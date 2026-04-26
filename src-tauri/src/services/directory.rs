use crate::models::{ContactInfo, DeletedObject, DirectoryEntry, OUNode, PrinterInfo};
use anyhow::Result;
use async_trait::async_trait;
use std::collections::HashMap;

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

    /// The hostname or IP of the connected DC/LDAP server.
    fn connected_host(&self) -> Option<String>;

    /// Returns simple bind credentials (bind_dn, password) if using simple bind auth.
    /// Used for authenticating remote operations (e.g., event log access from non-domain machines).
    fn simple_bind_credentials(&self) -> Option<(String, String)> {
        None
    }

    /// The base DN for searches (e.g. "DC=corp,DC=local"), if known.
    fn base_dn(&self) -> Option<String>;

    /// Tests the connection by performing a lightweight rootDSE query.
    async fn test_connection(&self) -> Result<bool>;

    /// Returns a classification key for the last connection failure, if any.
    ///
    /// The value is a stable identifier (e.g. `clock_skew`, `no_credentials`,
    /// `dns`, `ldap_signing`, `network`, `auth_denied`, `kerberos_unknown`,
    /// `unknown`, `not_domain_joined`) that the UI maps to a localized hint.
    /// The raw error message is not exposed here - full detail is written to
    /// the application log at ERROR level.
    fn last_connection_error(&self) -> Option<String> {
        None
    }

    /// Returns true when the last search/browse call returned partial results
    /// because the server hit `sizeLimitExceeded` or our `max_results` cap was
    /// reached with more pages available. The UI uses this to render a
    /// truncation banner instead of presenting a possibly incomplete list as
    /// authoritative.
    fn last_search_was_truncated(&self) -> bool {
        false
    }

    /// Returns true when the connected directory server identified itself as a
    /// Read-Only Domain Controller (RODC) in its rootDSE
    /// `supportedCapabilities` response. The UI surfaces this so operators
    /// know that write operations may be referred to a writable DC or
    /// rejected outright.
    fn is_connected_to_rodc(&self) -> bool {
        false
    }

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

    /// Generic UAC bit-clear helper - reads the current `userAccountControl`,
    /// masks out the supplied bits, and writes back when the value changed.
    ///
    /// Used by Epic 14 quick-fix actions to safely flip individual UAC flags
    /// (e.g. `0x0020` PASSWD_NOTREQD for Story 14.4, `0x80000`
    /// TRUSTED_FOR_DELEGATION for Story 14.6) without needing a per-action
    /// trait method.
    ///
    /// Returns `(previous_uac, new_uac)`. When the bits were already clear
    /// the two values are equal and no LDAP write was performed - the
    /// caller treats this as an idempotent no-op (skip snapshot, skip
    /// audit entry).
    async fn clear_user_account_control_bits(
        &self,
        user_dn: &str,
        bits_to_clear: u32,
    ) -> Result<(u32, u32)>;

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

    /// Creates a new user account in Active Directory.
    ///
    /// Parameters:
    /// - `cn`: Common name for the user
    /// - `container_dn`: DN of the OU where the user will be created
    /// - `sam_account_name`: The sAMAccountName login
    /// - `password`: Initial password to set
    /// - `attributes`: Additional LDAP attributes to set
    ///
    /// Returns the DN of the created user.
    async fn create_user(
        &self,
        cn: &str,
        container_dn: &str,
        sam_account_name: &str,
        password: &str,
        attributes: &std::collections::HashMap<String, Vec<String>>,
    ) -> Result<String>;

    /// Fetches all attributes of an object by DN using a base-scope search with ["*"].
    /// Used for complete snapshots before modifications.
    async fn get_all_attributes(
        &self,
        _dn: &str,
    ) -> Result<std::collections::HashMap<String, Vec<String>>> {
        Ok(std::collections::HashMap::new())
    }

    /// Modifies an attribute on an AD object.
    async fn modify_attribute(
        &self,
        dn: &str,
        attribute_name: &str,
        values: &[String],
    ) -> Result<()>;

    /// Returns the authenticated user identity resolved via WhoAmI, if available.
    fn authenticated_user(&self) -> Option<String>;

    /// Probes the effective permissions of the current user by checking
    /// `allowedAttributesEffective` and `allowedChildClassesEffective`
    /// on representative objects.
    ///
    /// Returns a tuple of (can_write_user_attrs, can_write_group_members, can_create_objects):
    /// - can_write_user_attrs: `lockoutTime` writable on a user (HelpDesk)
    /// - can_write_group_members: `member` writable on a group (AccountOperator)
    /// - can_create_objects: `user` creatable in an OU (Admin)
    async fn probe_effective_permissions(&self) -> Result<(bool, bool, bool)>;

    /// Returns all user-applicable attribute names from the AD schema.
    ///
    /// Queries the schema naming context for attributeSchema objects that
    /// apply to the "user" class. Returns just the `lDAPDisplayName` values.
    async fn get_schema_attributes(&self) -> Result<Vec<String>>;

    /// Fetches all contact objects (up to `max_results`) for browsing.
    async fn browse_contacts(&self, max_results: usize) -> Result<Vec<DirectoryEntry>>;

    /// Fetches all printer objects (up to `max_results`) for browsing.
    async fn browse_printers(&self, max_results: usize) -> Result<Vec<DirectoryEntry>>;

    /// Checks whether the AD Recycle Bin optional feature is enabled.
    ///
    /// Looks for the Recycle Bin feature GUID in `msDS-EnabledFeature`
    /// on `CN=Partitions,CN=Configuration,<forest DN>`.
    async fn is_recycle_bin_enabled(&self) -> Result<bool>;

    /// Lists deleted objects from the AD Recycle Bin.
    ///
    /// Searches `CN=Deleted Objects,<domain DN>` with `isDeleted=TRUE`
    /// and the `ShowDeletedControl` (OID 1.2.840.113556.1.4.417).
    async fn get_deleted_objects(&self) -> Result<Vec<DeletedObject>>;

    /// Restores a deleted object from the Recycle Bin.
    ///
    /// Removes the `isDeleted` attribute and moves the object to the
    /// specified target OU. If `target_ou_dn` is empty, restores to
    /// the original OU stored in `lastKnownParent`.
    async fn restore_deleted_object(&self, deleted_dn: &str, target_ou_dn: &str) -> Result<()>;

    /// Searches for contact objects matching the filter.
    async fn search_contacts(&self, filter: &str, max_results: usize) -> Result<Vec<ContactInfo>>;

    /// Searches for printer (printQueue) objects matching the filter.
    async fn search_printers(&self, filter: &str, max_results: usize) -> Result<Vec<PrinterInfo>>;

    /// Creates a new contact in the specified container.
    ///
    /// Returns the DN of the created contact.
    async fn create_contact(
        &self,
        container_dn: &str,
        attrs: &HashMap<String, String>,
    ) -> Result<String>;

    /// Updates an existing contact's attributes.
    async fn update_contact(&self, dn: &str, attrs: &HashMap<String, String>) -> Result<()>;

    /// Deletes a contact by its DN.
    async fn delete_contact(&self, dn: &str) -> Result<()>;

    /// Creates a new printer (printQueue) in the specified container.
    ///
    /// Returns the DN of the created printer.
    async fn create_printer(
        &self,
        container_dn: &str,
        attrs: &HashMap<String, String>,
    ) -> Result<String>;

    /// Updates an existing printer's attributes.
    async fn update_printer(&self, dn: &str, attrs: &HashMap<String, String>) -> Result<()>;

    /// Deletes a printer by its DN.
    async fn delete_printer(&self, dn: &str) -> Result<()>;

    /// Gets the thumbnailPhoto attribute as base64-encoded bytes.
    async fn get_thumbnail_photo(&self, user_dn: &str) -> Result<Option<String>>;

    /// Sets the thumbnailPhoto attribute from base64-encoded JPEG bytes.
    async fn set_thumbnail_photo(&self, user_dn: &str, photo_base64: &str) -> Result<()>;

    /// Removes the thumbnailPhoto attribute.
    async fn remove_thumbnail_photo(&self, user_dn: &str) -> Result<()>;

    /// Searches the AD Configuration partition with a custom LDAP filter.
    ///
    /// Performs a subtree search starting from `search_base` with the given
    /// `filter`. Returns matching entries as `DirectoryEntry` objects.
    /// Used for querying Sites and Services, replication topology, etc.
    async fn search_configuration(
        &self,
        search_base: &str,
        filter: &str,
    ) -> Result<Vec<DirectoryEntry>>;

    /// Reads a single entry at the exact DN using LDAP Base scope.
    ///
    /// Use this for rootDSE queries (dn = "") or reading specific objects
    /// like FSMO role holders where Subtree would return too many results.
    /// Returns the entry if found, or None.
    async fn read_entry(&self, dn: &str) -> Result<Option<DirectoryEntry>>;

    /// Resolves a well-known security group by its RID (Relative Identifier).
    ///
    /// This is the language-independent way to find groups like Domain Admins
    /// (RID 512), Enterprise Admins (519), Schema Admins (518), etc.
    /// Searches security groups and matches the last sub-authority of `objectSid`.
    /// Returns the group entry if found, or None.
    async fn resolve_group_by_rid(&self, rid: u32) -> Result<Option<DirectoryEntry>>;
}

