use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use anyhow::{Context, Result};
use async_trait::async_trait;
use ldap3::controls::{self, RawControl};
use ldap3::{LdapConnAsync, LdapConnSettings, Mod, Scope, SearchEntry};

use crate::models::{DirectoryEntry, OUNode};
use crate::services::directory::DirectoryProvider;

/// LDAP attributes to retrieve for user searches.
const USER_ATTRS: &[&str] = &[
    "distinguishedName",
    "sAMAccountName",
    "displayName",
    "objectClass",
    "mail",
    "department",
    "title",
    "telephoneNumber",
    "givenName",
    "sn",
    "userPrincipalName",
    "userAccountControl",
    "lockoutTime",
    "accountExpires",
    "pwdLastSet",
    "lastLogon",
    "badPwdCount",
    "whenCreated",
    "whenChanged",
    "memberOf",
];

/// LDAP attributes to retrieve for computer searches.
const COMPUTER_ATTRS: &[&str] = &[
    "distinguishedName",
    "sAMAccountName",
    "cn",
    "dNSHostName",
    "operatingSystem",
    "operatingSystemVersion",
    "lastLogon",
    "userAccountControl",
    "memberOf",
    "objectClass",
];

/// LDAP attributes to retrieve for group searches.
const GROUP_ATTRS: &[&str] = &[
    "distinguishedName",
    "sAMAccountName",
    "displayName",
    "objectClass",
    "groupType",
    "member",
    "description",
];

/// Maximum allowed length for search input queries.
const MAX_SEARCH_INPUT_LENGTH: usize = 256;

/// Validates and sanitizes search input before LDAP query construction.
///
/// Applies defense-in-depth checks ported from the C# v0.1.0 implementation:
/// - Trims leading/trailing whitespace
/// - Rejects inputs exceeding 256 characters
/// - Rejects inputs containing ASCII control characters (U+0000..U+001F, U+007F)
///
/// Returns the trimmed input on success, or an error describing the validation failure.
pub fn validate_search_input(input: &str) -> Result<&str> {
    let trimmed = input.trim();

    if trimmed.len() > MAX_SEARCH_INPUT_LENGTH {
        anyhow::bail!(
            "Search query too long ({} chars, max {})",
            trimmed.len(),
            MAX_SEARCH_INPUT_LENGTH
        );
    }

    if trimmed.chars().any(|c| c.is_ascii_control()) {
        anyhow::bail!("Search query contains invalid control characters");
    }

    Ok(trimmed)
}

/// Escapes special characters in LDAP filter values.
///
/// LDAP filters must escape: `*`, `(`, `)`, `\`, and NUL.
pub fn ldap_escape(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            '\\' => output.push_str("\\5c"),
            '*' => output.push_str("\\2a"),
            '(' => output.push_str("\\28"),
            ')' => output.push_str("\\29"),
            '\0' => output.push_str("\\00"),
            _ => output.push(c),
        }
    }
    output
}

/// LDAP authentication mode selection.
///
/// Controls how the provider authenticates to the directory server at runtime.
/// The `gssapi` Cargo feature flag controls whether the GSSAPI dependency is
/// compiled in, but this enum selects the actual auth method used.
#[derive(Clone)]
pub enum LdapAuthMode {
    /// Kerberos authentication via GSSAPI (default, requires domain-joined machine).
    Gssapi,
    /// Simple bind with explicit credentials (for lab/test environments).
    SimpleBind { bind_dn: String, password: String },
}

impl std::fmt::Debug for LdapAuthMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Gssapi => write!(f, "Gssapi"),
            Self::SimpleBind { bind_dn, .. } => f
                .debug_struct("SimpleBind")
                .field("bind_dn", bind_dn)
                .field("password", &"[REDACTED]")
                .finish(),
        }
    }
}

/// `DirectoryProvider` implementation using on-premises Active Directory via LDAP.
///
/// Supports both GSSAPI (Kerberos) and simple bind authentication. The auth mode
/// is selected at runtime based on configuration. The connection is established
/// lazily on first use and reused across operations. `ldap3::Ldap` supports
/// multiplexing, so a single connection handles concurrent requests efficiently
/// without per-operation connect/bind overhead.
/// TLS configuration for LDAP connections.
#[derive(Debug, Clone, Default)]
pub struct LdapTlsConfig {
    /// Whether to use LDAPS (implicit TLS on port 636).
    pub enabled: bool,
    /// Whether to skip TLS certificate verification (lab environments only).
    pub skip_verify: bool,
}

pub struct LdapDirectoryProvider {
    domain: Option<String>,
    server_override: Option<String>,
    auth_mode: LdapAuthMode,
    tls_config: LdapTlsConfig,
    base_dn: Mutex<Option<String>>,
    connected: Mutex<bool>,
    /// Pooled LDAP connection. Reused across operations; recreated on failure.
    pool: tokio::sync::Mutex<Option<ldap3::Ldap>>,
    /// Authenticated user identity resolved via WhoAmI.
    authenticated_user: Mutex<Option<String>>,
}

/// Parses the server string and returns (host, use_tls).
///
/// Supports `ldaps://host`, `ldap://host`, or plain `host`.
fn parse_server_url(server: &str) -> (String, bool) {
    if let Some(rest) = server.strip_prefix("ldaps://") {
        // Remove trailing port if present
        let host = rest.split(':').next().unwrap_or(rest);
        (host.to_string(), true)
    } else if let Some(rest) = server.strip_prefix("ldap://") {
        let host = rest.split(':').next().unwrap_or(rest);
        (host.to_string(), false)
    } else {
        (server.to_string(), false)
    }
}

impl Default for LdapDirectoryProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl LdapDirectoryProvider {
    /// Creates a new `LdapDirectoryProvider` with GSSAPI authentication.
    ///
    /// Domain is auto-detected from the `USERDNSDOMAIN` environment variable.
    /// If the variable is not set, the provider operates in disconnected mode.
    pub fn new() -> Self {
        let domain = std::env::var("USERDNSDOMAIN").ok();
        match &domain {
            None => tracing::warn!(
                "USERDNSDOMAIN not set - not domain-joined, directory provider will be offline"
            ),
            Some(d) => tracing::info!("Domain detected: {}", d),
        }

        Self {
            domain,
            server_override: None,
            auth_mode: LdapAuthMode::Gssapi,
            tls_config: LdapTlsConfig::default(),
            base_dn: Mutex::new(None),
            connected: Mutex::new(false),
            pool: tokio::sync::Mutex::new(None),
            authenticated_user: Mutex::new(None),
        }
    }

    /// Creates a new `LdapDirectoryProvider` with simple bind authentication.
    ///
    /// Uses explicit credentials instead of Kerberos. The `server` parameter
    /// specifies the LDAP host (IP or hostname), bypassing `USERDNSDOMAIN`
    /// auto-detection.
    pub fn new_with_credentials(
        server: String,
        bind_dn: String,
        password: String,
        tls_config: LdapTlsConfig,
    ) -> Self {
        let (host, url_tls) = parse_server_url(&server);
        let effective_tls = LdapTlsConfig {
            enabled: tls_config.enabled || url_tls,
            skip_verify: tls_config.skip_verify,
        };

        tracing::warn!(
            server = %host,
            bind_dn = %bind_dn,
            tls = effective_tls.enabled,
            "Simple bind mode active - credentials-based authentication"
        );

        Self {
            domain: Some(host.clone()),
            server_override: Some(host),
            auth_mode: LdapAuthMode::SimpleBind { bind_dn, password },
            tls_config: effective_tls,
            base_dn: Mutex::new(None),
            connected: Mutex::new(false),
            pool: tokio::sync::Mutex::new(None),
            authenticated_user: Mutex::new(None),
        }
    }

    /// Returns the configured authentication mode.
    pub fn auth_mode(&self) -> &LdapAuthMode {
        &self.auth_mode
    }

