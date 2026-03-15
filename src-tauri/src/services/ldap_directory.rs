use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use anyhow::{Context, Result};
use async_trait::async_trait;
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

/// `DirectoryProvider` implementation using on-premises Active Directory via LDAP.
///
/// Uses `ldap3` crate for LDAP operations with Kerberos (GSSAPI) authentication.
/// The connection is established lazily on first use and reused across operations.
/// `ldap3::Ldap` supports multiplexing, so a single connection handles concurrent
/// requests efficiently without per-operation connect/bind overhead.
pub struct LdapDirectoryProvider {
    domain: Option<String>,
    base_dn: Mutex<Option<String>>,
    connected: Mutex<bool>,
    /// Pooled LDAP connection. Reused across operations; recreated on failure.
    pool: tokio::sync::Mutex<Option<ldap3::Ldap>>,
}

impl Default for LdapDirectoryProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl LdapDirectoryProvider {
    /// Creates a new `LdapDirectoryProvider`.
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
            base_dn: Mutex::new(None),
            connected: Mutex::new(false),
            pool: tokio::sync::Mutex::new(None),
        }
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

    /// Executes an LDAP operation with automatic reconnect on stale connection.
    ///
    /// On connection-level failure, invalidates the pool and retries once with
    /// a fresh connection before propagating the error.
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
                    || msg.contains("closed");
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

    /// Establishes a new LDAP connection with GSSAPI authentication.
    async fn create_connection(&self) -> Result<ldap3::Ldap> {
        let domain = self
            .domain
            .as_ref()
            .context("No domain available - machine is not domain-joined")?;

        let settings = LdapConnSettings::new();
        let (conn, mut ldap) =
            LdapConnAsync::with_settings(settings, &format!("ldap://{}:389", domain))
                .await
                .context("Failed to connect to LDAP server")?;

        tokio::spawn(conn.drive());

        #[cfg(feature = "gssapi")]
        ldap.sasl_gssapi_bind(domain)
            .await
            .context("GSSAPI (Kerberos) authentication failed")?;

        #[cfg(not(feature = "gssapi"))]
        ldap.simple_bind("", "")
            .await
            .context("Anonymous LDAP bind failed (build without gssapi feature)")?;

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

        self.with_connection(|mut ldap| {
            let base = base.clone();
            let filter = filter.clone();
            let attrs = attrs.clone();
            async move {
                let (rs, _) = ldap
                    .search(&base, Scope::Subtree, &filter, attrs)
                    .await
                    .context("LDAP search failed")?
                    .success()
                    .context("LDAP search returned error")?;

                let entries: Vec<DirectoryEntry> = rs
                    .into_iter()
                    .take(max_results)
                    .map(|entry| {
                        let se = SearchEntry::construct(entry);
                        search_entry_to_directory_entry(se)
                    })
                    .collect();

                Ok(entries)
            }
        })
        .await
    }
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
        let results = self.search(&ldap_filter, USER_ATTRS, 1).await?;
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
        let username =
            std::env::var("USERNAME").context("USERNAME environment variable not set")?;
        let user = self.get_user_by_identity(&username).await?;
        match user {
            Some(entry) => Ok(entry.get_attribute_values("memberOf").to_vec()),
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
