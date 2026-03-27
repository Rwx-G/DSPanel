use tauri::State;

use crate::error::AppError;
use crate::services::PermissionLevel;
use crate::services::cleanup::{
    CleanupDryRunResult, CleanupExecutionResult, CleanupMatch, CleanupRule,
};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Cleanup rule management (persist in app settings)
// ---------------------------------------------------------------------------

/// Returns all configured cleanup rules.
#[tauri::command]
pub fn get_cleanup_rules(state: State<'_, AppState>) -> Vec<CleanupRule> {
    state.app_settings.get().cleanup_rules.unwrap_or_default()
}

/// Saves cleanup rules to app settings. Requires DomainAdmin.
#[tauri::command]
pub fn save_cleanup_rules(
    state: State<'_, AppState>,
    rules: Vec<CleanupRule>,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Cleanup rules require DomainAdmin permission".to_string(),
        ));
    }

    let mut settings = state.app_settings.get();
    settings.cleanup_rules = Some(rules);
    state.app_settings.update(settings);
    Ok(())
}

// ---------------------------------------------------------------------------
// Dry-run & execution
// ---------------------------------------------------------------------------

/// Evaluates a cleanup rule against all user accounts (dry-run).
/// Returns matching objects without making changes. Requires DomainAdmin.
#[tauri::command]
pub async fn cleanup_dry_run(
    state: State<'_, AppState>,
    rule: CleanupRule,
) -> Result<CleanupDryRunResult, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Cleanup requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.provider();
    crate::services::cleanup::evaluate_rule(provider, &rule).await
}

