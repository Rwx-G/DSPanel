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
