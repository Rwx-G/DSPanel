use tauri::State;

use crate::error::AppError;
use crate::models::dc_health::DcHealthResult;
use crate::models::dns_validation::DnsKerberosReport;
use crate::models::replication_status::ReplicationPartnership;
use crate::models::system_metrics::SystemMetrics;
use crate::models::topology::TopologyData;
use crate::services::PermissionLevel;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// DC Health - Inner functions
// ---------------------------------------------------------------------------

/// Returns the health status of all domain controllers.
/// Requires DomainAdmin permission.
pub(crate) async fn get_dc_health_inner(state: &AppState) -> Result<Vec<DcHealthResult>, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "DC health checks require DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    crate::services::dc_health::check_all_dc_health(provider)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

// ---------------------------------------------------------------------------
// Replication Status - Inner functions
// ---------------------------------------------------------------------------

/// Returns all replication partnerships. Requires DomainAdmin.
pub(crate) async fn get_replication_status_inner(
    state: &AppState,
) -> Result<Vec<ReplicationPartnership>, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Replication status requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    crate::services::replication_status::get_replication_partnerships(provider)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Forces replication between two DCs. Requires DomainAdmin.
pub(crate) async fn force_replication_inner(
    state: &AppState,
    source_dc: &str,
    target_dc: &str,
    naming_context: &str,
) -> Result<String, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Force replication requires DomainAdmin permission".to_string(),
        ));
    }

    crate::services::replication_status::force_replication(source_dc, target_dc, naming_context)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

// ---------------------------------------------------------------------------
// DNS & Kerberos Validation - Inner functions
// ---------------------------------------------------------------------------

/// Returns a full DNS and Kerberos validation report.
/// Requires DomainAdmin permission.
pub(crate) async fn get_dns_kerberos_validation_inner(
    state: &AppState,
    threshold_seconds: u32,
) -> Result<DnsKerberosReport, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "DNS/Kerberos validation requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    crate::services::dns_validation::run_full_validation(provider, threshold_seconds)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

// ---------------------------------------------------------------------------
// Workstation Monitoring - Inner functions
// ---------------------------------------------------------------------------

/// Returns system metrics from a remote workstation via PowerShell remoting.
/// Requires HelpDesk permission (accessible from computer lookup).
pub(crate) async fn get_workstation_metrics_inner(
    state: &AppState,
    hostname: &str,
) -> Result<SystemMetrics, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::HelpDesk)
    {
        return Err(AppError::PermissionDenied(
            "Workstation monitoring requires HelpDesk permission or higher".to_string(),
        ));
    }

    crate::services::workstation_monitor::get_system_metrics(hostname)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}

// ---------------------------------------------------------------------------
// Topology - Inner functions
// ---------------------------------------------------------------------------

/// Returns the AD topology (sites, DCs, replication links, site links).
/// Requires DomainAdmin permission.
pub(crate) async fn get_topology_inner(state: &AppState) -> Result<TopologyData, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Topology visualization requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    crate::services::topology::get_topology(provider)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Returns health status of all domain controllers.
#[tauri::command]
pub async fn get_dc_health(state: State<'_, AppState>) -> Result<Vec<DcHealthResult>, AppError> {
    get_dc_health_inner(&state).await
}

/// Returns all replication partnerships.
#[tauri::command]
pub async fn get_replication_status(
    state: State<'_, AppState>,
) -> Result<Vec<ReplicationPartnership>, AppError> {
    get_replication_status_inner(&state).await
}

/// Forces replication between source and target DC.
#[tauri::command]
pub async fn force_replication_cmd(
    source_dc: String,
    target_dc: String,
    naming_context: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    force_replication_inner(&state, &source_dc, &target_dc, &naming_context).await
}

/// Returns DNS SRV record validation and clock skew analysis for the domain.
#[tauri::command]
pub async fn get_dns_kerberos_validation(
    threshold_seconds: u32,
    state: State<'_, AppState>,
) -> Result<DnsKerberosReport, AppError> {
    get_dns_kerberos_validation_inner(&state, threshold_seconds).await
}

/// Returns system metrics (CPU, RAM, disk, services, sessions) from a remote workstation.
#[tauri::command]
pub async fn get_workstation_metrics(
    hostname: String,
    state: State<'_, AppState>,
) -> Result<SystemMetrics, AppError> {
    get_workstation_metrics_inner(&state, &hostname).await
}

/// Returns the AD topology data for visualization.
#[tauri::command]
pub async fn get_topology(state: State<'_, AppState>) -> Result<TopologyData, AppError> {
    get_topology_inner(&state).await
}
