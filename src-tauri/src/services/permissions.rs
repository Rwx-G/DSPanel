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
    DomainAdmin = 3,
}

impl std::fmt::Display for PermissionLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PermissionLevel::ReadOnly => write!(f, "ReadOnly"),
            PermissionLevel::HelpDesk => write!(f, "HelpDesk"),
            PermissionLevel::AccountOperator => write!(f, "AccountOperator"),
            PermissionLevel::DomainAdmin => write!(f, "DomainAdmin"),
        }
    }
}

/// Configuration for permission group-to-level mappings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionConfig {
    pub group_mappings: HashMap<String, PermissionLevel>,
}

impl Default for PermissionConfig {
    fn default() -> Self {
        let mut mappings = HashMap::new();
        mappings.insert("DSPanel-HelpDesk".to_string(), PermissionLevel::HelpDesk);
        mappings.insert(
            "DSPanel-AccountOps".to_string(),
            PermissionLevel::AccountOperator,
        );
        mappings.insert("Domain Admins".to_string(), PermissionLevel::DomainAdmin);
        Self {
            group_mappings: mappings,
        }
    }
}

/// Service for detecting and checking user permissions based on AD group memberships.
///
/// The service maps AD group names to `PermissionLevel` values.
/// The highest detected level wins (inheritance model).
pub struct PermissionService {
    current_level: Mutex<PermissionLevel>,
    user_groups: Mutex<Vec<String>>,
    group_mappings: HashMap<String, PermissionLevel>,
}

impl PermissionService {
    /// Creates a new `PermissionService` with the given configuration.
    pub fn new(config: PermissionConfig) -> Self {
        Self {
            current_level: Mutex::new(PermissionLevel::ReadOnly),
            user_groups: Mutex::new(Vec::new()),
            group_mappings: config.group_mappings,
        }
    }

    /// Returns the current detected permission level.
    pub fn current_level(&self) -> PermissionLevel {
        *self.current_level.lock().unwrap()
    }

    /// Returns true if the user meets or exceeds the required permission level.
    pub fn has_permission(&self, required: PermissionLevel) -> bool {
        self.current_level() >= required
    }

    /// Returns the user's detected AD group memberships.
    pub fn user_groups(&self) -> Vec<String> {
        self.user_groups.lock().unwrap().clone()
    }

    /// Detects the user's permission level by querying AD group memberships.
    ///
    /// The service queries the `DirectoryProvider` for the current user's groups,
    /// maps them to permission levels, and selects the highest level.
    /// Defaults to `ReadOnly` when no matching groups are found.
    pub async fn detect_permissions(&self, provider: &dyn DirectoryProvider) -> Result<()> {
        let group_dns = provider.get_current_user_groups().await?;

        // Extract the CN from each group DN for matching.
        // Group DNs are like "CN=Domain Admins,CN=Users,DC=example,DC=com"
        let group_names: Vec<String> = group_dns.iter().filter_map(|dn| extract_cn(dn)).collect();

        let mut detected_level = PermissionLevel::ReadOnly;

        for group_name in &group_names {
            if let Some(&level) = self.group_mappings.get(group_name) {
                if level > detected_level {
                    detected_level = level;
                }
            }
        }

        tracing::info!(
            "Permission level detected: {} (from {} groups)",
            detected_level,
            group_names.len()
        );

        *self.current_level.lock().unwrap() = detected_level;
        *self.user_groups.lock().unwrap() = group_names;

        Ok(())
    }

    /// Manually sets the permission level (useful for testing or offline mode).
    pub fn set_level(&self, level: PermissionLevel) {
        *self.current_level.lock().unwrap() = level;
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
    fn test_default_config_has_three_mappings() {
        let config = PermissionConfig::default();
        assert_eq!(config.group_mappings.len(), 3);
        assert_eq!(
            config.group_mappings.get("DSPanel-HelpDesk"),
            Some(&PermissionLevel::HelpDesk)
        );
        assert_eq!(
            config.group_mappings.get("DSPanel-AccountOps"),
            Some(&PermissionLevel::AccountOperator)
        );
        assert_eq!(
            config.group_mappings.get("Domain Admins"),
            Some(&PermissionLevel::DomainAdmin)
        );
    }

    #[test]
    fn test_config_serialization_roundtrip() {
        let config = PermissionConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: PermissionConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.group_mappings.len(), 3);
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
    async fn test_detect_domain_admin_from_group() {
        let provider =
            MockDirectoryProvider::new().with_user_groups(make_group_dns(&["Domain Admins"]));
        let service = default_service();
        service.detect_permissions(&provider).await.unwrap();
        assert_eq!(service.current_level(), PermissionLevel::DomainAdmin);
    }

    #[tokio::test]
    async fn test_highest_level_wins() {
        let provider = MockDirectoryProvider::new().with_user_groups(make_group_dns(&[
            "DSPanel-HelpDesk",
            "DSPanel-AccountOps",
            "Domain Admins",
        ]));
        let service = default_service();
        service.detect_permissions(&provider).await.unwrap();
        assert_eq!(service.current_level(), PermissionLevel::DomainAdmin);
    }

    #[tokio::test]
    async fn test_inheritance_domain_admin_has_helpdesk_permission() {
        let provider =
            MockDirectoryProvider::new().with_user_groups(make_group_dns(&["Domain Admins"]));
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
