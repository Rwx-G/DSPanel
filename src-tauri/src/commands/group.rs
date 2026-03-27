use tauri::State;

use crate::error::AppError;
use crate::models::DirectoryEntry;
use crate::services::ntfs::{AceCrossReference, AceEntry, NtfsAuditResult};
use crate::services::ntfs_analyzer::NtfsAnalysisResult;
use crate::services::replication::{
    AttributeChangeDiff, AttributeMetadata, ReplicationMetadataResult,
};
use crate::services::PermissionLevel;
use crate::state::AppState;

use super::capture_snapshot;

/// Removes a member from a group.
pub(crate) async fn remove_group_member_inner(
    state: &AppState,
    group_dn: &str,
    member_dn: &str,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Removing group members requires AccountOperator permission or higher".to_string(),
        ));
    }

    state
        .snapshot_service
        .capture(group_dn, "RemoveGroupMember");

    let provider = state.provider();
    match provider.remove_group_member(group_dn, member_dn).await {
        Ok(()) => {
            state.audit_service.log_success(
                "GroupMemberRemoved",
                group_dn,
                &format!("Removed member {} from group", member_dn),
            );
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "RemoveGroupMemberFailed",
                group_dn,
                &format!("Failed to remove member {} from group: {}", member_dn, e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Returns members of a group by its DN.
pub(crate) async fn get_group_members_inner(
    state: &AppState,
    group_dn: &str,
) -> Result<Vec<DirectoryEntry>, AppError> {
    let provider = state.provider();
    provider
        .get_group_members(group_dn, 200)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Detects empty groups (groups with no members).
pub(crate) async fn detect_empty_groups_inner(
    state: &AppState,
) -> Result<Vec<DirectoryEntry>, AppError> {
    let provider = state.provider();
    let groups = provider
        .browse_groups(5000)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))?;

    // Filter groups with no "member" attribute or empty member list
    let empty: Vec<DirectoryEntry> = groups
        .into_iter()
        .filter(|g| {
            let members = g.get_attribute_values("member");
            members.is_empty()
        })
        .filter(|g| {
            // Exclude built-in groups (those in CN=Builtin or CN=Users containers)
            let dn = &g.distinguished_name;
            !dn.contains("CN=Builtin,") && !dn.contains("CN=Users,DC=")
        })
        .collect();

    Ok(empty)
}

/// Detects circular group nesting using DFS cycle detection.
pub(crate) async fn detect_circular_groups_inner(
    state: &AppState,
) -> Result<Vec<Vec<String>>, AppError> {
    let provider = state.provider();
    let groups = provider
        .browse_groups(5000)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))?;

    // Build adjacency list: group DN -> member group DNs
    let mut graph: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for group in &groups {
        let members = group.get_attribute_values("member");
        let member_groups: Vec<String> = members
            .iter()
            .filter(|m| groups.iter().any(|g| g.distinguished_name == **m))
            .cloned()
            .collect();
        graph.insert(group.distinguished_name.clone(), member_groups);
    }

    // DFS cycle detection with three-color marking
    let mut cycles = Vec::new();
    let mut white: std::collections::HashSet<String> = graph.keys().cloned().collect();
    let mut gray: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut black: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut path: Vec<String> = Vec::new();

    fn dfs(
        node: &str,
        graph: &std::collections::HashMap<String, Vec<String>>,
        white: &mut std::collections::HashSet<String>,
        gray: &mut std::collections::HashSet<String>,
        black: &mut std::collections::HashSet<String>,
        path: &mut Vec<String>,
        cycles: &mut Vec<Vec<String>>,
    ) {
        white.remove(node);
        gray.insert(node.to_string());
        path.push(node.to_string());

        if let Some(neighbors) = graph.get(node) {
            for neighbor in neighbors {
                if gray.contains(neighbor.as_str()) {
                    // Found cycle - extract the cycle from path
                    if let Some(cycle_start) = path.iter().position(|p| p == neighbor) {
                        let mut cycle: Vec<String> = path[cycle_start..].to_vec();
                        cycle.push(neighbor.clone()); // close the cycle
                        cycles.push(cycle);
                    }
                } else if white.contains(neighbor.as_str()) {
                    dfs(neighbor, graph, white, gray, black, path, cycles);
                }
            }
        }

        path.pop();
        gray.remove(node);
        black.insert(node.to_string());
    }

    let start_nodes: Vec<String> = white.iter().cloned().collect();
    for node in start_nodes {
        if white.contains(&node) {
            dfs(
                &node,
                &graph,
                &mut white,
                &mut gray,
                &mut black,
                &mut path,
                &mut cycles,
            );
        }
    }

    Ok(cycles)
}

/// Detects groups with exactly one member.
pub(crate) async fn detect_single_member_groups_inner(
    state: &AppState,
) -> Result<Vec<DirectoryEntry>, AppError> {
    let provider = state.provider();
    let groups = provider
        .browse_groups(5000)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))?;

    let single: Vec<DirectoryEntry> = groups
        .into_iter()
        .filter(|g| {
            let members = g.get_attribute_values("member");
            members.len() == 1
        })
        .filter(|g| {
            let dn = &g.distinguished_name;
            !dn.contains("CN=Builtin,") && !dn.contains("CN=Users,DC=")
        })
        .collect();

    Ok(single)
}

/// Result for a group with deep nesting.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepNestingResult {
    pub group_dn: String,
    pub group_name: String,
    pub depth: usize,
}

/// Detects groups not modified for longer than the given threshold in days.
pub(crate) async fn detect_stale_groups_inner(
    state: &AppState,
    days_threshold: u64,
) -> Result<Vec<DirectoryEntry>, AppError> {
    let provider = state.provider();
    let groups = provider
        .browse_groups(5000)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))?;

    let now = chrono::Utc::now();
    let threshold = chrono::Duration::days(days_threshold as i64);

    let stale: Vec<DirectoryEntry> = groups
        .into_iter()
        .filter(|g| {
            let dn = &g.distinguished_name;
            !dn.contains("CN=Builtin,") && !dn.contains("CN=Users,DC=")
        })
        .filter(|g| {
            if let Some(when_changed) = g.get_attribute("whenChanged") {
                if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(when_changed) {
                    let age = now - parsed.with_timezone(&chrono::Utc);
                    return age > threshold;
                }
                // Try AD generalized time format: yyyyMMddHHmmss.0Z
                if let Ok(parsed) = chrono::NaiveDateTime::parse_from_str(
                    when_changed.trim_end_matches('Z'),
                    "%Y%m%d%H%M%S%.f",
                ) {
                    let utc = parsed.and_utc();
                    let age = now - utc;
                    return age > threshold;
                }
            }
            false
        })
        .collect();

    Ok(stale)
}

