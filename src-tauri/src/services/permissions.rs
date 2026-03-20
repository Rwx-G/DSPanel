use std::collections::HashMap;
use std::sync::Mutex;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::services::directory::DirectoryProvider;

/// Permission levels in ascending order of privilege.
///
/// Derived `PartialOrd` and `Ord` enable inheritance checks:
/// `current_level >= required_level` means "has permission".
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(u8)]
pub enum PermissionLevel {
    ReadOnly = 0,
    HelpDesk = 1,
    AccountOperator = 2,
    Admin = 3,
    DomainAdmin = 4,
}

impl std::fmt::Display for PermissionLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PermissionLevel::ReadOnly => write!(f, "ReadOnly"),
            PermissionLevel::HelpDesk => write!(f, "HelpDesk"),
            PermissionLevel::AccountOperator => write!(f, "AccountOperator"),
            PermissionLevel::Admin => write!(f, "Admin"),
            PermissionLevel::DomainAdmin => write!(f, "DomainAdmin"),
        }
    }
}

/// Well-known RIDs (Relative IDs) for AD built-in groups.
/// These are language-independent and work in any AD locale.
const RID_DOMAIN_ADMINS: u32 = 512;
const RID_ENTERPRISE_ADMINS: u32 = 519;
const RID_ACCOUNT_OPERATORS: u32 = 548;
const RID_ADMINISTRATORS: u32 = 544;

/// Configuration for permission group-to-level mappings.
///
/// Includes both well-known SID RID mappings (language-independent) and
/// custom group name mappings for organization-specific groups.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionConfig {
    /// Custom group name to permission level mappings.
    pub group_mappings: HashMap<String, PermissionLevel>,
    /// SID suffix (RID) to permission level mappings.
    #[serde(default = "default_rid_mappings")]
    pub rid_mappings: HashMap<u32, PermissionLevel>,
}

fn default_rid_mappings() -> HashMap<u32, PermissionLevel> {
    let mut m = HashMap::new();
    m.insert(RID_DOMAIN_ADMINS, PermissionLevel::DomainAdmin);
    m.insert(RID_ENTERPRISE_ADMINS, PermissionLevel::DomainAdmin);
    m.insert(RID_ADMINISTRATORS, PermissionLevel::DomainAdmin);
    m.insert(RID_ACCOUNT_OPERATORS, PermissionLevel::AccountOperator);
    m
}

impl Default for PermissionConfig {
    fn default() -> Self {
        let mut group_mappings = HashMap::new();
        // Custom DSPanel-specific groups (organization can create these)
        group_mappings.insert("DSPanel-HelpDesk".to_string(), PermissionLevel::HelpDesk);
        group_mappings.insert(
            "DSPanel-AccountOps".to_string(),
            PermissionLevel::AccountOperator,
        );
        group_mappings.insert("DSPanel-Admin".to_string(), PermissionLevel::Admin);
        group_mappings.insert(
            "DSPanel-DomainAdmin".to_string(),
            PermissionLevel::DomainAdmin,
        );
        Self {
            group_mappings,
            rid_mappings: default_rid_mappings(),
        }
    }
}

/// Extracts the RID (last sub-authority) from a SID string like "S-1-5-21-...-512".
fn extract_rid(sid: &str) -> Option<u32> {
    sid.rsplit('-').next()?.parse().ok()
}

/// Service for detecting and checking user permissions based on AD group memberships.
///
/// The service maps AD group names to `PermissionLevel` values.
/// The highest detected level wins (inheritance model).
pub struct PermissionService {
    current_level: Mutex<PermissionLevel>,
    user_groups: Mutex<Vec<String>>,
    authenticated_user: Mutex<Option<String>>,
    group_mappings: HashMap<String, PermissionLevel>,
    rid_mappings: HashMap<u32, PermissionLevel>,
}

impl PermissionService {
    /// Creates a new `PermissionService` with the given configuration.
    pub fn new(config: PermissionConfig) -> Self {
        Self {
            current_level: Mutex::new(PermissionLevel::ReadOnly),
            user_groups: Mutex::new(Vec::new()),
            authenticated_user: Mutex::new(None),
            group_mappings: config.group_mappings,
            rid_mappings: config.rid_mappings,
        }
    }