#[allow(clippy::unwrap_used)]
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
        pub create_user_calls: Mutex<Vec<(String, String, String)>>,
        pub modify_attribute_calls: Mutex<Vec<(String, String, Vec<String>)>>,
        /// Per-user-DN userAccountControl values. Used by
        /// `clear_user_account_control_bits` to simulate read-modify-write.
        /// Pre-populate with `set_user_account_control(dn, uac)`; defaults
        /// to 0 when absent.
        pub user_uac: Mutex<HashMap<String, u32>>,
        /// Records every successful clear_user_account_control_bits call
        /// (idempotent no-ops are NOT recorded). Tuple is
        /// `(dn, bits_to_clear, previous_uac, new_uac)`.
        pub clear_uac_bits_calls: Mutex<Vec<(String, u32, u32, u32)>>,
        cannot_change_password: Mutex<bool>,
        replication_metadata: Mutex<Option<String>>,
        ou_tree: Mutex<Vec<OUNode>>,
        recycle_bin_enabled: Mutex<bool>,
        deleted_objects: Mutex<Vec<DeletedObject>>,
        pub restore_calls: Mutex<Vec<(String, String)>>,
        contacts: Mutex<Vec<ContactInfo>>,
        printers: Mutex<Vec<PrinterInfo>>,
        pub create_contact_calls: Mutex<Vec<(String, HashMap<String, String>)>>,
        pub update_contact_calls: Mutex<Vec<(String, HashMap<String, String>)>>,
        pub delete_contact_calls: Mutex<Vec<String>>,
        pub create_printer_calls: Mutex<Vec<(String, HashMap<String, String>)>>,
        pub update_printer_calls: Mutex<Vec<(String, HashMap<String, String>)>>,
        pub delete_printer_calls: Mutex<Vec<String>>,
        thumbnail_photos: Mutex<HashMap<String, String>>,
        pub set_photo_calls: Mutex<Vec<(String, String)>>,
        pub remove_photo_calls: Mutex<Vec<String>>,
        configuration_entries: Mutex<Vec<DirectoryEntry>>,
        connection_error: Mutex<Option<String>>,
        truncated: Mutex<bool>,
        is_rodc: Mutex<bool>,
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
                create_user_calls: Mutex::new(Vec::new()),
                modify_attribute_calls: Mutex::new(Vec::new()),
                user_uac: Mutex::new(HashMap::new()),
                clear_uac_bits_calls: Mutex::new(Vec::new()),
                cannot_change_password: Mutex::new(false),
                replication_metadata: Mutex::new(None),
                ou_tree: Mutex::new(Vec::new()),
                recycle_bin_enabled: Mutex::new(true),
                deleted_objects: Mutex::new(Vec::new()),
                restore_calls: Mutex::new(Vec::new()),
                contacts: Mutex::new(Vec::new()),
                printers: Mutex::new(Vec::new()),
                create_contact_calls: Mutex::new(Vec::new()),
                update_contact_calls: Mutex::new(Vec::new()),
                delete_contact_calls: Mutex::new(Vec::new()),
                create_printer_calls: Mutex::new(Vec::new()),
                update_printer_calls: Mutex::new(Vec::new()),
                delete_printer_calls: Mutex::new(Vec::new()),
                thumbnail_photos: Mutex::new(HashMap::new()),
                set_photo_calls: Mutex::new(Vec::new()),
                remove_photo_calls: Mutex::new(Vec::new()),
                configuration_entries: Mutex::new(Vec::new()),
                connection_error: Mutex::new(None),
                truncated: Mutex::new(false),
                is_rodc: Mutex::new(false),
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
                create_user_calls: Mutex::new(Vec::new()),
                modify_attribute_calls: Mutex::new(Vec::new()),
                user_uac: Mutex::new(HashMap::new()),
                clear_uac_bits_calls: Mutex::new(Vec::new()),
                cannot_change_password: Mutex::new(false),
                replication_metadata: Mutex::new(None),
                ou_tree: Mutex::new(Vec::new()),
                recycle_bin_enabled: Mutex::new(false),
                deleted_objects: Mutex::new(Vec::new()),
                restore_calls: Mutex::new(Vec::new()),
                contacts: Mutex::new(Vec::new()),
                printers: Mutex::new(Vec::new()),
                create_contact_calls: Mutex::new(Vec::new()),
                update_contact_calls: Mutex::new(Vec::new()),
                delete_contact_calls: Mutex::new(Vec::new()),
                create_printer_calls: Mutex::new(Vec::new()),
                update_printer_calls: Mutex::new(Vec::new()),
                delete_printer_calls: Mutex::new(Vec::new()),
                thumbnail_photos: Mutex::new(HashMap::new()),
                set_photo_calls: Mutex::new(Vec::new()),
                remove_photo_calls: Mutex::new(Vec::new()),
                configuration_entries: Mutex::new(Vec::new()),
                connection_error: Mutex::new(Some("not_domain_joined".to_string())),
                truncated: Mutex::new(false),
                is_rodc: Mutex::new(false),
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

        pub fn with_deleted_objects(self, objects: Vec<DeletedObject>) -> Self {
            *self.deleted_objects.lock().unwrap() = objects;
            self
        }

        pub fn with_recycle_bin_disabled(self) -> Self {
            *self.recycle_bin_enabled.lock().unwrap() = false;
            self
        }

        pub fn with_contacts(self, contacts: Vec<ContactInfo>) -> Self {
            *self.contacts.lock().unwrap() = contacts;
            self
        }

        pub fn with_printers(self, printers: Vec<PrinterInfo>) -> Self {
            *self.printers.lock().unwrap() = printers;
            self
        }

        pub fn with_thumbnail_photo(self, dn: &str, photo_base64: &str) -> Self {
            self.thumbnail_photos
                .lock()
                .unwrap()
                .insert(dn.to_string(), photo_base64.to_string());
            self
        }

        pub fn with_configuration_entries(self, entries: Vec<DirectoryEntry>) -> Self {
            *self.configuration_entries.lock().unwrap() = entries;
            self
        }

        pub fn with_failure(self) -> Self {
            *self.should_fail.lock().unwrap() = true;
            self
        }

        /// Sets the userAccountControl value for a specific user DN. Used by
        /// tests of the `clear_user_account_control_bits` flow.
        pub fn set_user_account_control(&self, dn: &str, uac: u32) {
            self.user_uac.lock().unwrap().insert(dn.to_string(), uac);
        }

        pub fn with_connection_error(self, kind: &str) -> Self {
            *self.connection_error.lock().unwrap() = Some(kind.to_string());
            self
        }

        pub fn with_truncated(self) -> Self {
            *self.truncated.lock().unwrap() = true;
            self
        }

        pub fn with_rodc(self) -> Self {
            *self.is_rodc.lock().unwrap() = true;
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

        fn connected_host(&self) -> Option<String> {
            self.domain.clone()
        }

        fn base_dn(&self) -> Option<String> {
            self.base.clone()
        }

        async fn test_connection(&self) -> Result<bool> {
            self.check_failure()?;
            Ok(self.is_connected())
        }

        fn last_connection_error(&self) -> Option<String> {
            self.connection_error.lock().unwrap().clone()
        }

        fn last_search_was_truncated(&self) -> bool {
            *self.truncated.lock().unwrap()
        }

        fn is_connected_to_rodc(&self) -> bool {
            *self.is_rodc.lock().unwrap()
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

        async fn clear_user_account_control_bits(
            &self,
            user_dn: &str,
            bits_to_clear: u32,
        ) -> Result<(u32, u32)> {
            self.check_failure()?;
            let mut uac_map = self.user_uac.lock().unwrap();
            let previous = uac_map.get(user_dn).copied().unwrap_or(0);
            let new = previous & !bits_to_clear;
            if new == previous {
                // Idempotent no-op - no state change, no recorded call
                return Ok((previous, previous));
            }
            uac_map.insert(user_dn.to_string(), new);
            self.modify_attribute_calls.lock().unwrap().push((
                user_dn.to_string(),
                "userAccountControl".to_string(),
                vec![new.to_string()],
            ));
            self.clear_uac_bits_calls.lock().unwrap().push((
                user_dn.to_string(),
                bits_to_clear,
                previous,
                new,
            ));
            Ok((previous, new))
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

        async fn browse_contacts(&self, _max_results: usize) -> Result<Vec<DirectoryEntry>> {
            self.check_failure()?;
            Ok(Vec::new())
        }

        async fn browse_printers(&self, _max_results: usize) -> Result<Vec<DirectoryEntry>> {
            self.check_failure()?;
            Ok(Vec::new())
        }

        async fn create_user(
            &self,
            cn: &str,
            container_dn: &str,
            sam_account_name: &str,
            _password: &str,
            _attributes: &std::collections::HashMap<String, Vec<String>>,
        ) -> Result<String> {
            if *self.should_fail.lock().unwrap() {
                anyhow::bail!("Mock create_user failure");
            }
            self.create_user_calls.lock().unwrap().push((
                cn.to_string(),
                container_dn.to_string(),
                sam_account_name.to_string(),
            ));
            Ok(format!("CN={},{}", cn, container_dn))
        }

        async fn modify_attribute(
            &self,
            dn: &str,
            attribute_name: &str,
            values: &[String],
        ) -> Result<()> {
            if *self.should_fail.lock().unwrap() {
                anyhow::bail!("Mock modify_attribute failure");
            }
            self.modify_attribute_calls.lock().unwrap().push((
                dn.to_string(),
                attribute_name.to_string(),
                values.to_vec(),
            ));
            Ok(())
        }

        fn authenticated_user(&self) -> Option<String> {
            None
        }

        async fn probe_effective_permissions(&self) -> Result<(bool, bool, bool)> {
            self.check_failure()?;
            Ok((false, false, false))
        }

        async fn is_recycle_bin_enabled(&self) -> Result<bool> {
            self.check_failure()?;
            Ok(*self.recycle_bin_enabled.lock().unwrap())
        }

        async fn get_deleted_objects(&self) -> Result<Vec<DeletedObject>> {
            self.check_failure()?;
            Ok(self.deleted_objects.lock().unwrap().clone())
        }

        async fn restore_deleted_object(&self, deleted_dn: &str, target_ou_dn: &str) -> Result<()> {
            self.check_failure()?;
            self.restore_calls
                .lock()
                .unwrap()
                .push((deleted_dn.to_string(), target_ou_dn.to_string()));
            Ok(())
        }

        async fn search_contacts(
            &self,
            _filter: &str,
            max_results: usize,
        ) -> Result<Vec<ContactInfo>> {
            self.check_failure()?;
            let contacts = self.contacts.lock().unwrap();
            Ok(contacts.iter().take(max_results).cloned().collect())
        }

        async fn search_printers(
            &self,
            _filter: &str,
            max_results: usize,
        ) -> Result<Vec<PrinterInfo>> {
            self.check_failure()?;
            let printers = self.printers.lock().unwrap();
            Ok(printers.iter().take(max_results).cloned().collect())
        }

        async fn create_contact(
            &self,
            container_dn: &str,
            attrs: &HashMap<String, String>,
        ) -> Result<String> {
            self.check_failure()?;
            let cn = attrs
                .get("displayName")
                .cloned()
                .unwrap_or_else(|| "Contact".to_string());
            self.create_contact_calls
                .lock()
                .unwrap()
                .push((container_dn.to_string(), attrs.clone()));
            Ok(format!("CN={},{}", cn, container_dn))
        }

        async fn update_contact(&self, dn: &str, attrs: &HashMap<String, String>) -> Result<()> {
            self.check_failure()?;
            self.update_contact_calls
                .lock()
                .unwrap()
                .push((dn.to_string(), attrs.clone()));
            Ok(())
        }

        async fn delete_contact(&self, dn: &str) -> Result<()> {
            self.check_failure()?;
            self.delete_contact_calls
                .lock()
                .unwrap()
                .push(dn.to_string());
            Ok(())
        }

        async fn create_printer(
            &self,
            container_dn: &str,
            attrs: &HashMap<String, String>,
        ) -> Result<String> {
            self.check_failure()?;
            let cn = attrs
                .get("printerName")
                .cloned()
                .unwrap_or_else(|| "Printer".to_string());
            self.create_printer_calls
                .lock()
                .unwrap()
                .push((container_dn.to_string(), attrs.clone()));
            Ok(format!("CN={},{}", cn, container_dn))
        }

        async fn update_printer(&self, dn: &str, attrs: &HashMap<String, String>) -> Result<()> {
            self.check_failure()?;
            self.update_printer_calls
                .lock()
                .unwrap()
                .push((dn.to_string(), attrs.clone()));
            Ok(())
        }

        async fn delete_printer(&self, dn: &str) -> Result<()> {
            self.check_failure()?;
            self.delete_printer_calls
                .lock()
                .unwrap()
                .push(dn.to_string());
            Ok(())
        }

        async fn get_thumbnail_photo(&self, user_dn: &str) -> Result<Option<String>> {
            self.check_failure()?;
            Ok(self.thumbnail_photos.lock().unwrap().get(user_dn).cloned())
        }

        async fn set_thumbnail_photo(&self, user_dn: &str, photo_base64: &str) -> Result<()> {
            self.check_failure()?;
            self.set_photo_calls
                .lock()
                .unwrap()
                .push((user_dn.to_string(), photo_base64.to_string()));
            self.thumbnail_photos
                .lock()
                .unwrap()
                .insert(user_dn.to_string(), photo_base64.to_string());
            Ok(())
        }

        async fn remove_thumbnail_photo(&self, user_dn: &str) -> Result<()> {
            self.check_failure()?;
            self.remove_photo_calls
                .lock()
                .unwrap()
                .push(user_dn.to_string());
            self.thumbnail_photos.lock().unwrap().remove(user_dn);
            Ok(())
        }

        async fn search_configuration(
            &self,
            _search_base: &str,
            _filter: &str,
        ) -> Result<Vec<DirectoryEntry>> {
            self.check_failure()?;
            Ok(self.configuration_entries.lock().unwrap().clone())
        }

        async fn read_entry(&self, _dn: &str) -> Result<Option<DirectoryEntry>> {
            self.check_failure()?;
            Ok(self.configuration_entries.lock().unwrap().first().cloned())
        }

        async fn resolve_group_by_rid(&self, _rid: u32) -> Result<Option<DirectoryEntry>> {
            self.check_failure()?;
            // Mock returns a matching group from the groups list based on RID
            Ok(self.groups.lock().unwrap().first().cloned())
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

    // ------------------------------------------------------------------
    // clear_user_account_control_bits (Epic 14 Story 14.4 / 14.6)
    // ------------------------------------------------------------------

    #[tokio::test]
    async fn test_clear_uac_bits_clears_only_target_bit() {
        let provider = MockDirectoryProvider::new();
        let dn = "CN=Alice,DC=example,DC=com";
        // 0x0220 = PASSWORD_NOT_REQUIRED (0x0020) | ACCOUNTDISABLE (0x0200)
        provider.set_user_account_control(dn, 0x0220);

        let (previous, new) = provider
            .clear_user_account_control_bits(dn, 0x0020)
            .await
            .unwrap();

        assert_eq!(previous, 0x0220);
        assert_eq!(new, 0x0200, "only PASSWORD_NOT_REQUIRED should be cleared");

        let calls = provider.clear_uac_bits_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0], (dn.to_string(), 0x0020, 0x0220, 0x0200));

        let writes = provider.modify_attribute_calls.lock().unwrap();
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].1, "userAccountControl");
        assert_eq!(writes[0].2, vec!["512".to_string()]); // 0x0200 = 512
    }

    #[tokio::test]
    async fn test_clear_uac_bits_idempotent_no_op_when_already_clear() {
        let provider = MockDirectoryProvider::new();
        let dn = "CN=Bob,DC=example,DC=com";
        // 0x0200 = ACCOUNTDISABLE only, PASSWORD_NOT_REQUIRED already clear
        provider.set_user_account_control(dn, 0x0200);

        let (previous, new) = provider
            .clear_user_account_control_bits(dn, 0x0020)
            .await
            .unwrap();

        assert_eq!(previous, 0x0200);
        assert_eq!(new, 0x0200, "no-op should return previous == new");

        let calls = provider.clear_uac_bits_calls.lock().unwrap();
        assert!(
            calls.is_empty(),
            "no clear_uac_bits_calls entry on no-op (only successful state changes are recorded)"
        );

        let writes = provider.modify_attribute_calls.lock().unwrap();
        assert!(writes.is_empty(), "no LDAP write on no-op");
    }

    #[tokio::test]
    async fn test_clear_uac_bits_preserves_unrelated_bits() {
        let provider = MockDirectoryProvider::new();
        let dn = "CN=Carol,DC=example,DC=com";
        // 0x80220 = TRUSTED_FOR_DELEGATION | ACCOUNTDISABLE | PASSWORD_NOT_REQUIRED
        provider.set_user_account_control(dn, 0x80220);

        // Clear only PASSWORD_NOT_REQUIRED - delegation and disable bits must
        // survive
        let (_previous, new) = provider
            .clear_user_account_control_bits(dn, 0x0020)
            .await
            .unwrap();

        assert_eq!(new, 0x80200);
        assert_eq!(new & 0x80000, 0x80000, "TRUSTED_FOR_DELEGATION preserved");
        assert_eq!(new & 0x0200, 0x0200, "ACCOUNTDISABLE preserved");
        assert_eq!(new & 0x0020, 0, "PASSWORD_NOT_REQUIRED cleared");
    }

    #[tokio::test]
    async fn test_clear_uac_bits_works_with_any_mask() {
        let provider = MockDirectoryProvider::new();
        let dn = "CN=Dave,DC=example,DC=com";
        // Story 14.6 will clear TRUSTED_FOR_DELEGATION (0x80000)
        provider.set_user_account_control(dn, 0x80200);

        let (previous, new) = provider
            .clear_user_account_control_bits(dn, 0x80000)
            .await
            .unwrap();

        assert_eq!(previous, 0x80200);
        assert_eq!(new, 0x0200, "only TRUSTED_FOR_DELEGATION cleared");

        let calls = provider.clear_uac_bits_calls.lock().unwrap();
        assert_eq!(calls[0].1, 0x80000, "mask recorded as-is");
    }

    #[tokio::test]
    async fn test_clear_uac_bits_propagates_failure_flag() {
        let provider = MockDirectoryProvider::new().with_failure();
        let result = provider
            .clear_user_account_control_bits("CN=Alice,DC=example,DC=com", 0x0020)
            .await;
        assert!(result.is_err());
    }
}