/// Detects groups missing the description attribute.
pub(crate) async fn detect_undescribed_groups_inner(
    state: &AppState,
) -> Result<Vec<DirectoryEntry>, AppError> {
    let provider = state.provider();
    let groups = provider
        .browse_groups(5000)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))?;

    let undescribed: Vec<DirectoryEntry> = groups
        .into_iter()
        .filter(|g| {
            let dn = &g.distinguished_name;
            !dn.contains("CN=Builtin,") && !dn.contains("CN=Users,DC=")
        })
        .filter(|g| {
            let desc = g.get_attribute("description").unwrap_or("");
            desc.trim().is_empty()
        })
        .collect();

    Ok(undescribed)
}

/// Detects groups nested deeper than `max_depth` levels.
pub(crate) async fn detect_deep_nesting_inner(
    state: &AppState,
    max_depth: usize,
) -> Result<Vec<DeepNestingResult>, AppError> {
    let provider = state.provider();
    let groups = provider
        .browse_groups(5000)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))?;

    // Build parent-to-child adjacency: group DN -> child group DNs
    let group_dns: std::collections::HashSet<String> = groups
        .iter()
        .map(|g| g.distinguished_name.clone())
        .collect();

    let mut children_of: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for group in &groups {
        let member_groups: Vec<String> = group
            .get_attribute_values("member")
            .iter()
            .filter(|m| group_dns.contains(*m))
            .cloned()
            .collect();
        children_of.insert(group.distinguished_name.clone(), member_groups);
    }

    // For each group, compute maximum depth via DFS
    fn compute_depth(
        node: &str,
        children_of: &std::collections::HashMap<String, Vec<String>>,
        visited: &mut std::collections::HashSet<String>,
    ) -> usize {
        if visited.contains(node) {
            return 0; // avoid cycles
        }
        visited.insert(node.to_string());
        let max_child_depth = children_of
            .get(node)
            .map(|children| {
                children
                    .iter()
                    .map(|c| compute_depth(c, children_of, visited))
                    .max()
                    .unwrap_or(0)
            })
            .unwrap_or(0);
        visited.remove(node);
        max_child_depth + 1
    }

    let mut results: Vec<DeepNestingResult> = Vec::new();
    for group in &groups {
        let mut visited = std::collections::HashSet::new();
        let depth = compute_depth(&group.distinguished_name, &children_of, &mut visited);
        if depth > max_depth {
            let name = group
                .display_name
                .clone()
                .or_else(|| group.sam_account_name.clone())
                .unwrap_or_else(|| group.distinguished_name.clone());
            results.push(DeepNestingResult {
                group_dn: group.distinguished_name.clone(),
                group_name: name,
                depth,
            });
        }
    }

    Ok(results)
}

/// Detects groups that have exactly the same set of members.
pub(crate) async fn detect_duplicate_groups_inner(
    state: &AppState,
) -> Result<Vec<Vec<DirectoryEntry>>, AppError> {
    let provider = state.provider();
    let groups = provider
        .browse_groups(5000)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))?;

    // Build member set fingerprints
    let mut member_map: std::collections::HashMap<Vec<String>, Vec<DirectoryEntry>> =
        std::collections::HashMap::new();

    for group in groups {
        let dn = &group.distinguished_name;
        if dn.contains("CN=Builtin,") || dn.contains("CN=Users,DC=") {
            continue;
        }
        let members = group.get_attribute_values("member");
        if members.is_empty() {
            continue; // empty groups already handled separately
        }
        let mut sorted_members: Vec<String> = members.to_vec();
        sorted_members.sort();
        member_map.entry(sorted_members).or_default().push(group);
    }

    // Keep only clusters with 2+ groups
    let duplicates: Vec<Vec<DirectoryEntry>> = member_map
        .into_values()
        .filter(|cluster| cluster.len() >= 2)
        .collect();

    Ok(duplicates)
}

/// Creates a new group in Active Directory. Requires AccountOperator permission.
pub(crate) async fn create_group_inner(
    state: &AppState,
    name: &str,
    container_dn: &str,
    scope: &str,
    category: &str,
    description: &str,
) -> Result<String, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Group creation requires AccountOperator permission or higher".to_string(),
        ));
    }

    let dn = format!("CN={},{}", name, container_dn);
    capture_snapshot(state, &dn, "GroupCreate").await;

    let provider = state.provider();
    match provider
        .create_group(name, container_dn, scope, category, description)
        .await
    {
        Ok(created_dn) => {
            state.audit_service.log_success(
                "GroupCreated",
                &created_dn,
                &format!(
                    "Group created: scope={}, category={}, container={}",
                    scope, category, container_dn
                ),
            );
            Ok(created_dn)
        }
        Err(e) => {
            state.audit_service.log_failure(
                "GroupCreateFailed",
                &dn,
                &format!("Failed to create group: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Moves an AD object to a different container. Requires AccountOperator permission.
pub(crate) async fn move_object_inner(
    state: &AppState,
    object_dn: &str,
    target_container_dn: &str,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Moving objects requires AccountOperator permission or higher".to_string(),
        ));
    }

    capture_snapshot(state, object_dn, "MoveObject").await;

    let provider = state.provider();
    match provider.move_object(object_dn, target_container_dn).await {
        Ok(()) => {
            state.audit_service.log_success(
                "ObjectMoved",
                object_dn,
                &format!("Moved to {}", target_container_dn),
            );
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "MoveObjectFailed",
                object_dn,
                &format!("Failed to move object: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Result of a single object move in a bulk operation.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkMoveResult {
    pub object_dn: String,
    pub success: bool,
    pub error: Option<String>,
}

/// Moves multiple AD objects to a target container sequentially.
/// Continues on individual failures and returns results for all objects.
pub(crate) async fn bulk_move_objects_inner(
    state: &AppState,
    object_dns: &[String],
    target_container_dn: &str,
) -> Result<Vec<BulkMoveResult>, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Moving objects requires AccountOperator permission or higher".to_string(),
        ));
    }

    let mut results = Vec::with_capacity(object_dns.len());

    for dn in object_dns {
        capture_snapshot(state, dn, "MoveObject").await;

        let provider = state.provider();
        match provider.move_object(dn, target_container_dn).await {
            Ok(()) => {
                state.audit_service.log_success(
                    "ObjectMoved",
                    dn,
                    &format!("Moved to {}", target_container_dn),
                );
                results.push(BulkMoveResult {
                    object_dn: dn.clone(),
                    success: true,
                    error: None,
                });
            }
            Err(e) => {
                state.audit_service.log_failure(
                    "MoveObjectFailed",
                    dn,
                    &format!("Failed to move object: {}", e),
                );
                results.push(BulkMoveResult {
                    object_dn: dn.clone(),
                    success: false,
                    error: Some(e.to_string()),
                });
            }
        }
    }

    Ok(results)
}