    /// Returns the current detected permission level.
    pub fn current_level(&self) -> PermissionLevel {
        *self.current_level.lock().expect("lock poisoned")
    }

    /// Returns true if the user meets or exceeds the required permission level.
    pub fn has_permission(&self, required: PermissionLevel) -> bool {
        self.current_level() >= required
    }

    /// Returns the user's detected AD group memberships.
    pub fn user_groups(&self) -> Vec<String> {
        self.user_groups.lock().expect("lock poisoned").clone()
    }

    /// Returns the authenticated user identity (resolved via WhoAmI or bind DN).
    pub fn authenticated_user(&self) -> Option<String> {
        self.authenticated_user
            .lock()
            .expect("lock poisoned")
            .clone()
    }

    /// Sets the authenticated user identity.
    pub fn set_authenticated_user(&self, username: String) {
        *self.authenticated_user.lock().expect("lock poisoned") = Some(username);
    }

    /// Detects the user's permission level by querying AD group memberships.
    ///
    /// The service queries the `DirectoryProvider` for the current user's groups,
    /// maps them to permission levels, and selects the highest level.
    /// Defaults to `ReadOnly` when no matching groups are found.
    pub async fn detect_permissions(&self, provider: &dyn DirectoryProvider) -> Result<()> {
        let group_strings = provider.get_current_user_groups().await?;

        // Separate group DNs from SID strings.
        // get_current_user_groups returns both: DNs from memberOf and
        // SID strings (S-1-5-...) from tokenGroups.
        let mut group_names = Vec::new();
        let mut sids = Vec::new();

        for entry in &group_strings {
            if entry.starts_with("S-1-") {
                sids.push(entry.clone());
            } else if let Some(cn) = extract_cn(entry) {
                group_names.push(cn);
            }
        }

        let mut detected_level = PermissionLevel::ReadOnly;

        // 1. Match by well-known RID (language-independent)
        for sid in &sids {
            if let Some(rid) = extract_rid(sid) {
                if let Some(&level) = self.rid_mappings.get(&rid) {
                    if level > detected_level {
                        tracing::info!(sid = %sid, rid, level = %level, "RID match");
                        detected_level = level;
                    }
                }
            }
        }

        // 2. Match by custom group name (organization-specific)
        for group_name in &group_names {
            if let Some(&level) = self.group_mappings.get(group_name) {
                if level > detected_level {
                    tracing::info!(group = %group_name, level = %level, "Group name match");
                    detected_level = level;
                }
            }
        }

        // 3. If still below DomainAdmin, probe effective permissions
        if detected_level < PermissionLevel::DomainAdmin {
            match provider.probe_effective_permissions().await {
                Ok((can_write_user, can_write_group, can_create)) => {
                    if can_create && detected_level < PermissionLevel::Admin {
                        tracing::info!("Probe: can create objects in OU -> Admin");
                        detected_level = PermissionLevel::Admin;
                    }
                    if can_write_group && detected_level < PermissionLevel::AccountOperator {
                        tracing::info!("Probe: can write group members -> AccountOperator");
                        detected_level = PermissionLevel::AccountOperator;
                    }
                    if can_write_user && detected_level < PermissionLevel::HelpDesk {
                        tracing::info!("Probe: can write user attributes -> HelpDesk");
                        detected_level = PermissionLevel::HelpDesk;
                    }
                }
                Err(e) => {
                    tracing::warn!("Permission probe failed: {}", e);
                }
            }
        }

        tracing::info!(
            "Permission level detected: {} (from {} groups, {} SIDs, with probe)",
            detected_level,
            group_names.len(),
            sids.len()
        );

        *self.current_level.lock().expect("lock poisoned") = detected_level;
        *self.user_groups.lock().expect("lock poisoned") = group_names;

        Ok(())
    }

    /// Manually sets the permission level (useful for testing or offline mode).
    pub fn set_level(&self, level: PermissionLevel) {
        *self.current_level.lock().expect("lock poisoned") = level;
    }
}