    /// Returns the authenticated user identity resolved via WhoAmI.
    pub fn resolved_user(&self) -> Option<String> {
        self.authenticated_user.lock().unwrap().clone()
    }

    /// Returns a pooled LDAP connection, creating one if needed.
    ///
    /// The returned `Ldap` handle is a clone of the pooled connection.
    /// `ldap3::Ldap` supports multiplexing, so concurrent operations share
    /// the same underlying TCP connection and GSSAPI session.
    ///
    /// If the pooled connection is stale (operation fails), the caller should
    /// call `invalidate_connection()` to force a reconnect on the next call.
    async fn get_connection(&self) -> Result<ldap3::Ldap> {
        let mut guard = self.pool.lock().await;
        if let Some(ref ldap) = *guard {
            return Ok(ldap.clone());
        }
        let ldap = self.create_connection().await?;
        *guard = Some(ldap.clone());
        Ok(ldap)
    }

    /// Discards the pooled connection, forcing a fresh connect on next use.
    async fn invalidate_connection(&self) {
        let mut guard = self.pool.lock().await;
        *guard = None;
        *self.connected.lock().unwrap() = false;
        tracing::info!("LDAP connection pool invalidated - will reconnect on next operation");
    }

    /// Executes an LDAP operation with automatic reconnect on connection failure.
    ///
    /// On connection-level failure (timeout, reset, broken pipe, LDAP protocol
    /// errors), invalidates the pool and retries once with a fresh connection.
    /// Business logic errors (missing attributes, permission denied) are
    /// propagated without retry to avoid unnecessary reconnections.
    async fn with_connection<T, Op, Fut>(&self, operation: Op) -> Result<T>
    where
        Op: Fn(ldap3::Ldap) -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let ldap = self.get_connection().await?;
        match operation(ldap).await {
            Ok(result) => Ok(result),
            Err(err) => {
                let msg = err.to_string().to_lowercase();
                let is_connection_error = msg.contains("connection")
                    || msg.contains("timeout")
                    || msg.contains("broken pipe")
                    || msg.contains("reset")
                    || msg.contains("closed")
                    || msg.contains("ldap search error")
                    || msg.contains("ldap search failed")
                    || msg.contains("ldap paged search");
                if is_connection_error {
                    tracing::warn!("LDAP connection error, reconnecting: {}", err);
                    self.invalidate_connection().await;
                    let ldap = self.get_connection().await?;
                    operation(ldap).await
                } else {
                    Err(err)
                }
            }
        }
    }

    /// Establishes a new LDAP connection with the configured authentication mode.
    async fn create_connection(&self) -> Result<ldap3::Ldap> {
        let host = match &self.server_override {
            Some(server) => server.clone(),
            None => self
                .domain
                .as_ref()
                .context("No domain available - machine is not domain-joined")?
                .clone(),
        };

        let (scheme, port) = if self.tls_config.enabled {
            ("ldaps", 636)
        } else {
            ("ldap", 389)
        };
        tracing::debug!(host = %host, auth_mode = ?self.auth_mode, tls = self.tls_config.enabled, "Establishing LDAP connection");

        let mut settings =
            LdapConnSettings::new().set_conn_timeout(std::time::Duration::from_secs(10));
        if self.tls_config.skip_verify {
            settings = settings.set_no_tls_verify(true);
        }
        let url = format!("{}://{}:{}", scheme, host, port);
        let (conn, mut ldap) = LdapConnAsync::with_settings(settings, &url).await.context(
            if self.tls_config.enabled {
                "Failed to connect to LDAP server via LDAPS (TLS) - check certificate and port 636"
            } else {
                "Failed to connect to LDAP server"
            },
        )?;

        tokio::spawn(conn.drive());

        match &self.auth_mode {
            LdapAuthMode::SimpleBind { bind_dn, password } => {
                let result = ldap
                    .simple_bind(bind_dn, password)
                    .await
                    .context("Simple bind failed - connection error")?;
                if result.rc != 0 {
                    anyhow::bail!(
                        "Simple bind authentication failed (rc={}): invalid credentials or insufficient access",
                        result.rc
                    );
                }
                tracing::info!(bind_dn = %bind_dn, "Simple bind authentication successful");
            }
            LdapAuthMode::Gssapi => {
                #[cfg(feature = "gssapi")]
                ldap.sasl_gssapi_bind(&host)
                    .await
                    .context("GSSAPI (Kerberos) authentication failed")?;

                #[cfg(not(feature = "gssapi"))]
                ldap.simple_bind("", "")
                    .await
                    .context("Anonymous LDAP bind failed (build without gssapi feature)")?;
            }
        }

        // Discover base DN via rootDSE
        let (rs, _) = ldap
            .search(
                "",
                Scope::Base,
                "(objectClass=*)",
                vec!["defaultNamingContext"],
            )
            .await
            .context("Failed to query rootDSE")?
            .success()
            .context("rootDSE query returned error")?;

        if let Some(entry) = rs.into_iter().next() {
            let se = SearchEntry::construct(entry);
            if let Some(dn) = se
                .attrs
                .get("defaultNamingContext")
                .and_then(|v| v.first().cloned())
            {
                tracing::info!("Base DN discovered: {}", dn);
                *self.base_dn.lock().unwrap() = Some(dn);
            }
        }

        *self.connected.lock().unwrap() = true;
        Ok(ldap)
    }

    /// Reads the current `userAccountControl` value for a user.
    async fn get_user_account_control(&self, user_dn: &str) -> Result<u32> {
        let dn = user_dn.to_string();
        self.with_connection(|mut ldap| {
            let dn = dn.clone();
            async move {
                let (rs, _) = ldap
                    .search(
                        &dn,
                        Scope::Base,
                        "(objectClass=*)",
                        vec!["userAccountControl"],
                    )
                    .await
                    .context("Failed to read userAccountControl")?
                    .success()
                    .context("userAccountControl read returned error")?;

                let entry = rs
                    .into_iter()
                    .next()
                    .context("User not found when reading userAccountControl")?;
                let se = SearchEntry::construct(entry);
                let uac_str = se
                    .attrs
                    .get("userAccountControl")
                    .and_then(|v| v.first())
                    .context("userAccountControl attribute not present")?;
                uac_str
                    .parse::<u32>()
                    .context("Failed to parse userAccountControl value")
            }
        })
        .await
    }

    /// Performs an LDAP search and maps results to `DirectoryEntry` objects.
    ///
    /// Uses LDAP paged results control to retrieve results in pages of 500,
    /// avoiding AD's default MaxPageSize (1000) limit. Results are capped
    /// at `max_results` client-side.
    async fn search(
        &self,
        filter: &str,
        attrs: &[&str],
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>> {
        if self.domain.is_none() {
            tracing::debug!("Directory search skipped - not domain-joined");
            return Ok(Vec::new());
        }

        let base = self.base_dn.lock().unwrap().clone().unwrap_or_default();
        let filter = filter.to_string();
        let attrs: Vec<String> = attrs.iter().map(|a| a.to_string()).collect();

        if max_results <= 1000 {
            // Simple search without pagination (within AD's default MaxPageSize).
            tracing::info!(filter = %filter, max_results, base = %base, "Search: simple path");
            self.with_connection(|mut ldap| {
                let base = base.clone();
                let filter = filter.clone();
                let attrs = attrs.clone();
                async move {
                    let search_result = ldap
                        .search(&base, Scope::Subtree, &filter, attrs)
                        .await
                        .context("LDAP search failed")?;

                    let rc = search_result.1.rc;

                    // rc=0: success, rc=4: sizeLimitExceeded (partial results OK)
                    if rc != 0 && rc != 4 {
                        anyhow::bail!("LDAP search error (rc={}): {}", rc, search_result.1.text);
                    }

                    let rs = search_result.0;

                    let entries: Vec<DirectoryEntry> = rs
                        .into_iter()
                        .take(max_results)
                        .map(|entry| search_entry_to_directory_entry(SearchEntry::construct(entry)))
                        .collect();

                    tracing::debug!(count = entries.len(), rc, "Search: simple path complete");
                    Ok(entries)
                }
            })
            .await
        } else {
            // Paged search: create a dedicated connection inside the retry
            // loop so stale connections are handled automatically.
            let domain = self.domain.clone();
            let server_override = self.server_override.clone();
            let auth_mode = self.auth_mode.clone();
            let tls_config = self.tls_config.clone();

            self.with_connection(|_pooled_ldap| {
                let base = base.clone();
                let filter = filter.clone();
                let attrs = attrs.clone();
                let domain = domain.clone();
                let server_override = server_override.clone();
                let auth_mode = auth_mode.clone();
                let tls_config = tls_config.clone();
                async move {
                    // Use a fresh dedicated connection for paged search
                    // to avoid leaking controls into the shared pool.
                    let mut ldap =
                        create_fresh_connection(&domain, &server_override, &auth_mode, &tls_config)
                            .await?;

                    let page_size = 500_i32;
                    let mut all_entries = Vec::new();
                    let mut cookie: Vec<u8> = Vec::new();

                    loop {
                        let pr_control: RawControl = controls::PagedResults {
                            size: page_size,
                            cookie: cookie.clone(),
                        }
                        .into();
                        ldap.with_controls(vec![pr_control]);

                        let (rs, result) = ldap
                            .search(&base, Scope::Subtree, &filter, attrs.clone())
                            .await
                            .context("LDAP paged search failed")?
                            .success()
                            .context("LDAP paged search returned error")?;

                        for entry in rs {
                            all_entries.push(search_entry_to_directory_entry(
                                SearchEntry::construct(entry),
                            ));
                        }

                        if all_entries.len() >= max_results {
                            all_entries.truncate(max_results);
                            break;
                        }

                        cookie = Vec::new();
                        for ctrl in &result.ctrls {
                            if let controls::Control(
                                Some(controls::ControlType::PagedResults),
                                ref raw,
                            ) = *ctrl
                            {
                                let pr: controls::PagedResults = raw.parse();
                                cookie = pr.cookie;
                            }
                        }

                        if cookie.is_empty() {
                            break;
                        }
                    }

                    Ok(all_entries)
                }
            })
            .await
        }
    }
}

