use tauri::State;

use crate::error::AppError;
use crate::services::compliance::{self, ComplianceScanResult};
use crate::services::PermissionLevel;
use crate::state::AppState;

/// Returns the list of supported frameworks.
#[tauri::command]
pub fn get_compliance_frameworks() -> Vec<String> {
    compliance::FRAMEWORKS
        .iter()
        .map(|s| s.to_string())
        .collect()
}

/// Runs all compliance checks once and returns results with per-framework scores.
/// Requires DomainAdmin.
#[tauri::command]
pub async fn run_compliance_scan(
    state: State<'_, AppState>,
) -> Result<ComplianceScanResult, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Compliance scan requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    compliance::run_compliance_scan(provider).await
}

/// Exports a compliance report for a specific framework as HTML via save dialog.
#[tauri::command]
pub async fn export_compliance_framework_report(
    scan: ComplianceScanResult,
    framework: String,
    default_name: String,
) -> Result<Option<String>, AppError> {
    let html = compliance::export_framework_report(&scan, &framework);

    let dialog = rfd::AsyncFileDialog::new()
        .set_file_name(&default_name)
        .add_filter("HTML files", &["html"]);

    let handle = dialog.save_file().await;

    match handle {
        Some(file) => {
            let path = file.path().to_string_lossy().to_string();
            tokio::fs::write(file.path(), html.as_bytes())
                .await
                .map_err(|e| AppError::Internal(format!("Failed to write file: {e}")))?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;
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
    // get_compliance_frameworks
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_compliance_frameworks_returns_all_frameworks() {
        let frameworks: Vec<String> = compliance::FRAMEWORKS
            .iter()
            .map(|s| s.to_string())
            .collect();

        assert!(!frameworks.is_empty());
        assert!(frameworks.contains(&"GDPR".to_string()));
        assert!(frameworks.contains(&"HIPAA".to_string()));
        assert!(frameworks.contains(&"SOX".to_string()));
        assert!(frameworks.contains(&"PCI-DSS v4.0".to_string()));
        assert!(frameworks.contains(&"ISO 27001".to_string()));
        assert!(frameworks.contains(&"NIST 800-53".to_string()));
        assert!(frameworks.contains(&"CIS v8".to_string()));
        assert!(frameworks.contains(&"NIS2".to_string()));
        assert!(frameworks.contains(&"ANSSI".to_string()));
    }

    #[test]
    fn test_get_compliance_frameworks_count() {
        let frameworks: Vec<String> = compliance::FRAMEWORKS
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(frameworks.len(), 9);
    }

    // -----------------------------------------------------------------------
    // run_compliance_scan - permission checks
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_run_compliance_scan_requires_domain_admin() {
        let state = make_state(); // ReadOnly by default
        let has_perm = state
            .permission_service
            .has_permission(PermissionLevel::DomainAdmin);
        assert!(!has_perm);
    }

    #[tokio::test]
    async fn test_run_compliance_scan_denied_for_helpdesk() {
        let state = make_state_with_level(PermissionLevel::HelpDesk);
        let has_perm = state
            .permission_service
            .has_permission(PermissionLevel::DomainAdmin);
        assert!(!has_perm);
    }

    #[tokio::test]
    async fn test_run_compliance_scan_allowed_with_domain_admin() {
        let state = make_state_with_level(PermissionLevel::DomainAdmin);
        let has_perm = state
            .permission_service
            .has_permission(PermissionLevel::DomainAdmin);
        assert!(has_perm);
    }

    // -----------------------------------------------------------------------
    // export_compliance_framework_report - report generation
    // -----------------------------------------------------------------------

    #[test]
    fn test_export_framework_report_generates_html() {
        let scan = ComplianceScanResult {
            scanned_at: "2026-03-26T10:00:00Z".to_string(),
            generator: "DSPanel".to_string(),
            total_accounts_scanned: 100,
            global_score: 85,
            total_findings: 5,
            framework_scores: Vec::new(),
            checks: Vec::new(),
        };

        let html = compliance::export_framework_report(&scan, "GDPR");
        assert!(!html.is_empty());
        // Should contain HTML structure
        assert!(html.contains("html") || html.contains("HTML") || html.contains("<"));
    }
}
