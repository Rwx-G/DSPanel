use std::collections::HashMap;
use std::sync::Mutex;

use anyhow::{Context, Result};
use async_trait::async_trait;
use ldap3::{LdapConnAsync, LdapConnSettings, Scope, SearchEntry};

use crate::models::DirectoryEntry;
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
/// The connection is established lazily on first use.
pub struct LdapDirectoryProvider {
    domain: Option<String>,
    base_dn: Mutex<Option<String>>,
    connected: Mutex<bool>,
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
        }
    }

    /// Establishes a new LDAP connection with GSSAPI authentication.
    async fn connect(&self) -> Result<ldap3::Ldap> {
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

        let mut ldap = self.connect().await?;

        let base = self.base_dn.lock().unwrap().clone().unwrap_or_default();

        let (rs, _) = ldap
            .search(&base, Scope::Subtree, filter, attrs.to_vec())
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

        let _ = ldap.unbind().await;

        Ok(entries)
    }
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
        match self.connect().await {
            Ok(mut ldap) => {
                let _ = ldap.unbind().await;
                Ok(true)
            }
            Err(e) => {
                tracing::warn!("Connection test failed: {}", e);
                *self.connected.lock().unwrap() = false;
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
        let ldap_filter = format!("(&(objectClass=user)(memberOf={}))", escaped);
        self.search(&ldap_filter, USER_ATTRS, max_results).await
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