/// Updates the managedBy attribute of a group. Requires AccountOperator permission.
pub(crate) async fn update_managed_by_inner(
    state: &AppState,
    group_dn: &str,
    manager_dn: &str,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Updating group manager requires AccountOperator permission or higher".to_string(),
        ));
    }

    let provider = state.provider();
    match provider.update_managed_by(group_dn, manager_dn).await {
        Ok(()) => {
            state.audit_service.log_success(
                "ManagedByUpdated",
                group_dn,
                &format!("Manager set to {}", manager_dn),
            );
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "UpdateManagedByFailed",
                group_dn,
                &format!("Failed to update managedBy: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Deletes any AD object by DN. Requires AccountOperator permission.
/// Deletes a group by DN (requires DomainAdmin).
pub(crate) async fn delete_ad_object_inner(state: &AppState, dn: &str) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Deleting objects requires AccountOperator permission or higher".to_string(),
        ));
    }

    capture_snapshot(state, dn, "ObjectDelete").await;
    let provider = state.provider();
    match provider.delete_object(dn).await {
        Ok(()) => {
            state
                .audit_service
                .log_success("ObjectDeleted", dn, "Object deleted");
            Ok(())
        }
        Err(e) => {
            state
                .audit_service
                .log_failure("ObjectDeleteFailed", dn, &e.to_string());
            Err(AppError::Directory(e.to_string()))
        }
    }
}

pub(crate) async fn delete_group_inner(state: &AppState, group_dn: &str) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Group deletion requires DomainAdmin permission".to_string(),
        ));
    }

    capture_snapshot(state, group_dn, "GroupDelete").await;
    let provider = state.provider();
    match provider.delete_object(group_dn).await {
        Ok(()) => {
            state
                .audit_service
                .log_success("GroupDeleted", group_dn, "Group deleted");
            Ok(())
        }
        Err(e) => {
            state
                .audit_service
                .log_failure("GroupDeleteFailed", group_dn, &e.to_string());
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Retrieves and parses replication metadata for an AD object.
pub(crate) async fn get_replication_metadata_inner(
    state: &AppState,
    object_dn: &str,
) -> Result<ReplicationMetadataResult, AppError> {
    let provider = state.provider();
    let raw = provider
        .get_replication_metadata(object_dn)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))?;

    // Also fetch value metadata for linked attributes
    let value_raw = provider
        .get_replication_value_metadata(object_dn)
        .await
        .unwrap_or(None);

    let value_metadata = value_raw
        .map(|xml| crate::services::replication::parse_replication_value_metadata(&xml))
        .unwrap_or_default();

    match raw {
        Some(xml) => {
            let attributes = crate::services::replication::parse_replication_metadata(&xml);
            Ok(ReplicationMetadataResult {
                object_dn: object_dn.to_string(),
                attributes,
                value_metadata,
                is_available: true,
                message: None,
            })
        }
        None => {
            let has_values = !value_metadata.is_empty();
            Ok(ReplicationMetadataResult {
                object_dn: object_dn.to_string(),
                attributes: vec![],
                value_metadata,
                is_available: has_values,
                message: if !has_values {
                    Some("Replication metadata not available for this object".to_string())
                } else {
                    None
                },
            })
        }
    }
}

/// Computes attribute diff between two timestamps.
pub(crate) fn compute_attribute_diff_inner(
    metadata: &[AttributeMetadata],
    from_time: &str,
    to_time: &str,
) -> Vec<AttributeChangeDiff> {
    crate::services::replication::compute_attribute_diff(metadata, from_time, to_time)
}

/// Reads NTFS ACL from a UNC path.
pub(crate) fn audit_ntfs_permissions_inner(path: &str) -> Result<NtfsAuditResult, AppError> {
    crate::services::ntfs::validate_unc_path(path).map_err(AppError::Validation)?;

    #[cfg(feature = "demo")]
    let aces = crate::services::ntfs::read_acl_demo(path);

    #[cfg(not(feature = "demo"))]
    let aces = crate::services::ntfs::read_acl(path).map_err(AppError::Directory)?;

    Ok(NtfsAuditResult {
        path: path.to_string(),
        aces,
        errors: vec![],
    })
}

/// Cross-references NTFS ACEs with two users' group SIDs.
pub(crate) fn cross_reference_ntfs_inner(
    aces: &[AceEntry],
    user_a_sids: &[String],
    user_b_sids: &[String],
) -> Vec<AceCrossReference> {
    crate::services::ntfs::cross_reference_aces(aces, user_a_sids, user_b_sids)
}

/// Performs a recursive NTFS permissions analysis on a UNC path.
pub(crate) fn analyze_ntfs_inner(path: &str, depth: usize) -> Result<NtfsAnalysisResult, AppError> {
    crate::services::ntfs::validate_unc_path(path).map_err(AppError::Validation)?;

    Ok(crate::services::ntfs_analyzer::analyze(path, depth))
}

// ---------------------------------------------------------------------------
// Tauri commands - thin wrappers
// ---------------------------------------------------------------------------

/// Removes a member from a group.
#[tauri::command]
pub async fn remove_group_member(
    group_dn: String,
    member_dn: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    remove_group_member_inner(&state, &group_dn, &member_dn).await
}

/// Returns the members of a group identified by its DN.
#[tauri::command]
pub async fn get_group_members(
    group_dn: String,
    state: State<'_, AppState>,
) -> Result<Vec<DirectoryEntry>, AppError> {
    get_group_members_inner(&state, &group_dn).await
}

/// Detects empty groups (groups with no members).
#[tauri::command]
pub async fn detect_empty_groups(
    state: State<'_, AppState>,
) -> Result<Vec<DirectoryEntry>, AppError> {
    detect_empty_groups_inner(&state).await
}

/// Detects circular group nesting.
#[tauri::command]
pub async fn detect_circular_groups(
    state: State<'_, AppState>,
) -> Result<Vec<Vec<String>>, AppError> {
    detect_circular_groups_inner(&state).await
}

/// Detects groups with exactly one member.
#[tauri::command]
pub async fn detect_single_member_groups(
    state: State<'_, AppState>,
) -> Result<Vec<DirectoryEntry>, AppError> {
    detect_single_member_groups_inner(&state).await
}

/// Detects groups not modified in a long time (stale).
#[tauri::command]
pub async fn detect_stale_groups(
    days_threshold: u64,
    state: State<'_, AppState>,
) -> Result<Vec<DirectoryEntry>, AppError> {
    detect_stale_groups_inner(&state, days_threshold).await
}

/// Detects groups missing description attribute.
#[tauri::command]
pub async fn detect_undescribed_groups(
    state: State<'_, AppState>,
) -> Result<Vec<DirectoryEntry>, AppError> {
    detect_undescribed_groups_inner(&state).await
}

/// Detects groups with excessive nesting depth.
#[tauri::command]
pub async fn detect_deep_nesting(
    max_depth: usize,
    state: State<'_, AppState>,
) -> Result<Vec<DeepNestingResult>, AppError> {
    detect_deep_nesting_inner(&state, max_depth).await
}

/// Detects groups with identical member sets.
#[tauri::command]
pub async fn detect_duplicate_groups(
    state: State<'_, AppState>,
) -> Result<Vec<Vec<DirectoryEntry>>, AppError> {
    detect_duplicate_groups_inner(&state).await
}

/// Deletes a group by DN.
#[tauri::command]
pub async fn delete_group(group_dn: String, state: State<'_, AppState>) -> Result<(), AppError> {
    delete_group_inner(&state, &group_dn).await
}

