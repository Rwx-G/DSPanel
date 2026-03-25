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

// ---------------------------------------------------------------------------
// GPO Viewer
// ---------------------------------------------------------------------------

use crate::services::gpo::{self, GpoInfo, GpoLink, GpoLinksResult};

/// Returns GPO links for a given object DN by walking the OU hierarchy.
/// Requires DomainAdmin permission.
pub(crate) async fn get_gpo_links_inner(
    state: &AppState,
    object_dn: &str,
) -> Result<GpoLinksResult, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "GPO viewer requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    let base_dn = provider
        .base_dn()
        .ok_or_else(|| AppError::Directory("Not connected - no base DN".to_string()))?;

    // Build the OU chain from the object's DN up to the domain root
    let ou_chain = build_ou_chain(object_dn, &base_dn, &*provider).await?;

    // Resolve GPO display names (cached 5 minutes)
    let gpo_names = resolve_gpo_names_cached(state, &base_dn, &*provider).await;

    let (links, blocks_inheritance) = gpo::resolve_effective_gpos(&ou_chain, &gpo_names);

    Ok(GpoLinksResult {
        object_dn: object_dn.to_string(),
        links,
        blocks_inheritance,
    })
}

/// Returns all OUs where a given GPO is linked (scope report).
pub(crate) async fn get_gpo_scope_inner(
    state: &AppState,
    gpo_dn: &str,
) -> Result<Vec<GpoLink>, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "GPO viewer requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    let base_dn = provider
        .base_dn()
        .ok_or_else(|| AppError::Directory("Not connected - no base DN".to_string()))?;

    // Search all OUs and the domain root for gPLink containing this GPO DN
    let ous = provider
        .get_ou_tree()
        .await
        .map_err(|e| AppError::Directory(e.to_string()))?;

    let gpo_dn_upper = gpo_dn.to_uppercase();
    let mut result = Vec::new();

    // Check domain root
    if let Ok(entries) = provider
        .search_configuration(&base_dn, "(objectClass=domainDNS)")
        .await
    {
        for entry in &entries {
            if let Some(gp_link_vals) = entry.attributes.get("gPLink") {
                let gp_link = gp_link_vals.join("");
                let raw_links = gpo::parse_gp_link(&gp_link);
                for (order, raw) in raw_links.iter().enumerate() {
                    if raw.gpo_dn.to_uppercase() == gpo_dn_upper {
                        result.push(GpoLink {
                            gpo_dn: gpo_dn.to_string(),
                            gpo_name: String::new(),
                            link_order: order + 1,
                            is_enforced: gpo::is_link_enforced(raw.flags),
                            is_disabled: gpo::is_link_disabled(raw.flags),
                            linked_at: entry.distinguished_name.clone(),
                            is_inherited: false,
                            wmi_filter: None,
                        });
                    }
                }
            }
        }
    }

    // Check all OUs
    for ou in &ous {
        check_ou_for_gpo_link(&ou.distinguished_name, &gpo_dn_upper, gpo_dn, &*provider, &mut result).await;
    }

    Ok(result)
}

async fn check_ou_for_gpo_link(
    ou_dn: &str,
    gpo_dn_upper: &str,
    gpo_dn: &str,
    provider: &dyn crate::services::DirectoryProvider,
    result: &mut Vec<GpoLink>,
) {
    let filter = format!("(distinguishedName={})", ldap_escape_dn(ou_dn));
    if let Ok(entries) = provider.search_configuration(ou_dn, &filter).await {
        for entry in &entries {
            if let Some(gp_link_vals) = entry.attributes.get("gPLink") {
                let gp_link = gp_link_vals.join("");
                let raw_links = gpo::parse_gp_link(&gp_link);
                for (order, raw) in raw_links.iter().enumerate() {
                    if raw.gpo_dn.to_uppercase() == gpo_dn_upper {
                        result.push(GpoLink {
                            gpo_dn: gpo_dn.to_string(),
                            gpo_name: String::new(),
                            link_order: order + 1,
                            is_enforced: gpo::is_link_enforced(raw.flags),
                            is_disabled: gpo::is_link_disabled(raw.flags),
                            linked_at: ou_dn.to_string(),
                            is_inherited: false,
                            wmi_filter: None,
                        });
                    }
                }
            }
        }
    }
}

/// Builds the OU chain from domain root down to the object's parent OU.
/// Each entry is (ou_dn, gPLink_value, gPOptions_value).
async fn build_ou_chain(
    object_dn: &str,
    base_dn: &str,
    provider: &dyn crate::services::DirectoryProvider,
) -> Result<Vec<(String, Option<String>, Option<String>)>, AppError> {
    // Extract the OU hierarchy from the DN
    let parts: Vec<&str> = object_dn.split(',').collect();
    let mut chain = Vec::new();

    // Start from the domain root and work down
    // Domain root is the base_dn
    let base_parts: Vec<&str> = base_dn.split(',').collect();
    let base_depth = base_parts.len();

    // Build OU DNs from domain root downward
    let mut ou_dns = Vec::new();
    ou_dns.push(base_dn.to_string());

    // Add intermediate OUs (skip the CN= component which is the object itself)
    for i in (1..parts.len()).rev() {
        let dn_suffix: String = parts[i..].join(",");
        // Skip components at or above the domain root level (already included)
        if parts[i..].len() <= base_depth {
            continue;
        }
        if (parts[i].starts_with("OU=") || parts[i].starts_with("ou="))
            && !ou_dns.contains(&dn_suffix)
        {
            ou_dns.push(dn_suffix);
        }
    }

    // Query each OU/domain for gPLink and gPOptions
    for ou_dn in &ou_dns {
        let (gp_link, gp_options) = query_gp_attributes(ou_dn, provider).await;
        chain.push((ou_dn.clone(), gp_link, gp_options));
    }

    Ok(chain)
}

