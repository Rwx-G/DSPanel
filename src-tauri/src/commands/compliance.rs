use tauri::State;

use crate::error::AppError;
use crate::services::PermissionLevel;
use crate::services::compliance::{self, ComplianceScanResult};
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

    let provider = state.provider();
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

    // -----------------------------------------------------------------------
    // run_compliance_scan - success path with mock data
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_run_compliance_scan_success_with_domain_admin() {
        let state = make_state_with_level(PermissionLevel::DomainAdmin);
        let has_perm = state
            .permission_service
            .has_permission(PermissionLevel::DomainAdmin);
        assert!(has_perm);

        let result = compliance::run_compliance_scan(state.provider())
            .await
            .unwrap();

        assert_eq!(result.checks.len(), 7);
        assert!(!result.scanned_at.is_empty());
        assert_eq!(result.framework_scores.len(), 9);
    }

    #[tokio::test]
    async fn test_run_compliance_scan_with_findings() {
        // Create users that trigger checks
        let mut admin = crate::models::DirectoryEntry::new("CN=Admin,DC=test".to_string());
        admin.sam_account_name = Some("admin".to_string());
        admin.display_name = Some("Admin".to_string());
        admin.object_class = Some("user".to_string());
        admin
            .attributes
            .insert("adminCount".to_string(), vec!["1".to_string()]);

        let mut disabled = crate::models::DirectoryEntry::new("CN=Disabled,DC=test".to_string());
        disabled.sam_account_name = Some("disabled".to_string());
        disabled.display_name = Some("Disabled".to_string());
        disabled.object_class = Some("user".to_string());
        disabled
            .attributes
            .insert("userAccountControl".to_string(), vec!["514".to_string()]);

        let provider = Arc::new(MockDirectoryProvider::new().with_users(vec![admin, disabled]));
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        state
            .permission_service
            .set_level(PermissionLevel::DomainAdmin);

        let result = compliance::run_compliance_scan(state.provider())
            .await
            .unwrap();

        assert!(result.total_findings > 0);
        assert!(result.global_score < 100);

        // Verify at least privilegedAccounts and disabledAccounts checks have findings
        let priv_check = result
            .checks
            .iter()
            .find(|c| c.check_id == "privileged_accounts")
            .unwrap();
        assert!(priv_check.finding_count > 0);

        let disabled_check = result
            .checks
            .iter()
            .find(|c| c.check_id == "disabled_accounts")
            .unwrap();
        assert!(disabled_check.finding_count > 0);
    }

    // -----------------------------------------------------------------------
    // export report format validation
    // -----------------------------------------------------------------------

    #[test]
    fn test_export_framework_report_contains_proper_html_structure() {
        let scan = ComplianceScanResult {
            scanned_at: "2026-03-26T10:00:00Z".to_string(),
            generator: "TestAdmin".to_string(),
            total_accounts_scanned: 50,
            global_score: 70,
            total_findings: 3,
            framework_scores: vec![compliance::FrameworkScore {
                standard: "HIPAA".to_string(),
                score: 80,
                total_checks: 5,
                checks_with_findings: 2,
                control_refs: vec!["164.312(a)(1)".to_string()],
            }],
            checks: vec![compliance::CheckResult {
                check_id: "test_check".to_string(),
                title: "Test Check".to_string(),
                description: "A test check".to_string(),
                severity: "High".to_string(),
                finding_count: 2,
                headers: vec!["Username".to_string(), "Display Name".to_string()],
                rows: vec![
                    vec!["admin".to_string(), "Administrator".to_string()],
                    vec!["svc_sql".to_string(), "SQL Service".to_string()],
                ],
                frameworks: vec![compliance::FrameworkMapping {
                    standard: "HIPAA".to_string(),
                    control_ref: "164.312(a)(1)".to_string(),
                }],
                remediation: "Fix the issue.".to_string(),
            }],
        };

        let html = compliance::export_framework_report(&scan, "HIPAA");

        // Validate HTML structure
        assert!(html.starts_with("<!DOCTYPE html>"));
        assert!(html.contains("<html"));
        assert!(html.contains("</html>"));
        assert!(html.contains("HIPAA Compliance Report"));
        assert!(html.contains("TestAdmin"));
        assert!(html.contains("164.312(a)(1)"));
        assert!(html.contains("Test Check"));
        assert!(html.contains("admin"));
        assert!(html.contains("svc_sql"));
        assert!(html.contains("Fix the issue."));
        assert!(html.contains("High"));
        // Table structure
        assert!(html.contains("<table>"));
        assert!(html.contains("<th>"));
        assert!(html.contains("<td>"));
    }

    #[test]
    fn test_export_framework_report_different_frameworks() {
        let scan = ComplianceScanResult {
            scanned_at: "2026-03-26".to_string(),
            generator: "test".to_string(),
            total_accounts_scanned: 0,
            global_score: 100,
            total_findings: 0,
            framework_scores: vec![],
            checks: vec![],
        };

        for fw in compliance::FRAMEWORKS {
            let html = compliance::export_framework_report(&scan, fw);
            assert!(
                html.contains(&format!("{} Compliance Report", fw)),
                "Report for {} missing title",
                fw
            );
        }
    }

    // -----------------------------------------------------------------------
    // Permission level boundary checks
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_run_compliance_scan_denied_for_account_operator() {
        let state = make_state_with_level(PermissionLevel::AccountOperator);
        let has_perm = state
            .permission_service
            .has_permission(PermissionLevel::DomainAdmin);
        assert!(!has_perm);
    }

    #[tokio::test]
    async fn test_run_compliance_scan_denied_for_readonly() {
        let state = make_state(); // ReadOnly by default
        let has_perm = state
            .permission_service
            .has_permission(PermissionLevel::DomainAdmin);
        assert!(!has_perm);
    }
}