/// Deletes any AD object by DN. Requires AccountOperator+.
#[tauri::command]
pub async fn delete_ad_object(dn: String, state: State<'_, AppState>) -> Result<(), AppError> {
    delete_ad_object_inner(&state, &dn).await
}

/// Creates a new group in Active Directory.
#[tauri::command]
pub async fn create_group(
    name: String,
    container_dn: String,
    scope: String,
    category: String,
    description: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    create_group_inner(
        &state,
        &name,
        &container_dn,
        &scope,
        &category,
        &description,
    )
    .await
}

/// Moves an AD object to a different container.
#[tauri::command]
pub async fn move_object(
    object_dn: String,
    target_container_dn: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    move_object_inner(&state, &object_dn, &target_container_dn).await
}

/// Moves multiple AD objects to a target container. Continues on individual failures.
#[tauri::command]
pub async fn bulk_move_objects(
    object_dns: Vec<String>,
    target_container_dn: String,
    state: State<'_, AppState>,
) -> Result<Vec<BulkMoveResult>, AppError> {
    bulk_move_objects_inner(&state, &object_dns, &target_container_dn).await
}

/// Updates the managedBy attribute of a group.
#[tauri::command]
pub async fn update_managed_by(
    group_dn: String,
    manager_dn: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    update_managed_by_inner(&state, &group_dn, &manager_dn).await
}

/// Retrieves replication metadata for an AD object.
#[tauri::command]
pub async fn get_replication_metadata(
    object_dn: String,
    state: State<'_, AppState>,
) -> Result<ReplicationMetadataResult, AppError> {
    get_replication_metadata_inner(&state, &object_dn).await
}

/// Computes attribute diff between two timestamps.
#[tauri::command]
pub fn compute_attribute_diff(
    metadata: Vec<AttributeMetadata>,
    from_time: String,
    to_time: String,
) -> Vec<AttributeChangeDiff> {
    compute_attribute_diff_inner(&metadata, &from_time, &to_time)
}

/// Performs a recursive NTFS permissions analysis.
#[tauri::command]
pub fn analyze_ntfs(path: String, depth: usize) -> Result<NtfsAnalysisResult, AppError> {
    analyze_ntfs_inner(&path, depth)
}

/// Reads NTFS ACL from a UNC path and returns parsed ACE entries.
#[tauri::command]
pub fn audit_ntfs_permissions(path: String) -> Result<NtfsAuditResult, AppError> {
    audit_ntfs_permissions_inner(&path)
}

/// Cross-references ACEs with two users' group SIDs.
#[tauri::command]
pub fn cross_reference_ntfs(
    aces: Vec<AceEntry>,
    user_a_sids: Vec<String>,
    user_b_sids: Vec<String>,
) -> Vec<AceCrossReference> {
    cross_reference_ntfs_inner(&aces, &user_a_sids, &user_b_sids)
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::directory::tests::MockDirectoryProvider;
    use crate::services::PermissionConfig;
    use std::collections::HashMap;
    use std::sync::Arc;

    fn make_state() -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new());
        AppState::new_for_test(provider, PermissionConfig::default())
    }

    fn make_user_entry(sam: &str, display: &str) -> DirectoryEntry {
        let mut attrs = HashMap::new();
        attrs.insert("mail".to_string(), vec![format!("{}@example.com", sam)]);
        DirectoryEntry {
            distinguished_name: format!("CN={},OU=Users,DC=example,DC=com", display),
            sam_account_name: Some(sam.to_string()),
            display_name: Some(display.to_string()),
            object_class: Some("user".to_string()),
            attributes: attrs,
        }
    }

    fn make_state_with_failure() -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new().with_failure());
        AppState::new_for_test(provider, PermissionConfig::default())
    }

    fn make_state_with_level(level: PermissionLevel) -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new());
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        state.permission_service.set_level(level);
        state
    }

    fn make_state_with_level_and_provider(
        level: PermissionLevel,
    ) -> (AppState, Arc<MockDirectoryProvider>) {
        let provider = Arc::new(MockDirectoryProvider::new());
        let provider_ref = Arc::clone(&provider);
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        state.permission_service.set_level(level);
        (state, provider_ref)
    }

    fn make_state_with_level_and_failure(level: PermissionLevel) -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new().with_failure());
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        state.permission_service.set_level(level);
        state
    }

    fn make_group_entry_with_members(name: &str, members: Vec<&str>) -> DirectoryEntry {
        let mut attrs = HashMap::new();
        attrs.insert("groupType".to_string(), vec!["-2147483646".to_string()]);
        attrs.insert("description".to_string(), vec![format!("{} group", name)]);
        if !members.is_empty() {
            attrs.insert(
                "member".to_string(),
                members.iter().map(|m| m.to_string()).collect(),
            );
        }
        DirectoryEntry {
            distinguished_name: format!("CN={},OU=Groups,DC=example,DC=com", name),
            sam_account_name: Some(name.to_string()),
            display_name: Some(name.to_string()),
            object_class: Some("group".to_string()),
            attributes: attrs,
        }
    }

    fn make_state_with_groups(groups: Vec<DirectoryEntry>) -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new().with_groups(groups));
        AppState::new_for_test(provider, PermissionConfig::default())
    }

    // -----------------------------------------------------------------------
    // remove_group_member tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_remove_group_member_inner_requires_account_operator() {
        let state = make_state(); // ReadOnly
        let result = remove_group_member_inner(
            &state,
            "CN=Group,DC=example,DC=com",
            "CN=User,DC=example,DC=com",
        )
        .await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => assert!(msg.contains("AccountOperator")),
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_remove_group_member_inner_audits_success() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        remove_group_member_inner(
            &state,
            "CN=Group,DC=example,DC=com",
            "CN=User,DC=example,DC=com",
        )
        .await
        .unwrap();
        let calls = provider.remove_group_member_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        let entries = state.audit_service.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].success);
        assert_eq!(entries[0].action, "GroupMemberRemoved");
    }

    // -----------------------------------------------------------------------
    // Get group members tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_get_group_members_inner_returns_members() {
        let members = vec![
            make_user_entry("jdoe", "John Doe"),
            make_user_entry("asmith", "Alice Smith"),
        ];
        let provider = Arc::new(MockDirectoryProvider::new().with_members(members));
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        let result = get_group_members_inner(&state, "CN=TestGroup,DC=example,DC=com")
            .await
            .unwrap();
        assert_eq!(result.len(), 2);
    }

    #[tokio::test]
    async fn test_get_group_members_inner_failure() {
        let state = make_state_with_failure();
        let result = get_group_members_inner(&state, "CN=G,DC=test").await;
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // NTFS permissions tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_audit_ntfs_permissions_invalid_path() {
        let result = audit_ntfs_permissions_inner("C:\\local\\path");
        assert!(result.is_err());
    }

    #[test]
    fn test_audit_ntfs_permissions_missing_share() {
        let result = audit_ntfs_permissions_inner("\\\\server");
        assert!(result.is_err());
    }

    #[test]
    fn test_cross_reference_ntfs_inner_with_matches() {
        let aces = vec![
            crate::services::ntfs::AceEntry {
                trustee_sid: "S-1-5-21-100".to_string(),
                trustee_display_name: "Admins".to_string(),
                access_type: crate::services::ntfs::AceAccessType::Allow,
                permissions: vec!["FullControl".to_string()],
                is_inherited: false,
            },
            crate::services::ntfs::AceEntry {
                trustee_sid: "S-1-5-21-200".to_string(),
                trustee_display_name: "Users".to_string(),
                access_type: crate::services::ntfs::AceAccessType::Deny,
                permissions: vec!["Write".to_string()],
                is_inherited: true,
            },
        ];
        let user_a_sids = vec!["S-1-5-21-100".to_string()];
        let user_b_sids = vec!["S-1-5-21-200".to_string()];

        let results = cross_reference_ntfs_inner(&aces, &user_a_sids, &user_b_sids);
        assert_eq!(results.len(), 2);
        assert_eq!(
            results[0].user_a_access,
            crate::services::ntfs::AccessIndicator::Allowed
        );
        assert_eq!(
            results[0].user_b_access,
            crate::services::ntfs::AccessIndicator::NoMatch
        );
        assert_eq!(
            results[1].user_a_access,
            crate::services::ntfs::AccessIndicator::NoMatch
        );
        assert_eq!(
            results[1].user_b_access,
            crate::services::ntfs::AccessIndicator::Denied
        );
    }

    #[test]
    fn test_cross_reference_ntfs_inner_empty() {
        let results = cross_reference_ntfs_inner(&[], &[], &[]);
        assert!(results.is_empty());
    }

    // -----------------------------------------------------------------------
    // replication metadata tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_get_replication_metadata_available() {
        let xml = r#"<DS_REPL_ATTR_META_DATA>
    <pszAttributeName>displayName</pszAttributeName>
    <dwVersion>3</dwVersion>
    <ftimeLastOriginatingChange>2026-02-15T14:30:00Z</ftimeLastOriginatingChange>
    <pszLastOriginatingDsaDN>CN=DC1</pszLastOriginatingDsaDN>
    <usnOriginatingChange>12345</usnOriginatingChange>
    <usnLocalChange>67890</usnLocalChange>
