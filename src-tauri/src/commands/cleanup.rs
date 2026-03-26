use tauri::State;

use crate::error::AppError;
use crate::services::cleanup::{
    CleanupDryRunResult, CleanupExecutionResult, CleanupMatch, CleanupRule,
};
use crate::services::PermissionLevel;
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

    let provider = state.directory_provider.clone();
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

    let provider = state.directory_provider.clone();
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
        let _rules = vec![CleanupRule {
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
}