/// Extracts the CN value from a distinguished name.
///
/// Example: "CN=Domain Admins,CN=Users,DC=example,DC=com" -> "Domain Admins"
fn extract_cn(dn: &str) -> Option<String> {
    dn.split(',')
        .next()
        .and_then(|part| part.strip_prefix("CN="))
        .map(|cn| cn.to_string())
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::directory::tests::MockDirectoryProvider;

    fn default_service() -> PermissionService {
        PermissionService::new(PermissionConfig::default())
    }

    fn custom_service(mappings: HashMap<String, PermissionLevel>) -> PermissionService {
        PermissionService::new(PermissionConfig {
            group_mappings: mappings,
            rid_mappings: default_rid_mappings(),
        })
    }

    fn make_group_dns(groups: &[&str]) -> Vec<String> {
        groups
            .iter()
            .map(|g| format!("CN={},CN=Users,DC=example,DC=com", g))
            .collect()
    }

    // --- PermissionLevel tests ---

    #[test]
    fn test_permission_level_ordering() {
        assert!(PermissionLevel::ReadOnly < PermissionLevel::HelpDesk);
        assert!(PermissionLevel::HelpDesk < PermissionLevel::AccountOperator);
        assert!(PermissionLevel::AccountOperator < PermissionLevel::DomainAdmin);
    }

    #[test]
    fn test_permission_level_equality() {
        assert_eq!(PermissionLevel::ReadOnly, PermissionLevel::ReadOnly);
        assert_ne!(PermissionLevel::ReadOnly, PermissionLevel::HelpDesk);
    }

    #[test]
    fn test_permission_level_display() {
        assert_eq!(PermissionLevel::ReadOnly.to_string(), "ReadOnly");
        assert_eq!(PermissionLevel::HelpDesk.to_string(), "HelpDesk");
        assert_eq!(
            PermissionLevel::AccountOperator.to_string(),
            "AccountOperator"
        );
        assert_eq!(PermissionLevel::DomainAdmin.to_string(), "DomainAdmin");
    }

    #[test]
    fn test_permission_level_serialization() {
        let json = serde_json::to_string(&PermissionLevel::HelpDesk).unwrap();
        assert_eq!(json, "\"HelpDesk\"");
        let deserialized: PermissionLevel = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, PermissionLevel::HelpDesk);
    }

    #[test]
    fn test_permission_level_copy() {
        let level = PermissionLevel::DomainAdmin;
        let copied = level;
        assert_eq!(level, copied);
    }

    // --- PermissionConfig tests ---

    #[test]
    fn test_default_config_has_group_mappings() {
        let config = PermissionConfig::default();
        assert_eq!(config.group_mappings.len(), 4);
        assert_eq!(
            config.group_mappings.get("DSPanel-HelpDesk"),
            Some(&PermissionLevel::HelpDesk)
        );
        assert_eq!(
            config.group_mappings.get("DSPanel-AccountOps"),
            Some(&PermissionLevel::AccountOperator)
        );
        assert_eq!(
            config.group_mappings.get("DSPanel-Admin"),
            Some(&PermissionLevel::Admin)
        );
        assert_eq!(
            config.group_mappings.get("DSPanel-DomainAdmin"),
            Some(&PermissionLevel::DomainAdmin)
        );
    }

    #[test]
    fn test_default_config_has_rid_mappings() {
        let config = PermissionConfig::default();
        assert_eq!(
            config.rid_mappings.get(&RID_DOMAIN_ADMINS),
            Some(&PermissionLevel::DomainAdmin)
        );
        assert_eq!(
            config.rid_mappings.get(&RID_ACCOUNT_OPERATORS),
            Some(&PermissionLevel::AccountOperator)
        );
    }

    #[test]
    fn test_config_serialization_roundtrip() {
        let config = PermissionConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: PermissionConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.group_mappings.len(), 4);
    }

    // --- PermissionService tests ---

    #[test]
    fn test_service_defaults_to_readonly() {
        let service = default_service();
        assert_eq!(service.current_level(), PermissionLevel::ReadOnly);
    }

    #[test]
    fn test_has_permission_readonly_always_true_for_readonly() {
        let service = default_service();
        assert!(service.has_permission(PermissionLevel::ReadOnly));
    }

    #[test]
    fn test_has_permission_readonly_false_for_higher() {
        let service = default_service();
        assert!(!service.has_permission(PermissionLevel::HelpDesk));
        assert!(!service.has_permission(PermissionLevel::AccountOperator));
        assert!(!service.has_permission(PermissionLevel::DomainAdmin));
    }

    #[test]
    fn test_set_level_updates_current() {
        let service = default_service();
        service.set_level(PermissionLevel::DomainAdmin);
        assert_eq!(service.current_level(), PermissionLevel::DomainAdmin);
    }

    #[test]
    fn test_user_groups_initially_empty() {
        let service = default_service();
        assert!(service.user_groups().is_empty());
    }

    // --- detect_permissions tests ---

    #[tokio::test]
    async fn test_detect_readonly_when_no_matching_groups() {
        let provider =
            MockDirectoryProvider::new().with_user_groups(make_group_dns(&["SomeOtherGroup"]));
        let service = default_service();
        service.detect_permissions(&provider).await.unwrap();
        assert_eq!(service.current_level(), PermissionLevel::ReadOnly);
    }

    #[tokio::test]
    async fn test_detect_helpdesk_from_group() {
        let provider =
            MockDirectoryProvider::new().with_user_groups(make_group_dns(&["DSPanel-HelpDesk"]));
        let service = default_service();
        service.detect_permissions(&provider).await.unwrap();
        assert_eq!(service.current_level(), PermissionLevel::HelpDesk);
    }

    #[tokio::test]
    async fn test_detect_account_operator_from_group() {
        let provider =
            MockDirectoryProvider::new().with_user_groups(make_group_dns(&["DSPanel-AccountOps"]));
        let service = default_service();
        service.detect_permissions(&provider).await.unwrap();
        assert_eq!(service.current_level(), PermissionLevel::AccountOperator);
    }

    #[tokio::test]
    async fn test_detect_domain_admin_from_sid() {
        // RID 512 = Domain Admins (language-independent)
        let mut groups = make_group_dns(&["SomeLocalizedGroup"]);
        groups.push("S-1-5-21-1234567890-1234567890-1234567890-512".to_string());
        let provider = MockDirectoryProvider::new().with_user_groups(groups);
        let service = default_service();
        service.detect_permissions(&provider).await.unwrap();
        assert_eq!(service.current_level(), PermissionLevel::DomainAdmin);
    }

    #[tokio::test]
    async fn test_detect_admin_from_custom_group_name() {
        let provider =
            MockDirectoryProvider::new().with_user_groups(make_group_dns(&["DSPanel-Admin"]));
        let service = default_service();
        service.detect_permissions(&provider).await.unwrap();
        assert_eq!(service.current_level(), PermissionLevel::Admin);
    }

    #[tokio::test]
    async fn test_detect_domain_admin_from_custom_group_name() {
        let provider =
            MockDirectoryProvider::new().with_user_groups(make_group_dns(&["DSPanel-DomainAdmin"]));
        let service = default_service();
        service.detect_permissions(&provider).await.unwrap();
        assert_eq!(service.current_level(), PermissionLevel::DomainAdmin);
    }

    #[tokio::test]
    async fn test_highest_level_wins() {
        let mut groups = make_group_dns(&["DSPanel-HelpDesk", "DSPanel-AccountOps"]);
        // Add Domain Admins SID
        groups.push("S-1-5-21-1234567890-1234567890-1234567890-512".to_string());
        let provider = MockDirectoryProvider::new().with_user_groups(groups);
        let service = default_service();
        service.detect_permissions(&provider).await.unwrap();
        assert_eq!(service.current_level(), PermissionLevel::DomainAdmin);
    }

    #[tokio::test]
    async fn test_inheritance_domain_admin_has_helpdesk_permission() {
        let provider = MockDirectoryProvider::new().with_user_groups(vec![
            "S-1-5-21-1234567890-1234567890-1234567890-512".to_string(),
        ]);
        let service = default_service();
        service.detect_permissions(&provider).await.unwrap();
        assert!(service.has_permission(PermissionLevel::HelpDesk));
        assert!(service.has_permission(PermissionLevel::AccountOperator));
        assert!(service.has_permission(PermissionLevel::DomainAdmin));
    }

    #[tokio::test]
    async fn test_inheritance_account_operator_has_helpdesk_permission() {
        let provider =
            MockDirectoryProvider::new().with_user_groups(make_group_dns(&["DSPanel-AccountOps"]));
        let service = default_service();
        service.detect_permissions(&provider).await.unwrap();
        assert!(service.has_permission(PermissionLevel::ReadOnly));
        assert!(service.has_permission(PermissionLevel::HelpDesk));
        assert!(service.has_permission(PermissionLevel::AccountOperator));
        assert!(!service.has_permission(PermissionLevel::DomainAdmin));
    }

    #[tokio::test]
    async fn test_has_permission_returns_false_when_level_insufficient() {
        let provider =
            MockDirectoryProvider::new().with_user_groups(make_group_dns(&["DSPanel-HelpDesk"]));
        let service = default_service();
        service.detect_permissions(&provider).await.unwrap();
        assert!(!service.has_permission(PermissionLevel::AccountOperator));
        assert!(!service.has_permission(PermissionLevel::DomainAdmin));
    }

    #[tokio::test]
    async fn test_custom_group_name_configuration() {
        let mut mappings = HashMap::new();
        mappings.insert("CustomAdmin".to_string(), PermissionLevel::DomainAdmin);
        let service = custom_service(mappings);
        let provider =
            MockDirectoryProvider::new().with_user_groups(make_group_dns(&["CustomAdmin"]));
        service.detect_permissions(&provider).await.unwrap();
        assert_eq!(service.current_level(), PermissionLevel::DomainAdmin);
    }

    #[tokio::test]
    async fn test_detect_with_empty_groups() {
        let provider = MockDirectoryProvider::new().with_user_groups(vec![]);
        let service = default_service();
        service.detect_permissions(&provider).await.unwrap();
        assert_eq!(service.current_level(), PermissionLevel::ReadOnly);
    }

    #[tokio::test]
    async fn test_detect_populates_user_groups() {
        let provider = MockDirectoryProvider::new()
            .with_user_groups(make_group_dns(&["DSPanel-HelpDesk", "SomeGroup"]));
        let service = default_service();
        service.detect_permissions(&provider).await.unwrap();
        let groups = service.user_groups();
        assert_eq!(groups.len(), 2);
        assert!(groups.contains(&"DSPanel-HelpDesk".to_string()));
        assert!(groups.contains(&"SomeGroup".to_string()));
    }

    #[tokio::test]
    async fn test_detect_with_provider_failure() {
        let provider = MockDirectoryProvider::new().with_failure();
        let service = default_service();
        let result = service.detect_permissions(&provider).await;
        assert!(result.is_err());
        // Level should remain ReadOnly on failure
        assert_eq!(service.current_level(), PermissionLevel::ReadOnly);
    }

    #[tokio::test]
    async fn test_detect_with_disconnected_provider() {
        let provider = MockDirectoryProvider::disconnected();
        let service = default_service();
        let result = service.detect_permissions(&provider).await;
        // Disconnected mock returns empty groups (not an error)
        assert!(result.is_ok());
        assert_eq!(service.current_level(), PermissionLevel::ReadOnly);
    }

    // --- extract_cn tests ---

    #[test]
    fn test_extract_cn_from_standard_dn() {
        assert_eq!(
            extract_cn("CN=Domain Admins,CN=Users,DC=example,DC=com"),
            Some("Domain Admins".to_string())
        );
    }

    #[test]
    fn test_extract_cn_from_simple_dn() {
        assert_eq!(
            extract_cn("CN=TestGroup,DC=example,DC=com"),
            Some("TestGroup".to_string())
        );
    }

    #[test]
    fn test_extract_cn_returns_none_for_non_cn() {
        assert_eq!(extract_cn("OU=Users,DC=example,DC=com"), None);
    }

    #[test]
    fn test_extract_cn_returns_none_for_empty() {
        assert_eq!(extract_cn(""), None);
    }
}
