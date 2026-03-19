use crate::models::{DirectoryEntry, OUNode};
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
    fn base_dn(&self) -> Option<String>;

    /// Tests the connection by performing a lightweight rootDSE query.
    async fn test_connection(&self) -> Result<bool>;

    /// Searches for user accounts matching the filter.
    async fn search_users(&self, filter: &str, max_results: usize) -> Result<Vec<DirectoryEntry>>;

    /// Searches for computer accounts matching the filter.
    async fn search_computers(
        &self,
        filter: &str,
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>>;

    /// Searches for groups matching the filter.
    async fn search_groups(&self, filter: &str, max_results: usize) -> Result<Vec<DirectoryEntry>>;

    /// Returns a single user by sAMAccountName, or None if not found.
    async fn get_user_by_identity(&self, sam_account_name: &str) -> Result<Option<DirectoryEntry>>;

    /// Returns the members of a group identified by its DN.
    async fn get_group_members(
        &self,
        group_dn: &str,
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>>;

    /// Fetches all user accounts (up to `max_results`) for browsing.
    ///
    /// Unlike `search_users`, this uses a broad filter without a search term.
    /// The caller is responsible for paging and sorting the results.
    async fn browse_users(&self, max_results: usize) -> Result<Vec<DirectoryEntry>>;

    /// Fetches all computer accounts (up to `max_results`) for browsing.
    async fn browse_computers(&self, max_results: usize) -> Result<Vec<DirectoryEntry>>;

    /// Returns the current user's group memberships (DNs).
    async fn get_current_user_groups(&self) -> Result<Vec<String>>;

    /// Resets the password for a user account.
    ///
    /// Sets the `unicodePwd` attribute to the new password (quoted UTF-16LE).
    /// If `must_change_at_next_logon` is true, sets `pwdLastSet = 0`.
    async fn reset_password(
        &self,
        user_dn: &str,
        new_password: &str,
        must_change_at_next_logon: bool,
    ) -> Result<()>;

    /// Unlocks a user account by setting `lockoutTime = 0`.
    async fn unlock_account(&self, user_dn: &str) -> Result<()>;

    /// Enables a user account by clearing the ACCOUNTDISABLE flag in `userAccountControl`.
    async fn enable_account(&self, user_dn: &str) -> Result<()>;

    /// Disables a user account by setting the ACCOUNTDISABLE flag in `userAccountControl`.
    async fn disable_account(&self, user_dn: &str) -> Result<()>;

    /// Reads the "User Cannot Change Password" flag from the DACL.
    async fn get_cannot_change_password(&self, user_dn: &str) -> Result<bool>;

    /// Sets password-related flags on a user account.
    async fn set_password_flags(
        &self,
        user_dn: &str,
        password_never_expires: bool,
        user_cannot_change_password: bool,
    ) -> Result<()>;

    /// Adds a user to a group by modifying the group's `member` attribute.
    async fn add_user_to_group(&self, user_dn: &str, group_dn: &str) -> Result<()>;

    /// Returns the raw `msDS-ReplAttributeMetaData` value for an object.
    ///
    /// This is an operational attribute that must be explicitly requested.
    /// Returns None if the attribute is not available.
    async fn get_replication_metadata(&self, object_dn: &str) -> Result<Option<String>>;

    /// Returns the raw `msDS-ReplValueMetaData` value for an object.
    ///
    /// Tracks individual linked-attribute values (e.g. group members).
    /// Returns None if the attribute is not available.
    async fn get_replication_value_metadata(&self, object_dn: &str) -> Result<Option<String>>;

    /// Returns all groups a user belongs to, including nested (transitive) memberships.
    ///
    /// Uses LDAP_MATCHING_RULE_IN_CHAIN (OID 1.2.840.113556.1.4.1941) to resolve
    /// the full group chain in a single query. Falls back to direct `memberOf` if
    /// the matching rule is not supported.
    async fn get_nested_groups(&self, user_dn: &str) -> Result<Vec<String>>;

    /// Returns the OU tree starting from the base DN.
    ///
    /// Each node contains the OU name and DN. Children are populated
    /// for the first level; deeper levels use `has_children` for lazy loading.
    async fn get_ou_tree(&self) -> Result<Vec<OUNode>>;

    /// Fetches all groups (up to `max_results`) for browsing.
    async fn browse_groups(&self, max_results: usize) -> Result<Vec<DirectoryEntry>>;

    /// Removes a member from a group.
    async fn remove_group_member(&self, group_dn: &str, member_dn: &str) -> Result<()>;

    /// Deletes an AD object by its DN.
    async fn delete_object(&self, dn: &str) -> Result<()>;

    /// Creates a new group in Active Directory.
    ///
    /// Parameters:
    /// - `name`: The CN of the new group
    /// - `container_dn`: The DN of the container (OU) where the group will be created
    /// - `scope`: "Global", "DomainLocal", or "Universal"
    /// - `category`: "Security" or "Distribution"
    /// - `description`: A description for the group
    ///
    /// Returns the DN of the created group.
    async fn create_group(
        &self,
        name: &str,
        container_dn: &str,
        scope: &str,
        category: &str,
        description: &str,
    ) -> Result<String>;

    /// Moves an AD object to a different container via LDAP moddn.
    async fn move_object(&self, object_dn: &str, target_container_dn: &str) -> Result<()>;

    /// Updates the managedBy attribute of a group.
    async fn update_managed_by(&self, group_dn: &str, manager_dn: &str) -> Result<()>;

    /// Returns all user-applicable attribute names from the AD schema.
    ///
    /// Queries the schema naming context for attributeSchema objects that
    /// apply to the "user" class. Returns just the `lDAPDisplayName` values.
    async fn get_schema_attributes(&self) -> Result<Vec<String>>;
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
        pub reset_password_calls: Mutex<Vec<(String, String, bool)>>,
        pub unlock_calls: Mutex<Vec<String>>,
        pub enable_calls: Mutex<Vec<String>>,
        pub disable_calls: Mutex<Vec<String>>,
        pub set_password_flags_calls: Mutex<Vec<(String, bool, bool)>>,
        pub remove_group_member_calls: Mutex<Vec<(String, String)>>,
        pub delete_calls: Mutex<Vec<String>>,
        #[allow(clippy::type_complexity)]
        pub create_group_calls: Mutex<Vec<(String, String, String, String, String)>>,
        pub move_object_calls: Mutex<Vec<(String, String)>>,
        pub update_managed_by_calls: Mutex<Vec<(String, String)>>,
        cannot_change_password: Mutex<bool>,
        replication_metadata: Mutex<Option<String>>,
        ou_tree: Mutex<Vec<OUNode>>,
    }

    impl Default for MockDirectoryProvider {
        fn default() -> Self {
            Self::new()
        }
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
                reset_password_calls: Mutex::new(Vec::new()),
                unlock_calls: Mutex::new(Vec::new()),
                enable_calls: Mutex::new(Vec::new()),
                disable_calls: Mutex::new(Vec::new()),
                set_password_flags_calls: Mutex::new(Vec::new()),
                remove_group_member_calls: Mutex::new(Vec::new()),
                delete_calls: Mutex::new(Vec::new()),
                create_group_calls: Mutex::new(Vec::new()),
                move_object_calls: Mutex::new(Vec::new()),
                update_managed_by_calls: Mutex::new(Vec::new()),
                cannot_change_password: Mutex::new(false),
                replication_metadata: Mutex::new(None),
                ou_tree: Mutex::new(Vec::new()),
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
                reset_password_calls: Mutex::new(Vec::new()),
                unlock_calls: Mutex::new(Vec::new()),
                enable_calls: Mutex::new(Vec::new()),
                disable_calls: Mutex::new(Vec::new()),
                set_password_flags_calls: Mutex::new(Vec::new()),
                remove_group_member_calls: Mutex::new(Vec::new()),
                delete_calls: Mutex::new(Vec::new()),
                create_group_calls: Mutex::new(Vec::new()),
                move_object_calls: Mutex::new(Vec::new()),
                update_managed_by_calls: Mutex::new(Vec::new()),
                cannot_change_password: Mutex::new(false),
                replication_metadata: Mutex::new(None),
                ou_tree: Mutex::new(Vec::new()),
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

        pub fn with_replication_metadata(self, xml: String) -> Self {
            *self.replication_metadata.lock().unwrap() = Some(xml);
            self
        }

        pub fn with_ou_tree(self, tree: Vec<OUNode>) -> Self {
            *self.ou_tree.lock().unwrap() = tree;
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

        fn base_dn(&self) -> Option<String> {
            self.base.clone()
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
            Ok(users
                .iter()
                .find(|u| u.sam_account_name.as_deref() == Some(sam_account_name))
                .cloned())
        }

        async fn browse_users(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
            self.check_failure()?;
            let users = self.users.lock().unwrap();
            Ok(users.iter().take(max_results).cloned().collect())
        }

        async fn browse_computers(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
            self.check_failure()?;
            let computers = self.computers.lock().unwrap();
            Ok(computers.iter().take(max_results).cloned().collect())
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

        async fn reset_password(
            &self,
            user_dn: &str,
            new_password: &str,
            must_change_at_next_logon: bool,
        ) -> Result<()> {
            self.check_failure()?;
            self.reset_password_calls.lock().unwrap().push((
                user_dn.to_string(),
                new_password.to_string(),
                must_change_at_next_logon,
            ));
            Ok(())
        }

        async fn unlock_account(&self, user_dn: &str) -> Result<()> {
            self.check_failure()?;
            self.unlock_calls.lock().unwrap().push(user_dn.to_string());
            Ok(())
        }

        async fn enable_account(&self, user_dn: &str) -> Result<()> {
            self.check_failure()?;
            self.enable_calls.lock().unwrap().push(user_dn.to_string());
            Ok(())
        }

        async fn disable_account(&self, user_dn: &str) -> Result<()> {
            self.check_failure()?;
            self.disable_calls.lock().unwrap().push(user_dn.to_string());
            Ok(())
        }

        async fn get_cannot_change_password(&self, _user_dn: &str) -> Result<bool> {
            self.check_failure()?;
            Ok(*self.cannot_change_password.lock().unwrap())
        }

        async fn set_password_flags(
            &self,
            user_dn: &str,
            password_never_expires: bool,
            user_cannot_change_password: bool,
        ) -> Result<()> {
            self.check_failure()?;
            *self.cannot_change_password.lock().unwrap() = user_cannot_change_password;
            self.set_password_flags_calls.lock().unwrap().push((
                user_dn.to_string(),
                password_never_expires,
                user_cannot_change_password,
            ));
            Ok(())
        }

        async fn add_user_to_group(&self, _user_dn: &str, _group_dn: &str) -> Result<()> {
            self.check_failure()?;
            Ok(())
        }

        async fn get_replication_metadata(&self, _object_dn: &str) -> Result<Option<String>> {
            self.check_failure()?;
            Ok(self.replication_metadata.lock().unwrap().clone())
        }

        async fn get_replication_value_metadata(&self, _object_dn: &str) -> Result<Option<String>> {
            self.check_failure()?;
            Ok(None)
        }

        async fn get_nested_groups(&self, user_dn: &str) -> Result<Vec<String>> {
            self.check_failure()?;
            // Mock: return memberOf from the matching user
            let users = self.users.lock().unwrap();
            if let Some(user) = users.iter().find(|u| u.distinguished_name == user_dn) {
                Ok(user.get_attribute_values("memberOf").to_vec())
            } else {
                Ok(Vec::new())
            }
        }

        async fn get_ou_tree(&self) -> Result<Vec<OUNode>> {
            self.check_failure()?;
            Ok(self.ou_tree.lock().unwrap().clone())
        }

        async fn browse_groups(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
            self.check_failure()?;
            let groups = self.groups.lock().unwrap();
            Ok(groups.iter().take(max_results).cloned().collect())
        }

        async fn remove_group_member(&self, group_dn: &str, member_dn: &str) -> Result<()> {
            self.check_failure()?;
            self.remove_group_member_calls
                .lock()
                .unwrap()
                .push((group_dn.to_string(), member_dn.to_string()));
            Ok(())
        }

        async fn delete_object(&self, dn: &str) -> Result<()> {
            self.check_failure()?;
            self.delete_calls.lock().unwrap().push(dn.to_string());
            Ok(())
        }

        async fn create_group(
            &self,
            name: &str,
            container_dn: &str,
            scope: &str,
            category: &str,
            description: &str,
        ) -> Result<String> {
            self.check_failure()?;
            self.create_group_calls.lock().unwrap().push((
                name.to_string(),
                container_dn.to_string(),
                scope.to_string(),
                category.to_string(),
                description.to_string(),
            ));
            Ok(format!("CN={},{}", name, container_dn))
        }

        async fn move_object(&self, object_dn: &str, target_container_dn: &str) -> Result<()> {
            self.check_failure()?;
            self.move_object_calls
                .lock()
                .unwrap()
                .push((object_dn.to_string(), target_container_dn.to_string()));
            Ok(())
        }

        async fn update_managed_by(&self, group_dn: &str, manager_dn: &str) -> Result<()> {
            self.check_failure()?;
            self.update_managed_by_calls
                .lock()
                .unwrap()
                .push((group_dn.to_string(), manager_dn.to_string()));
            Ok(())
        }

        async fn get_schema_attributes(&self) -> Result<Vec<String>> {
            self.check_failure()?;
            Ok(vec![
                "cn".to_string(),
                "displayName".to_string(),
                "mail".to_string(),
                "sAMAccountName".to_string(),
                "telephoneNumber".to_string(),
            ])
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
        assert_eq!(provider.base_dn(), Some("DC=example,DC=com".to_string()));
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
    async fn test_browse_users_returns_all_users() {
        let users = vec![
            make_user_entry("jdoe", "John Doe"),
            make_user_entry("asmith", "Alice Smith"),
        ];
        let provider = MockDirectoryProvider::new().with_users(users);
        let results = provider.browse_users(500).await.unwrap();
        assert_eq!(results.len(), 2);
    }

    #[tokio::test]
    async fn test_browse_users_respects_max_results() {
        let users = vec![
            make_user_entry("u1", "User 1"),
            make_user_entry("u2", "User 2"),
            make_user_entry("u3", "User 3"),
        ];
        let provider = MockDirectoryProvider::new().with_users(users);
        let results = provider.browse_users(2).await.unwrap();
        assert_eq!(results.len(), 2);
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

    #[tokio::test]
    async fn test_browse_groups_returns_configured_groups() {
        let groups = vec![
            make_group_entry("Domain Admins"),
            make_group_entry("IT Support"),
        ];
        let provider = MockDirectoryProvider::new().with_groups(groups);
        let results = provider.browse_groups(500).await.unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(
            results[0].sam_account_name,
            Some("Domain Admins".to_string())
        );
    }

    #[tokio::test]
    async fn test_browse_groups_respects_max_results() {
        let groups = vec![
            make_group_entry("Group1"),
            make_group_entry("Group2"),
            make_group_entry("Group3"),
        ];
        let provider = MockDirectoryProvider::new().with_groups(groups);
        let results = provider.browse_groups(2).await.unwrap();
        assert_eq!(results.len(), 2);
    }

    #[tokio::test]
    async fn test_remove_group_member_success() {
        let provider = MockDirectoryProvider::new();
        provider
            .remove_group_member(
                "CN=TestGroup,DC=example,DC=com",
                "CN=User,DC=example,DC=com",
            )
            .await
            .unwrap();
        let calls = provider.remove_group_member_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "CN=TestGroup,DC=example,DC=com");
        assert_eq!(calls[0].1, "CN=User,DC=example,DC=com");
    }

    #[tokio::test]
    async fn test_delete_object_records_call() {
        let provider = MockDirectoryProvider::new();
        provider
            .delete_object("CN=OldGroup,OU=Groups,DC=example,DC=com")
            .await
            .unwrap();
        let calls = provider.delete_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0], "CN=OldGroup,OU=Groups,DC=example,DC=com");
    }
}
