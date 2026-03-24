use tauri::State;

use crate::error::AppError;
use crate::services::compliance::{
    self, ComplianceReport, ComplianceTemplate,
};
use crate::services::PermissionLevel;
use crate::state::AppState;

/// Returns all available compliance templates (built-in + custom).
#[tauri::command]
pub fn get_compliance_templates(state: State<'_, AppState>) -> Vec<ComplianceTemplate> {
    let mut templates = compliance::builtin_templates();

    // Load custom templates from app settings
    let settings = state.app_settings.get();
    if let Some(custom) = settings.compliance_templates {
        templates.extend(custom);
    }

    templates
}

/// Saves a custom compliance template. Requires DomainAdmin.
#[tauri::command]
pub fn save_custom_template(
    state: State<'_, AppState>,
    template: ComplianceTemplate,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Custom templates require DomainAdmin permission".to_string(),
        ));
    }

    let mut settings = state.app_settings.get();
    let mut customs = settings.compliance_templates.unwrap_or_default();
    // Replace if same name exists, otherwise add
    if let Some(pos) = customs.iter().position(|t| t.name == template.name) {
        customs[pos] = template;
    } else {
        customs.push(template);
    }
    settings.compliance_templates = Some(customs);
    state.app_settings.update(settings);
    Ok(())
}

/// Deletes a custom compliance template by name. Requires DomainAdmin.
#[tauri::command]
pub fn delete_custom_template(
    state: State<'_, AppState>,
    name: String,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Custom templates require DomainAdmin permission".to_string(),
        ));
    }

    let mut settings = state.app_settings.get();
    let mut customs = settings.compliance_templates.unwrap_or_default();
    customs.retain(|t| t.name != name);
    settings.compliance_templates = Some(customs);
    state.app_settings.update(settings);
    Ok(())
}

/// Generates a compliance report from a template. Requires DomainAdmin.
#[tauri::command]
pub async fn generate_compliance_report(
    state: State<'_, AppState>,
    template: ComplianceTemplate,
) -> Result<ComplianceReport, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Report generation requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    compliance::generate_report(provider, &template).await
}

/// Exports a compliance report as HTML and opens a save dialog.
#[tauri::command]
pub async fn export_compliance_report_html(
    report: ComplianceReport,
    default_name: String,
) -> Result<Option<String>, AppError> {
    let html = compliance::report_to_html(&report);

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
