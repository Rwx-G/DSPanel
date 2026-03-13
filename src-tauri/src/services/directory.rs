use crate::models::DirectoryEntry;
use anyhow::Result;
use async_trait::async_trait;

/// Abstraction over directory service operations.
///
/// All AD queries must go through this trait - never use ldap3 or reqwest directly
/// in command handlers. Implementations include `LdapDirectoryProvider` for on-prem
/// AD and (future) `GraphDirectoryProvider` for Entra ID.
#[async_trait]
pub trait DirectoryProvider: Send + Sync {
    /// Whether a connection is currently established.
    fn is_connected(&self) -> bool;

    /// The domain name (e.g. "CORP.LOCAL"), if known.
    fn domain_name(&self) -> Option<&str>;

    /// The base DN for searches (e.g. "DC=corp,DC=local"), if known.
    fn base_dn(&self) -> Option<&str>;

    /// Tests the connection by performing a lightweight rootDSE query.
    async fn test_connection(&self) -> Result<bool>;

    /// Searches for user accounts matching the filter.
    async fn search_users(
        &self,
        filter: &str,
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>>;

    /// Searches for computer accounts matching the filter.
    async fn search_computers(
        &self,
        filter: &str,
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>>;

    /// Searches for groups matching the filter.
    async fn search_groups(
        &self,
        filter: &str,
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>>;

    /// Returns a single user by sAMAccountName, or None if not found.
    async fn get_user_by_identity(
        &self,
        sam_account_name: &str,
    ) -> Result<Option<DirectoryEntry>>;

    /// Returns the members of a group identified by its DN.
    async fn get_group_members(
        &self,
        group_dn: &str,
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>>;

    /// Returns the current user's group memberships (DNs).
    async fn get_current_user_groups(&self) -> Result<Vec<String>>;
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// Mock implementation of `DirectoryProvider` for testing.
    ///
    /// Allows test code to set up predetermined results for each method.
    pub struct MockDirectoryProvider {
        connected: Mutex<bool>,
        domain: Option<String>,
        base: Option<String>,
        users: Mutex<Vec<DirectoryEntry>>,
        computers: Mutex<Vec<DirectoryEntry>>,
        groups: Mutex<Vec<DirectoryEntry>>,
        members: Mutex<Vec<DirectoryEntry>>,
        user_groups: Mutex<Vec<String>>,
        should_fail: Mutex<bool>,
    }

    impl MockDirectoryProvider {
        pub fn new() -> Self {
            Self {
                connected: Mutex::new(true),
                domain: Some("EXAMPLE.COM".to_string()),
                base: Some("DC=example,DC=com".to_string()),
                users: Mutex::new(Vec::new()),
                computers: Mutex::new(Vec::new()),
                groups: Mutex::new(Vec::new()),
                members: Mutex::new(Vec::new()),
                user_groups: Mutex::new(Vec::new()),
                should_fail: Mutex::new(false),
            }
        }

        pub fn disconnected() -> Self {
            Self {
                connected: Mutex::new(false),
                domain: None,
                base: None,
                users: Mutex::new(Vec::new()),
                computers: Mutex::new(Vec::new()),
                groups: Mutex::new(Vec::new()),
                members: Mutex::new(Vec::new()),
                user_groups: Mutex::new(Vec::new()),
                should_fail: Mutex::new(false),
            }
        }

        pub fn with_users(self, users: Vec<DirectoryEntry>) -> Self {
            *self.users.lock().unwrap() = users;
            self
        }

        pub fn with_computers(self, computers: Vec<DirectoryEntry>) -> Self {
            *self.computers.lock().unwrap() = computers;
            self
        }

        pub fn with_groups(self, groups: Vec<DirectoryEntry>) -> Self {
            *self.groups.lock().unwrap() = groups;
            self
        }

        pub fn with_members(self, members: Vec<DirectoryEntry>) -> Self {
            *self.members.lock().unwrap() = members;
            self
        }

        pub fn with_user_groups(self, groups: Vec<String>) -> Self {
            *self.user_groups.lock().unwrap() = groups;
            self
        }

        pub fn with_failure(self) -> Self {
            *self.should_fail.lock().unwrap() = true;
            self
        }

        fn check_failure(&self) -> Result<()> {
            if *self.should_fail.lock().unwrap() {
                anyhow::bail!("Mock directory provider failure");
            }
            Ok(())
        }
    }

    #[async_trait]
    impl DirectoryProvider for MockDirectoryProvider {
        fn is_connected(&self) -> bool {
            *self.connected.lock().unwrap()
        }

        fn domain_name(&self) -> Option<&str> {
            self.domain.as_deref()
        }

        fn base_dn(&self) -> Option<&str> {
            self.base.as_deref()
        }

        async fn test_connection(&self) -> Result<bool> {
            self.check_failure()?;
            Ok(self.is_connected())
        }

        async fn search_users(
            &self,
            _filter: &str,
            max_results: usize,
        ) -> Result<Vec<DirectoryEntry>> {
            self.check_failure()?;
            let users = self.users.lock().unwrap();
            Ok(users.iter().take(max_results).cloned().collect())
        }

        async fn search_computers(
            &self,
            _filter: &str,
            max_results: usize,
        ) -> Result<Vec<DirectoryEntry>> {
            self.check_failure()?;
            let computers = self.computers.lock().unwrap();
            Ok(computers.iter().take(max_results).cloned().collect())
        }

        async fn search_groups(
            &self,
            _filter: &str,
            max_results: usize,
        ) -> Result<Vec<DirectoryEntry>> {
            self.check_failure()?;
            let groups = self.groups.lock().unwrap();
            Ok(groups.iter().take(max_results).cloned().collect())
        }

        async fn get_user_by_identity(
            &self,
            sam_account_name: &str,
        ) -> Result<Option<DirectoryEntry>> {
            self.check_failure()?;
            let users = self.users.lock().unwrap();
            Ok(users.iter().find(|u| {
                u.sam_account_name.as_deref() == Some(sam_account_name)
            }).cloned())
        }

        async fn get_group_members(
            &self,
            _group_dn: &str,
            max_results: usize,
        ) -> Result<Vec<DirectoryEntry>> {
            self.check_failure()?;
            let members = self.members.lock().unwrap();
            Ok(members.iter().take(max_results).cloned().collect())
        }

        async fn get_current_user_groups(&self) -> Result<Vec<String>> {
            self.check_failure()?;
            Ok(self.user_groups.lock().unwrap().clone())
        }
    }

    fn make_user_entry(sam: &str, display: &str) -> DirectoryEntry {
        let mut attrs = HashMap::new();
        attrs.insert("mail".to_string(), vec![format!("{}@example.com", sam)]);

        DirectoryEntry {
            distinguished_name: format!("CN={},OU=Users,DC=example,DC=com", display),
            sam_account_name: Some(sam.to_string()),
            display_name: Some(display.to_string()),
            object_class: Some("user".to_string()),
            attributes: attrs,
        }
    }

    fn make_computer_entry(name: &str) -> DirectoryEntry {
        DirectoryEntry {
            distinguished_name: format!("CN={},OU=Computers,DC=example,DC=com", name),
            sam_account_name: Some(format!("{}$", name)),
            display_name: Some(name.to_string()),
            object_class: Some("computer".to_string()),
            attributes: HashMap::new(),
        }
    }

    fn make_group_entry(name: &str) -> DirectoryEntry {
        DirectoryEntry {
            distinguished_name: format!("CN={},OU=Groups,DC=example,DC=com", name),
            sam_account_name: Some(name.to_string()),
            display_name: Some(name.to_string()),
            object_class: Some("group".to_string()),
            attributes: HashMap::new(),
        }
    }

    #[tokio::test]
    async fn test_mock_provider_is_connected() {
        let provider = MockDirectoryProvider::new();
        assert!(provider.is_connected());
    }

    #[tokio::test]
    async fn test_mock_provider_disconnected() {
        let provider = MockDirectoryProvider::disconnected();
        assert!(!provider.is_connected());
        assert!(provider.domain_name().is_none());
        assert!(provider.base_dn().is_none());
    }

    #[tokio::test]
    async fn test_mock_provider_domain_info() {
        let provider = MockDirectoryProvider::new();
        assert_eq!(provider.domain_name(), Some("EXAMPLE.COM"));
        assert_eq!(provider.base_dn(), Some("DC=example,DC=com"));
    }

    #[tokio::test]
    async fn test_search_users_returns_configured_users() {
        let users = vec![
            make_user_entry("jdoe", "John Doe"),
            make_user_entry("asmith", "Alice Smith"),
        ];
        let provider = MockDirectoryProvider::new().with_users(users);
        let results = provider.search_users("doe", 50).await.unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].sam_account_name, Some("jdoe".to_string()));
    }

    #[tokio::test]
    async fn test_search_users_respects_max_results() {
        let users = vec![
            make_user_entry("u1", "User 1"),
            make_user_entry("u2", "User 2"),
            make_user_entry("u3", "User 3"),
        ];
        let provider = MockDirectoryProvider::new().with_users(users);
        let results = provider.search_users("user", 2).await.unwrap();
        assert_eq!(results.len(), 2);
    }

    #[tokio::test]
    async fn test_search_users_returns_empty_when_no_users() {
        let provider = MockDirectoryProvider::new();
        let results = provider.search_users("nothing", 50).await.unwrap();
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn test_search_computers_returns_configured_computers() {
        let computers = vec![make_computer_entry("WORKSTATION01")];
        let provider = MockDirectoryProvider::new().with_computers(computers);
        let results = provider.search_computers("WORK", 50).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].display_name, Some("WORKSTATION01".to_string()));
    }

    #[tokio::test]
    async fn test_search_groups_returns_configured_groups() {
        let groups = vec![make_group_entry("Domain Admins")];
        let provider = MockDirectoryProvider::new().with_groups(groups);
        let results = provider.search_groups("admin", 50).await.unwrap();
        assert_eq!(results.len(), 1);
    }

    #[tokio::test]
    async fn test_get_user_by_identity_finds_matching_user() {
        let users = vec![
            make_user_entry("jdoe", "John Doe"),
            make_user_entry("asmith", "Alice Smith"),
        ];
        let provider = MockDirectoryProvider::new().with_users(users);
        let result = provider.get_user_by_identity("jdoe").await.unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap().display_name, Some("John Doe".to_string()));
    }