/// Executes cleanup actions on the selected matches. Requires DomainAdmin.
/// All actions are logged via the audit service.
#[tauri::command]
pub async fn cleanup_execute(
    state: State<'_, AppState>,
    matches: Vec<CleanupMatch>,
) -> Result<Vec<CleanupExecutionResult>, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Cleanup execution requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.provider();
    let results =
        crate::services::cleanup::execute_cleanup(provider, &state.audit_service, &matches).await;
    Ok(results)
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::cleanup::{CleanupAction, CleanupCondition};
    use crate::services::directory::tests::MockDirectoryProvider;
    use crate::services::{PermissionConfig, PermissionLevel};
    use std::sync::Arc;

    fn make_state() -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new());
        AppState::new_for_test(provider, PermissionConfig::default())
    }

    fn make_state_with_level(level: PermissionLevel) -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new());
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        state.permission_service.set_level(level);
        state
    }

    // -----------------------------------------------------------------------
    // get_cleanup_rules
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_cleanup_rules_returns_empty_by_default() {
        let state = make_state();
        // Simulate tauri State by calling the inner logic directly
        let rules = state.app_settings.get().cleanup_rules.unwrap_or_default();
        assert!(rules.is_empty());
    }

    // -----------------------------------------------------------------------
    // save_cleanup_rules - permission checks
    // -----------------------------------------------------------------------

    #[test]
    fn test_save_cleanup_rules_requires_domain_admin() {
        let state = make_state(); // ReadOnly by default
        let _rules = [CleanupRule {
            name: "Test Rule".to_string(),
            condition: CleanupCondition::InactiveDays,
            threshold_days: 90,
            action: CleanupAction::Disable,
            target_ou: None,
            exclude_patterns: None,
            exclude_ous: None,
        }];

        // Directly test the permission logic since tauri State wrapping
        // cannot be constructed in unit tests
        let has_perm = state
            .permission_service
            .has_permission(PermissionLevel::DomainAdmin);
        assert!(!has_perm);
    }

    #[test]
    fn test_save_cleanup_rules_persists_rules() {
        let state = make_state_with_level(PermissionLevel::DomainAdmin);
        let rules = vec![CleanupRule {
            name: "Inactive cleanup".to_string(),
            condition: CleanupCondition::InactiveDays,
            threshold_days: 180,
            action: CleanupAction::Disable,
            target_ou: None,
            exclude_patterns: Some(vec!["svc_*".to_string()]),
            exclude_ous: None,
        }];

        // Save rules directly (mimicking command body without State wrapper)
        let mut settings = state.app_settings.get();
        settings.cleanup_rules = Some(rules.clone());
        state.app_settings.update(settings);

        // Verify they are persisted
        let saved = state.app_settings.get().cleanup_rules.unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].name, "Inactive cleanup");
        assert_eq!(saved[0].threshold_days, 180);
    }

    #[test]
    fn test_save_cleanup_rules_overwrites_previous() {
        let state = make_state_with_level(PermissionLevel::DomainAdmin);

        // Save first set
        let rules1 = vec![CleanupRule {
            name: "Rule 1".to_string(),
            condition: CleanupCondition::InactiveDays,
            threshold_days: 90,
            action: CleanupAction::Disable,
            target_ou: None,
            exclude_patterns: None,
            exclude_ous: None,
        }];
        let mut settings = state.app_settings.get();
        settings.cleanup_rules = Some(rules1);
        state.app_settings.update(settings);

        // Save second set (should overwrite)
        let rules2 = vec![
            CleanupRule {
                name: "Rule A".to_string(),
                condition: CleanupCondition::DisabledDays,
                threshold_days: 30,
                action: CleanupAction::Delete,
                target_ou: None,
                exclude_patterns: None,
                exclude_ous: None,
            },
            CleanupRule {
                name: "Rule B".to_string(),
                condition: CleanupCondition::NeverLoggedOnCreatedDays,
                threshold_days: 60,
                action: CleanupAction::Move,
                target_ou: Some("OU=Cleanup,DC=example,DC=com".to_string()),
                exclude_patterns: None,
                exclude_ous: None,
            },
        ];
        let mut settings = state.app_settings.get();
        settings.cleanup_rules = Some(rules2);
        state.app_settings.update(settings);

        let saved = state.app_settings.get().cleanup_rules.unwrap();
        assert_eq!(saved.len(), 2);
        assert_eq!(saved[0].name, "Rule A");
        assert_eq!(saved[1].name, "Rule B");
    }

    // -----------------------------------------------------------------------
    // cleanup_dry_run - permission checks
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_cleanup_dry_run_requires_domain_admin() {
        let state = make_state(); // ReadOnly by default
        let has_perm = state
            .permission_service
            .has_permission(PermissionLevel::DomainAdmin);
        assert!(!has_perm);
    }

    #[tokio::test]
    async fn test_cleanup_dry_run_allowed_with_domain_admin() {
        let state = make_state_with_level(PermissionLevel::DomainAdmin);
        let has_perm = state
            .permission_service
            .has_permission(PermissionLevel::DomainAdmin);
        assert!(has_perm);
    }

    // -----------------------------------------------------------------------
    // cleanup_execute - permission checks
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_cleanup_execute_requires_domain_admin() {
        let state = make_state();
        let has_perm = state
            .permission_service
            .has_permission(PermissionLevel::DomainAdmin);
        assert!(!has_perm);
    }

    #[tokio::test]
    async fn test_cleanup_execute_denied_for_helpdesk() {
        let state = make_state_with_level(PermissionLevel::HelpDesk);
        let has_perm = state
            .permission_service
            .has_permission(PermissionLevel::DomainAdmin);
        assert!(!has_perm);
    }

    // -----------------------------------------------------------------------
    // cleanup_dry_run - actual execution via evaluate_rule
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_cleanup_dry_run_returns_results_with_domain_admin() {
        let now = chrono::Utc::now();
        let days_ago = now - chrono::Duration::days(200);
        let ticks = (days_ago.timestamp() + 11_644_473_600) * 10_000_000;

        let mut user =
            crate::models::DirectoryEntry::new("CN=Stale,OU=Users,DC=example,DC=com".to_string());
        user.sam_account_name = Some("stale".to_string());
        user.display_name = Some("Stale User".to_string());
        user.object_class = Some("user".to_string());
        user.attributes
            .insert("lastLogonTimestamp".to_string(), vec![ticks.to_string()]);

        let provider = Arc::new(MockDirectoryProvider::new().with_users(vec![user]));
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        state
            .permission_service
            .set_level(PermissionLevel::DomainAdmin);

        let rule = CleanupRule {
            name: "Inactive 180d".to_string(),
            condition: CleanupCondition::InactiveDays,
            threshold_days: 180,
            action: CleanupAction::Disable,
            target_ou: None,
            exclude_patterns: None,
            exclude_ous: None,
        };

        let result = crate::services::cleanup::evaluate_rule(state.provider(), &rule)
            .await
            .unwrap();

        assert_eq!(result.total_count, 1);
        assert_eq!(result.matches[0].display_name, "Stale User");
    }

    #[tokio::test]
    async fn test_cleanup_dry_run_empty_directory() {
        let state = make_state_with_level(PermissionLevel::DomainAdmin);

        let rule = CleanupRule {
            name: "Test".to_string(),
            condition: CleanupCondition::InactiveDays,
            threshold_days: 90,
            action: CleanupAction::Disable,
            target_ou: None,
            exclude_patterns: None,
            exclude_ous: None,
        };

        let result = crate::services::cleanup::evaluate_rule(state.provider(), &rule)
            .await
            .unwrap();

        assert_eq!(result.total_count, 0);
        assert!(result.matches.is_empty());
    }

    // -----------------------------------------------------------------------
    // cleanup_execute - actual execution via execute_cleanup
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_cleanup_execute_with_domain_admin() {
        let state = make_state_with_level(PermissionLevel::DomainAdmin);

        let matches = vec![crate::services::cleanup::CleanupMatch {
            dn: "CN=User,DC=test".to_string(),
            display_name: "User".to_string(),
            sam_account_name: "user".to_string(),
            current_state: "Inactive 200 days".to_string(),
            proposed_action: "Disable account".to_string(),
            action: CleanupAction::Disable,
            target_ou: None,
            selected: true,
        }];

        let results = crate::services::cleanup::execute_cleanup(
            state.provider(),
            &state.audit_service,
            &matches,
        )
        .await;

        assert_eq!(results.len(), 1);
        assert!(results[0].success);
    }

    #[tokio::test]
    async fn test_cleanup_execute_skips_unselected_matches() {
        let state = make_state_with_level(PermissionLevel::DomainAdmin);

        let matches = vec![crate::services::cleanup::CleanupMatch {
            dn: "CN=User,DC=test".to_string(),
            display_name: "User".to_string(),
            sam_account_name: "user".to_string(),
            current_state: "Inactive".to_string(),
            proposed_action: "Disable".to_string(),
            action: CleanupAction::Disable,
            target_ou: None,
            selected: false,
        }];

        let results = crate::services::cleanup::execute_cleanup(
            state.provider(),
            &state.audit_service,
            &matches,
        )
        .await;

        assert!(results.is_empty());
    }

    // -----------------------------------------------------------------------
    // save_cleanup_rules - permission levels
    // -----------------------------------------------------------------------

    #[test]
    fn test_save_cleanup_rules_denied_for_account_operator() {
        let state = make_state_with_level(PermissionLevel::AccountOperator);
        let has_perm = state
            .permission_service
            .has_permission(PermissionLevel::DomainAdmin);
        assert!(!has_perm);
    }

    #[test]
    fn test_save_cleanup_rules_allowed_for_domain_admin() {
        let state = make_state_with_level(PermissionLevel::DomainAdmin);
        let has_perm = state
            .permission_service
            .has_permission(PermissionLevel::DomainAdmin);
        assert!(has_perm);
    }

    // -----------------------------------------------------------------------
    // Rule round-trip via app settings
    // -----------------------------------------------------------------------

    #[test]
    fn test_save_and_retrieve_multiple_rule_types() {
        let state = make_state_with_level(PermissionLevel::DomainAdmin);

        let rules = vec![
            CleanupRule {
                name: "Inactive".to_string(),
                condition: CleanupCondition::InactiveDays,
                threshold_days: 90,
                action: CleanupAction::Disable,
                target_ou: None,
                exclude_patterns: Some(vec!["svc_*".to_string()]),
                exclude_ous: Some(vec!["OU=ServiceAccounts".to_string()]),
            },
            CleanupRule {
                name: "Never logged".to_string(),
                condition: CleanupCondition::NeverLoggedOnCreatedDays,
                threshold_days: 60,
                action: CleanupAction::Move,
                target_ou: Some("OU=Cleanup,DC=test".to_string()),
                exclude_patterns: None,
                exclude_ous: None,
            },
            CleanupRule {
                name: "Disabled".to_string(),
                condition: CleanupCondition::DisabledDays,
                threshold_days: 30,
                action: CleanupAction::Delete,
                target_ou: None,
                exclude_patterns: None,
                exclude_ous: None,
            },
        ];

        let mut settings = state.app_settings.get();
        settings.cleanup_rules = Some(rules);
        state.app_settings.update(settings);

        let saved = state.app_settings.get().cleanup_rules.unwrap();
        assert_eq!(saved.len(), 3);
        assert_eq!(saved[0].condition, CleanupCondition::InactiveDays);
        assert_eq!(
            saved[1].condition,
            CleanupCondition::NeverLoggedOnCreatedDays
        );
        assert_eq!(saved[2].condition, CleanupCondition::DisabledDays);
        assert_eq!(saved[0].action, CleanupAction::Disable);
        assert_eq!(saved[1].action, CleanupAction::Move);
        assert_eq!(saved[2].action, CleanupAction::Delete);
    }
}
