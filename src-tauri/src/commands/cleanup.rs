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
    state
        .app_settings
        .get()
        .cleanup_rules
        .unwrap_or_default()
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