    #[tokio::test]
    async fn test_get_user_by_identity_returns_none_for_unknown() {
        let users = vec![make_user_entry("jdoe", "John Doe")];
        let provider = MockDirectoryProvider::new().with_users(users);
        let result = provider.get_user_by_identity("unknown").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_get_group_members_returns_members() {
        let members = vec![
            make_user_entry("jdoe", "John Doe"),
            make_user_entry("asmith", "Alice Smith"),
        ];
        let provider = MockDirectoryProvider::new().with_members(members);
        let results = provider
            .get_group_members("CN=TestGroup,DC=example,DC=com", 50)
            .await
            .unwrap();
        assert_eq!(results.len(), 2);
    }

    #[tokio::test]
    async fn test_get_current_user_groups_returns_groups() {
        let groups = vec![
            "CN=Group1,DC=example,DC=com".to_string(),
            "CN=Group2,DC=example,DC=com".to_string(),
        ];
        let provider = MockDirectoryProvider::new().with_user_groups(groups);
        let results = provider.get_current_user_groups().await.unwrap();
        assert_eq!(results.len(), 2);
    }

    #[tokio::test]
    async fn test_test_connection_returns_true_when_connected() {
        let provider = MockDirectoryProvider::new();
        assert!(provider.test_connection().await.unwrap());
    }

    #[tokio::test]
    async fn test_test_connection_returns_false_when_disconnected() {
        let provider = MockDirectoryProvider::disconnected();
        assert!(!provider.test_connection().await.unwrap());
    }

    #[tokio::test]
    async fn test_search_users_when_domain_not_joined_returns_empty() {
        let provider = MockDirectoryProvider::disconnected();
        let results = provider.search_users("test", 50).await.unwrap();
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn test_provider_failure_propagates_error() {
        let provider = MockDirectoryProvider::new().with_failure();
        let result = provider.search_users("test", 50).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("failure"));
    }

    #[tokio::test]
    async fn test_test_connection_failure_propagates_error() {
        let provider = MockDirectoryProvider::new().with_failure();
        let result = provider.test_connection().await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_current_user_groups_failure_propagates_error() {
        let provider = MockDirectoryProvider::new().with_failure();
        let result = provider.get_current_user_groups().await;
        assert!(result.is_err());
    }
}