</DS_REPL_ATTR_META_DATA>"#;

        let provider =
            Arc::new(MockDirectoryProvider::new().with_replication_metadata(xml.to_string()));
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        let result = get_replication_metadata_inner(&state, "CN=Test,DC=example,DC=com")
            .await
            .unwrap();
        assert!(result.is_available);
        assert_eq!(result.attributes.len(), 1);
        assert_eq!(result.attributes[0].attribute_name, "displayName");
    }

    #[tokio::test]
    async fn test_get_replication_metadata_not_available() {
        let state = make_state();
        let result = get_replication_metadata_inner(&state, "CN=Test,DC=example,DC=com")
            .await
            .unwrap();
        assert!(!result.is_available);
        assert!(result.attributes.is_empty());
        assert!(result.message.is_some());
    }

    #[tokio::test]
    async fn test_get_replication_metadata_failure() {
        let state = make_state_with_failure();
        let result = get_replication_metadata_inner(&state, "CN=Test,DC=example,DC=com").await;
        assert!(result.is_err());
    }

    #[test]
    fn test_compute_attribute_diff_inner() {
        let metadata = vec![
            crate::services::replication::AttributeMetadata {
                attribute_name: "displayName".to_string(),
                version: 3,
                last_originating_change_time: "2026-02-15T14:30:00Z".to_string(),
                last_originating_dsa_dn: String::new(),
                local_usn: 0,
                originating_usn: 0,
            },
            crate::services::replication::AttributeMetadata {
                attribute_name: "title".to_string(),
                version: 5,
                last_originating_change_time: "2026-03-01T08:00:00Z".to_string(),
                last_originating_dsa_dn: String::new(),
                local_usn: 0,
                originating_usn: 0,
            },
        ];
        let diff =
            compute_attribute_diff_inner(&metadata, "2026-02-01T00:00:00Z", "2026-02-28T23:59:59Z");
        assert_eq!(diff.len(), 1);
        assert_eq!(diff[0].attribute_name, "displayName");
    }

    // -----------------------------------------------------------------------
    // analyze_ntfs_inner tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_analyze_ntfs_inner_invalid_path() {
        let result = analyze_ntfs_inner("C:\\local\\path", 2);
        assert!(result.is_err());
    }

    #[test]
    fn test_analyze_ntfs_inner_traversal_rejected() {
        let result = analyze_ntfs_inner("\\\\server\\share\\..\\..\\secret", 1);
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // Group hygiene tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_detect_empty_groups_inner_filters_empty() {
        let groups = vec![
            make_group_entry_with_members("EmptyGroup", vec![]),
            make_group_entry_with_members(
                "PopulatedGroup",
                vec!["CN=User1,OU=Users,DC=example,DC=com"],
            ),
            make_group_entry_with_members("AnotherEmpty", vec![]),
        ];
        let state = make_state_with_groups(groups);
        let result = detect_empty_groups_inner(&state).await.unwrap();
        assert_eq!(result.len(), 2);
        let names: Vec<&str> = result
            .iter()
            .filter_map(|g| g.sam_account_name.as_deref())
            .collect();
        assert!(names.contains(&"EmptyGroup"));
        assert!(names.contains(&"AnotherEmpty"));
    }

    #[tokio::test]
    async fn test_detect_empty_groups_inner_excludes_builtin() {
        let mut builtin_group = make_group_entry_with_members("Guests", vec![]);
        builtin_group.distinguished_name = "CN=Guests,CN=Builtin,DC=example,DC=com".to_string();
        let mut users_group = make_group_entry_with_members("Domain Users", vec![]);
        users_group.distinguished_name = "CN=Domain Users,CN=Users,DC=example,DC=com".to_string();
        let normal_empty = make_group_entry_with_members("CustomEmpty", vec![]);
        let groups = vec![builtin_group, users_group, normal_empty];
        let state = make_state_with_groups(groups);
        let result = detect_empty_groups_inner(&state).await.unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].sam_account_name, Some("CustomEmpty".to_string()));
    }

    #[tokio::test]
    async fn test_detect_circular_groups_inner_detects_simple_cycle() {
        let group_a =
            make_group_entry_with_members("GroupA", vec!["CN=GroupB,OU=Groups,DC=example,DC=com"]);
        let group_b =
            make_group_entry_with_members("GroupB", vec!["CN=GroupA,OU=Groups,DC=example,DC=com"]);
        let groups = vec![group_a, group_b];
        let state = make_state_with_groups(groups);
        let result = detect_circular_groups_inner(&state).await.unwrap();
        assert!(!result.is_empty(), "Should detect at least one cycle");
        let cycle = &result[0];
        assert!(cycle.iter().any(|dn| dn.contains("GroupA")));
        assert!(cycle.iter().any(|dn| dn.contains("GroupB")));
    }

    #[tokio::test]
    async fn test_detect_circular_groups_inner_no_cycle() {
        let group_a =
            make_group_entry_with_members("GroupA", vec!["CN=GroupB,OU=Groups,DC=example,DC=com"]);
        let group_b = make_group_entry_with_members("GroupB", vec![]);
        let groups = vec![group_a, group_b];
        let state = make_state_with_groups(groups);
        let result = detect_circular_groups_inner(&state).await.unwrap();
        assert!(result.is_empty(), "Should not detect any cycles");
    }

    #[tokio::test]
    async fn test_delete_group_inner_requires_domain_admin() {
        let state = make_state_with_level(PermissionLevel::AccountOperator);
        let result = delete_group_inner(&state, "CN=TestGroup,DC=example,DC=com").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => {
                assert!(msg.contains("DomainAdmin"));
            }
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_delete_group_inner_audits_success() {
        let (state, provider) = make_state_with_level_and_provider(PermissionLevel::DomainAdmin);
        delete_group_inner(&state, "CN=OldGroup,DC=example,DC=com")
            .await
            .unwrap();
        let calls = provider.delete_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0], "CN=OldGroup,DC=example,DC=com");
        let entries = state.audit_service.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].success);
        assert_eq!(entries[0].action, "GroupDeleted");
    }

    #[tokio::test]
    async fn test_detect_single_member_groups_inner() {
        let single_group = make_group_entry_with_members(
            "SingleGroup",
            vec!["CN=User1,OU=Users,DC=example,DC=com"],
        );
        let multi_group = make_group_entry_with_members(
            "MultiGroup",
            vec![
                "CN=User1,OU=Users,DC=example,DC=com",
                "CN=User2,OU=Users,DC=example,DC=com",
            ],
        );
        let empty_group = make_group_entry_with_members("EmptyGroup", vec![]);
        let groups = vec![single_group, multi_group, empty_group];
        let state = make_state_with_groups(groups);
        let result = detect_single_member_groups_inner(&state).await.unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].sam_account_name, Some("SingleGroup".to_string()));
    }

    #[tokio::test]
    async fn test_detect_stale_groups_inner() {
        let mut stale_group = make_group_entry_with_members("StaleGroup", vec![]);
        stale_group.attributes.insert(
            "whenChanged".to_string(),
            vec!["2024-01-01T00:00:00Z".to_string()],
        );
        let mut fresh_group = make_group_entry_with_members("FreshGroup", vec![]);
        fresh_group.attributes.insert(
            "whenChanged".to_string(),
            vec!["2026-03-14T00:00:00Z".to_string()],
        );
        let groups = vec![stale_group, fresh_group];
        let state = make_state_with_groups(groups);
        let result = detect_stale_groups_inner(&state, 180).await.unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].sam_account_name, Some("StaleGroup".to_string()));
    }

    #[tokio::test]
    async fn test_detect_undescribed_groups_inner() {
        let with_desc = make_group_entry_with_members("WithDesc", vec![]);
        let mut without_desc = make_group_entry_with_members("NoDesc", vec![]);
        without_desc.attributes.remove("description");
        let groups = vec![with_desc, without_desc];
        let state = make_state_with_groups(groups);
        let result = detect_undescribed_groups_inner(&state).await.unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].sam_account_name, Some("NoDesc".to_string()));
    }

    #[tokio::test]
    async fn test_detect_duplicate_groups_inner() {
        let group_a = make_group_entry_with_members(
            "GroupA",
            vec!["CN=User1,DC=example,DC=com", "CN=User2,DC=example,DC=com"],
        );
        let group_b = make_group_entry_with_members(
            "GroupB",
            vec!["CN=User2,DC=example,DC=com", "CN=User1,DC=example,DC=com"],
        );
        let group_c = make_group_entry_with_members("GroupC", vec!["CN=User3,DC=example,DC=com"]);
        let groups = vec![group_a, group_b, group_c];
        let state = make_state_with_groups(groups);
        let result = detect_duplicate_groups_inner(&state).await.unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].len(), 2);
        let names: Vec<&str> = result[0]
            .iter()
            .filter_map(|g| g.sam_account_name.as_deref())
            .collect();
        assert!(names.contains(&"GroupA"));
        assert!(names.contains(&"GroupB"));
    }

    #[tokio::test]
    async fn test_detect_deep_nesting_inner() {
        let group_a =
            make_group_entry_with_members("GroupA", vec!["CN=GroupB,OU=Groups,DC=example,DC=com"]);
        let group_b =
            make_group_entry_with_members("GroupB", vec!["CN=GroupC,OU=Groups,DC=example,DC=com"]);
        let group_c = make_group_entry_with_members("GroupC", vec![]);
        let groups = vec![group_a, group_b, group_c];
        let state = make_state_with_groups(groups);
        let result = detect_deep_nesting_inner(&state, 2).await.unwrap();
        assert!(!result.is_empty(), "Should detect GroupA with depth 3");
        assert!(result
            .iter()
            .any(|r| r.group_name == "GroupA" && r.depth == 3));
    }

    // -----------------------------------------------------------------------
    // create_group_inner tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_create_group_inner_requires_account_operator() {
        let state = make_state();
        let result = create_group_inner(
            &state,
            "TestGroup",
            "OU=Groups,DC=example,DC=com",
            "Global",
            "Security",
            "Test desc",
        )
        .await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_create_group_inner_audits_success() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);

        let result = create_group_inner(
            &state,
            "TestGroup",
            "OU=Groups,DC=example,DC=com",
            "Global",
            "Security",
            "A test group",
        )
        .await;
        assert!(result.is_ok());
        let dn = result.unwrap();
        assert_eq!(dn, "CN=TestGroup,OU=Groups,DC=example,DC=com");

        let calls = provider.create_group_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "TestGroup");

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "GroupCreated"));
    }

    // -----------------------------------------------------------------------
    // move_object_inner tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_move_object_inner_requires_account_operator() {
        let state = make_state();
        let result = move_object_inner(
            &state,
            "CN=TestGroup,OU=Old,DC=example,DC=com",
            "OU=New,DC=example,DC=com",
        )
        .await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_move_object_inner_allowed_for_account_operator() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);

        let result = move_object_inner(
            &state,
            "CN=TestUser,OU=Old,DC=example,DC=com",
            "OU=New,DC=example,DC=com",
        )
        .await;
        assert!(result.is_ok());

        let calls = provider.move_object_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "CN=TestUser,OU=Old,DC=example,DC=com");
        assert_eq!(calls[0].1, "OU=New,DC=example,DC=com");
    }

    #[tokio::test]
    async fn test_move_object_inner_audits_success() {
        let (state, provider) = make_state_with_level_and_provider(PermissionLevel::DomainAdmin);

        let result = move_object_inner(
            &state,
            "CN=TestGroup,OU=Old,DC=example,DC=com",
            "OU=New,DC=example,DC=com",
        )
        .await;
        assert!(result.is_ok());

        let calls = provider.move_object_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "ObjectMoved"));
    }

    #[tokio::test]
    async fn test_move_object_inner_audits_failure() {
        let state = make_state_with_level_and_failure(PermissionLevel::AccountOperator);

        let result = move_object_inner(
            &state,
            "CN=TestUser,OU=Old,DC=example,DC=com",
            "OU=New,DC=example,DC=com",
        )
        .await;
        assert!(result.is_err());

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "MoveObjectFailed"));
    }

    // -----------------------------------------------------------------------
    // bulk_move_objects_inner tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_bulk_move_objects_inner_requires_account_operator() {
        let state = make_state();
        let result = bulk_move_objects_inner(
            &state,
            &["CN=U1,OU=Old,DC=example,DC=com".to_string()],
            "OU=New,DC=example,DC=com",
        )
        .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_bulk_move_objects_inner_moves_all() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);

        let dns = vec![
            "CN=U1,OU=Old,DC=example,DC=com".to_string(),
            "CN=U2,OU=Old,DC=example,DC=com".to_string(),
        ];

        let results = bulk_move_objects_inner(&state, &dns, "OU=New,DC=example,DC=com")
            .await
            .unwrap();

        assert_eq!(results.len(), 2);
        assert!(results[0].success);
        assert!(results[1].success);
        assert!(results[0].error.is_none());

        let calls = provider.move_object_calls.lock().unwrap();
        assert_eq!(calls.len(), 2);

        let entries = state.audit_service.get_entries();
        assert_eq!(
            entries.iter().filter(|e| e.action == "ObjectMoved").count(),
            2
        );
    }

    #[tokio::test]
    async fn test_bulk_move_objects_inner_continues_on_failure() {
        let state = make_state_with_level_and_failure(PermissionLevel::AccountOperator);

        let dns = vec![
            "CN=U1,OU=Old,DC=example,DC=com".to_string(),
            "CN=U2,OU=Old,DC=example,DC=com".to_string(),
        ];

        let results = bulk_move_objects_inner(&state, &dns, "OU=New,DC=example,DC=com")
            .await
            .unwrap();

        assert_eq!(results.len(), 2);
        assert!(!results[0].success);
        assert!(!results[1].success);
        assert!(results[0].error.is_some());
        assert!(results[1].error.is_some());

        let entries = state.audit_service.get_entries();
        assert_eq!(
            entries
                .iter()
                .filter(|e| e.action == "MoveObjectFailed")
                .count(),
            2
        );
    }

    // -----------------------------------------------------------------------
    // update_managed_by_inner tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_update_managed_by_inner_requires_account_operator() {
        let state = make_state();
        let result = update_managed_by_inner(
            &state,
            "CN=TestGroup,OU=Groups,DC=example,DC=com",
            "CN=Manager,OU=Users,DC=example,DC=com",
        )
        .await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_update_managed_by_inner_audits_success() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);

        let result = update_managed_by_inner(
            &state,
            "CN=TestGroup,OU=Groups,DC=example,DC=com",
            "CN=Manager,OU=Users,DC=example,DC=com",
        )
        .await;
        assert!(result.is_ok());

        let calls = provider.update_managed_by_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "CN=TestGroup,OU=Groups,DC=example,DC=com");
        assert_eq!(calls[0].1, "CN=Manager,OU=Users,DC=example,DC=com");

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "ManagedByUpdated"));
    }

    // -----------------------------------------------------------------------
    // replication metadata edge cases
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_get_replication_metadata_no_attr_no_value() {
        let state = make_state();
        let result = get_replication_metadata_inner(&state, "CN=EmptyObj,DC=test")
            .await
            .unwrap();
        assert!(!result.is_available);
        assert!(result.attributes.is_empty());
        assert!(result.value_metadata.is_empty());
        assert!(result.message.is_some());
        assert!(result.message.unwrap().contains("not available"));
    }

    #[tokio::test]
    async fn test_get_replication_metadata_with_attr_metadata_has_correct_object_dn() {
        let xml = r#"<DS_REPL_ATTR_META_DATA>
    <pszAttributeName>sn</pszAttributeName>
    <dwVersion>1</dwVersion>
    <ftimeLastOriginatingChange>2026-01-01T00:00:00Z</ftimeLastOriginatingChange>
    <pszLastOriginatingDsaDN>CN=DC1</pszLastOriginatingDsaDN>
    <usnOriginatingChange>111</usnOriginatingChange>
    <usnLocalChange>222</usnLocalChange>
</DS_REPL_ATTR_META_DATA>"#;
        let provider =
            Arc::new(MockDirectoryProvider::new().with_replication_metadata(xml.to_string()));
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        let result = get_replication_metadata_inner(&state, "CN=User1,DC=example,DC=com")
            .await
            .unwrap();
        assert!(result.is_available);
        assert_eq!(result.object_dn, "CN=User1,DC=example,DC=com");
        assert!(result.message.is_none());
    }

    #[tokio::test]
    async fn test_get_replication_metadata_multiple_attributes() {
        let xml = r#"<DS_REPL_ATTR_META_DATA>
    <pszAttributeName>displayName</pszAttributeName>
    <dwVersion>3</dwVersion>
    <ftimeLastOriginatingChange>2026-02-15T14:30:00Z</ftimeLastOriginatingChange>
    <pszLastOriginatingDsaDN>CN=DC1</pszLastOriginatingDsaDN>
    <usnOriginatingChange>100</usnOriginatingChange>
    <usnLocalChange>200</usnLocalChange>
</DS_REPL_ATTR_META_DATA>
<DS_REPL_ATTR_META_DATA>
    <pszAttributeName>title</pszAttributeName>
    <dwVersion>5</dwVersion>
    <ftimeLastOriginatingChange>2026-03-01T08:00:00Z</ftimeLastOriginatingChange>
    <pszLastOriginatingDsaDN>CN=DC2</pszLastOriginatingDsaDN>
    <usnOriginatingChange>300</usnOriginatingChange>
    <usnLocalChange>400</usnLocalChange>
</DS_REPL_ATTR_META_DATA>"#;
        let provider =
            Arc::new(MockDirectoryProvider::new().with_replication_metadata(xml.to_string()));
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        let result = get_replication_metadata_inner(&state, "CN=User1,DC=test")
            .await
            .unwrap();
        assert!(result.is_available);
        assert_eq!(result.attributes.len(), 2);
        let names: Vec<&str> = result
            .attributes
            .iter()
            .map(|a| a.attribute_name.as_str())
            .collect();
        assert!(names.contains(&"displayName"));
        assert!(names.contains(&"title"));
    }

    // -----------------------------------------------------------------------
    // compute_attribute_diff_inner - edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_compute_attribute_diff_inner_empty_metadata() {
        let diff =
            compute_attribute_diff_inner(&[], "2026-01-01T00:00:00Z", "2026-12-31T23:59:59Z");
        assert!(diff.is_empty());
    }

    #[test]
    fn test_compute_attribute_diff_inner_all_outside_range() {
        let metadata = vec![crate::services::replication::AttributeMetadata {
            attribute_name: "displayName".to_string(),
            version: 3,
            last_originating_change_time: "2025-01-01T00:00:00Z".to_string(),
            last_originating_dsa_dn: String::new(),
            local_usn: 0,
            originating_usn: 0,
        }];
        let diff =
            compute_attribute_diff_inner(&metadata, "2026-01-01T00:00:00Z", "2026-12-31T23:59:59Z");
        assert!(diff.is_empty());
    }

    #[test]
    fn test_compute_attribute_diff_inner_all_inside_range() {
        let metadata = vec![
            crate::services::replication::AttributeMetadata {
                attribute_name: "sn".to_string(),
                version: 2,
                last_originating_change_time: "2026-06-15T10:00:00Z".to_string(),
                last_originating_dsa_dn: String::new(),
                local_usn: 0,
                originating_usn: 0,
            },
            crate::services::replication::AttributeMetadata {
                attribute_name: "givenName".to_string(),
                version: 1,
                last_originating_change_time: "2026-03-01T08:00:00Z".to_string(),
                last_originating_dsa_dn: String::new(),
                local_usn: 0,
                originating_usn: 0,
            },
        ];
        let diff =
            compute_attribute_diff_inner(&metadata, "2026-01-01T00:00:00Z", "2026-12-31T23:59:59Z");
        assert_eq!(diff.len(), 2);
        assert_eq!(diff[0].attribute_name, "sn");
        assert_eq!(diff[0].version_before, 1);
        assert_eq!(diff[0].version_after, 2);
        assert_eq!(diff[1].attribute_name, "givenName");
        assert_eq!(diff[1].version_before, 0);
        assert_eq!(diff[1].version_after, 1);
    }

    #[test]
    fn test_compute_attribute_diff_inner_boundary_timestamps() {
        let metadata = vec![
            crate::services::replication::AttributeMetadata {
                attribute_name: "attr_at_start".to_string(),
                version: 1,
                last_originating_change_time: "2026-01-01T00:00:00Z".to_string(),
                last_originating_dsa_dn: String::new(),
                local_usn: 0,
                originating_usn: 0,
            },
            crate::services::replication::AttributeMetadata {
                attribute_name: "attr_at_end".to_string(),
                version: 1,
                last_originating_change_time: "2026-12-31T23:59:59Z".to_string(),
                last_originating_dsa_dn: String::new(),
                local_usn: 0,
                originating_usn: 0,
            },
        ];
        let diff =
            compute_attribute_diff_inner(&metadata, "2026-01-01T00:00:00Z", "2026-12-31T23:59:59Z");
        assert_eq!(diff.len(), 2);
    }

    #[test]
    fn test_compute_attribute_diff_inner_version_zero() {
        let metadata = vec![crate::services::replication::AttributeMetadata {
            attribute_name: "new_attr".to_string(),
            version: 0,
            last_originating_change_time: "2026-06-01T00:00:00Z".to_string(),
            last_originating_dsa_dn: String::new(),
            local_usn: 0,
            originating_usn: 0,
        }];
        let diff =
            compute_attribute_diff_inner(&metadata, "2026-01-01T00:00:00Z", "2026-12-31T23:59:59Z");
        assert_eq!(diff.len(), 1);
        assert_eq!(diff[0].version_before, 0);
        assert_eq!(diff[0].version_after, 0);
    }

    // -----------------------------------------------------------------------
    // NTFS demo tests
    // -----------------------------------------------------------------------

    #[cfg(feature = "demo")]
    #[test]
    fn test_audit_ntfs_permissions_demo_valid_path() {
        let result = audit_ntfs_permissions_inner("\\\\server\\share");
        assert!(result.is_ok());
        let audit = result.unwrap();
        assert_eq!(audit.path, "\\\\server\\share");
        assert!(!audit.aces.is_empty());
    }

    #[cfg(feature = "demo")]
    #[test]
    fn test_analyze_ntfs_inner_demo_valid_path() {
        let result = analyze_ntfs_inner("\\\\server\\share", 2);
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert!(analysis.total_paths_scanned > 0);
        assert_eq!(analysis.total_errors, 0);
    }

    // -----------------------------------------------------------------------
    // NTFS additional invalid path patterns
    // -----------------------------------------------------------------------

    #[test]
    fn test_analyze_ntfs_inner_empty_path() {
        let result = analyze_ntfs_inner("", 1);
        assert!(result.is_err());
    }

    #[test]
    fn test_analyze_ntfs_inner_single_backslash() {
        let result = analyze_ntfs_inner("\\", 1);
        assert!(result.is_err());
    }

    #[test]
    fn test_audit_ntfs_permissions_empty_path() {
        let result = audit_ntfs_permissions_inner("");
        assert!(result.is_err());
    }

    #[test]
    fn test_audit_ntfs_permissions_traversal_attack() {
        let result = audit_ntfs_permissions_inner("\\\\server\\share\\..\\..\\etc");
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // cross_reference_ntfs_inner - additional scenarios
    // -----------------------------------------------------------------------

    #[test]
    fn test_cross_reference_ntfs_inner_shared_sid() {
        let aces = vec![crate::services::ntfs::AceEntry {
            trustee_sid: "S-1-5-21-100".to_string(),
            trustee_display_name: "SharedGroup".to_string(),
            access_type: crate::services::ntfs::AceAccessType::Allow,
            permissions: vec!["Read".to_string()],
            is_inherited: false,
        }];
        let user_a_sids = vec!["S-1-5-21-100".to_string()];
        let user_b_sids = vec!["S-1-5-21-100".to_string()];
        let results = cross_reference_ntfs_inner(&aces, &user_a_sids, &user_b_sids);
        assert_eq!(results.len(), 1);
        assert_eq!(
            results[0].user_a_access,
            crate::services::ntfs::AccessIndicator::Allowed
        );
        assert_eq!(
            results[0].user_b_access,
            crate::services::ntfs::AccessIndicator::Allowed
        );
    }

    #[test]
    fn test_cross_reference_ntfs_inner_no_matching_sids() {
        let aces = vec![crate::services::ntfs::AceEntry {
            trustee_sid: "S-1-5-21-999".to_string(),
            trustee_display_name: "OtherGroup".to_string(),
            access_type: crate::services::ntfs::AceAccessType::Allow,
            permissions: vec!["Read".to_string()],
            is_inherited: false,
        }];
        let user_a_sids = vec!["S-1-5-21-100".to_string()];
        let user_b_sids = vec!["S-1-5-21-200".to_string()];
        let results = cross_reference_ntfs_inner(&aces, &user_a_sids, &user_b_sids);
        assert_eq!(results.len(), 1);
        assert_eq!(
            results[0].user_a_access,
            crate::services::ntfs::AccessIndicator::NoMatch
        );
        assert_eq!(
            results[0].user_b_access,
            crate::services::ntfs::AccessIndicator::NoMatch
        );
    }
}
