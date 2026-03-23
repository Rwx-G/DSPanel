use tauri::State;

use crate::error::AppError;
use crate::models::security::PrivilegedAccountsReport;
use crate::services::PermissionLevel;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Privileged Accounts - Inner functions
// ---------------------------------------------------------------------------

/// Scans all privileged groups and returns accounts with security alerts.
/// Requires DomainAdmin permission.
pub(crate) async fn get_privileged_accounts_inner(
    state: &AppState,
) -> Result<PrivilegedAccountsReport, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Privileged accounts scan requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();

    // Load additional configured groups from settings
    let settings = state.app_settings.get();
    let additional_groups = settings
        .privileged_groups
        .clone()
        .unwrap_or_default();

    crate::services::security::get_privileged_accounts_report(provider, &additional_groups)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Returns a report of all privileged accounts with security alerts.
#[tauri::command]
pub async fn get_privileged_accounts(
    state: State<'_, AppState>,
) -> Result<PrivilegedAccountsReport, AppError> {
    get_privileged_accounts_inner(&state).await
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::directory::tests::MockDirectoryProvider;
    use crate::services::PermissionConfig;
    use std::sync::Arc;

    fn make_state() -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new());
        AppState::new_for_test(provider, PermissionConfig::default())
    }

    #[tokio::test]
    async fn test_get_privileged_accounts_requires_domain_admin() {
        let state = make_state();
        // Default permission is ReadOnly, should be denied
        let result = get_privileged_accounts_inner(&state).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_get_privileged_accounts_with_domain_admin() {
        let state = make_state();
        state
            .permission_service
            .set_level(PermissionLevel::DomainAdmin);
        let result = get_privileged_accounts_inner(&state).await;
        // Should succeed (returns empty report since mock has no users)
        assert!(result.is_ok());
        let report = result.unwrap();
        assert!(report.accounts.is_empty());
        assert_eq!(report.summary.critical, 0);
    }
}
