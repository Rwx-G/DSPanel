use tauri::State;

use crate::error::AppError;
use crate::models::security::{
    AttackDetectionReport, EscalationGraphResult, PrivilegedAccountsReport, RiskScoreHistory,
    RiskScoreResult, RiskWeights,
};
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

// ---------------------------------------------------------------------------
// Domain Risk Score - Inner functions (Story 9.2)
// ---------------------------------------------------------------------------

/// Computes the domain risk score. Requires DomainAdmin.
pub(crate) async fn get_risk_score_inner(
    state: &AppState,
) -> Result<RiskScoreResult, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Risk score computation requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    let weights = RiskWeights::default();

    let result = crate::services::security::compute_risk_score(provider, &weights)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))?;

    // Store the score for historical tracking
    let store = crate::services::security::RiskScoreStore::new();
    store.store_score(&result);

    Ok(result)
}

/// Returns the risk score history for the last N days. Requires DomainAdmin.
pub(crate) fn get_risk_score_history_inner(
    state: &AppState,
    days: u32,
) -> Result<Vec<RiskScoreHistory>, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Risk score history requires DomainAdmin permission".to_string(),
        ));
    }

    let store = crate::services::security::RiskScoreStore::new();
    Ok(store.get_history(days))
}

/// Computes and returns the domain risk score.
#[tauri::command]
pub async fn get_risk_score(
    state: State<'_, AppState>,
) -> Result<RiskScoreResult, AppError> {
    get_risk_score_inner(&state).await
}

/// Returns risk score history for trend display.
#[tauri::command]
pub fn get_risk_score_history(
    days: u32,
    state: State<'_, AppState>,
) -> Result<Vec<RiskScoreHistory>, AppError> {
    get_risk_score_history_inner(&state, days)
}

// ---------------------------------------------------------------------------
// Attack Detection - Inner functions (Story 9.3)
// ---------------------------------------------------------------------------

/// Detects AD attacks from event log analysis. Requires DomainAdmin.
pub(crate) async fn detect_attacks_inner(
    state: &AppState,
    time_window_hours: u32,
) -> Result<AttackDetectionReport, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Attack detection requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    crate::services::security::detect_attacks(provider, time_window_hours)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Detects common AD attacks from Windows Security event logs.
#[tauri::command]
pub async fn detect_ad_attacks(
    time_window_hours: u32,
    state: State<'_, AppState>,
) -> Result<AttackDetectionReport, AppError> {
    detect_attacks_inner(&state, time_window_hours).await
}

// ---------------------------------------------------------------------------
// Escalation Paths - Inner functions (Story 9.4)
// ---------------------------------------------------------------------------

/// Builds the privilege escalation graph. Requires DomainAdmin.
pub(crate) async fn get_escalation_paths_inner(
    state: &AppState,
) -> Result<EscalationGraphResult, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Escalation path visualization requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    crate::services::security::build_escalation_graph(provider)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Returns the privilege escalation graph data.
#[tauri::command]
pub async fn get_escalation_paths(
    state: State<'_, AppState>,
) -> Result<EscalationGraphResult, AppError> {
    get_escalation_paths_inner(&state).await
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

    #[tokio::test]
    async fn test_get_risk_score_requires_domain_admin() {
        let state = make_state();
        let result = get_risk_score_inner(&state).await;
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_get_risk_score_with_domain_admin() {
        let state = make_state();
        state
            .permission_service
            .set_level(PermissionLevel::DomainAdmin);
        let result = get_risk_score_inner(&state).await;
        assert!(result.is_ok());
        let score = result.unwrap();
        assert!(score.total_score >= 0.0 && score.total_score <= 100.0);
        assert_eq!(score.factors.len(), 4);
    }

    #[test]
    fn test_get_risk_score_history_requires_domain_admin() {
        let state = make_state();
        let result = get_risk_score_history_inner(&state, 30);
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_detect_attacks_requires_domain_admin() {
        let state = make_state();
        let result = detect_attacks_inner(&state, 24).await;
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_detect_attacks_with_domain_admin() {
        let state = make_state();
        state
            .permission_service
            .set_level(PermissionLevel::DomainAdmin);
        let result = detect_attacks_inner(&state, 24).await;
        assert!(result.is_ok());
        let report = result.unwrap();
        assert_eq!(report.time_window_hours, 24);
    }

    #[tokio::test]
    async fn test_get_escalation_paths_requires_domain_admin() {
        let state = make_state();
        let result = get_escalation_paths_inner(&state).await;
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_get_escalation_paths_with_domain_admin() {
        let state = make_state();
        state
            .permission_service
            .set_level(PermissionLevel::DomainAdmin);
        let result = get_escalation_paths_inner(&state).await;
        assert!(result.is_ok());
    }
}