/// Converts a binary SID to its string representation (e.g., "S-1-5-21-...-512").
///
/// SID binary format:
/// - Byte 0: revision (always 1)
/// - Byte 1: sub-authority count
/// - Bytes 2-7: identifier authority (big-endian 48-bit)
/// - Bytes 8+: sub-authorities (4 bytes each, little-endian)
fn sid_bytes_to_string(bytes: &[u8]) -> String {
    if bytes.len() < 8 {
        return String::new();
    }
    let revision = bytes[0];
    let sub_authority_count = bytes[1] as usize;
    let authority = u64::from(bytes[2]) << 40
        | u64::from(bytes[3]) << 32
        | u64::from(bytes[4]) << 24
        | u64::from(bytes[5]) << 16
        | u64::from(bytes[6]) << 8
        | u64::from(bytes[7]);

    let mut sid = format!("S-{}-{}", revision, authority);
    for i in 0..sub_authority_count {
        let offset = 8 + i * 4;
        if offset + 4 > bytes.len() {
            break;
        }
        let sub = u32::from_le_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ]);
        sid.push_str(&format!("-{}", sub));
    }
    sid
}

/// Creates a fresh LDAP connection without using the pool.
///
/// Used for paged searches that need dedicated connections to avoid
/// leaking pagination controls into the shared pool.
async fn create_fresh_connection(
    domain: &Option<String>,
    server_override: &Option<String>,
    auth_mode: &LdapAuthMode,
    tls_config: &LdapTlsConfig,
) -> Result<ldap3::Ldap> {
    let host = match server_override {
        Some(server) => server.clone(),
        None => domain.as_ref().context("No domain available")?.clone(),
    };

    let (scheme, port) = if tls_config.enabled {
        ("ldaps", 636)
    } else {
        ("ldap", 389)
    };
    let mut settings = LdapConnSettings::new().set_conn_timeout(std::time::Duration::from_secs(10));
    if tls_config.skip_verify {
        settings = settings.set_no_tls_verify(true);
    }
    let url = format!("{}://{}:{}", scheme, host, port);
    let (conn, mut ldap) = LdapConnAsync::with_settings(settings, &url)
        .await
        .context("Failed to connect to LDAP server")?;

    tokio::spawn(conn.drive());

    match auth_mode {
        LdapAuthMode::SimpleBind { bind_dn, password } => {
            let result = ldap
                .simple_bind(bind_dn, password)
                .await
                .context("Simple bind failed")?;
            if result.rc != 0 {
                anyhow::bail!("Simple bind authentication failed (rc={})", result.rc);
            }
        }
        LdapAuthMode::Gssapi => {
            #[cfg(feature = "gssapi")]
            ldap.sasl_gssapi_bind(&host)
                .await
                .context("GSSAPI authentication failed")?;

            #[cfg(not(feature = "gssapi"))]
            ldap.simple_bind("", "")
                .await
                .context("Anonymous bind failed")?;
        }
    }

    Ok(ldap)
}

/// Modifies the DACL to set or clear the "User Cannot Change Password" deny ACEs.
async fn set_cannot_change_password_with_ldap(
    user_dn: &str,
    deny: bool,
    ldap: &mut ldap3::Ldap,
) -> Result<()> {
    let (rs, _) = ldap
        .search(
            user_dn,
            Scope::Base,
            "(objectClass=*)",
            vec!["nTSecurityDescriptor"],
        )
        .await
        .context("Failed to read nTSecurityDescriptor")?
        .success()
        .context("nTSecurityDescriptor read returned error")?;

    let entry = rs
        .into_iter()
        .next()
        .context("User not found when reading security descriptor")?;
    let se = ldap3::SearchEntry::construct(entry);

    let sd_bytes = se
        .bin_attrs
        .get("nTSecurityDescriptor")
        .and_then(|v| v.first())
        .context("nTSecurityDescriptor binary attribute not present")?;

    let modified_sd = crate::services::dacl::set_cannot_change_password(sd_bytes, deny)
        .context("Failed to modify security descriptor DACL")?;

    let mods: Vec<Mod<Vec<u8>>> = vec![Mod::Replace(
        b"nTSecurityDescriptor".to_vec(),
        HashSet::from([modified_sd]),
    )];

    ldap.modify(user_dn, mods)
        .await
        .context("Failed to write modified nTSecurityDescriptor")?
        .success()
        .context("nTSecurityDescriptor write returned error")?;

    tracing::info!(
        target_dn = %user_dn,
        deny,
        "DACL modified for User Cannot Change Password"
    );
    Ok(())
}

/// Converts an `ldap3::SearchEntry` to a `DirectoryEntry`.
fn search_entry_to_directory_entry(se: SearchEntry) -> DirectoryEntry {
    let sam = se
        .attrs
        .get("sAMAccountName")
        .and_then(|v| v.first().cloned());
    let display = se.attrs.get("displayName").and_then(|v| v.first().cloned());
    let object_class = se.attrs.get("objectClass").and_then(|v| v.last().cloned());

    let mut attributes: HashMap<String, Vec<String>> = HashMap::new();
    for (key, values) in se.attrs {
        attributes.insert(key, values);
    }

    DirectoryEntry {
        distinguished_name: se.dn,
        sam_account_name: sam,
        display_name: display,
        object_class,
        attributes,
    }
}

#[async_trait]
impl DirectoryProvider for LdapDirectoryProvider {
    fn is_connected(&self) -> bool {
        *self.connected.lock().unwrap()
    }

    fn domain_name(&self) -> Option<&str> {
        self.domain.as_deref()
    }

    fn base_dn(&self) -> Option<String> {
        self.base_dn.lock().unwrap().clone()
    }