/// Queries gPLink and gPOptions attributes for a specific DN.
/// Returns (gPLink, gPOptions) as optional strings.
async fn query_gp_attributes(
    dn: &str,
    provider: &dyn crate::services::DirectoryProvider,
) -> (Option<String>, Option<String>) {
    // Use read_entry which does a Base scope search for a single object
    if let Ok(Some(entry)) = provider.read_entry(dn).await {
        let gp_link = entry
            .attributes
            .get("gPLink")
            .map(|vals| vals.join(""))
            .filter(|s| !s.is_empty());
        let gp_options = entry
            .attributes
            .get("gPOptions")
            .map(|vals| vals.join(""))
            .filter(|s| !s.is_empty());
        (gp_link, gp_options)
    } else {
        (None, None)
    }
}

/// GPO name cache TTL (5 minutes).
const GPO_NAME_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(300);

/// Resolves GPO DNs to display names, using AppState cache.
async fn resolve_gpo_names_cached(
    state: &AppState,
    base_dn: &str,
    provider: &dyn crate::services::DirectoryProvider,
) -> std::collections::HashMap<String, String> {
    // Check cache
    {
        let cache = state.gpo_name_cache.lock().expect("lock poisoned");
        if let Some((fetched_at, ref names)) = *cache {
            if fetched_at.elapsed() < GPO_NAME_CACHE_TTL {
                return names.clone();
            }
        }
    }

    // Cache miss or expired - fetch fresh
    let names = resolve_gpo_names(base_dn, provider).await;

    // Store in cache
    {
        let mut cache = state.gpo_name_cache.lock().expect("lock poisoned");
        *cache = Some((std::time::Instant::now(), names.clone()));
    }

    names
}

/// Resolves GPO DNs to display names.
async fn resolve_gpo_names(
    base_dn: &str,
    provider: &dyn crate::services::DirectoryProvider,
) -> std::collections::HashMap<String, String> {
    let mut names = std::collections::HashMap::new();
    let gpo_base = format!("CN=Policies,CN=System,{}", base_dn);
    if let Ok(gpos) = provider
        .search_configuration(&gpo_base, "(objectClass=groupPolicyContainer)")
        .await
    {
        for gpo in gpos {
            let display_name = gpo
                .attributes
                .get("displayName")
                .and_then(|v| v.first())
                .cloned()
                .unwrap_or_else(|| {
                    gpo.distinguished_name
                        .split(',')
                        .next()
                        .and_then(|p| p.strip_prefix("CN="))
                        .unwrap_or(&gpo.distinguished_name)
                        .to_string()
                });
            names.insert(gpo.distinguished_name.to_uppercase(), display_name);
        }
    }
    names
}

/// Minimal DN-safe escaping for LDAP filter values.
fn ldap_escape_dn(dn: &str) -> String {
    dn.replace('\\', "\\5c")
        .replace('*', "\\2a")
        .replace('(', "\\28")
        .replace(')', "\\29")
        .replace('\0', "\\00")
}

/// Returns GPO links for a given object DN.
#[tauri::command]
pub async fn get_gpo_links(
    object_dn: String,
    state: State<'_, AppState>,
) -> Result<GpoLinksResult, AppError> {
    get_gpo_links_inner(&state, &object_dn).await
}

/// Returns a scope report: all OUs where a specific GPO is linked.
#[tauri::command]
pub async fn get_gpo_scope(
    gpo_dn: String,
    state: State<'_, AppState>,
) -> Result<Vec<GpoLink>, AppError> {
    get_gpo_scope_inner(&state, &gpo_dn).await
}

/// Returns a list of all GPOs in the domain (for autocomplete/dropdown).
#[tauri::command]
pub async fn get_gpo_list(
    state: State<'_, AppState>,
) -> Result<Vec<GpoInfo>, AppError> {
    get_gpo_list_inner(&state).await
}

pub(crate) async fn get_gpo_list_inner(state: &AppState) -> Result<Vec<GpoInfo>, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "GPO viewer requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    let base_dn = provider
        .base_dn()
        .ok_or_else(|| AppError::Directory("Not connected - no base DN".to_string()))?;

    let gpo_base = format!("CN=Policies,CN=System,{}", base_dn);
    let gpos = provider
        .search_configuration(&gpo_base, "(objectClass=groupPolicyContainer)")
        .await
        .map_err(|e| AppError::Directory(e.to_string()))?;

    let mut result: Vec<GpoInfo> = gpos
        .into_iter()
        .map(|gpo| {
            let display_name = gpo
                .attributes
                .get("displayName")
                .and_then(|v| v.first())
                .cloned()
                .unwrap_or_else(|| {
                    gpo.distinguished_name
                        .split(',')
                        .next()
                        .and_then(|p| p.strip_prefix("CN="))
                        .unwrap_or(&gpo.distinguished_name)
                        .to_string()
                });

            let wmi_filter = gpo
                .attributes
                .get("gPCWMIFilter")
                .and_then(|v| v.first())
                .and_then(|wmi_ref| {
                    // gPCWMIFilter format: "[domain;{GUID};0]" - extract the GUID
                    wmi_ref
                        .split(';')
                        .nth(1)
                        .map(|s| s.to_string())
                })
                .filter(|s| !s.is_empty());

            GpoInfo {
                dn: gpo.distinguished_name,
                display_name,
                wmi_filter,
            }
        })
        .collect();

    result.sort_by(|a, b| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()));
    Ok(result)
}