    async fn test_connection(&self) -> Result<bool> {
        if self.domain.is_none() {
            return Ok(false);
        }
        match self.get_connection().await {
            Ok(_) => Ok(true),
            Err(e) => {
                tracing::warn!("Connection test failed: {}", e);
                self.invalidate_connection().await;
                Ok(false)
            }
        }
    }

    async fn search_users(&self, filter: &str, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        let validated = validate_search_input(filter)?;
        let escaped = ldap_escape(validated);
        let ldap_filter = format!(
            "(&(objectClass=user)(objectCategory=person)\
             (|(sAMAccountName=*{}*)(displayName=*{}*)(userPrincipalName=*{}*)))",
            escaped, escaped, escaped
        );
        self.search(&ldap_filter, USER_ATTRS, max_results).await
    }

    async fn search_computers(
        &self,
        filter: &str,
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>> {
        let validated = validate_search_input(filter)?;
        let escaped = ldap_escape(validated);
        let ldap_filter = format!(
            "(&(objectClass=computer)(|(cn=*{}*)(dNSHostName=*{}*)))",
            escaped, escaped
        );
        self.search(&ldap_filter, COMPUTER_ATTRS, max_results).await
    }

    async fn search_groups(&self, filter: &str, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        let validated = validate_search_input(filter)?;
        let escaped = ldap_escape(validated);
        let ldap_filter = format!(
            "(&(objectClass=group)(|(sAMAccountName=*{}*)(displayName=*{}*)))",
            escaped, escaped
        );
        self.search(&ldap_filter, GROUP_ATTRS, max_results).await
    }

    async fn browse_users(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        let ldap_filter = "(&(objectClass=user)(objectCategory=person))";
        self.search(ldap_filter, USER_ATTRS, max_results).await
    }

    async fn browse_computers(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        let ldap_filter = "(objectClass=computer)";
        self.search(ldap_filter, COMPUTER_ATTRS, max_results).await
    }

    async fn browse_groups(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        let ldap_filter = "(objectClass=group)";
        self.search(ldap_filter, GROUP_ATTRS, max_results).await
    }

    async fn delete_object(&self, dn: &str) -> Result<()> {
        let dn_owned = dn.to_string();
        self.with_connection(|mut ldap| {
            let dn_owned = dn_owned.clone();
            async move {
                ldap.delete(&dn_owned)
                    .await
                    .context("Failed to delete object")?
                    .success()
                    .context("Delete object LDAP operation returned error")?;

                tracing::info!(dn = %dn_owned, "Object deleted");
                Ok(())
            }
        })
        .await
    }

    async fn remove_group_member(&self, group_dn: &str, member_dn: &str) -> Result<()> {
        let g = group_dn.to_string();
        let m = member_dn.to_string();
        self.with_connection(|mut ldap| {
            let g = g.clone();
            let m = m.clone();
            async move {
                ldap.modify(
                    &g,
                    vec![Mod::Delete(
                        "member".to_string(),
                        HashSet::from([m.clone()]),
                    )],
                )
                .await
                .context("Failed to remove member from group")?
                .success()
                .context("Remove group member LDAP operation returned error")?;

                tracing::info!(
                    group_dn = %g,
                    member_dn = %m,
                    "Member removed from group"
                );
                Ok(())
            }
        })
        .await
    }

    async fn get_user_by_identity(&self, sam_account_name: &str) -> Result<Option<DirectoryEntry>> {
        let validated = validate_search_input(sam_account_name)?;
        let escaped = ldap_escape(validated);
        let ldap_filter = format!(
            "(&(objectClass=user)(objectCategory=person)(sAMAccountName={}))",
            escaped
        );
        // Fetch all attributes for single-user detail view (advanced attributes)
        let results = self.search(&ldap_filter, &["*"], 1).await?;
        Ok(results.into_iter().next())
    }

    async fn get_group_members(
        &self,
        group_dn: &str,
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>> {
        let validated = validate_search_input(group_dn)?;
        let escaped = ldap_escape(validated);
        let ldap_filter = format!(
            "(&(|(objectClass=user)(objectClass=group))(memberOf={}))",
            escaped
        );
        self.search(&ldap_filter, USER_ATTRS, max_results).await
    }

    async fn reset_password(
        &self,
        user_dn: &str,
        new_password: &str,
        must_change_at_next_logon: bool,
    ) -> Result<()> {
        let dn = user_dn.to_string();
        let password = new_password.to_string();

        self.with_connection(|mut ldap| {
            let dn = dn.clone();
            let password = password.clone();
            async move {
                // AD requires unicodePwd as a quoted UTF-16LE byte array
                let quoted = format!("\"{}\"", password);
                let utf16le: Vec<u8> = quoted
                    .encode_utf16()
                    .flat_map(|c| c.to_le_bytes())
                    .collect();

                let mut mods: Vec<Mod<Vec<u8>>> = vec![Mod::Replace(
                    b"unicodePwd".to_vec(),
                    HashSet::from([utf16le]),
                )];

                if must_change_at_next_logon {
                    mods.push(Mod::Replace(
                        b"pwdLastSet".to_vec(),
                        HashSet::from([b"0".to_vec()]),
                    ));
                }

                ldap.modify(&dn, mods)
                    .await
                    .context("Failed to reset password")?
                    .success()
                    .context("Password reset LDAP operation returned error")?;

                tracing::info!(target_dn = %dn, "Password reset completed");
                Ok(())
            }
        })
        .await
    }

    async fn unlock_account(&self, user_dn: &str) -> Result<()> {
        let dn = user_dn.to_string();
        self.with_connection(|mut ldap| {
            let dn = dn.clone();
            async move {
                ldap.modify(
                    &dn,
                    vec![Mod::Replace(
                        "lockoutTime".to_string(),
                        HashSet::from(["0".to_string()]),
                    )],
                )
                .await
                .context("Failed to unlock account")?
                .success()
                .context("Unlock LDAP operation returned error")?;

                tracing::info!(target_dn = %dn, "Account unlocked");
                Ok(())
            }
        })
        .await
    }

    async fn enable_account(&self, user_dn: &str) -> Result<()> {
        let uac = self.get_user_account_control(user_dn).await?;
        let new_uac = uac & !0x0002; // Clear ACCOUNTDISABLE flag

        let dn = user_dn.to_string();
        self.with_connection(|mut ldap| {
            let dn = dn.clone();
            async move {
                ldap.modify(
                    &dn,
                    vec![Mod::Replace(
                        "userAccountControl".to_string(),
                        HashSet::from([new_uac.to_string()]),
                    )],
                )
                .await
                .context("Failed to enable account")?
                .success()
                .context("Enable LDAP operation returned error")?;

                tracing::info!(target_dn = %dn, "Account enabled");
                Ok(())
            }
        })
        .await
    }

    async fn disable_account(&self, user_dn: &str) -> Result<()> {
        let uac = self.get_user_account_control(user_dn).await?;
        let new_uac = uac | 0x0002; // Set ACCOUNTDISABLE flag

        let dn = user_dn.to_string();
        self.with_connection(|mut ldap| {
            let dn = dn.clone();
            async move {
                ldap.modify(
                    &dn,
                    vec![Mod::Replace(
                        "userAccountControl".to_string(),
                        HashSet::from([new_uac.to_string()]),
                    )],
                )
                .await
                .context("Failed to disable account")?
                .success()
                .context("Disable LDAP operation returned error")?;

                tracing::info!(target_dn = %dn, "Account disabled");
                Ok(())
            }
        })
        .await
    }

    async fn get_cannot_change_password(&self, user_dn: &str) -> Result<bool> {
        let dn = user_dn.to_string();
        self.with_connection(|mut ldap| {
            let dn = dn.clone();
            async move {
                let (rs, _) = ldap
                    .search(
                        &dn,
                        Scope::Base,
                        "(objectClass=*)",
                        vec!["nTSecurityDescriptor"],
                    )
                    .await
                    .context("Failed to read nTSecurityDescriptor")?
                    .success()
                    .context("nTSecurityDescriptor read returned error")?;

                let entry = rs
                    .into_iter()
                    .next()
                    .context("User not found when reading security descriptor")?;
                let se = ldap3::SearchEntry::construct(entry);
                let sd_bytes = se
                    .bin_attrs
                    .get("nTSecurityDescriptor")
                    .and_then(|v| v.first())
                    .context("nTSecurityDescriptor binary attribute not present")?;

                crate::services::dacl::is_cannot_change_password(sd_bytes)
                    .context("Failed to parse security descriptor DACL")
            }
        })
        .await
    }

    async fn set_password_flags(
        &self,
        user_dn: &str,
        password_never_expires: bool,
        user_cannot_change_password: bool,
    ) -> Result<()> {
        let uac = self.get_user_account_control(user_dn).await?;
        let mut new_uac = uac;

        // DONT_EXPIRE_PASSWD = 0x10000
        if password_never_expires {
            new_uac |= 0x10000;
        } else {
            new_uac &= !0x10000;
        }

        let dn = user_dn.to_string();
        self.with_connection(|mut ldap| {
            let dn = dn.clone();
            async move {
                ldap.modify(
                    &dn,
                    vec![Mod::Replace(
                        "userAccountControl".to_string(),
                        HashSet::from([new_uac.to_string()]),
                    )],
                )
                .await
                .context("Failed to set password flags")?
                .success()
                .context("Set password flags LDAP operation returned error")?;

                // PASSWD_CANT_CHANGE: modify the object's DACL to add/remove deny ACEs
                // for the "Change Password" extended right
                set_cannot_change_password_with_ldap(&dn, user_cannot_change_password, &mut ldap)
                    .await?;

                tracing::info!(
                    target_dn = %dn,
                    password_never_expires,
                    user_cannot_change_password,
                    "Password flags updated"
                );
                Ok(())
            }
        })
        .await
    }

    async fn get_current_user_groups(&self) -> Result<Vec<String>> {
        // Use LDAP "Who Am I" extended operation to determine the authenticated
        // identity. This works correctly for both GSSAPI (including runas) and
        // simple bind. The response is "u:DOMAIN\user" or "dn:CN=...",
        // from which we extract the sAMAccountName.
        let username: String = self
            .with_connection(|mut ldap| async move {
                let (exop, _) = ldap
                    .extended(ldap3::exop::WhoAmI)
                    .await
                    .context("WhoAmI extended operation failed")?
                    .success()
                    .context("WhoAmI returned error")?;

                let authzid = exop
                    .val
                    .and_then(|v| String::from_utf8(v).ok())
                    .unwrap_or_default();

                // Parse authzid: "u:DOMAIN\user" or "dn:CN=User,CN=Users,..."
                let name: String = if let Some(domain_user) = authzid.strip_prefix("u:") {
                    // "u:DSPANEL\TestAdmin" -> "TestAdmin"
                    domain_user
                        .split('\\')
                        .next_back()
                        .unwrap_or(domain_user)
                        .to_string()
                } else if let Some(dn) = authzid.strip_prefix("dn:") {
                    // "dn:CN=TestAdmin,CN=Users,..." -> "TestAdmin"
                    dn.split(',')
                        .next()
                        .and_then(|rdn: &str| rdn.strip_prefix("CN="))
                        .unwrap_or("")
                        .to_string()
                } else {
                    authzid
                };

                Ok(name)
            })
            .await?;

        if username.is_empty() {
            tracing::warn!("Could not determine authenticated user identity");
            return Ok(Vec::new());
        }

        tracing::info!(username = %username, "Authenticated identity resolved");
        // Store the resolved identity for later retrieval
        *self.authenticated_user.lock().unwrap() = Some(username.clone());
        let user = self.get_user_by_identity(&username).await?;
        match user {
            Some(entry) => {
                let mut results = entry.get_attribute_values("memberOf").to_vec();

                // Also fetch tokenGroups (operational attribute, not returned by *)
                // to get SID strings for language-independent permission detection.
                let dn = entry.distinguished_name.clone();
                let sids = self
                    .with_connection(|mut ldap| {
                        let dn = dn.clone();
                        async move {
                            let (rs, _) = ldap
                                .search(&dn, Scope::Base, "(objectClass=*)", vec!["tokenGroups"])
                                .await
                                .context("Failed to query tokenGroups")?
                                .success()
                                .context("tokenGroups query returned error")?;

                            let mut sids = Vec::new();
                            if let Some(entry) = rs.into_iter().next() {
                                let se = SearchEntry::construct(entry);
                                if let Some(token_groups) = se.bin_attrs.get("tokenGroups") {
                                    for sid_bytes in token_groups {
                                        sids.push(sid_bytes_to_string(sid_bytes));
                                    }
                                }
                            }
                            Ok(sids)
                        }
                    })
                    .await
                    .unwrap_or_default();

                tracing::info!(
                    sid_count = sids.len(),
                    group_count = results.len(),
                    "User groups and SIDs retrieved"
                );
                results.extend(sids);
                Ok(results)
            }
            None => {
                tracing::warn!("Current user {} not found in directory", username);
                Ok(Vec::new())
            }
        }
    }

    async fn add_user_to_group(&self, user_dn: &str, group_dn: &str) -> Result<()> {
        let u = user_dn.to_string();
        let g = group_dn.to_string();
        self.with_connection(|mut ldap| {
            let u = u.clone();
            let g = g.clone();
            async move {
                ldap.modify(
                    &g,
                    vec![Mod::Add("member".to_string(), HashSet::from([u.clone()]))],
                )
                .await
                .context("Failed to add user to group")?
                .success()
                .context("Add user to group LDAP operation returned error")?;

                tracing::info!(
                    user_dn = %u,
                    group_dn = %g,
                    "User added to group"
                );
                Ok(())
            }
        })
        .await
    }

    async fn get_replication_metadata(&self, object_dn: &str) -> Result<Option<String>> {
        let _base_dn = self.base_dn().context("Not connected - no base DN")?;
        let dn = object_dn.to_string();
        self.with_connection(|mut ldap| {
            let dn = dn.clone();
            async move {
                let (entries, _) = ldap
                    .search(
                        &dn,
                        ldap3::Scope::Base,
                        "(objectClass=*)",
                        vec!["msDS-ReplAttributeMetaData"],
                    )
                    .await
                    .context("Failed to query replication metadata")?
                    .success()
                    .context("Replication metadata LDAP query returned error")?;

                if let Some(entry) = entries.into_iter().next() {
                    let se = ldap3::SearchEntry::construct(entry);
                    if let Some(values) = se.attrs.get("msDS-ReplAttributeMetaData") {
                        if let Some(raw) = values.first() {
                            return Ok(Some(raw.clone()));
                        }
                    }
                }

                Ok(None)
            }
        })
        .await
    }

    async fn get_replication_value_metadata(&self, object_dn: &str) -> Result<Option<String>> {
        let _base_dn = self.base_dn().context("Not connected - no base DN")?;
        let dn = object_dn.to_string();
        self.with_connection(|mut ldap| {
            let dn = dn.clone();
            async move {
                let (entries, _) = ldap
                    .search(
                        &dn,
                        ldap3::Scope::Base,
                        "(objectClass=*)",
                        vec!["msDS-ReplValueMetaData"],
                    )
                    .await
                    .context("Failed to query replication value metadata")?
                    .success()
                    .context("Replication value metadata LDAP query returned error")?;

                if let Some(entry) = entries.into_iter().next() {
                    let se = ldap3::SearchEntry::construct(entry);
                    if let Some(values) = se.attrs.get("msDS-ReplValueMetaData") {
                        if let Some(raw) = values.first() {
                            return Ok(Some(raw.clone()));
                        }
                    }
                }

                Ok(None)
            }
        })
        .await
    }

    async fn get_nested_groups(&self, user_dn: &str) -> Result<Vec<String>> {
        if self.domain.is_none() {
            return Ok(Vec::new());
        }

        let base = self.base_dn.lock().unwrap().clone().unwrap_or_default();
        let dn = user_dn.to_string();
        self.with_connection(|mut ldap| {
            let base = base.clone();
            let dn = dn.clone();
            async move {
                // LDAP_MATCHING_RULE_IN_CHAIN resolves transitive membership
                let filter = format!(
                    "(&(objectClass=group)(member:1.2.840.113556.1.4.1941:={}))",
                    dn
                );
                let (rs, _) = ldap
                    .search(&base, Scope::Subtree, &filter, vec!["distinguishedName"])
                    .await
                    .context("Failed to query nested groups")?
                    .success()
                    .context("Nested groups LDAP query returned error")?;

                let groups: Vec<String> = rs
                    .into_iter()
                    .map(|entry| SearchEntry::construct(entry).dn)
                    .collect();

                Ok(groups)
            }
        })
        .await
    }

    async fn get_ou_tree(&self) -> Result<Vec<OUNode>> {
        if self.domain.is_none() {
            return Ok(Vec::new());
        }

        let base = self.base_dn.lock().unwrap().clone().unwrap_or_default();
        self.with_connection(|mut ldap| {
            let base = base.clone();
            async move {
                let (rs, _) = ldap
                    .search(
                        &base,
                        Scope::Subtree,
                        "(objectClass=organizationalUnit)",
                        vec!["distinguishedName", "name"],
                    )
                    .await
                    .context("Failed to query OU tree")?
                    .success()
                    .context("OU tree LDAP query returned error")?;

                let mut flat_ous: Vec<(String, String)> = rs
                    .into_iter()
                    .map(|entry| {
                        let se = SearchEntry::construct(entry);
                        let name = se
                            .attrs
                            .get("name")
                            .and_then(|v| v.first().cloned())
                            .unwrap_or_default();
                        (se.dn, name)
                    })
                    .collect();

                flat_ous.sort_by(|a, b| a.1.to_lowercase().cmp(&b.1.to_lowercase()));
                Ok(build_ou_tree(&flat_ous, &base))
            }
        })
        .await
    }

    async fn create_group(
        &self,
        name: &str,
        container_dn: &str,
        scope: &str,
        category: &str,
        description: &str,
    ) -> Result<String> {
        let dn = format!("CN={},{}", name, container_dn);

        // Compute groupType value from scope and category
        let scope_bits: i32 = match scope {
            "DomainLocal" => 0x4,
            "Universal" => 0x8,
            _ => 0x2, // Global
        };
        let category_bit: i32 = if category == "Distribution" {
            0
        } else {
            -2_147_483_648_i32 // 0x80000000 - Security
        };
        let group_type = scope_bits | category_bit;

        let dn_clone = dn.clone();
        let name_owned = name.to_string();
        let desc_owned = description.to_string();
        self.with_connection(|mut ldap| {
            let dn = dn_clone.clone();
            let name_owned = name_owned.clone();
            let desc_owned = desc_owned.clone();
            async move {
                let mut attrs = vec![
                    (
                        "objectClass".to_string(),
                        HashSet::from(["group".to_string()]),
                    ),
                    ("sAMAccountName".to_string(), HashSet::from([name_owned])),
                    (
                        "groupType".to_string(),
                        HashSet::from([group_type.to_string()]),
                    ),
                ];
                if !desc_owned.is_empty() {
                    attrs.push(("description".to_string(), HashSet::from([desc_owned])));
                }

                ldap.add(&dn, attrs)
                    .await
                    .context("Failed to create group")?
                    .success()
                    .context("Create group LDAP operation returned error")?;

                tracing::info!(dn = %dn, "Group created");
                Ok(dn)
            }
        })
        .await
    }

    async fn move_object(&self, object_dn: &str, target_container_dn: &str) -> Result<()> {
        // Extract the RDN (first component) from the object DN
        let rdn = object_dn
            .split(',')
            .next()
            .context("Invalid DN: cannot extract RDN")?
            .to_string();

        let target = target_container_dn.to_string();
        self.with_connection(|mut ldap| {
            let rdn = rdn.clone();
            let target = target.clone();
            async move {
                ldap.modifydn(object_dn, &rdn, true, Some(&target))
                    .await
                    .context("Failed to move object")?
                    .success()
                    .context("Move object LDAP operation returned error")?;

                tracing::info!(
                    object_dn = %object_dn,
                    target = %target,
                    "Object moved"
                );
                Ok(())
            }
        })
        .await
    }

    async fn update_managed_by(&self, group_dn: &str, manager_dn: &str) -> Result<()> {
        let g = group_dn.to_string();
        let m = manager_dn.to_string();
        self.with_connection(|mut ldap| {
            let g = g.clone();
            let m = m.clone();
            async move {
                ldap.modify(
                    &g,
                    vec![Mod::Replace(
                        "managedBy".to_string(),
                        HashSet::from([m.clone()]),
                    )],
                )
                .await
                .context("Failed to update managedBy")?
                .success()
                .context("Update managedBy LDAP operation returned error")?;

                tracing::info!(
                    group_dn = %g,
                    manager_dn = %m,
                    "managedBy updated"
                );
                Ok(())
            }
        })
        .await
    }

    fn authenticated_user(&self) -> Option<String> {
        self.resolved_user()
    }

    async fn probe_effective_permissions(&self) -> Result<(bool, bool, bool)> {
        if self.domain.is_none() {
            return Ok((false, false, false));
        }

        let base_dn = self.base_dn().unwrap_or_default();

        // Phase 1: Get all OUs with allowedChildClassesEffective in a single query.
        // This covers probe 3 (can_create) and gives us the OU list for probes 1 & 2.
        let ous: Vec<String> = self
            .with_connection(|mut ldap| {
                let base_dn = base_dn.clone();
                async move {
                    let search_result = ldap
                        .search(
                            &base_dn,
                            Scope::Subtree,
                            "(objectClass=organizationalUnit)",
                            vec!["distinguishedName"],
                        )
                        .await
                        .context("Probe: OU enumeration failed")?;

                    let dns: Vec<String> = search_result
                        .0
                        .into_iter()
                        .map(|e| SearchEntry::construct(e).dn)
                        .collect();
                    Ok(dns)
                }
            })
            .await
            .unwrap_or_default();

        tracing::info!(ou_count = ous.len(), "Probe: enumerated OUs");

        // Also check containers (CN=Users, CN=Builtin, etc.)
        let mut probe_bases: Vec<String> = ous;
        probe_bases.push(base_dn.clone());

        // Probe 3: Check allowedChildClassesEffective on all OUs
        let can_create = self
            .with_connection(|mut ldap| {
                let probe_bases = probe_bases.clone();
                async move {
                    for ou_dn in &probe_bases {
                        let search_result = ldap
                            .search(
                                ou_dn,
                                Scope::Base,
                                "(objectClass=*)",
                                vec!["allowedChildClassesEffective"],
                            )
                            .await;

                        if let Ok(result) = search_result {
                            if let Some(entry) = result.0.into_iter().next() {
                                let se = SearchEntry::construct(entry);
                                if let Some(classes) = se.attrs.get("allowedChildClassesEffective")
                                {
                                    if classes.iter().any(|c| c.eq_ignore_ascii_case("user")) {
                                        return Ok(true);
                                    }
                                }
                            }
                        }
                    }
                    Ok(false)
                }
            })
            .await
            .unwrap_or(false);

        // Phase 2: For each OU, sample ONE user and ONE group to check
        // allowedAttributesEffective. Early return as soon as we find a match.

        // Probe 1: Check lockoutTime writable on any user (HelpDesk)
        let can_write_user = self
            .with_connection(|mut ldap| {
                let probe_bases = probe_bases.clone();
                async move {
                    for ou_dn in &probe_bases {
                        let search_result = ldap
                            .with_search_options(ldap3::SearchOptions::new().sizelimit(1))
                            .search(
                                ou_dn,
                                Scope::OneLevel,
                                "(&(objectClass=user)(objectCategory=person))",
                                vec!["allowedAttributesEffective"],
                            )
                            .await;

                        if let Ok(result) = search_result {
                            for entry in result.0 {
                                let se = SearchEntry::construct(entry);
                                if let Some(attrs) = se.attrs.get("allowedAttributesEffective") {
                                    if attrs.iter().any(|a| a.eq_ignore_ascii_case("lockoutTime")) {
                                        return Ok(true);
                                    }
                                }
                            }
                        }
                    }
                    Ok(false)
                }
            })
            .await
            .unwrap_or(false);

        // Probe 2: Check member writable on any group (AccountOperator)
        let can_write_group = self
            .with_connection(|mut ldap| {
                let probe_bases = probe_bases.clone();
                async move {
                    for ou_dn in &probe_bases {
                        let search_result = ldap
                            .with_search_options(ldap3::SearchOptions::new().sizelimit(1))
                            .search(
                                ou_dn,
                                Scope::OneLevel,
                                "(objectClass=group)",
                                vec!["allowedAttributesEffective"],
                            )
                            .await;

                        if let Ok(result) = search_result {
                            for entry in result.0 {
                                let se = SearchEntry::construct(entry);
                                if let Some(attrs) = se.attrs.get("allowedAttributesEffective") {
                                    if attrs.iter().any(|a| a.eq_ignore_ascii_case("member")) {
                                        return Ok(true);
                                    }
                                }
                            }
                        }
                    }
                    Ok(false)
                }
            })
            .await
            .unwrap_or(false);

        tracing::info!(
            can_write_user,
            can_write_group,
            can_create,
            "Permission probe results"
        );

        Ok((can_write_user, can_write_group, can_create))
    }

    async fn get_schema_attributes(&self) -> Result<Vec<String>> {
        if self.domain.is_none() {
            return Ok(Vec::new());
        }

        // Use a dedicated connection to avoid mutating shared base_dn
        let mut ldap = create_fresh_connection(
            &self.domain,
            &self.server_override,
            &self.auth_mode,
            &self.tls_config,
        )
        .await?;

        // Discover schema naming context via rootDSE
        let (rs, _) = ldap
            .search(
                "",
                Scope::Base,
                "(objectClass=*)",
                vec!["schemaNamingContext"],
            )
            .await
            .context("Failed to query rootDSE for schema DN")?
            .success()
            .context("rootDSE schema query returned error")?;

        let schema_dn = rs
            .into_iter()
            .next()
            .and_then(|entry| {
                let se = SearchEntry::construct(entry);
                se.attrs
                    .get("schemaNamingContext")
                    .and_then(|v| v.first().cloned())
            })
            .context("schemaNamingContext not found in rootDSE")?;

        // Query all attributeSchema objects with paged results
        let mut names = Vec::new();
        let mut cookie: Vec<u8> = Vec::new();
        let filter = "(objectClass=attributeSchema)";
        let attrs = vec!["lDAPDisplayName".to_string()];

        loop {
            let pr_control: RawControl = controls::PagedResults {
                size: 500,
                cookie: cookie.clone(),
            }
            .into();
            ldap.with_controls(vec![pr_control]);

            let (rs, result) = ldap
                .search(&schema_dn, Scope::Subtree, filter, attrs.clone())
                .await
                .context("Schema search failed")?
                .success()
                .context("Schema search returned error")?;

            for entry in rs {
                let se = SearchEntry::construct(entry);
                if let Some(name) = se.attrs.get("lDAPDisplayName").and_then(|v| v.first()) {
                    names.push(name.clone());
                }
            }

            cookie = Vec::new();
            for ctrl in &result.ctrls {
                if let controls::Control(Some(controls::ControlType::PagedResults), ref raw) = *ctrl
                {
                    let pr: controls::PagedResults = raw.parse();
                    cookie = pr.cookie;
                }
            }
            if cookie.is_empty() {
                break;
            }
        }

        names.sort();
        Ok(names)
    }
}

/// Builds a hierarchical OU tree from a flat list of (DN, name) pairs.
fn build_ou_tree(flat_ous: &[(String, String)], base_dn: &str) -> Vec<OUNode> {
    fn children_of(flat_ous: &[(String, String)], target_parent: &str) -> Vec<OUNode> {
        let mut nodes: Vec<OUNode> = flat_ous
            .iter()
            .filter(|(dn, _)| {
                let dn_lower = dn.to_lowercase();
                if dn_lower == target_parent {
                    return false;
                }
                // Direct child: everything after the first comma is the parent DN
                match dn_lower.find(',') {
                    Some(pos) => &dn_lower[pos + 1..] == target_parent,
                    None => false,
                }
            })
            .map(|(dn, name)| {
                let dn_lower = dn.to_lowercase();
                let child_nodes = children_of(flat_ous, &dn_lower);
                let has_children = if child_nodes.is_empty() {
                    None
                } else {
                    Some(true)
                };
                OUNode {
                    distinguished_name: dn.clone(),
                    name: name.clone(),
                    children: if child_nodes.is_empty() {
                        None
                    } else {
                        Some(child_nodes)
                    },
                    has_children,
                }
            })
            .collect();

        nodes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        nodes
    }

    children_of(flat_ous, &base_dn.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_search_input_trims_whitespace() {
        assert_eq!(validate_search_input("  hello  ").unwrap(), "hello");
    }

    #[test]
    fn test_validate_search_input_accepts_normal_input() {
        assert_eq!(validate_search_input("john.doe").unwrap(), "john.doe");
    }

    #[test]
    fn test_validate_search_input_rejects_too_long() {
        let long_input = "a".repeat(257);
        let result = validate_search_input(&long_input);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("too long"));
    }

    #[test]
    fn test_validate_search_input_accepts_max_length() {
        let max_input = "a".repeat(256);
        assert!(validate_search_input(&max_input).is_ok());
    }

    #[test]
    fn test_validate_search_input_rejects_control_chars() {
        let result = validate_search_input("hello\x07world");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("control characters"));
    }

    #[test]
    fn test_validate_search_input_rejects_tab() {
        let result = validate_search_input("hello\tworld");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_search_input_rejects_newline() {
        let result = validate_search_input("hello\nworld");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_search_input_allows_unicode() {
        assert_eq!(validate_search_input("Jean-Pierre").unwrap(), "Jean-Pierre");
    }

    #[test]
    fn test_ldap_escape_plain_text() {
        assert_eq!(ldap_escape("hello"), "hello");
    }

    #[test]
    fn test_ldap_escape_backslash() {
        assert_eq!(ldap_escape("a\\b"), "a\\5cb");
    }

    #[test]
    fn test_ldap_escape_asterisk() {
        assert_eq!(ldap_escape("a*b"), "a\\2ab");
    }

    #[test]
    fn test_ldap_escape_parentheses() {
        assert_eq!(ldap_escape("a(b)c"), "a\\28b\\29c");
    }

    #[test]
    fn test_ldap_escape_null() {
        assert_eq!(ldap_escape("a\0b"), "a\\00b");
    }

    #[test]
    fn test_ldap_escape_combined() {
        assert_eq!(ldap_escape("a*b\\c(d)"), "a\\2ab\\5cc\\28d\\29");
    }

    #[test]
    fn test_ldap_escape_empty_string() {
        assert_eq!(ldap_escape(""), "");
    }

    #[test]
    fn test_search_entry_to_directory_entry_maps_fields() {
        let mut attrs = HashMap::new();
        attrs.insert("sAMAccountName".to_string(), vec!["jdoe".to_string()]);
        attrs.insert("displayName".to_string(), vec!["John Doe".to_string()]);
        attrs.insert(
            "objectClass".to_string(),
            vec!["top".to_string(), "person".to_string(), "user".to_string()],
        );
        attrs.insert("mail".to_string(), vec!["jdoe@example.com".to_string()]);

        let se = SearchEntry {
            dn: "CN=John Doe,OU=Users,DC=example,DC=com".to_string(),
            attrs,
            bin_attrs: HashMap::new(),
        };

        let entry = search_entry_to_directory_entry(se);
        assert_eq!(
            entry.distinguished_name,
            "CN=John Doe,OU=Users,DC=example,DC=com"
        );
        assert_eq!(entry.sam_account_name, Some("jdoe".to_string()));
        assert_eq!(entry.display_name, Some("John Doe".to_string()));
        // objectClass takes the last value (most specific)
        assert_eq!(entry.object_class, Some("user".to_string()));
        assert_eq!(entry.get_attribute("mail"), Some("jdoe@example.com"));
    }

    #[test]
    fn test_search_entry_to_directory_entry_handles_missing_attrs() {
        let se = SearchEntry {
            dn: "CN=Test,DC=example,DC=com".to_string(),
            attrs: HashMap::new(),
            bin_attrs: HashMap::new(),
        };

        let entry = search_entry_to_directory_entry(se);
        assert_eq!(entry.distinguished_name, "CN=Test,DC=example,DC=com");
        assert!(entry.sam_account_name.is_none());
        assert!(entry.display_name.is_none());
        assert!(entry.object_class.is_none());
    }

    #[test]
    fn test_ldap_provider_new_without_domain() {
        // Temporarily unset USERDNSDOMAIN for this test
        let original = std::env::var("USERDNSDOMAIN").ok();
        std::env::remove_var("USERDNSDOMAIN");

        let provider = LdapDirectoryProvider::new();
        assert!(provider.domain_name().is_none());
        assert!(!provider.is_connected());

        // Restore
        if let Some(val) = original {
            std::env::set_var("USERDNSDOMAIN", val);
        }
    }

    #[test]
    fn test_new_defaults_to_gssapi_auth_mode() {
        let original = std::env::var("USERDNSDOMAIN").ok();
        std::env::remove_var("USERDNSDOMAIN");

        let provider = LdapDirectoryProvider::new();
        assert!(matches!(provider.auth_mode(), LdapAuthMode::Gssapi));
        assert!(provider.server_override.is_none());

        if let Some(val) = original {
            std::env::set_var("USERDNSDOMAIN", val);
        }
    }

    #[test]
    fn test_new_with_credentials_sets_simple_bind_mode() {
        let provider = LdapDirectoryProvider::new_with_credentials(
            "10.0.0.10".to_string(),
            "CN=Test,DC=lab,DC=local".to_string(),
            "secret".to_string(),
            LdapTlsConfig::default(),
        );

        assert!(matches!(
            provider.auth_mode(),
            LdapAuthMode::SimpleBind { .. }
        ));
        if let LdapAuthMode::SimpleBind { bind_dn, password } = provider.auth_mode() {
            assert_eq!(bind_dn, "CN=Test,DC=lab,DC=local");
            assert_eq!(password, "secret");
        }
    }

    #[test]
    fn test_new_with_credentials_sets_server_override() {
        let provider = LdapDirectoryProvider::new_with_credentials(
            "10.0.0.10".to_string(),
            "CN=Test,DC=lab,DC=local".to_string(),
            "secret".to_string(),
            LdapTlsConfig::default(),
        );

        assert_eq!(provider.server_override, Some("10.0.0.10".to_string()));
        assert_eq!(provider.domain_name(), Some("10.0.0.10"));
    }

    #[test]
    fn test_new_with_credentials_domain_is_set() {
        let provider = LdapDirectoryProvider::new_with_credentials(
            "dc01.lab.local".to_string(),
            "CN=Admin,DC=lab,DC=local".to_string(),
            "pass".to_string(),
            LdapTlsConfig::default(),
        );

        // domain is set to the server value so search operations work
        assert!(provider.domain.is_some());
        assert_eq!(provider.domain.as_deref(), Some("dc01.lab.local"));
    }

    #[test]
    fn test_parse_server_url_plain() {
        let (host, tls) = parse_server_url("172.31.72.165");
        assert_eq!(host, "172.31.72.165");
        assert!(!tls);
    }

    #[test]
    fn test_parse_server_url_ldap_scheme() {
        let (host, tls) = parse_server_url("ldap://172.31.72.165");
        assert_eq!(host, "172.31.72.165");
        assert!(!tls);
    }

    #[test]
    fn test_parse_server_url_ldaps_scheme() {
        let (host, tls) = parse_server_url("ldaps://172.31.72.165");
        assert_eq!(host, "172.31.72.165");
        assert!(tls);
    }

    #[test]
    fn test_parse_server_url_ldaps_with_port() {
        let (host, tls) = parse_server_url("ldaps://dc.example.com:636");
        assert_eq!(host, "dc.example.com");
        assert!(tls);
    }

    #[test]
    fn test_parse_server_url_hostname() {
        let (host, tls) = parse_server_url("dc01.corp.local");
        assert_eq!(host, "dc01.corp.local");
        assert!(!tls);
    }

    #[test]
    fn test_tls_config_from_url_scheme() {
        let provider = LdapDirectoryProvider::new_with_credentials(
            "ldaps://10.0.0.10".to_string(),
            "CN=Test,DC=lab,DC=local".to_string(),
            "secret".to_string(),
            LdapTlsConfig::default(),
        );
        assert!(provider.tls_config.enabled);
        assert_eq!(provider.server_override, Some("10.0.0.10".to_string()));
    }

    #[test]
    fn test_tls_config_explicit_flag() {
        let provider = LdapDirectoryProvider::new_with_credentials(
            "10.0.0.10".to_string(),
            "CN=Test,DC=lab,DC=local".to_string(),
            "secret".to_string(),
            LdapTlsConfig {
                enabled: true,
                skip_verify: true,
            },
        );
        assert!(provider.tls_config.enabled);
        assert!(provider.tls_config.skip_verify);
    }

    #[tokio::test]
    async fn test_search_users_returns_empty_when_not_domain_joined() {
        let original = std::env::var("USERDNSDOMAIN").ok();
        std::env::remove_var("USERDNSDOMAIN");

        let provider = LdapDirectoryProvider::new();
        let results = provider.search_users("test", 50).await.unwrap();
        assert!(results.is_empty());

        if let Some(val) = original {
            std::env::set_var("USERDNSDOMAIN", val);
        }
    }

    #[tokio::test]
    async fn test_search_computers_returns_empty_when_not_domain_joined() {
        let original = std::env::var("USERDNSDOMAIN").ok();
        std::env::remove_var("USERDNSDOMAIN");

        let provider = LdapDirectoryProvider::new();
        let results = provider.search_computers("test", 50).await.unwrap();
        assert!(results.is_empty());

        if let Some(val) = original {
            std::env::set_var("USERDNSDOMAIN", val);
        }
    }

    #[tokio::test]
    async fn test_search_groups_returns_empty_when_not_domain_joined() {
        let original = std::env::var("USERDNSDOMAIN").ok();
        std::env::remove_var("USERDNSDOMAIN");

        let provider = LdapDirectoryProvider::new();
        let results = provider.search_groups("test", 50).await.unwrap();
        assert!(results.is_empty());

        if let Some(val) = original {
            std::env::set_var("USERDNSDOMAIN", val);
        }
    }

    #[tokio::test]
    async fn test_test_connection_returns_false_when_not_domain_joined() {
        let original = std::env::var("USERDNSDOMAIN").ok();
        std::env::remove_var("USERDNSDOMAIN");

        let provider = LdapDirectoryProvider::new();
        assert!(!provider.test_connection().await.unwrap());

        if let Some(val) = original {
            std::env::set_var("USERDNSDOMAIN", val);
        }
    }
}
