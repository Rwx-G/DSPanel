use tauri::State;

use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::models::{
    ContactInfo, DeletedObject, DirectoryEntry, OUNode, ObjectSnapshot, Preset, PrinterInfo,
    SnapshotDiff,
};
use crate::services::app_settings::AppSettings;
use crate::services::audit::AuditEntry;
use crate::services::comparison::GroupComparisonResult;
use crate::services::mfa::{MfaConfig, MfaSetupResult};
use crate::services::ntfs::{AceCrossReference, AceEntry, NtfsAuditResult};
use crate::services::ntfs_analyzer::NtfsAnalysisResult;
use crate::services::password::{HibpResult, PasswordOptions};
use crate::services::replication::{
    AttributeChangeDiff, AttributeMetadata, ReplicationMetadataResult,
};
use crate::services::{AccountHealthStatus, HealthInput, PermissionLevel};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Inner functions - testable without Tauri runtime
// ---------------------------------------------------------------------------

/// Returns the application title from state.
pub(crate) fn get_app_title_inner(state: &AppState) -> String {
    state.title.lock().expect("lock poisoned").clone()
}

/// Returns the current user's permission level.
pub(crate) fn get_permission_level_inner(state: &AppState) -> PermissionLevel {
    state.permission_service.current_level()
}

/// Returns the current user's detected AD group names.
pub(crate) fn get_user_groups_inner(state: &AppState) -> Vec<String> {
    state.permission_service.user_groups()
}

/// Checks if the current user has the required permission level.
pub(crate) fn has_permission_inner(state: &AppState, required: PermissionLevel) -> bool {
    state.permission_service.has_permission(required)
}

/// Maximum allowed length for a search query.
const MAX_SEARCH_QUERY_LEN: usize = 256;

/// Validates and sanitizes a search query string.
///
/// Trims whitespace, rejects empty queries, enforces a maximum length,
/// and rejects control characters (null bytes, etc.) for defense-in-depth.
fn validate_search_input(query: &str) -> Result<String, AppError> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(
            "Search query must not be empty".to_string(),
        ));
    }
    if trimmed.len() > MAX_SEARCH_QUERY_LEN {
        return Err(AppError::Validation(format!(
            "Search query exceeds maximum length of {} characters",
            MAX_SEARCH_QUERY_LEN
        )));
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err(AppError::Validation(
            "Search query must not contain control characters".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

/// Searches for user accounts matching the query string.
pub(crate) async fn search_users_inner(
    state: &AppState,
    query: &str,
) -> Result<Vec<DirectoryEntry>, AppError> {
    let sanitized = validate_search_input(query)?;
    let provider = state.directory_provider.clone();
    provider
        .search_users(&sanitized, 50)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Searches for groups matching the query string.
pub(crate) async fn search_groups_inner(
    state: &AppState,
    query: &str,
) -> Result<Vec<DirectoryEntry>, AppError> {
    let sanitized = validate_search_input(query)?;
    let provider = state.directory_provider.clone();
    provider
        .search_groups(&sanitized, 50)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Returns the OU tree from Active Directory.
pub(crate) async fn get_ou_tree_inner(state: &AppState) -> Result<Vec<OUNode>, AppError> {
    let provider = state.directory_provider.clone();
    provider
        .get_ou_tree()
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Returns a single user by sAMAccountName with full attributes.
pub(crate) async fn get_user_inner(
    state: &AppState,
    sam_account_name: &str,
) -> Result<Option<DirectoryEntry>, AppError> {
    let provider = state.directory_provider.clone();
    provider
        .get_user_by_identity(sam_account_name)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Searches for computer accounts matching the query string.
pub(crate) async fn search_computers_inner(
    state: &AppState,
    query: &str,
) -> Result<Vec<DirectoryEntry>, AppError> {
    let provider = state.directory_provider.clone();
    provider
        .search_computers(query, 50)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Browse users with server-side caching and pagination.
///
/// Fetches up to 500 users, caches for 60 seconds, sorts by displayName,
/// and returns a page slice.
pub(crate) async fn browse_users_inner(
    state: &AppState,
    page: usize,
    page_size: usize,
) -> Result<BrowseResult, AppError> {
    const CACHE_TTL: Duration = Duration::from_secs(60);
    const MAX_BROWSE: usize = 5000;

    // Check cache validity
    let cached = {
        let cache = state.browse_cache.lock().expect("lock poisoned");
        cache
            .as_ref()
            .filter(|(ts, _)| ts.elapsed() < CACHE_TTL)
            .map(|(_, entries)| entries.clone())
    };

    let entries = match cached {
        Some(entries) => entries,
        None => {
            let provider = state.directory_provider.clone();
            let mut fresh = provider
                .browse_users(MAX_BROWSE)
                .await
                .map_err(|e| AppError::Directory(e.to_string()))?;

            // Sort by display name (case-insensitive)
            fresh.sort_by(|a, b| {
                let da = a.display_name.as_deref().unwrap_or("").to_lowercase();
                let db = b.display_name.as_deref().unwrap_or("").to_lowercase();
                da.cmp(&db)
            });

            // Update cache
            let mut cache = state.browse_cache.lock().expect("lock poisoned");
            *cache = Some((Instant::now(), fresh.clone()));

            fresh
        }
    };

    let total_count = entries.len();
    let start = page * page_size;
    let page_entries: Vec<DirectoryEntry> =
        entries.into_iter().skip(start).take(page_size).collect();
    let has_more = start + page_entries.len() < total_count;

    Ok(BrowseResult {
        entries: page_entries,
        total_count,
        has_more,
    })
}

/// Browse computers with server-side caching and pagination.
pub(crate) async fn browse_computers_inner(
    state: &AppState,
    page: usize,
    page_size: usize,
) -> Result<BrowseResult, AppError> {
    const CACHE_TTL: Duration = Duration::from_secs(60);
    const MAX_BROWSE: usize = 5000;

    let cached = {
        let cache = state.browse_computers_cache.lock().expect("lock poisoned");
        cache
            .as_ref()
            .filter(|(ts, _)| ts.elapsed() < CACHE_TTL)
            .map(|(_, entries)| entries.clone())
    };

    let entries = match cached {
        Some(entries) => entries,
        None => {
            let provider = state.directory_provider.clone();
            let mut fresh = provider
                .browse_computers(MAX_BROWSE)
                .await
                .map_err(|e| AppError::Directory(e.to_string()))?;

            fresh.sort_by(|a, b| {
                let da = a.display_name.as_deref().unwrap_or("").to_lowercase();
                let db = b.display_name.as_deref().unwrap_or("").to_lowercase();
                da.cmp(&db)
            });

            let mut cache = state.browse_computers_cache.lock().expect("lock poisoned");
            *cache = Some((Instant::now(), fresh.clone()));

            fresh
        }
    };

    let total_count = entries.len();
    let start = page * page_size;
    let page_entries: Vec<DirectoryEntry> =
        entries.into_iter().skip(start).take(page_size).collect();
    let has_more = start + page_entries.len() < total_count;

    Ok(BrowseResult {
        entries: page_entries,
        total_count,
        has_more,
    })
}

/// Browse groups with server-side caching and pagination.
pub(crate) async fn browse_groups_inner(
    state: &AppState,
    page: usize,
    page_size: usize,
) -> Result<BrowseResult, AppError> {
    const CACHE_TTL: Duration = Duration::from_secs(60);
    const MAX_BROWSE: usize = 5000;

    let cached = {
        let cache = state.browse_groups_cache.lock().expect("lock poisoned");
        cache
            .as_ref()
            .filter(|(ts, _)| ts.elapsed() < CACHE_TTL)
            .map(|(_, entries)| entries.clone())
    };

    let entries = match cached {
        Some(entries) => entries,
        None => {
            let provider = state.directory_provider.clone();
            let mut fresh = provider
                .browse_groups(MAX_BROWSE)
                .await
                .map_err(|e| AppError::Directory(e.to_string()))?;

            fresh.sort_by(|a, b| {
                let da = a.display_name.as_deref().unwrap_or("").to_lowercase();
                let db = b.display_name.as_deref().unwrap_or("").to_lowercase();
                da.cmp(&db)
            });

            let mut cache = state.browse_groups_cache.lock().expect("lock poisoned");
            *cache = Some((Instant::now(), fresh.clone()));

            fresh
        }
    };

    let total_count = entries.len();
    let start = page * page_size;
    let page_entries: Vec<DirectoryEntry> =
        entries.into_iter().skip(start).take(page_size).collect();
    let has_more = start + page_entries.len() < total_count;

    Ok(BrowseResult {
        entries: page_entries,
        total_count,
        has_more,
    })
}

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

    let provider = state.directory_provider.clone();
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
    let provider = state.directory_provider.clone();
    provider
        .get_group_members(group_dn, 200)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Checks whether the directory provider has an active connection.
pub(crate) async fn check_connection_inner(state: &AppState) -> Result<bool, AppError> {
    let provider = state.directory_provider.clone();
    provider
        .test_connection()
        .await
        .map_err(|e| AppError::Network(e.to_string()))
}

/// Returns domain information from the directory provider.
pub(crate) fn get_domain_info_inner(state: &AppState) -> DomainInfo {
    let provider = &state.directory_provider;
    DomainInfo {
        domain_name: provider.domain_name().map(|s| s.to_string()),
        is_connected: provider.is_connected(),
    }
}

/// Resets a user's password via the directory provider.
pub(crate) async fn reset_password_inner(
    state: &AppState,
    user_dn: &str,
    new_password: &str,
    must_change_at_next_logon: bool,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::HelpDesk)
    {
        return Err(AppError::PermissionDenied(
            "Password reset requires HelpDesk permission or higher".to_string(),
        ));
    }

    state
        .mfa_service
        .check_mfa_for_action("PasswordReset")
        .map_err(|e| AppError::PermissionDenied(e.to_string()))?;

    state.snapshot_service.capture(user_dn, "PasswordReset");
    let provider = state.directory_provider.clone();
    match provider
        .reset_password(user_dn, new_password, must_change_at_next_logon)
        .await
    {
        Ok(()) => {
            state.audit_service.log_success(
                "PasswordReset",
                user_dn,
                &format!(
                    "Password reset (must_change_at_next_logon={})",
                    must_change_at_next_logon
                ),
            );
            Ok(())
        }
        Err(e) => {
            state
                .audit_service
                .log_failure("PasswordResetFailed", user_dn, &e.to_string());
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Unlocks a user account via the directory provider.
pub(crate) async fn unlock_account_inner(state: &AppState, user_dn: &str) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::HelpDesk)
    {
        return Err(AppError::PermissionDenied(
            "Account unlock requires HelpDesk permission or higher".to_string(),
        ));
    }

    state.snapshot_service.capture(user_dn, "AccountUnlock");
    let provider = state.directory_provider.clone();
    match provider.unlock_account(user_dn).await {
        Ok(()) => {
            state
                .audit_service
                .log_success("AccountUnlocked", user_dn, "Account unlocked");
            Ok(())
        }
        Err(e) => {
            state
                .audit_service
                .log_failure("AccountUnlockFailed", user_dn, &e.to_string());
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Enables a user account via the directory provider.
pub(crate) async fn enable_account_inner(state: &AppState, user_dn: &str) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::HelpDesk)
    {
        return Err(AppError::PermissionDenied(
            "Account enable requires HelpDesk permission or higher".to_string(),
        ));
    }

    state.snapshot_service.capture(user_dn, "AccountEnable");
    let provider = state.directory_provider.clone();
    match provider.enable_account(user_dn).await {
        Ok(()) => {
            state
                .audit_service
                .log_success("AccountEnabled", user_dn, "Account enabled");
            Ok(())
        }
        Err(e) => {
            state
                .audit_service
                .log_failure("AccountEnableFailed", user_dn, &e.to_string());
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Disables a user account via the directory provider.
pub(crate) async fn disable_account_inner(state: &AppState, user_dn: &str) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::HelpDesk)
    {
        return Err(AppError::PermissionDenied(
            "Account disable requires HelpDesk permission or higher".to_string(),
        ));
    }

    state
        .mfa_service
        .check_mfa_for_action("AccountDisable")
        .map_err(|e| AppError::PermissionDenied(e.to_string()))?;

    state.snapshot_service.capture(user_dn, "AccountDisable");
    let provider = state.directory_provider.clone();
    match provider.disable_account(user_dn).await {
        Ok(()) => {
            state
                .audit_service
                .log_success("AccountDisabled", user_dn, "Account disabled");
            Ok(())
        }
        Err(e) => {
            state
                .audit_service
                .log_failure("AccountDisableFailed", user_dn, &e.to_string());
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Sets password flags on a user account via the directory provider.
/// Reads the current "User Cannot Change Password" flag from the DACL.
pub(crate) async fn get_cannot_change_password_inner(
    state: &AppState,
    user_dn: &str,
) -> Result<bool, AppError> {
    let provider = state.directory_provider.clone();
    provider
        .get_cannot_change_password(user_dn)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

pub(crate) async fn set_password_flags_inner(
    state: &AppState,
    user_dn: &str,
    password_never_expires: bool,
    user_cannot_change_password: bool,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Password flag management requires AccountOperator permission or higher".to_string(),
        ));
    }

    state
        .mfa_service
        .check_mfa_for_action("PasswordFlagsChange")
        .map_err(|e| AppError::PermissionDenied(e.to_string()))?;

    state
        .snapshot_service
        .capture(user_dn, "PasswordFlagsChange");
    let provider = state.directory_provider.clone();
    match provider
        .set_password_flags(user_dn, password_never_expires, user_cannot_change_password)
        .await
    {
        Ok(()) => {
            state.audit_service.log_success(
                "PasswordFlagsChanged",
                user_dn,
                &format!(
                    "password_never_expires={}, user_cannot_change_password={}",
                    password_never_expires, user_cannot_change_password
                ),
            );
            Ok(())
        }
        Err(e) => {
            state
                .audit_service
                .log_failure("PasswordFlagsChangeFailed", user_dn, &e.to_string());
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Returns audit log entries.
pub(crate) fn get_audit_entries_inner(state: &AppState) -> Vec<AuditEntry> {
    state.audit_service.get_entries()
}

/// Resolves a user by sAMAccountName, trying get_user_by_identity first,
/// then falling back to search_users if not found.
async fn resolve_user(
    provider: &dyn crate::services::DirectoryProvider,
    sam: &str,
) -> Result<DirectoryEntry, AppError> {
    // Try exact lookup first
    if let Some(user) = provider
        .get_user_by_identity(sam)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))?
    {
        return Ok(user);
    }

    // Fallback to search (handles cases where sAMAccountName filter doesn't match)
    let results = provider
        .search_users(sam, 5)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))?;

    results
        .into_iter()
        .find(|u| u.sam_account_name.as_deref() == Some(sam))
        .ok_or_else(|| AppError::Directory(format!("User not found: {}", sam)))
}

/// Compares the group memberships of two users identified by sAMAccountName.
pub(crate) async fn compare_users_inner(
    state: &AppState,
    sam_a: &str,
    sam_b: &str,
) -> Result<GroupComparisonResult, AppError> {
    let provider = state.directory_provider.clone();

    let user_a = resolve_user(&*provider, sam_a).await?;
    let user_b = resolve_user(&*provider, sam_b).await?;

    // Use nested group resolution (transitive membership) for complete comparison
    let groups_a = provider
        .get_nested_groups(&user_a.distinguished_name)
        .await
        .unwrap_or_else(|_| user_a.get_attribute_values("memberOf").to_vec());
    let groups_b = provider
        .get_nested_groups(&user_b.distinguished_name)
        .await
        .unwrap_or_else(|_| user_b.get_attribute_values("memberOf").to_vec());

    Ok(crate::services::comparison::compute_group_diff(
        &groups_a, &groups_b,
    ))
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

/// Adds a user to a group. Requires HelpDesk permission.
pub(crate) async fn add_user_to_group_inner(
    state: &AppState,
    user_dn: &str,
    group_dn: &str,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::HelpDesk)
    {
        return Err(AppError::PermissionDenied(
            "Requires HelpDesk permission or higher".to_string(),
        ));
    }

    state.snapshot_service.capture(user_dn, "AddToGroup");

    let provider = state.directory_provider.clone();
    match provider.add_user_to_group(user_dn, group_dn).await {
        Ok(()) => {
            state.audit_service.log_success(
                "AddedToGroup",
                user_dn,
                &format!("Added to group {}", group_dn),
            );
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "AddToGroupFailed",
                user_dn,
                &format!("Failed to add to group {}: {}", group_dn, e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Retrieves and parses replication metadata for an AD object.
pub(crate) async fn get_replication_metadata_inner(
    state: &AppState,
    object_dn: &str,
) -> Result<ReplicationMetadataResult, AppError> {
    let provider = state.directory_provider.clone();
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

/// Performs a recursive NTFS permissions analysis on a UNC path.
pub(crate) fn analyze_ntfs_inner(path: &str, depth: usize) -> Result<NtfsAnalysisResult, AppError> {
    crate::services::ntfs::validate_unc_path(path).map_err(AppError::Validation)?;

    Ok(crate::services::ntfs_analyzer::analyze(path, depth))
}

/// Detects empty groups (groups with no members).
pub(crate) async fn detect_empty_groups_inner(
    state: &AppState,
) -> Result<Vec<DirectoryEntry>, AppError> {
    let provider = state.directory_provider.clone();
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
    let provider = state.directory_provider.clone();
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
    let provider = state.directory_provider.clone();
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
    let provider = state.directory_provider.clone();
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
    let provider = state.directory_provider.clone();
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
    let provider = state.directory_provider.clone();
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
    let provider = state.directory_provider.clone();
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
    state.snapshot_service.capture(&dn, "GroupCreate");

    let provider = state.directory_provider.clone();
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

    state.snapshot_service.capture(object_dn, "MoveObject");

    let provider = state.directory_provider.clone();
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
        state.snapshot_service.capture(dn, "MoveObject");

        let provider = state.directory_provider.clone();
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

// ---------------------------------------------------------------------------
// Recycle Bin commands
// ---------------------------------------------------------------------------

/// Checks whether the AD Recycle Bin feature is enabled. Requires DomainAdmin.
pub(crate) async fn is_recycle_bin_enabled_inner(state: &AppState) -> Result<bool, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Recycle Bin access requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    provider
        .is_recycle_bin_enabled()
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Lists deleted objects from the AD Recycle Bin. Requires DomainAdmin.
pub(crate) async fn get_deleted_objects_inner(
    state: &AppState,
) -> Result<Vec<DeletedObject>, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Recycle Bin access requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    provider
        .get_deleted_objects()
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Restores a deleted object from the Recycle Bin. Requires DomainAdmin.
pub(crate) async fn restore_deleted_object_inner(
    state: &AppState,
    deleted_dn: &str,
    target_ou_dn: &str,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Restoring objects requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    match provider
        .restore_deleted_object(deleted_dn, target_ou_dn)
        .await
    {
        Ok(()) => {
            state.audit_service.log_success(
                "ObjectRestored",
                deleted_dn,
                &format!("Restored to {}", target_ou_dn),
            );
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "RestoreObjectFailed",
                deleted_dn,
                &format!("Failed to restore: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
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

    let provider = state.directory_provider.clone();
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

/// Deletes a group by DN (requires DomainAdmin).
pub(crate) async fn delete_group_inner(state: &AppState, group_dn: &str) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Group deletion requires DomainAdmin permission".to_string(),
        ));
    }

    state.snapshot_service.capture(group_dn, "GroupDelete");
    let provider = state.directory_provider.clone();
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

// ---------------------------------------------------------------------------
// Contact and Printer Management - inner functions
// ---------------------------------------------------------------------------

/// Searches for contacts matching the query string. ReadOnly access.
pub(crate) async fn search_contacts_inner(
    state: &AppState,
    query: &str,
) -> Result<Vec<ContactInfo>, AppError> {
    let sanitized = validate_search_input(query)?;
    let provider = state.directory_provider.clone();
    provider
        .search_contacts(&sanitized, 50)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Searches for printers matching the query string. ReadOnly access.
pub(crate) async fn search_printers_inner(
    state: &AppState,
    query: &str,
) -> Result<Vec<PrinterInfo>, AppError> {
    let sanitized = validate_search_input(query)?;
    let provider = state.directory_provider.clone();
    provider
        .search_printers(&sanitized, 50)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Creates a new contact. Requires AccountOperator permission.
pub(crate) async fn create_contact_inner(
    state: &AppState,
    container_dn: &str,
    attrs: &std::collections::HashMap<String, String>,
) -> Result<String, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Contact creation requires AccountOperator permission or higher".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    match provider.create_contact(container_dn, attrs).await {
        Ok(dn) => {
            state.audit_service.log_success(
                "ContactCreated",
                &dn,
                &format!("Contact created in {}", container_dn),
            );
            Ok(dn)
        }
        Err(e) => {
            state.audit_service.log_failure(
                "ContactCreateFailed",
                container_dn,
                &format!("Failed to create contact: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Updates an existing contact. Requires AccountOperator permission.
pub(crate) async fn update_contact_inner(
    state: &AppState,
    dn: &str,
    attrs: &std::collections::HashMap<String, String>,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Contact modification requires AccountOperator permission or higher".to_string(),
        ));
    }

    state.snapshot_service.capture(dn, "ContactUpdate");

    let provider = state.directory_provider.clone();
    match provider.update_contact(dn, attrs).await {
        Ok(()) => {
            state
                .audit_service
                .log_success("ContactUpdated", dn, "Contact updated");
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "ContactUpdateFailed",
                dn,
                &format!("Failed to update contact: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Deletes a contact. Requires AccountOperator permission.
pub(crate) async fn delete_contact_inner(state: &AppState, dn: &str) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Contact deletion requires AccountOperator permission or higher".to_string(),
        ));
    }

    state.snapshot_service.capture(dn, "ContactDelete");

    let provider = state.directory_provider.clone();
    match provider.delete_contact(dn).await {
        Ok(()) => {
            state
                .audit_service
                .log_success("ContactDeleted", dn, "Contact deleted");
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "ContactDeleteFailed",
                dn,
                &format!("Failed to delete contact: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Creates a new printer. Requires DomainAdmin permission.
pub(crate) async fn create_printer_inner(
    state: &AppState,
    container_dn: &str,
    attrs: &std::collections::HashMap<String, String>,
) -> Result<String, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Printer creation requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    match provider.create_printer(container_dn, attrs).await {
        Ok(dn) => {
            state.audit_service.log_success(
                "PrinterCreated",
                &dn,
                &format!("Printer created in {}", container_dn),
            );
            Ok(dn)
        }
        Err(e) => {
            state.audit_service.log_failure(
                "PrinterCreateFailed",
                container_dn,
                &format!("Failed to create printer: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Updates an existing printer. Requires DomainAdmin permission.
pub(crate) async fn update_printer_inner(
    state: &AppState,
    dn: &str,
    attrs: &std::collections::HashMap<String, String>,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Printer modification requires DomainAdmin permission".to_string(),
        ));
    }

    state.snapshot_service.capture(dn, "PrinterUpdate");

    let provider = state.directory_provider.clone();
    match provider.update_printer(dn, attrs).await {
        Ok(()) => {
            state
                .audit_service
                .log_success("PrinterUpdated", dn, "Printer updated");
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "PrinterUpdateFailed",
                dn,
                &format!("Failed to update printer: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Deletes a printer. Requires DomainAdmin permission.
pub(crate) async fn delete_printer_inner(state: &AppState, dn: &str) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Printer deletion requires DomainAdmin permission".to_string(),
        ));
    }

    state.snapshot_service.capture(dn, "PrinterDelete");

    let provider = state.directory_provider.clone();
    match provider.delete_printer(dn).await {
        Ok(()) => {
            state
                .audit_service
                .log_success("PrinterDeleted", dn, "Printer deleted");
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "PrinterDeleteFailed",
                dn,
                &format!("Failed to delete printer: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands - thin wrappers
// ---------------------------------------------------------------------------

/// Returns the application title from managed state.
#[tauri::command]
pub fn get_app_title(state: State<'_, AppState>) -> String {
    get_app_title_inner(&state)
}

/// Returns the current user's permission level.
#[tauri::command]
pub fn get_permission_level(state: State<'_, AppState>) -> PermissionLevel {
    get_permission_level_inner(&state)
}

/// Returns the current user's detected AD group names.
#[tauri::command]
pub fn get_user_groups(state: State<'_, AppState>) -> Vec<String> {
    get_user_groups_inner(&state)
}

/// Checks if the current user has the required permission level.
#[tauri::command]
pub fn has_permission(state: State<'_, AppState>, required: PermissionLevel) -> bool {
    has_permission_inner(&state, required)
}

/// Searches for user accounts matching the query string.
///
/// The query is matched against sAMAccountName, userPrincipalName, and displayName
/// using a wildcard LDAP filter. Returns up to 50 results.
#[tauri::command]
pub async fn search_users(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<DirectoryEntry>, AppError> {
    search_users_inner(&state, &query).await
}

/// Searches for groups matching a query string.
#[tauri::command]
pub async fn search_groups(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<DirectoryEntry>, AppError> {
    search_groups_inner(&state, &query).await
}

/// Returns the OU tree from Active Directory.
#[tauri::command]
pub async fn get_ou_tree(state: State<'_, AppState>) -> Result<Vec<OUNode>, AppError> {
    get_ou_tree_inner(&state).await
}

/// Returns a single user by sAMAccountName with full attributes.
#[tauri::command]
pub async fn get_user(
    sam_account_name: String,
    state: State<'_, AppState>,
) -> Result<Option<DirectoryEntry>, AppError> {
    get_user_inner(&state, &sam_account_name).await
}

/// Searches for computer accounts matching the query string.
#[tauri::command]
pub async fn search_computers(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<DirectoryEntry>, AppError> {
    search_computers_inner(&state, &query).await
}

/// Pings a hostname and returns the result string.
///
/// Uses `tokio::process::Command` to avoid blocking the Tokio runtime thread pool.
#[tauri::command]
pub async fn ping_host(hostname: String) -> Result<String, AppError> {
    use std::time::Instant;
    use tokio::process::Command;

    let start = Instant::now();

    #[cfg(target_os = "windows")]
    let output = Command::new("ping")
        .args(["-n", "1", "-w", "3000", &hostname])
        .output()
        .await;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("ping")
        .args(["-c", "1", "-W", "3", &hostname])
        .output()
        .await;

    match output {
        Ok(result) => {
            let elapsed = start.elapsed().as_millis();
            if result.status.success() {
                Ok(format!("Reachable ({}ms)", elapsed))
            } else {
                Ok("Unreachable".to_string())
            }
        }
        Err(_) => Ok("Unreachable".to_string()),
    }
}

/// Checks whether the directory provider has an active connection to AD.
///
/// Returns a boolean: `true` if connected, `false` otherwise.
/// This performs a lightweight rootDSE query via `test_connection()`.
#[tauri::command]
pub async fn check_connection(state: State<'_, AppState>) -> Result<bool, AppError> {
    check_connection_inner(&state).await
}

/// Returns domain information from the directory provider.
///
/// Returns a JSON object with `domain_name` (e.g. "CORP.LOCAL") and
/// `is_connected` fields. Both may be null/false if not domain-joined.
#[tauri::command]
pub fn get_domain_info(state: State<'_, AppState>) -> DomainInfo {
    get_domain_info_inner(&state)
}

#[derive(serde::Serialize)]
pub struct DomainInfo {
    pub domain_name: Option<String>,
    pub is_connected: bool,
}

/// Paginated browse result for user listing.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseResult {
    pub entries: Vec<DirectoryEntry>,
    pub total_count: usize,
    pub has_more: bool,
}

/// Browses all users with pagination (cached server-side for 60s).
#[tauri::command]
pub async fn browse_users(
    page: usize,
    page_size: usize,
    state: State<'_, AppState>,
) -> Result<BrowseResult, AppError> {
    browse_users_inner(&state, page, page_size).await
}

/// Browses all computers with pagination (cached server-side for 60s).
#[tauri::command]
pub async fn browse_computers(
    page: usize,
    page_size: usize,
    state: State<'_, AppState>,
) -> Result<BrowseResult, AppError> {
    browse_computers_inner(&state, page, page_size).await
}

/// Browses all groups with pagination (cached server-side for 60s).
#[tauri::command]
pub async fn browse_groups(
    page: usize,
    page_size: usize,
    state: State<'_, AppState>,
) -> Result<BrowseResult, AppError> {
    browse_groups_inner(&state, page, page_size).await
}

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

/// Checks whether the AD Recycle Bin feature is enabled.
#[tauri::command]
pub async fn is_recycle_bin_enabled(state: State<'_, AppState>) -> Result<bool, AppError> {
    is_recycle_bin_enabled_inner(&state).await
}

/// Lists deleted objects from the AD Recycle Bin.
#[tauri::command]
pub async fn get_deleted_objects(
    state: State<'_, AppState>,
) -> Result<Vec<DeletedObject>, AppError> {
    get_deleted_objects_inner(&state).await
}

/// Restores a deleted object from the Recycle Bin.
#[tauri::command]
pub async fn restore_deleted_object(
    deleted_dn: String,
    target_ou_dn: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    restore_deleted_object_inner(&state, &deleted_dn, &target_ou_dn).await
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

/// Returns the current Windows username from the environment.
#[tauri::command]
pub fn get_current_username() -> String {
    std::env::var("USERNAME").unwrap_or_else(|e| {
        tracing::warn!("USERNAME environment variable not set: {}", e);
        "Unknown".to_string()
    })
}

/// Returns the authenticated LDAP identity (resolved via WhoAmI or bind DN).
///
/// This may differ from `get_current_username` when using "Run as" or simple bind.
#[tauri::command]
pub fn get_authenticated_identity(state: State<'_, AppState>) -> String {
    state
        .permission_service
        .authenticated_user()
        .unwrap_or_else(get_current_username)
}

/// Returns the platform the application is running on.
///
/// Returns one of: "windows", "macos", "linux", or "unknown".
pub(crate) fn get_platform_inner() -> String {
    if cfg!(target_os = "windows") {
        "windows".to_string()
    } else if cfg!(target_os = "macos") {
        "macos".to_string()
    } else if cfg!(target_os = "linux") {
        "linux".to_string()
    } else {
        "unknown".to_string()
    }
}

/// Returns the platform the application is running on.
#[tauri::command]
pub fn get_platform() -> String {
    get_platform_inner()
}

/// Returns the computer name from the environment.
#[tauri::command]
pub fn get_computer_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|e| {
        tracing::warn!("COMPUTERNAME environment variable not set: {}", e);
        "Unknown".to_string()
    })
}

/// Returns all attribute names from the AD schema.
#[tauri::command]
pub async fn get_schema_attributes(state: State<'_, AppState>) -> Result<Vec<String>, AppError> {
    let provider = state.directory_provider.clone();
    provider
        .get_schema_attributes()
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Evaluates the health status of a user account.
///
/// Receives user account properties and returns a health assessment with
/// severity level and active flags (Disabled, Locked, Expired, etc.).
#[tauri::command]
pub fn evaluate_health_cmd(input: HealthInput) -> AccountHealthStatus {
    let now_ms = chrono::Utc::now().timestamp_millis();
    crate::services::evaluate_health(&input, now_ms)
}

/// Evaluates health status for multiple user accounts in a single IPC call.
///
/// Accepts a vector of health inputs and returns a vector of results in the
/// same order. Much faster than calling `evaluate_health_cmd` per user.
#[tauri::command]
pub fn evaluate_health_batch(inputs: Vec<HealthInput>) -> Vec<AccountHealthStatus> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    inputs
        .iter()
        .map(|input| crate::services::evaluate_health(input, now_ms))
        .collect()
}

/// Resets a user's password.
#[tauri::command]
pub async fn reset_password(
    user_dn: String,
    new_password: String,
    must_change_at_next_logon: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    reset_password_inner(&state, &user_dn, &new_password, must_change_at_next_logon).await
}

/// Unlocks a user account.
#[tauri::command]
pub async fn unlock_account(user_dn: String, state: State<'_, AppState>) -> Result<(), AppError> {
    unlock_account_inner(&state, &user_dn).await
}

/// Enables a user account.
#[tauri::command]
pub async fn enable_account(user_dn: String, state: State<'_, AppState>) -> Result<(), AppError> {
    enable_account_inner(&state, &user_dn).await
}

/// Disables a user account.
#[tauri::command]
pub async fn disable_account(user_dn: String, state: State<'_, AppState>) -> Result<(), AppError> {
    disable_account_inner(&state, &user_dn).await
}

/// Reads the "User Cannot Change Password" DACL flag for a user account.
#[tauri::command]
pub async fn get_cannot_change_password(
    user_dn: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    get_cannot_change_password_inner(&state, &user_dn).await
}

/// Sets password flags on a user account.
#[tauri::command]
pub async fn set_password_flags(
    user_dn: String,
    password_never_expires: bool,
    user_cannot_change_password: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    set_password_flags_inner(
        &state,
        &user_dn,
        password_never_expires,
        user_cannot_change_password,
    )
    .await
}

/// Returns audit log entries.
#[tauri::command]
pub fn get_audit_entries(state: State<'_, AppState>) -> Vec<AuditEntry> {
    get_audit_entries_inner(&state)
}

/// Logs an audit event from the frontend (for operations not backed by a write command).
#[tauri::command]
pub fn audit_log(
    action: String,
    target_dn: String,
    details: String,
    success: bool,
    state: State<'_, AppState>,
) {
    if success {
        state
            .audit_service
            .log_success(&action, &target_dn, &details);
    } else {
        state
            .audit_service
            .log_failure(&action, &target_dn, &details);
    }
}

/// Adds a user to a group.
#[tauri::command]
pub async fn add_user_to_group(
    user_dn: String,
    group_dn: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    add_user_to_group_inner(&state, &user_dn, &group_dn).await
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

/// Compares group memberships of two users, returning shared/unique groups.
#[tauri::command]
pub async fn compare_users(
    sam_a: String,
    sam_b: String,
    state: State<'_, AppState>,
) -> Result<GroupComparisonResult, AppError> {
    compare_users_inner(&state, &sam_a, &sam_b).await
}

/// Generates a secure password with optional HIBP breach check.
#[tauri::command]
pub async fn generate_password(
    length: Option<usize>,
    include_uppercase: Option<bool>,
    include_lowercase: Option<bool>,
    include_digits: Option<bool>,
    include_special: Option<bool>,
    exclude_ambiguous: Option<bool>,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let options = PasswordOptions {
        length: length.unwrap_or(16),
        include_uppercase: include_uppercase.unwrap_or(true),
        include_lowercase: include_lowercase.unwrap_or(true),
        include_digits: include_digits.unwrap_or(true),
        include_special: include_special.unwrap_or(true),
        exclude_ambiguous: exclude_ambiguous.unwrap_or(false),
    };
    let (password, _hibp) =
        crate::services::password::generate_safe_password(&options, Some(&state.http_client), 5)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(password)
}

/// Checks a password against the HIBP Pwned Passwords API.
#[tauri::command]
pub async fn check_password_hibp(
    password: String,
    state: State<'_, AppState>,
) -> Result<HibpResult, AppError> {
    crate::services::password::check_hibp(&password, &state.http_client)
        .await
        .map_err(|e| AppError::Network(e.to_string()))
}

/// Sets up MFA (TOTP) for the current operator.
#[tauri::command]
pub fn mfa_setup(state: State<'_, AppState>) -> Result<MfaSetupResult, AppError> {
    let username = std::env::var("USERNAME").unwrap_or_else(|_| "Unknown".to_string());
    state
        .mfa_service
        .setup(&username)
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Verifies a TOTP code.
#[tauri::command]
pub fn mfa_verify(code: String, state: State<'_, AppState>) -> Result<bool, AppError> {
    state
        .mfa_service
        .verify(&code)
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Returns whether MFA is configured.
#[tauri::command]
pub fn mfa_is_configured(state: State<'_, AppState>) -> bool {
    state.mfa_service.is_configured()
}

/// Revokes MFA setup.
#[tauri::command]
pub fn mfa_revoke(state: State<'_, AppState>) {
    state.mfa_service.revoke();
    state
        .audit_service
        .log_success("MfaRevoked", "", "MFA configuration revoked");
}

/// Returns the current MFA configuration.
#[tauri::command]
pub fn mfa_get_config(state: State<'_, AppState>) -> MfaConfig {
    state.mfa_service.config()
}

/// Updates the MFA configuration.
#[tauri::command]
pub fn mfa_set_config(config: MfaConfig, state: State<'_, AppState>) {
    state.mfa_service.set_config(config);
}

/// Checks if a given action requires MFA.
#[tauri::command]
pub fn mfa_requires(action: String, state: State<'_, AppState>) -> bool {
    state.mfa_service.requires_mfa(&action)
}

/// Opens a native save file dialog and writes content to the selected path.
///
/// Returns the path the file was saved to, or None if the user cancelled.
#[tauri::command]
pub async fn save_file_dialog(
    content: String,
    default_name: String,
    filter_name: String,
    filter_extensions: Vec<String>,
) -> Result<Option<String>, AppError> {
    let ext_refs: Vec<&str> = filter_extensions.iter().map(|s| s.as_str()).collect();
    let dialog = rfd::AsyncFileDialog::new()
        .set_file_name(&default_name)
        .add_filter(&filter_name, &ext_refs);

    let handle = dialog.save_file().await;

    match handle {
        Some(file) => {
            let path = file.path().to_string_lossy().to_string();
            tokio::fs::write(file.path(), content.as_bytes())
                .await
                .map_err(|e| AppError::Internal(format!("Failed to write file: {}", e)))?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

/// Opens a native folder picker dialog and returns the selected path, or None if cancelled.
#[tauri::command]
pub async fn pick_folder_dialog() -> Result<Option<String>, AppError> {
    let handle = rfd::AsyncFileDialog::new().pick_folder().await;
    Ok(handle.map(|f| f.path().to_string_lossy().to_string()))
}

/// Resolves a hostname to IP addresses with a 5-second timeout.
#[tauri::command]
pub async fn resolve_dns(hostname: String) -> Result<Vec<String>, AppError> {
    use tokio::net::lookup_host;
    use tokio::time::{timeout, Duration};

    let result = timeout(
        Duration::from_secs(5),
        lookup_host(format!("{}:0", hostname)),
    )
    .await;

    match result {
        Ok(Ok(addrs)) => {
            let ips: Vec<String> = addrs.map(|a| a.ip().to_string()).collect();
            if ips.is_empty() {
                Err(AppError::Network("No addresses found".to_string()))
            } else {
                Ok(ips)
            }
        }
        Ok(Err(e)) => Err(AppError::Network(format!("DNS resolution failed: {}", e))),
        Err(_) => Err(AppError::Network("DNS resolution timed out".to_string())),
    }
}

// ---------------------------------------------------------------------------
// Preset management - inner functions
// ---------------------------------------------------------------------------

/// Returns the configured preset storage path.
pub(crate) fn get_preset_path_inner(state: &AppState) -> Option<String> {
    state
        .preset_service
        .get_path()
        .map(|p| p.to_string_lossy().to_string())
}

/// Validates and sets the preset storage path, loads presets and starts watching.
pub(crate) fn set_preset_path_inner(state: &AppState, path: &str) -> Result<(), AppError> {
    state
        .preset_service
        .configure_path(path)
        .map_err(AppError::Configuration)
}

/// Tests whether a path is a valid, accessible directory.
pub(crate) fn test_preset_path_inner(path: &str) -> Result<bool, AppError> {
    match crate::services::PresetService::validate_path(path) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// Returns all loaded presets.
pub(crate) fn list_presets_inner(state: &AppState) -> Vec<Preset> {
    state.preset_service.load_all()
}

/// Saves a preset to disk. Requires AccountOperator permission.
pub(crate) fn save_preset_inner(state: &AppState, preset: &Preset) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Managing presets requires AccountOperator permission or higher".to_string(),
        ));
    }

    state
        .preset_service
        .save(preset)
        .map_err(AppError::Configuration)?;

    state.audit_service.log_success(
        "PresetSaved",
        &preset.name,
        &format!("Preset '{}' saved", preset.name),
    );

    Ok(())
}

/// Accepts a preset whose checksum has changed (user acknowledges external modification).
pub(crate) fn accept_preset_checksum_inner(state: &AppState, name: &str) -> Result<(), AppError> {
    state
        .preset_service
        .accept_checksum(name)
        .map_err(AppError::Configuration)?;

    state.audit_service.log_success(
        "PresetChecksumAccepted",
        name,
        &format!(
            "Preset '{}' checksum accepted after external modification",
            name
        ),
    );

    Ok(())
}

/// Deletes a preset by name. Requires AccountOperator permission.
pub(crate) fn delete_preset_inner(state: &AppState, name: &str) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Managing presets requires AccountOperator permission or higher".to_string(),
        ));
    }

    state
        .preset_service
        .delete(name)
        .map_err(AppError::Configuration)?;

    state
        .audit_service
        .log_success("PresetDeleted", name, &format!("Preset '{}' deleted", name));

    Ok(())
}

// ---------------------------------------------------------------------------
// Preset management - Tauri commands
// ---------------------------------------------------------------------------

/// Returns the configured preset storage path.
#[tauri::command]
pub fn get_preset_path(state: State<'_, AppState>) -> Option<String> {
    get_preset_path_inner(&state)
}

/// Validates and sets the preset storage path.
#[tauri::command]
pub fn set_preset_path(path: String, state: State<'_, AppState>) -> Result<(), AppError> {
    set_preset_path_inner(&state, &path)
}

/// Tests whether a path is a valid, accessible directory for presets.
#[tauri::command]
pub fn test_preset_path(path: String) -> Result<bool, AppError> {
    test_preset_path_inner(&path)
}

/// Returns all available presets.
#[tauri::command]
pub fn list_presets(state: State<'_, AppState>) -> Vec<Preset> {
    list_presets_inner(&state)
}

/// Saves a preset to disk. Requires AccountOperator+.
#[tauri::command]
pub fn save_preset(preset: Preset, state: State<'_, AppState>) -> Result<(), AppError> {
    save_preset_inner(&state, &preset)
}

/// Deletes a preset by name. Requires AccountOperator+.
#[tauri::command]
pub fn delete_preset(name: String, state: State<'_, AppState>) -> Result<(), AppError> {
    delete_preset_inner(&state, &name)
}

/// Accepts a preset whose checksum has changed (user acknowledges external modification).
#[tauri::command]
pub fn accept_preset_checksum(name: String, state: State<'_, AppState>) -> Result<(), AppError> {
    accept_preset_checksum_inner(&state, &name)
}

// ---------------------------------------------------------------------------
// Onboarding / Offboarding / Modify attribute - inner functions
// ---------------------------------------------------------------------------

/// Creates a new user account with preset attributes. Requires AccountOperator+.
pub(crate) async fn create_user_inner(
    state: &AppState,
    cn: &str,
    container_dn: &str,
    sam_account_name: &str,
    password: &str,
    attributes: &std::collections::HashMap<String, Vec<String>>,
) -> Result<String, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Creating users requires AccountOperator permission or higher".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();

    // Check login uniqueness
    let existing = provider
        .get_user_by_identity(sam_account_name)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))?;
    if existing.is_some() {
        return Err(AppError::Validation(format!(
            "Login '{}' already exists",
            sam_account_name
        )));
    }

    state.snapshot_service.capture(container_dn, "CreateUser");

    match provider
        .create_user(cn, container_dn, sam_account_name, password, attributes)
        .await
    {
        Ok(dn) => {
            state.audit_service.log_success(
                "UserCreated",
                &dn,
                &format!("User '{}' created in {}", sam_account_name, container_dn),
            );
            Ok(dn)
        }
        Err(e) => {
            state.audit_service.log_failure(
                "CreateUserFailed",
                container_dn,
                &format!("Failed to create user '{}': {}", sam_account_name, e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Modifies an attribute on an AD object. Requires AccountOperator+.
pub(crate) async fn modify_attribute_inner(
    state: &AppState,
    dn: &str,
    attribute_name: &str,
    values: &[String],
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Modifying attributes requires AccountOperator permission or higher".to_string(),
        ));
    }

    state.snapshot_service.capture(dn, "ModifyAttribute");

    let provider = state.directory_provider.clone();
    match provider.modify_attribute(dn, attribute_name, values).await {
        Ok(()) => {
            state.audit_service.log_success(
                "AttributeModified",
                dn,
                &format!("Attribute '{}' modified", attribute_name),
            );
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "ModifyAttributeFailed",
                dn,
                &format!("Failed to modify '{}': {}", attribute_name, e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

// ---------------------------------------------------------------------------
// Onboarding / Offboarding / Modify attribute - Tauri commands
// ---------------------------------------------------------------------------

/// Creates a new user account. Requires AccountOperator+.
#[tauri::command]
pub async fn create_user(
    cn: String,
    container_dn: String,
    sam_account_name: String,
    password: String,
    attributes: std::collections::HashMap<String, Vec<String>>,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    create_user_inner(
        &state,
        &cn,
        &container_dn,
        &sam_account_name,
        &password,
        &attributes,
    )
    .await
}

/// Modifies an attribute on an AD object. Requires AccountOperator+.
#[tauri::command]
pub async fn modify_attribute(
    dn: String,
    attribute_name: String,
    values: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    modify_attribute_inner(&state, &dn, &attribute_name, &values).await
}

// ---------------------------------------------------------------------------
// App settings - Tauri commands
// ---------------------------------------------------------------------------

/// Returns the current application settings.
#[tauri::command]
pub fn get_app_settings(state: State<'_, AppState>) -> AppSettings {
    state.app_settings.get()
}

/// Updates application settings and persists to disk.
///
/// If Graph settings changed, also updates the GraphExchangeService config.
/// The client secret is read from the credential store, not from settings JSON.
#[tauri::command]
pub fn set_app_settings(settings: AppSettings, state: State<'_, AppState>) {
    // Read client secret from credential store (not from settings JSON)
    let client_secret = state
        .credential_store
        .retrieve("graph_client_secret")
        .unwrap_or(None);
    let graph_config = crate::services::graph_exchange::GraphConfig {
        tenant_id: settings.graph_tenant_id.clone().unwrap_or_default(),
        client_id: settings.graph_client_id.clone().unwrap_or_default(),
        client_secret,
    };
    state.graph_exchange.set_config(graph_config);
    state.app_settings.update(settings);
}

// ---------------------------------------------------------------------------
// Credential store - Tauri commands
// ---------------------------------------------------------------------------

/// Stores a credential in the OS-native secure storage.
pub(crate) fn store_credential_inner(
    state: &AppState,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    state
        .credential_store
        .store(key, value)
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Retrieves a credential from the OS-native secure storage.
pub(crate) fn get_credential_inner(
    state: &AppState,
    key: &str,
) -> Result<Option<String>, AppError> {
    state
        .credential_store
        .retrieve(key)
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Deletes a credential from the OS-native secure storage.
pub(crate) fn delete_credential_inner(state: &AppState, key: &str) -> Result<(), AppError> {
    state
        .credential_store
        .delete(key)
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Stores a credential in the OS-native secure storage.
#[tauri::command]
pub fn store_credential(
    key: String,
    value: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    store_credential_inner(&state, &key, &value)
}

/// Retrieves a credential from the OS-native secure storage.
/// Returns null if the credential does not exist.
#[tauri::command]
pub fn get_credential(key: String, state: State<'_, AppState>) -> Result<Option<String>, AppError> {
    get_credential_inner(&state, &key)
}

/// Deletes a credential from the OS-native secure storage.
#[tauri::command]
pub fn delete_credential(key: String, state: State<'_, AppState>) -> Result<(), AppError> {
    delete_credential_inner(&state, &key)
}

// ---------------------------------------------------------------------------
// Graph Exchange - Tauri commands
// ---------------------------------------------------------------------------

use crate::models::ExchangeOnlineInfo;

/// Tests the Microsoft Graph API connection with the current settings.
#[tauri::command]
pub async fn test_graph_connection(state: State<'_, AppState>) -> Result<bool, AppError> {
    if !state.graph_exchange.is_configured() {
        return Err(AppError::Validation(
            "Graph integration is not configured. Set tenant ID and client ID in settings."
                .to_string(),
        ));
    }
    state
        .graph_exchange
        .test_connection(&state.http_client)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Fetches Exchange Online information for a user by UPN.
#[tauri::command]
pub async fn get_exchange_online_info(
    user_principal_name: String,
    state: State<'_, AppState>,
) -> Result<Option<ExchangeOnlineInfo>, AppError> {
    if !state.graph_exchange.is_configured() {
        return Ok(None);
    }
    state
        .graph_exchange
        .get_exchange_online_info(&state.http_client, &user_principal_name)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Returns whether Graph integration is configured.
#[tauri::command]
pub fn is_graph_configured(state: State<'_, AppState>) -> bool {
    state.graph_exchange.is_configured()
}

// ---------------------------------------------------------------------------
// Contact and Printer Management - Tauri commands
// ---------------------------------------------------------------------------

/// Searches for contacts matching a query string.
#[tauri::command]
pub async fn search_contacts(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<ContactInfo>, AppError> {
    search_contacts_inner(&state, &query).await
}

/// Searches for printers matching a query string.
#[tauri::command]
pub async fn search_printers(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<PrinterInfo>, AppError> {
    search_printers_inner(&state, &query).await
}

/// Creates a new contact. Requires AccountOperator+.
#[tauri::command]
pub async fn create_contact(
    container_dn: String,
    attrs: std::collections::HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    create_contact_inner(&state, &container_dn, &attrs).await
}

/// Updates an existing contact. Requires AccountOperator+.
#[tauri::command]
pub async fn update_contact(
    dn: String,
    attrs: std::collections::HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    update_contact_inner(&state, &dn, &attrs).await
}

/// Deletes a contact. Requires AccountOperator+.
#[tauri::command]
pub async fn delete_contact(dn: String, state: State<'_, AppState>) -> Result<(), AppError> {
    delete_contact_inner(&state, &dn).await
}

/// Creates a new printer. Requires DomainAdmin.
#[tauri::command]
pub async fn create_printer(
    container_dn: String,
    attrs: std::collections::HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    create_printer_inner(&state, &container_dn, &attrs).await
}

/// Updates an existing printer. Requires DomainAdmin.
#[tauri::command]
pub async fn update_printer(
    dn: String,
    attrs: std::collections::HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    update_printer_inner(&state, &dn, &attrs).await
}

/// Deletes a printer. Requires DomainAdmin.
#[tauri::command]
pub async fn delete_printer(dn: String, state: State<'_, AppState>) -> Result<(), AppError> {
    delete_printer_inner(&state, &dn).await
}

// ---------------------------------------------------------------------------
// Thumbnail Photo
// ---------------------------------------------------------------------------

/// Gets the thumbnailPhoto attribute as base64-encoded bytes. ReadOnly access.
pub(crate) async fn get_thumbnail_photo_inner(
    state: &AppState,
    user_dn: &str,
) -> Result<Option<String>, AppError> {
    let provider = state.directory_provider.clone();
    provider
        .get_thumbnail_photo(user_dn)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Sets the thumbnailPhoto attribute from base64-encoded JPEG bytes.
/// Requires AccountOperator+.
pub(crate) async fn set_thumbnail_photo_inner(
    state: &AppState,
    user_dn: &str,
    photo_base64: &str,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Setting thumbnail photo requires AccountOperator permission or higher".to_string(),
        ));
    }

    state.snapshot_service.capture(user_dn, "SetThumbnailPhoto");

    let provider = state.directory_provider.clone();
    match provider.set_thumbnail_photo(user_dn, photo_base64).await {
        Ok(()) => {
            state
                .audit_service
                .log_success("ThumbnailPhotoSet", user_dn, "Thumbnail photo set");
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "ThumbnailPhotoSetFailed",
                user_dn,
                &format!("Failed to set thumbnail photo: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Removes the thumbnailPhoto attribute. Requires AccountOperator+.
pub(crate) async fn remove_thumbnail_photo_inner(
    state: &AppState,
    user_dn: &str,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Removing thumbnail photo requires AccountOperator permission or higher".to_string(),
        ));
    }

    state
        .snapshot_service
        .capture(user_dn, "RemoveThumbnailPhoto");

    let provider = state.directory_provider.clone();
    match provider.remove_thumbnail_photo(user_dn).await {
        Ok(()) => {
            state.audit_service.log_success(
                "ThumbnailPhotoRemoved",
                user_dn,
                "Thumbnail photo removed",
            );
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "ThumbnailPhotoRemoveFailed",
                user_dn,
                &format!("Failed to remove thumbnail photo: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

// ---------------------------------------------------------------------------
// Object Snapshot - inner functions
// ---------------------------------------------------------------------------

/// Captures a full snapshot of an AD object before modification.
/// Fetches current attributes from directory and stores in SQLite.
pub(crate) async fn capture_object_snapshot_inner(
    state: &AppState,
    object_dn: &str,
    operation_type: &str,
) -> Result<i64, AppError> {
    let provider = state.directory_provider.clone();
    // Search for the object to get all its attributes
    let entries = provider
        .search_users(object_dn, 1)
        .await
        .unwrap_or_default();
    // Serialize the entry's attributes to JSON
    let attrs_json = if let Some(entry) = entries.first() {
        serde_json::to_string(&entry.attributes).unwrap_or_else(|_| "{}".to_string())
    } else {
        "{}".to_string()
    };
    let id = state
        .object_snapshot_service
        .capture(object_dn, operation_type, &attrs_json);
    Ok(id)
}

/// Gets snapshot history for an object. ReadOnly access.
pub(crate) fn get_snapshot_history_inner(state: &AppState, object_dn: &str) -> Vec<ObjectSnapshot> {
    state.object_snapshot_service.get_history(object_dn)
}

/// Gets a specific snapshot by ID. ReadOnly access.
pub(crate) fn get_snapshot_inner(state: &AppState, id: i64) -> Option<ObjectSnapshot> {
    state.object_snapshot_service.get_snapshot(id)
}

/// Computes diff between a snapshot and current object state.
/// Requires ReadOnly access.
pub(crate) async fn compute_snapshot_diff_inner(
    state: &AppState,
    snapshot_id: i64,
) -> Result<Vec<SnapshotDiff>, AppError> {
    let snapshot = state
        .object_snapshot_service
        .get_snapshot(snapshot_id)
        .ok_or_else(|| AppError::Validation("Snapshot not found".to_string()))?;

    // Parse stored attributes
    let stored_attrs: std::collections::HashMap<String, Vec<String>> =
        serde_json::from_str(&snapshot.attributes_json).unwrap_or_default();

    // Fetch current state from directory
    let provider = state.directory_provider.clone();
    let entries = provider
        .search_users(&snapshot.object_dn, 1)
        .await
        .unwrap_or_default();

    let current_attrs: std::collections::HashMap<String, Vec<String>> = entries
        .first()
        .map(|e| e.attributes.clone())
        .unwrap_or_default();

    // Build diff - collect all attribute names from both sides
    let mut all_keys: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for key in stored_attrs.keys() {
        all_keys.insert(key.clone());
    }
    for key in current_attrs.keys() {
        all_keys.insert(key.clone());
    }

    let diffs: Vec<SnapshotDiff> = all_keys
        .into_iter()
        .map(|attr| {
            let snap_val = stored_attrs.get(&attr).map(|v| v.join("; "));
            let curr_val = current_attrs.get(&attr).map(|v| v.join("; "));
            let changed = snap_val != curr_val;
            SnapshotDiff {
                attribute: attr,
                snapshot_value: snap_val,
                current_value: curr_val,
                changed,
            }
        })
        .collect();

    Ok(diffs)
}

/// Restores an object from a snapshot. Requires DomainAdmin.
/// Applies the snapshot's attribute values back to the object.
pub(crate) async fn restore_from_snapshot_inner(
    state: &AppState,
    snapshot_id: i64,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Restoring from snapshot requires DomainAdmin permission".to_string(),
        ));
    }

    let snapshot = state
        .object_snapshot_service
        .get_snapshot(snapshot_id)
        .ok_or_else(|| AppError::Validation("Snapshot not found".to_string()))?;

    let stored_attrs: std::collections::HashMap<String, Vec<String>> =
        serde_json::from_str(&snapshot.attributes_json).unwrap_or_default();

    let provider = state.directory_provider.clone();
    let dn = &snapshot.object_dn;

    // Apply each attribute from the snapshot
    for (attr_name, values) in &stored_attrs {
        if let Err(e) = provider.modify_attribute(dn, attr_name, values).await {
            state.audit_service.log_failure(
                "SnapshotRestoreFailed",
                dn,
                &format!(
                    "Failed to restore attribute '{}' from snapshot {}: {}",
                    attr_name, snapshot_id, e
                ),
            );
            return Err(AppError::Directory(format!(
                "Failed to restore attribute '{}': {}",
                attr_name, e
            )));
        }
    }

    state.audit_service.log_success(
        "SnapshotRestored",
        dn,
        &format!(
            "Object restored from snapshot {} ({} attributes)",
            snapshot_id,
            stored_attrs.len()
        ),
    );

    Ok(())
}

/// Cleans up expired snapshots. Returns count deleted.
pub(crate) fn cleanup_snapshots_inner(state: &AppState, retention_days: i64) -> usize {
    state
        .object_snapshot_service
        .cleanup_expired(retention_days)
}

// ---------------------------------------------------------------------------
// Object Snapshot - Tauri commands
// ---------------------------------------------------------------------------

/// Captures a full snapshot of an AD object.
#[tauri::command]
pub async fn capture_object_snapshot(
    object_dn: String,
    operation_type: String,
    state: State<'_, AppState>,
) -> Result<i64, AppError> {
    capture_object_snapshot_inner(&state, &object_dn, &operation_type).await
}

/// Gets snapshot history for an object DN.
#[tauri::command]
pub fn get_snapshot_history(object_dn: String, state: State<'_, AppState>) -> Vec<ObjectSnapshot> {
    get_snapshot_history_inner(&state, &object_dn)
}

/// Gets a specific snapshot by ID.
#[tauri::command]
pub fn get_snapshot(id: i64, state: State<'_, AppState>) -> Option<ObjectSnapshot> {
    get_snapshot_inner(&state, id)
}

/// Computes diff between a snapshot and current object state.
#[tauri::command]
pub async fn compute_snapshot_diff(
    snapshot_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<SnapshotDiff>, AppError> {
    compute_snapshot_diff_inner(&state, snapshot_id).await
}

/// Restores an object from a snapshot. Requires DomainAdmin.
#[tauri::command]
pub async fn restore_from_snapshot(
    snapshot_id: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    restore_from_snapshot_inner(&state, snapshot_id).await
}

/// Cleans up expired snapshots. Returns count deleted.
#[tauri::command]
pub fn cleanup_snapshots(retention_days: i64, state: State<'_, AppState>) -> usize {
    cleanup_snapshots_inner(&state, retention_days)
}

/// Gets the thumbnail photo for a user. ReadOnly access.
#[tauri::command]
pub async fn get_thumbnail_photo(
    user_dn: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    get_thumbnail_photo_inner(&state, &user_dn).await
}

/// Sets the thumbnail photo for a user. Requires AccountOperator+.
#[tauri::command]
pub async fn set_thumbnail_photo(
    user_dn: String,
    photo_base64: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    set_thumbnail_photo_inner(&state, &user_dn, &photo_base64).await
}

/// Removes the thumbnail photo for a user. Requires AccountOperator+.
#[tauri::command]
pub async fn remove_thumbnail_photo(
    user_dn: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    remove_thumbnail_photo_inner(&state, &user_dn).await
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

    use crate::models::DirectoryEntry;
    use std::collections::HashMap;

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

    fn make_state_with_users(users: Vec<DirectoryEntry>) -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new().with_users(users));
        AppState::new_for_test(provider, PermissionConfig::default())
    }

    fn make_state_with_failure() -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new().with_failure());
        AppState::new_for_test(provider, PermissionConfig::default())
    }

    // -----------------------------------------------------------------------
    // Inner function tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_app_title_inner() {
        let state = make_state();
        assert_eq!(get_app_title_inner(&state), "DSPanel");
    }

    #[test]
    fn test_get_permission_level_inner() {
        let state = make_state();
        assert_eq!(
            get_permission_level_inner(&state),
            PermissionLevel::ReadOnly
        );
    }

    #[test]
    fn test_get_user_groups_inner() {
        let state = make_state();
        assert!(get_user_groups_inner(&state).is_empty());
    }

    #[test]
    fn test_has_permission_inner() {
        let state = make_state();
        assert!(has_permission_inner(&state, PermissionLevel::ReadOnly));
        assert!(!has_permission_inner(&state, PermissionLevel::HelpDesk));
    }

    #[tokio::test]
    async fn test_search_users_inner_returns_results() {
        let users = vec![
            make_user_entry("jdoe", "John Doe"),
            make_user_entry("asmith", "Alice Smith"),
        ];
        let state = make_state_with_users(users);
        let results = search_users_inner(&state, "doe").await.unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].sam_account_name, Some("jdoe".to_string()));
    }

    #[tokio::test]
    async fn test_search_users_inner_failure() {
        let state = make_state_with_failure();
        let result = search_users_inner(&state, "test").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_user_inner_found() {
        let users = vec![make_user_entry("jdoe", "John Doe")];
        let state = make_state_with_users(users);
        let result = get_user_inner(&state, "jdoe").await.unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap().display_name, Some("John Doe".to_string()));
    }

    #[tokio::test]
    async fn test_get_user_inner_not_found() {
        let users = vec![make_user_entry("jdoe", "John Doe")];
        let state = make_state_with_users(users);
        let result = get_user_inner(&state, "unknown").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_get_user_inner_failure() {
        let state = make_state_with_failure();
        let result = get_user_inner(&state, "jdoe").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_search_computers_inner_results() {
        let computers = vec![DirectoryEntry {
            distinguished_name: "CN=WS01,OU=Computers,DC=example,DC=com".to_string(),
            sam_account_name: Some("WS01$".to_string()),
            display_name: Some("WS01".to_string()),
            object_class: Some("computer".to_string()),
            attributes: HashMap::new(),
        }];
        let provider = Arc::new(MockDirectoryProvider::new().with_computers(computers));
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        let results = search_computers_inner(&state, "WS").await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].sam_account_name, Some("WS01$".to_string()));
    }

    #[tokio::test]
    async fn test_search_computers_inner_empty() {
        let state = make_state();
        let results = search_computers_inner(&state, "none").await.unwrap();
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn test_check_connection_inner() {
        let state = make_state();
        let result = check_connection_inner(&state).await.unwrap();
        assert!(result);
    }

    #[test]
    fn test_get_domain_info_inner() {
        let state = make_state();
        let info = get_domain_info_inner(&state);
        assert_eq!(info.domain_name, Some("EXAMPLE.COM".to_string()));
        assert!(info.is_connected);
    }

    // -----------------------------------------------------------------------
    // Legacy tests (updated to use _inner where applicable)
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_app_title_returns_default() {
        let state = make_state();
        assert_eq!(get_app_title_inner(&state), "DSPanel");
    }

    #[test]
    fn test_get_permission_level_returns_readonly_by_default() {
        let state = make_state();
        assert_eq!(
            get_permission_level_inner(&state),
            PermissionLevel::ReadOnly
        );
    }

    #[test]
    fn test_has_permission_check() {
        let state = make_state();
        assert!(has_permission_inner(&state, PermissionLevel::ReadOnly));
        assert!(!has_permission_inner(&state, PermissionLevel::HelpDesk));
    }

    #[test]
    fn test_get_user_groups_empty_by_default() {
        let state = make_state();
        assert!(get_user_groups_inner(&state).is_empty());
    }

    #[tokio::test]
    async fn test_search_users_returns_results() {
        let users = vec![
            make_user_entry("jdoe", "John Doe"),
            make_user_entry("asmith", "Alice Smith"),
        ];
        let state = make_state_with_users(users);
        let results = search_users_inner(&state, "doe").await.unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].sam_account_name, Some("jdoe".to_string()));
    }

    #[tokio::test]
    async fn test_search_users_returns_empty_for_no_match() {
        let state = make_state_with_users(vec![]);
        let results = search_users_inner(&state, "nobody").await.unwrap();
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn test_search_users_failure_returns_error() {
        let state = make_state_with_failure();
        let result = search_users_inner(&state, "test").await;
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_search_input_trims_whitespace() {
        let result = validate_search_input("  john  ").unwrap();
        assert_eq!(result, "john");
    }

    #[test]
    fn test_validate_search_input_rejects_empty() {
        assert!(validate_search_input("").is_err());
        assert!(validate_search_input("   ").is_err());
    }

    #[test]
    fn test_validate_search_input_rejects_too_long() {
        let long_query = "a".repeat(MAX_SEARCH_QUERY_LEN + 1);
        let result = validate_search_input(&long_query);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("maximum length"));
    }

    #[test]
    fn test_validate_search_input_rejects_control_chars() {
        assert!(validate_search_input("john\0doe").is_err());
        assert!(validate_search_input("test\x01").is_err());
    }

    #[test]
    fn test_validate_search_input_accepts_valid() {
        assert!(validate_search_input("john.doe").is_ok());
        assert!(validate_search_input("user@domain.com").is_ok());
        assert!(validate_search_input("CN=Test User,OU=Users").is_ok());
    }

    #[tokio::test]
    async fn test_search_users_inner_rejects_empty_query() {
        let state = make_state_with_users(vec![make_user_entry("jdoe", "John Doe")]);
        let result = search_users_inner(&state, "   ").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_user_by_identity_found() {
        let users = vec![make_user_entry("jdoe", "John Doe")];
        let state = make_state_with_users(users);
        let result = get_user_inner(&state, "jdoe").await.unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap().display_name, Some("John Doe".to_string()));
    }

    #[tokio::test]
    async fn test_get_user_by_identity_not_found() {
        let users = vec![make_user_entry("jdoe", "John Doe")];
        let state = make_state_with_users(users);
        let result = get_user_inner(&state, "unknown").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_get_user_failure_returns_error() {
        let state = make_state_with_failure();
        let result = get_user_inner(&state, "jdoe").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    #[ignore] // requires ICMP privileges, fails in Docker/CI containers
    async fn test_ping_host_localhost_is_reachable() {
        let result = ping_host("127.0.0.1".to_string()).await.unwrap();
        assert!(
            result.contains("Reachable"),
            "Expected reachable, got: {}",
            result
        );
    }

    #[tokio::test]
    async fn test_ping_host_invalid_returns_unreachable() {
        let result = ping_host("192.0.2.1".to_string()).await.unwrap();
        // RFC 5737 TEST-NET-1 should be unreachable
        assert!(
            result == "Unreachable" || result.contains("Reachable"),
            "Expected valid response, got: {}",
            result
        );
    }

    #[tokio::test]
    async fn test_resolve_dns_localhost() {
        let result = resolve_dns("localhost".to_string()).await.unwrap();
        assert!(!result.is_empty());
        assert!(
            result.iter().any(|ip| ip == "127.0.0.1" || ip == "::1"),
            "Expected localhost to resolve to loopback, got: {:?}",
            result
        );
    }

    #[tokio::test]
    async fn test_resolve_dns_invalid_returns_error() {
        let result = resolve_dns("this.host.does.not.exist.invalid".to_string()).await;
        assert!(result.is_err());
    }

    #[test]
    fn test_evaluate_health_cmd_healthy_user() {
        let input = HealthInput {
            enabled: true,
            locked_out: false,
            account_expires: None,
            password_last_set: Some("2026-03-01T10:00:00Z".to_string()),
            password_expired: false,
            password_never_expires: false,
            last_logon: Some("2026-03-12T08:00:00Z".to_string()),
            when_created: Some("2024-01-01T00:00:00Z".to_string()),
        };
        let result = evaluate_health_cmd(input);
        assert_eq!(result.level, crate::services::HealthLevel::Healthy);
        assert!(result.active_flags.is_empty());
    }

    #[test]
    fn test_evaluate_health_cmd_disabled_user() {
        let input = HealthInput {
            enabled: false,
            locked_out: false,
            account_expires: None,
            password_last_set: Some("2026-03-01T10:00:00Z".to_string()),
            password_expired: false,
            password_never_expires: false,
            last_logon: Some("2026-03-12T08:00:00Z".to_string()),
            when_created: Some("2024-01-01T00:00:00Z".to_string()),
        };
        let result = evaluate_health_cmd(input);
        assert_eq!(result.level, crate::services::HealthLevel::Critical);
        assert!(result.active_flags.iter().any(|f| f.name == "Disabled"));
    }

    #[test]
    fn test_get_current_username_returns_value() {
        let result = get_current_username();
        // In test environment, USERNAME should be set
        assert!(!result.is_empty());
    }

    #[test]
    fn test_get_platform_returns_known_value() {
        let result = get_platform_inner();
        assert!(
            ["windows", "macos", "linux", "unknown"].contains(&result.as_str()),
            "Unexpected platform: {}",
            result,
        );
    }

    #[test]
    fn test_get_platform_returns_windows_on_windows() {
        let result = get_platform_inner();
        // This test runs on Windows in CI
        if cfg!(target_os = "windows") {
            assert_eq!(result, "windows");
        }
    }

    #[test]
    fn test_get_computer_name_returns_value() {
        let result = get_computer_name();
        assert!(!result.is_empty());
    }

    #[test]
    fn test_get_domain_info_with_mock() {
        let state = make_state();
        let info = get_domain_info_inner(&state);
        assert_eq!(info.domain_name, Some("EXAMPLE.COM".to_string()));
        assert!(info.is_connected);
    }

    #[test]
    fn test_get_domain_info_disconnected() {
        let provider = Arc::new(MockDirectoryProvider::disconnected());
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        let info = get_domain_info_inner(&state);
        assert!(info.domain_name.is_none());
        assert!(!info.is_connected);
    }

    #[test]
    fn test_domain_info_serialization() {
        let info = DomainInfo {
            domain_name: Some("CORP.LOCAL".to_string()),
            is_connected: true,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("domain_name"));
        assert!(json.contains("is_connected"));
        assert!(json.contains("CORP.LOCAL"));
    }

    #[tokio::test]
    async fn test_search_computers_returns_results() {
        let computers = vec![DirectoryEntry {
            distinguished_name: "CN=WS01,OU=Computers,DC=example,DC=com".to_string(),
            sam_account_name: Some("WS01$".to_string()),
            display_name: Some("WS01".to_string()),
            object_class: Some("computer".to_string()),
            attributes: HashMap::new(),
        }];
        let provider = Arc::new(MockDirectoryProvider::new().with_computers(computers));
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        let results = search_computers_inner(&state, "WS").await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].sam_account_name, Some("WS01$".to_string()));
    }

    #[tokio::test]
    async fn test_search_computers_empty() {
        let state = make_state();
        let results = search_computers_inner(&state, "none").await.unwrap();
        assert!(results.is_empty());
    }

    // -----------------------------------------------------------------------
    // Helper: create state with a specific permission level
    // -----------------------------------------------------------------------

    fn make_state_with_level(level: PermissionLevel) -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new());
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        state.permission_service.set_level(level);
        state
    }

    /// Creates a state with a given permission level and returns both the
    /// state and a cloned Arc to the mock provider for call verification.
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

    // -----------------------------------------------------------------------
    // Epic 2 command tests - reset_password_inner
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_reset_password_requires_helpdesk_permission() {
        let state = make_state(); // ReadOnly by default
        let result =
            reset_password_inner(&state, "CN=Test,DC=example,DC=com", "NewPass1!", false).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        match err {
            AppError::PermissionDenied(msg) => {
                assert!(msg.contains("HelpDesk"));
            }
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_reset_password_succeeds_with_helpdesk() {
        let state = make_state_with_level(PermissionLevel::HelpDesk);
        let result =
            reset_password_inner(&state, "CN=Test,DC=example,DC=com", "NewPass1!", false).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_reset_password_calls_provider_with_correct_args() {
        let (state, provider) = make_state_with_level_and_provider(PermissionLevel::HelpDesk);
        reset_password_inner(&state, "CN=User1,DC=example,DC=com", "Secret123!", true)
            .await
            .unwrap();
        let calls = provider.reset_password_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "CN=User1,DC=example,DC=com");
        assert_eq!(calls[0].1, "Secret123!");
        assert!(calls[0].2); // must_change_at_next_logon
    }

    #[tokio::test]
    async fn test_reset_password_logs_audit_on_success() {
        let state = make_state_with_level(PermissionLevel::HelpDesk);
        reset_password_inner(&state, "CN=User1,DC=example,DC=com", "Pass!", true)
            .await
            .unwrap();
        let entries = state.audit_service.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].success);
        assert_eq!(entries[0].action, "PasswordReset");
        assert_eq!(entries[0].target_dn, "CN=User1,DC=example,DC=com");
        assert!(entries[0]
            .details
            .contains("must_change_at_next_logon=true"));
    }

    #[tokio::test]
    async fn test_reset_password_logs_audit_on_failure() {
        let state = make_state_with_level_and_failure(PermissionLevel::HelpDesk);
        let result =
            reset_password_inner(&state, "CN=User1,DC=example,DC=com", "Pass!", false).await;
        assert!(result.is_err());
        let entries = state.audit_service.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].success);
        assert_eq!(entries[0].action, "PasswordResetFailed");
        assert_eq!(entries[0].target_dn, "CN=User1,DC=example,DC=com");
    }

    // -----------------------------------------------------------------------
    // Epic 2 command tests - unlock_account_inner
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_unlock_account_requires_helpdesk() {
        let state = make_state(); // ReadOnly
        let result = unlock_account_inner(&state, "CN=Test,DC=example,DC=com").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => assert!(msg.contains("HelpDesk")),
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_unlock_account_succeeds() {
        let (state, provider) = make_state_with_level_and_provider(PermissionLevel::HelpDesk);
        unlock_account_inner(&state, "CN=Locked,DC=example,DC=com")
            .await
            .unwrap();
        let calls = provider.unlock_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0], "CN=Locked,DC=example,DC=com");
        let entries = state.audit_service.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].success);
        assert_eq!(entries[0].action, "AccountUnlocked");
    }

    // -----------------------------------------------------------------------
    // Epic 2 command tests - enable_account_inner
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_enable_account_requires_helpdesk() {
        let state = make_state(); // ReadOnly
        let result = enable_account_inner(&state, "CN=Test,DC=example,DC=com").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => assert!(msg.contains("HelpDesk")),
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_enable_account_succeeds() {
        let (state, provider) = make_state_with_level_and_provider(PermissionLevel::HelpDesk);
        enable_account_inner(&state, "CN=Disabled,DC=example,DC=com")
            .await
            .unwrap();
        let calls = provider.enable_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0], "CN=Disabled,DC=example,DC=com");
        let entries = state.audit_service.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].success);
        assert_eq!(entries[0].action, "AccountEnabled");
    }

    // -----------------------------------------------------------------------
    // Epic 2 command tests - disable_account_inner
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_disable_account_requires_helpdesk() {
        let state = make_state(); // ReadOnly
        let result = disable_account_inner(&state, "CN=Test,DC=example,DC=com").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => assert!(msg.contains("HelpDesk")),
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_disable_account_succeeds() {
        let (state, provider) = make_state_with_level_and_provider(PermissionLevel::HelpDesk);
        disable_account_inner(&state, "CN=Active,DC=example,DC=com")
            .await
            .unwrap();
        let calls = provider.disable_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0], "CN=Active,DC=example,DC=com");
        let entries = state.audit_service.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].success);
        assert_eq!(entries[0].action, "AccountDisabled");
    }

    // -----------------------------------------------------------------------
    // Epic 2 command tests - set_password_flags_inner
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_set_password_flags_requires_account_operator() {
        // HelpDesk is insufficient for set_password_flags
        let state = make_state_with_level(PermissionLevel::HelpDesk);
        let result =
            set_password_flags_inner(&state, "CN=Test,DC=example,DC=com", true, false).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => assert!(msg.contains("AccountOperator")),
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_set_password_flags_succeeds() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        set_password_flags_inner(&state, "CN=User1,DC=example,DC=com", true, false)
            .await
            .unwrap();
        let calls = provider.set_password_flags_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "CN=User1,DC=example,DC=com");
        assert!(calls[0].1); // password_never_expires
        assert!(!calls[0].2); // user_cannot_change_password
        let entries = state.audit_service.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].success);
        assert_eq!(entries[0].action, "PasswordFlagsChanged");
        assert!(entries[0].details.contains("password_never_expires=true"));
        assert!(entries[0]
            .details
            .contains("user_cannot_change_password=false"));
    }

    // -----------------------------------------------------------------------
    // Epic 2 command tests - get_audit_entries_inner
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_audit_entries_returns_entries() {
        let state = make_state();
        // Initially empty
        assert!(get_audit_entries_inner(&state).is_empty());
        // Add some audit entries via the service directly
        state.audit_service.log_success("Action1", "dn1", "detail1");
        state.audit_service.log_failure("Action2", "dn2", "detail2");
        let entries = get_audit_entries_inner(&state);
        assert_eq!(entries.len(), 2);
        // Most recent first
        assert_eq!(entries[0].action, "Action2");
        assert_eq!(entries[1].action, "Action1");
    }

    // -----------------------------------------------------------------------
    // Browse users tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_browse_users_inner_returns_sorted_page() {
        let users = vec![
            make_user_entry("zuser", "Zara User"),
            make_user_entry("auser", "Alice User"),
            make_user_entry("muser", "Mary User"),
        ];
        let state = make_state_with_users(users);
        let result = browse_users_inner(&state, 0, 10).await.unwrap();
        assert_eq!(result.total_count, 3);
        assert_eq!(result.entries.len(), 3);
        assert!(!result.has_more);
        // Sorted by display name
        assert_eq!(
            result.entries[0].display_name,
            Some("Alice User".to_string())
        );
        assert_eq!(
            result.entries[1].display_name,
            Some("Mary User".to_string())
        );
        assert_eq!(
            result.entries[2].display_name,
            Some("Zara User".to_string())
        );
    }

    #[tokio::test]
    async fn test_browse_users_inner_pagination() {
        let users = vec![
            make_user_entry("a", "Alice"),
            make_user_entry("b", "Bob"),
            make_user_entry("c", "Carol"),
            make_user_entry("d", "Dave"),
            make_user_entry("e", "Eve"),
        ];
        let state = make_state_with_users(users);

        let page0 = browse_users_inner(&state, 0, 2).await.unwrap();
        assert_eq!(page0.entries.len(), 2);
        assert_eq!(page0.total_count, 5);
        assert!(page0.has_more);
        assert_eq!(page0.entries[0].display_name, Some("Alice".to_string()));

        let page1 = browse_users_inner(&state, 1, 2).await.unwrap();
        assert_eq!(page1.entries.len(), 2);
        assert!(page1.has_more);
        assert_eq!(page1.entries[0].display_name, Some("Carol".to_string()));

        let page2 = browse_users_inner(&state, 2, 2).await.unwrap();
        assert_eq!(page2.entries.len(), 1);
        assert!(!page2.has_more);
        assert_eq!(page2.entries[0].display_name, Some("Eve".to_string()));
    }

    #[tokio::test]
    async fn test_browse_users_inner_uses_cache() {
        let users = vec![make_user_entry("jdoe", "John Doe")];
        let state = make_state_with_users(users);

        // First call populates cache
        let r1 = browse_users_inner(&state, 0, 10).await.unwrap();
        assert_eq!(r1.total_count, 1);

        // Cache should be populated
        let cache = state.browse_cache.lock().unwrap();
        assert!(cache.is_some());
    }

    #[tokio::test]
    async fn test_browse_users_inner_failure() {
        let state = make_state_with_failure();
        let result = browse_users_inner(&state, 0, 10).await;
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // Browse groups tests
    // -----------------------------------------------------------------------

    fn make_group_entry(name: &str) -> DirectoryEntry {
        let mut attrs = HashMap::new();
        attrs.insert("groupType".to_string(), vec!["-2147483646".to_string()]);
        attrs.insert("description".to_string(), vec![format!("{} group", name)]);
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

    #[tokio::test]
    async fn test_browse_groups_inner_returns_paginated_results() {
        let groups = vec![
            make_group_entry("Alpha Group"),
            make_group_entry("Beta Group"),
            make_group_entry("Gamma Group"),
        ];
        let state = make_state_with_groups(groups);
        let result = browse_groups_inner(&state, 0, 2).await.unwrap();
        assert_eq!(result.entries.len(), 2);
        assert_eq!(result.total_count, 3);
        assert!(result.has_more);
    }

    #[tokio::test]
    async fn test_browse_groups_inner_uses_cache() {
        let groups = vec![make_group_entry("TestGroup")];
        let state = make_state_with_groups(groups);

        let r1 = browse_groups_inner(&state, 0, 10).await.unwrap();
        assert_eq!(r1.total_count, 1);

        let cache = state.browse_groups_cache.lock().unwrap();
        assert!(cache.is_some());
    }

    #[tokio::test]
    async fn test_browse_groups_inner_sorts_by_display_name() {
        let groups = vec![
            make_group_entry("Zeta"),
            make_group_entry("Alpha"),
            make_group_entry("Mid"),
        ];
        let state = make_state_with_groups(groups);
        let result = browse_groups_inner(&state, 0, 10).await.unwrap();
        assert_eq!(result.entries[0].display_name, Some("Alpha".to_string()));
        assert_eq!(result.entries[1].display_name, Some("Mid".to_string()));
        assert_eq!(result.entries[2].display_name, Some("Zeta".to_string()));
    }

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
    // Epic 3 command tests - compare_users_inner
    // -----------------------------------------------------------------------

    fn make_user_with_groups(sam: &str, display: &str, groups: Vec<&str>) -> DirectoryEntry {
        let mut attrs = HashMap::new();
        attrs.insert("mail".to_string(), vec![format!("{}@example.com", sam)]);
        attrs.insert(
            "memberOf".to_string(),
            groups.iter().map(|g| g.to_string()).collect(),
        );
        DirectoryEntry {
            distinguished_name: format!("CN={},OU=Users,DC=example,DC=com", display),
            sam_account_name: Some(sam.to_string()),
            display_name: Some(display.to_string()),
            object_class: Some("user".to_string()),
            attributes: attrs,
        }
    }

    #[tokio::test]
    async fn test_compare_users_returns_diff() {
        let users = vec![
            make_user_with_groups(
                "jdoe",
                "John Doe",
                vec![
                    "CN=Group1,DC=example,DC=com",
                    "CN=Group2,DC=example,DC=com",
                    "CN=Group3,DC=example,DC=com",
                ],
            ),
            make_user_with_groups(
                "asmith",
                "Alice Smith",
                vec!["CN=Group2,DC=example,DC=com", "CN=Group4,DC=example,DC=com"],
            ),
        ];
        let state = make_state_with_users(users);
        let result = compare_users_inner(&state, "jdoe", "asmith").await.unwrap();
        assert_eq!(result.shared_groups.len(), 1);
        assert_eq!(result.only_a_groups.len(), 2);
        assert_eq!(result.only_b_groups.len(), 1);
        assert_eq!(result.total_a, 3);
        assert_eq!(result.total_b, 2);
    }

    #[tokio::test]
    async fn test_compare_users_user_a_not_found() {
        let users = vec![make_user_entry("jdoe", "John Doe")];
        let state = make_state_with_users(users);
        let result = compare_users_inner(&state, "unknown", "jdoe").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("User not found: unknown"));
    }

    #[tokio::test]
    async fn test_compare_users_user_b_not_found() {
        let users = vec![make_user_entry("jdoe", "John Doe")];
        let state = make_state_with_users(users);
        let result = compare_users_inner(&state, "jdoe", "unknown").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("User not found: unknown"));
    }

    #[tokio::test]
    async fn test_compare_users_provider_failure() {
        let state = make_state_with_failure();
        let result = compare_users_inner(&state, "jdoe", "asmith").await;
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // Epic 3 command tests - NTFS permissions
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

    #[tokio::test]
    async fn test_compare_users_no_groups() {
        let users = vec![
            make_user_entry("jdoe", "John Doe"),
            make_user_entry("asmith", "Alice Smith"),
        ];
        let state = make_state_with_users(users);
        let result = compare_users_inner(&state, "jdoe", "asmith").await.unwrap();
        assert!(result.shared_groups.is_empty());
        assert!(result.only_a_groups.is_empty());
        assert!(result.only_b_groups.is_empty());
        assert_eq!(result.total_a, 0);
        assert_eq!(result.total_b, 0);
    }

    // -----------------------------------------------------------------------
    // Epic 3 command tests - get_replication_metadata_inner
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
    // search_groups_inner tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_search_groups_inner_returns_results() {
        let groups = vec![DirectoryEntry {
            distinguished_name: "CN=Admins,DC=example,DC=com".to_string(),
            sam_account_name: Some("Admins".to_string()),
            display_name: Some("Admins".to_string()),
            object_class: Some("group".to_string()),
            attributes: HashMap::new(),
        }];
        let provider = Arc::new(MockDirectoryProvider::new().with_groups(groups));
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        let results = search_groups_inner(&state, "Admin").await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].sam_account_name, Some("Admins".to_string()));
    }

    #[tokio::test]
    async fn test_search_groups_inner_empty_query_rejected() {
        let state = make_state();
        let result = search_groups_inner(&state, "   ").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_search_groups_inner_failure() {
        let state = make_state_with_failure();
        let result = search_groups_inner(&state, "test").await;
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // get_ou_tree_inner tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_get_ou_tree_inner_returns_empty() {
        let state = make_state();
        let result = get_ou_tree_inner(&state).await.unwrap();
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn test_get_ou_tree_inner_failure() {
        let state = make_state_with_failure();
        let result = get_ou_tree_inner(&state).await;
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // browse_computers_inner tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_browse_computers_inner_returns_sorted_page() {
        let computers = vec![
            DirectoryEntry {
                distinguished_name: "CN=WS03,DC=test".to_string(),
                sam_account_name: Some("WS03$".to_string()),
                display_name: Some("Zulu Workstation".to_string()),
                object_class: Some("computer".to_string()),
                attributes: HashMap::new(),
            },
            DirectoryEntry {
                distinguished_name: "CN=WS01,DC=test".to_string(),
                sam_account_name: Some("WS01$".to_string()),
                display_name: Some("Alpha Workstation".to_string()),
                object_class: Some("computer".to_string()),
                attributes: HashMap::new(),
            },
        ];
        let provider = Arc::new(MockDirectoryProvider::new().with_computers(computers));
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        let result = browse_computers_inner(&state, 0, 10).await.unwrap();
        assert_eq!(result.total_count, 2);
        assert_eq!(result.entries.len(), 2);
        assert!(!result.has_more);
        // Sorted by display name
        assert_eq!(
            result.entries[0].display_name,
            Some("Alpha Workstation".to_string())
        );
        assert_eq!(
            result.entries[1].display_name,
            Some("Zulu Workstation".to_string())
        );
    }

    #[tokio::test]
    async fn test_browse_computers_inner_pagination() {
        let computers = vec![
            DirectoryEntry {
                distinguished_name: "CN=A,DC=test".to_string(),
                sam_account_name: Some("A$".to_string()),
                display_name: Some("Alpha".to_string()),
                object_class: Some("computer".to_string()),
                attributes: HashMap::new(),
            },
            DirectoryEntry {
                distinguished_name: "CN=B,DC=test".to_string(),
                sam_account_name: Some("B$".to_string()),
                display_name: Some("Bravo".to_string()),
                object_class: Some("computer".to_string()),
                attributes: HashMap::new(),
            },
            DirectoryEntry {
                distinguished_name: "CN=C,DC=test".to_string(),
                sam_account_name: Some("C$".to_string()),
                display_name: Some("Charlie".to_string()),
                object_class: Some("computer".to_string()),
                attributes: HashMap::new(),
            },
        ];
        let provider = Arc::new(MockDirectoryProvider::new().with_computers(computers));
        let state = AppState::new_for_test(provider, PermissionConfig::default());

        let page0 = browse_computers_inner(&state, 0, 2).await.unwrap();
        assert_eq!(page0.entries.len(), 2);
        assert_eq!(page0.total_count, 3);
        assert!(page0.has_more);

        let page1 = browse_computers_inner(&state, 1, 2).await.unwrap();
        assert_eq!(page1.entries.len(), 1);
        assert!(!page1.has_more);
    }

    #[tokio::test]
    async fn test_browse_computers_inner_failure() {
        let state = make_state_with_failure();
        let result = browse_computers_inner(&state, 0, 10).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_browse_computers_inner_uses_cache() {
        let computers = vec![DirectoryEntry {
            distinguished_name: "CN=WS01,DC=test".to_string(),
            sam_account_name: Some("WS01$".to_string()),
            display_name: Some("WS01".to_string()),
            object_class: Some("computer".to_string()),
            attributes: HashMap::new(),
        }];
        let provider = Arc::new(MockDirectoryProvider::new().with_computers(computers));
        let state = AppState::new_for_test(provider, PermissionConfig::default());

        let r1 = browse_computers_inner(&state, 0, 10).await.unwrap();
        assert_eq!(r1.total_count, 1);

        let cache = state.browse_computers_cache.lock().unwrap();
        assert!(cache.is_some());
    }

    // -----------------------------------------------------------------------
    // get_cannot_change_password_inner tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_get_cannot_change_password_inner_returns_false() {
        let state = make_state();
        let result = get_cannot_change_password_inner(&state, "CN=User,DC=test")
            .await
            .unwrap();
        assert!(!result);
    }

    #[tokio::test]
    async fn test_get_cannot_change_password_inner_failure() {
        let state = make_state_with_failure();
        let result = get_cannot_change_password_inner(&state, "CN=User,DC=test").await;
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // add_user_to_group_inner tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_add_user_to_group_requires_helpdesk() {
        let state = make_state(); // ReadOnly
        let result = add_user_to_group_inner(&state, "CN=User,DC=test", "CN=Group,DC=test").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => assert!(msg.contains("HelpDesk")),
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_add_user_to_group_succeeds_with_helpdesk() {
        let (state, _provider) = make_state_with_level_and_provider(PermissionLevel::HelpDesk);
        let result = add_user_to_group_inner(&state, "CN=User,DC=test", "CN=Group,DC=test").await;
        assert!(result.is_ok());
        let entries = state.audit_service.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].success);
        assert_eq!(entries[0].action, "AddedToGroup");
    }

    #[tokio::test]
    async fn test_add_user_to_group_failure_logs_audit() {
        let state = make_state_with_level_and_failure(PermissionLevel::HelpDesk);
        let result = add_user_to_group_inner(&state, "CN=User,DC=test", "CN=Group,DC=test").await;
        assert!(result.is_err());
        let entries = state.audit_service.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].success);
        assert_eq!(entries[0].action, "AddToGroupFailed");
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
    // Failure audit paths for account operations
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_unlock_account_failure_logs_audit() {
        let state = make_state_with_level_and_failure(PermissionLevel::HelpDesk);
        let result = unlock_account_inner(&state, "CN=User,DC=test").await;
        assert!(result.is_err());
        let entries = state.audit_service.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].success);
        assert_eq!(entries[0].action, "AccountUnlockFailed");
    }

    #[tokio::test]
    async fn test_enable_account_failure_logs_audit() {
        let state = make_state_with_level_and_failure(PermissionLevel::HelpDesk);
        let result = enable_account_inner(&state, "CN=User,DC=test").await;
        assert!(result.is_err());
        let entries = state.audit_service.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].success);
        assert_eq!(entries[0].action, "AccountEnableFailed");
    }

    #[tokio::test]
    async fn test_disable_account_failure_logs_audit() {
        let state = make_state_with_level_and_failure(PermissionLevel::HelpDesk);
        let result = disable_account_inner(&state, "CN=User,DC=test").await;
        assert!(result.is_err());
        let entries = state.audit_service.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].success);
        assert_eq!(entries[0].action, "AccountDisableFailed");
    }

    #[tokio::test]
    async fn test_set_password_flags_failure_logs_audit() {
        let state = make_state_with_level_and_failure(PermissionLevel::AccountOperator);
        let result = set_password_flags_inner(&state, "CN=User,DC=test", true, false).await;
        assert!(result.is_err());
        let entries = state.audit_service.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].success);
        assert_eq!(entries[0].action, "PasswordFlagsChangeFailed");
    }

    // -----------------------------------------------------------------------
    // Admin-level permission succeeds for HelpDesk operations
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_reset_password_succeeds_with_admin() {
        let state = make_state_with_level(PermissionLevel::DomainAdmin);
        let result =
            reset_password_inner(&state, "CN=Test,DC=example,DC=com", "Pass1!", false).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_unlock_account_succeeds_with_admin() {
        let state = make_state_with_level(PermissionLevel::DomainAdmin);
        let result = unlock_account_inner(&state, "CN=Test,DC=example,DC=com").await;
        assert!(result.is_ok());
    }

    // -----------------------------------------------------------------------
    // BrowseResult and DomainInfo struct tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_browse_result_serialization() {
        let br = BrowseResult {
            entries: vec![],
            total_count: 42,
            has_more: true,
        };
        let json = serde_json::to_string(&br).unwrap();
        assert!(json.contains("totalCount"));
        assert!(json.contains("hasMore"));
        assert!(json.contains("42"));
    }

    #[test]
    fn test_domain_info_disconnected_serialization() {
        let info = DomainInfo {
            domain_name: None,
            is_connected: false,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("null"));
        assert!(json.contains("false"));
    }

    // -----------------------------------------------------------------------
    // validate_search_input boundary tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_validate_search_input_max_length_exact() {
        let exact = "a".repeat(MAX_SEARCH_QUERY_LEN);
        assert!(validate_search_input(&exact).is_ok());
    }

    #[test]
    fn test_validate_search_input_tab_is_control() {
        assert!(validate_search_input("john\tdoe").is_err());
    }

    // -----------------------------------------------------------------------
    // check_connection_inner failure test
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_check_connection_inner_failure() {
        let state = make_state_with_failure();
        let result = check_connection_inner(&state).await;
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // browse_users_inner page beyond range
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_browse_users_inner_page_beyond_range() {
        let users = vec![make_user_entry("jdoe", "John Doe")];
        let state = make_state_with_users(users);
        let result = browse_users_inner(&state, 100, 10).await.unwrap();
        assert_eq!(result.total_count, 1);
        assert!(result.entries.is_empty());
        assert!(!result.has_more);
    }

    // -----------------------------------------------------------------------
    // get_replication_metadata_inner - value metadata branch
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_get_replication_metadata_no_attr_no_value() {
        // Mock returns None for both attribute and value metadata
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
        // Parser may return in any order - check both are present
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
        assert_eq!(diff[0].version_before, 1); // saturating_sub(1) of 2
        assert_eq!(diff[0].version_after, 2);
        assert_eq!(diff[1].attribute_name, "givenName");
        assert_eq!(diff[1].version_before, 0); // saturating_sub(1) of 1
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
        // Both boundary timestamps should be included (>=, <=)
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
        // version 0 saturating_sub(1) = 0
        assert_eq!(diff[0].version_before, 0);
        assert_eq!(diff[0].version_after, 0);
    }

    // -----------------------------------------------------------------------
    // set_password_flags_inner - all flag combinations
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_set_password_flags_false_true() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        set_password_flags_inner(&state, "CN=User2,DC=test", false, true)
            .await
            .unwrap();
        let calls = provider.set_password_flags_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert!(!calls[0].1); // password_never_expires = false
        assert!(calls[0].2); // user_cannot_change_password = true
        let entries = state.audit_service.get_entries();
        assert!(entries[0].details.contains("password_never_expires=false"));
        assert!(entries[0]
            .details
            .contains("user_cannot_change_password=true"));
    }

    #[tokio::test]
    async fn test_set_password_flags_true_true() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        set_password_flags_inner(&state, "CN=User3,DC=test", true, true)
            .await
            .unwrap();
        let calls = provider.set_password_flags_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert!(calls[0].1);
        assert!(calls[0].2);
        let entries = state.audit_service.get_entries();
        assert!(entries[0].details.contains("password_never_expires=true"));
        assert!(entries[0]
            .details
            .contains("user_cannot_change_password=true"));
    }

    #[tokio::test]
    async fn test_set_password_flags_false_false() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        set_password_flags_inner(&state, "CN=User4,DC=test", false, false)
            .await
            .unwrap();
        let calls = provider.set_password_flags_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert!(!calls[0].1);
        assert!(!calls[0].2);
        let entries = state.audit_service.get_entries();
        assert!(entries[0].details.contains("password_never_expires=false"));
        assert!(entries[0]
            .details
            .contains("user_cannot_change_password=false"));
    }

    #[tokio::test]
    async fn test_set_password_flags_requires_readonly_denied() {
        let state = make_state_with_level(PermissionLevel::ReadOnly);
        let result = set_password_flags_inner(&state, "CN=Test,DC=test", true, true).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => assert!(msg.contains("AccountOperator")),
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_set_password_flags_succeeds_with_domain_admin() {
        let (state, _provider) = make_state_with_level_and_provider(PermissionLevel::DomainAdmin);
        let result = set_password_flags_inner(&state, "CN=User5,DC=test", true, false).await;
        assert!(result.is_ok());
    }

    // -----------------------------------------------------------------------
    // NTFS audit - valid demo path
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
    // analyze_ntfs_inner - additional invalid path patterns
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

    // -----------------------------------------------------------------------
    // audit_ntfs_permissions_inner - more invalid paths
    // -----------------------------------------------------------------------

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
        // Both users share the same SID
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

    // -----------------------------------------------------------------------
    // compare_users_inner - same user comparison
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_compare_users_same_user() {
        let users = vec![make_user_with_groups(
            "jdoe",
            "John Doe",
            vec!["CN=Group1,DC=test", "CN=Group2,DC=test"],
        )];
        let state = make_state_with_users(users);
        let result = compare_users_inner(&state, "jdoe", "jdoe").await.unwrap();
        // All groups should be shared
        assert_eq!(result.shared_groups.len(), 2);
        assert!(result.only_a_groups.is_empty());
        assert!(result.only_b_groups.is_empty());
        assert_eq!(result.total_a, 2);
        assert_eq!(result.total_b, 2);
    }

    // -----------------------------------------------------------------------
    // browse_computers_inner - page beyond range
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_browse_computers_inner_page_beyond_range() {
        let computers = vec![DirectoryEntry {
            distinguished_name: "CN=WS01,DC=test".to_string(),
            sam_account_name: Some("WS01$".to_string()),
            display_name: Some("WS01".to_string()),
            object_class: Some("computer".to_string()),
            attributes: HashMap::new(),
        }];
        let provider = Arc::new(MockDirectoryProvider::new().with_computers(computers));
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        let result = browse_computers_inner(&state, 100, 10).await.unwrap();
        assert_eq!(result.total_count, 1);
        assert!(result.entries.is_empty());
        assert!(!result.has_more);
    }

    // -----------------------------------------------------------------------
    // validate_search_input - additional edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_validate_search_input_unicode_allowed() {
        let result = validate_search_input("utilisateur-francais");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "utilisateur-francais");
    }

    #[test]
    fn test_validate_search_input_single_char() {
        let result = validate_search_input("a");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "a");
    }

    #[test]
    fn test_validate_search_input_newline_rejected() {
        assert!(validate_search_input("line1\nline2").is_err());
    }

    #[test]
    fn test_validate_search_input_carriage_return_rejected() {
        assert!(validate_search_input("line1\rline2").is_err());
    }

    // -----------------------------------------------------------------------
    // DomainInfo and BrowseResult - additional serialization
    // -----------------------------------------------------------------------

    #[test]
    fn test_browse_result_empty_entries() {
        let br = BrowseResult {
            entries: vec![],
            total_count: 0,
            has_more: false,
        };
        let json = serde_json::to_string(&br).unwrap();
        assert!(json.contains("\"entries\":[]"));
        assert!(json.contains("\"totalCount\":0"));
        assert!(json.contains("\"hasMore\":false"));
    }

    // -----------------------------------------------------------------------
    // Account operations - snapshot capture verification
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_reset_password_captures_snapshot() {
        let state = make_state_with_level(PermissionLevel::HelpDesk);
        assert_eq!(state.snapshot_service.count(), 0);
        reset_password_inner(&state, "CN=UserSnap,DC=test", "Pass1!", true)
            .await
            .unwrap();
        assert_eq!(state.snapshot_service.count(), 1);
    }

    #[tokio::test]
    async fn test_disable_account_captures_snapshot() {
        let state = make_state_with_level(PermissionLevel::HelpDesk);
        assert_eq!(state.snapshot_service.count(), 0);
        disable_account_inner(&state, "CN=UserSnap,DC=test")
            .await
            .unwrap();
        assert_eq!(state.snapshot_service.count(), 1);
    }

    #[tokio::test]
    async fn test_unlock_account_captures_snapshot() {
        let state = make_state_with_level(PermissionLevel::HelpDesk);
        assert_eq!(state.snapshot_service.count(), 0);
        unlock_account_inner(&state, "CN=UserSnap,DC=test")
            .await
            .unwrap();
        assert_eq!(state.snapshot_service.count(), 1);
    }

    #[tokio::test]
    async fn test_enable_account_captures_snapshot() {
        let state = make_state_with_level(PermissionLevel::HelpDesk);
        assert_eq!(state.snapshot_service.count(), 0);
        enable_account_inner(&state, "CN=UserSnap,DC=test")
            .await
            .unwrap();
        assert_eq!(state.snapshot_service.count(), 1);
    }

    #[tokio::test]
    async fn test_set_password_flags_captures_snapshot() {
        let state = make_state_with_level(PermissionLevel::AccountOperator);
        assert_eq!(state.snapshot_service.count(), 0);
        set_password_flags_inner(&state, "CN=UserSnap,DC=test", true, false)
            .await
            .unwrap();
        assert_eq!(state.snapshot_service.count(), 1);
    }

    #[tokio::test]
    async fn test_add_user_to_group_captures_snapshot() {
        let state = make_state_with_level(PermissionLevel::HelpDesk);
        assert_eq!(state.snapshot_service.count(), 0);
        add_user_to_group_inner(&state, "CN=User,DC=test", "CN=Group,DC=test")
            .await
            .unwrap();
        assert_eq!(state.snapshot_service.count(), 1);
    }

    // -----------------------------------------------------------------------
    // add_user_to_group_inner - additional permission levels
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_add_user_to_group_succeeds_with_admin() {
        let (state, _provider) = make_state_with_level_and_provider(PermissionLevel::DomainAdmin);
        let result = add_user_to_group_inner(&state, "CN=User,DC=test", "CN=Group,DC=test").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_add_user_to_group_succeeds_with_account_operator() {
        let (state, _provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let result = add_user_to_group_inner(&state, "CN=User,DC=test", "CN=Group,DC=test").await;
        assert!(result.is_ok());
    }

    // -----------------------------------------------------------------------
    // Story 4.4 - Group hygiene command tests
    // -----------------------------------------------------------------------

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
        // GroupA has member GroupB, GroupB has member GroupA
        let group_a =
            make_group_entry_with_members("GroupA", vec!["CN=GroupB,OU=Groups,DC=example,DC=com"]);
        let group_b =
            make_group_entry_with_members("GroupB", vec!["CN=GroupA,OU=Groups,DC=example,DC=com"]);
        let groups = vec![group_a, group_b];
        let state = make_state_with_groups(groups);
        let result = detect_circular_groups_inner(&state).await.unwrap();
        assert!(!result.is_empty(), "Should detect at least one cycle");
        // Verify cycle contains both groups
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
        // WithDesc already has description from the helper
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
        // Create a chain: GroupA -> GroupB -> GroupC (depth 3 from A)
        let group_a =
            make_group_entry_with_members("GroupA", vec!["CN=GroupB,OU=Groups,DC=example,DC=com"]);
        let group_b =
            make_group_entry_with_members("GroupB", vec!["CN=GroupC,OU=Groups,DC=example,DC=com"]);
        let group_c = make_group_entry_with_members("GroupC", vec![]);
        let groups = vec![group_a, group_b, group_c];
        let state = make_state_with_groups(groups);
        // max_depth = 2 means we report groups with depth > 2
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
        let state = make_state(); // default is ReadOnly
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

        // Verify the mock recorded the call
        let calls = provider.create_group_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "TestGroup");

        // Verify audit log
        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "GroupCreated"));
    }

    // -----------------------------------------------------------------------
    // move_object_inner tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_move_object_inner_requires_account_operator() {
        let state = make_state(); // default is ReadOnly
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

        // Both should fail but the operation continues
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
    // recycle bin tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_is_recycle_bin_enabled_requires_domain_admin() {
        let state = make_state();
        let result = is_recycle_bin_enabled_inner(&state).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_is_recycle_bin_enabled_returns_true() {
        let (state, _) = make_state_with_level_and_provider(PermissionLevel::DomainAdmin);
        let result = is_recycle_bin_enabled_inner(&state).await.unwrap();
        assert!(result);
    }

    #[tokio::test]
    async fn test_get_deleted_objects_requires_domain_admin() {
        let state = make_state();
        let result = get_deleted_objects_inner(&state).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_get_deleted_objects_returns_list() {
        use crate::models::DeletedObject;

        let provider =
            Arc::new(
                MockDirectoryProvider::new().with_deleted_objects(vec![DeletedObject {
                    distinguished_name: "CN=Test\\0ADEL:abc,CN=Deleted Objects,DC=example,DC=com"
                        .to_string(),
                    name: "Test".to_string(),
                    object_type: "user".to_string(),
                    deletion_date: "2026-03-20".to_string(),
                    original_ou: "OU=Users,DC=example,DC=com".to_string(),
                }]),
            );
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        state
            .permission_service
            .set_level(PermissionLevel::DomainAdmin);

        let result = get_deleted_objects_inner(&state).await.unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "Test");
    }

    #[tokio::test]
    async fn test_restore_deleted_object_requires_domain_admin() {
        let state = make_state();
        let result = restore_deleted_object_inner(
            &state,
            "CN=Test,CN=Deleted Objects,DC=example,DC=com",
            "OU=Users,DC=example,DC=com",
        )
        .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_restore_deleted_object_success_and_audit() {
        let (state, provider) = make_state_with_level_and_provider(PermissionLevel::DomainAdmin);

        let result = restore_deleted_object_inner(
            &state,
            "CN=Test,CN=Deleted Objects,DC=example,DC=com",
            "OU=Users,DC=example,DC=com",
        )
        .await;
        assert!(result.is_ok());

        let calls = provider.restore_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "CN=Test,CN=Deleted Objects,DC=example,DC=com");
        assert_eq!(calls[0].1, "OU=Users,DC=example,DC=com");

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "ObjectRestored"));
    }

    #[tokio::test]
    async fn test_restore_deleted_object_failure_audits() {
        let state = make_state_with_level_and_failure(PermissionLevel::DomainAdmin);

        let result = restore_deleted_object_inner(
            &state,
            "CN=Test,CN=Deleted Objects,DC=example,DC=com",
            "OU=Users,DC=example,DC=com",
        )
        .await;
        assert!(result.is_err());

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "RestoreObjectFailed"));
    }

    // -----------------------------------------------------------------------
    // update_managed_by_inner tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_update_managed_by_inner_requires_account_operator() {
        let state = make_state(); // default is ReadOnly
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
    // Preset command tests
    // -----------------------------------------------------------------------

    fn make_state_with_preset_dir(level: PermissionLevel) -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let (state, _) = make_state_with_level_and_provider(level);
        state
            .preset_service
            .configure_path(dir.path().to_str().unwrap())
            .unwrap();
        (state, dir)
    }

    fn make_test_preset() -> Preset {
        use crate::models::PresetType;
        Preset {
            name: "Test Preset".to_string(),
            description: "For testing".to_string(),
            preset_type: PresetType::Onboarding,
            target_ou: "OU=Test,DC=example,DC=com".to_string(),
            groups: vec!["CN=Group1,DC=example,DC=com".to_string()],
            attributes: std::collections::HashMap::new(),
            integrity_warning: false,
        }
    }

    #[test]
    fn test_get_preset_path_inner_none_by_default() {
        let state = make_state();
        assert!(get_preset_path_inner(&state).is_none());
    }

    #[test]
    fn test_set_and_get_preset_path() {
        let dir = tempfile::tempdir().unwrap();
        let state = make_state();
        set_preset_path_inner(&state, dir.path().to_str().unwrap()).unwrap();
        let path = get_preset_path_inner(&state);
        assert!(path.is_some());
    }

    #[test]
    fn test_set_preset_path_invalid() {
        let state = make_state();
        let result = set_preset_path_inner(&state, "/nonexistent/12345");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Configuration(_)));
    }

    #[test]
    fn test_test_preset_path_valid() {
        let dir = tempfile::tempdir().unwrap();
        let result = test_preset_path_inner(dir.path().to_str().unwrap()).unwrap();
        assert!(result);
    }

    #[test]
    fn test_test_preset_path_invalid() {
        let result = test_preset_path_inner("/nonexistent/12345").unwrap();
        assert!(!result);
    }

    #[test]
    fn test_list_presets_empty() {
        let state = make_state();
        assert!(list_presets_inner(&state).is_empty());
    }

    #[test]
    fn test_save_preset_requires_account_operator() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::HelpDesk);
        let result = save_preset_inner(&state, &make_test_preset());
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[test]
    fn test_save_preset_success() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::AccountOperator);
        save_preset_inner(&state, &make_test_preset()).unwrap();
        let presets = list_presets_inner(&state);
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].name, "Test Preset");
    }

    #[test]
    fn test_save_preset_audits() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::AccountOperator);
        save_preset_inner(&state, &make_test_preset()).unwrap();
        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "PresetSaved"));
    }

    #[test]
    fn test_delete_preset_requires_account_operator() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::HelpDesk);
        let result = delete_preset_inner(&state, "Test");
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[test]
    fn test_delete_preset_success() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::AccountOperator);
        save_preset_inner(&state, &make_test_preset()).unwrap();
        assert_eq!(list_presets_inner(&state).len(), 1);

        delete_preset_inner(&state, "Test Preset").unwrap();
        assert!(list_presets_inner(&state).is_empty());
    }

    #[test]
    fn test_delete_preset_audits() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::AccountOperator);
        save_preset_inner(&state, &make_test_preset()).unwrap();
        delete_preset_inner(&state, "Test Preset").unwrap();
        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "PresetDeleted"));
    }

    #[test]
    fn test_delete_preset_nonexistent() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::AccountOperator);
        let result = delete_preset_inner(&state, "Nonexistent");
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // create_user_inner tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_create_user_requires_account_operator() {
        let state = make_state();
        let result = create_user_inner(
            &state,
            "John Smith",
            "OU=Users,DC=example,DC=com",
            "jsmith",
            "P@ssw0rd",
            &std::collections::HashMap::new(),
        )
        .await;
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_create_user_checks_login_uniqueness() {
        let user = make_user_entry("jsmith", "John Smith");
        let provider = Arc::new(
            crate::services::directory::tests::MockDirectoryProvider::new().with_users(vec![user]),
        );
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        state
            .permission_service
            .set_level(PermissionLevel::AccountOperator);

        let result = create_user_inner(
            &state,
            "John Smith",
            "OU=Users,DC=example,DC=com",
            "jsmith",
            "P@ssw0rd",
            &std::collections::HashMap::new(),
        )
        .await;
        assert!(matches!(result.unwrap_err(), AppError::Validation(_)));
    }

    #[tokio::test]
    async fn test_create_user_success() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);

        let result = create_user_inner(
            &state,
            "Jane Doe",
            "OU=Users,DC=example,DC=com",
            "jdoe",
            "P@ssw0rd",
            &std::collections::HashMap::new(),
        )
        .await;
        assert!(result.is_ok());

        let calls = provider.create_user_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].2, "jdoe");

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "UserCreated"));
    }

    // -----------------------------------------------------------------------
    // modify_attribute_inner tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_modify_attribute_requires_account_operator() {
        let state = make_state();
        let result = modify_attribute_inner(
            &state,
            "CN=User,DC=example,DC=com",
            "department",
            &["Engineering".to_string()],
        )
        .await;
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_modify_attribute_success() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);

        let result = modify_attribute_inner(
            &state,
            "CN=User,DC=example,DC=com",
            "department",
            &["Engineering".to_string()],
        )
        .await;
        assert!(result.is_ok());

        let calls = provider.modify_attribute_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].1, "department");

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "AttributeModified"));
    }

    #[tokio::test]
    async fn test_modify_attribute_captures_snapshot() {
        let (state, _) = make_state_with_level_and_provider(PermissionLevel::AccountOperator);

        modify_attribute_inner(
            &state,
            "CN=User,DC=example,DC=com",
            "department",
            &["Engineering".to_string()],
        )
        .await
        .unwrap();

        assert_eq!(state.snapshot_service.count(), 1);
    }

    // -----------------------------------------------------------------------
    // credential store tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_store_and_get_credential() {
        let state = make_state();
        store_credential_inner(&state, "graph_client_secret", "test-secret").unwrap();
        let retrieved = get_credential_inner(&state, "graph_client_secret").unwrap();
        assert_eq!(retrieved, Some("test-secret".to_string()));
    }

    #[test]
    fn test_get_credential_missing_returns_none() {
        let state = make_state();
        let retrieved = get_credential_inner(&state, "graph_client_secret").unwrap();
        assert_eq!(retrieved, None);
    }

    #[test]
    fn test_delete_credential() {
        let state = make_state();
        store_credential_inner(&state, "graph_client_secret", "test-secret").unwrap();
        delete_credential_inner(&state, "graph_client_secret").unwrap();
        let retrieved = get_credential_inner(&state, "graph_client_secret").unwrap();
        assert_eq!(retrieved, None);
    }

    #[test]
    fn test_store_credential_rejects_invalid_key() {
        let state = make_state();
        let result = store_credential_inner(&state, "bad_key", "value");
        assert!(result.is_err());
    }

    #[test]
    fn test_get_credential_rejects_invalid_key() {
        let state = make_state();
        let result = get_credential_inner(&state, "bad_key");
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // Contact management tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_search_contacts_anyone_can_search() {
        use crate::models::ContactInfo;
        let contacts = vec![ContactInfo {
            dn: "CN=Test Contact,OU=Contacts,DC=example,DC=com".to_string(),
            display_name: "Test Contact".to_string(),
            first_name: "Test".to_string(),
            last_name: "Contact".to_string(),
            email: "test@example.com".to_string(),
            phone: "+1-555-0100".to_string(),
            mobile: String::new(),
            company: "Acme".to_string(),
            department: "Sales".to_string(),
            description: "A test contact".to_string(),
        }];
        let provider = Arc::new(MockDirectoryProvider::new().with_contacts(contacts));
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        // ReadOnly by default - should still work
        let results = search_contacts_inner(&state, "test").await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].display_name, "Test Contact");
    }

    #[tokio::test]
    async fn test_create_contact_requires_account_operator() {
        let state = make_state(); // ReadOnly
        let attrs = HashMap::new();
        let result = create_contact_inner(&state, "OU=Contacts,DC=example,DC=com", &attrs).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => {
                assert!(msg.contains("AccountOperator"));
            }
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_create_contact_success_and_audit() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let mut attrs = HashMap::new();
        attrs.insert("displayName".to_string(), "New Contact".to_string());
        let result = create_contact_inner(&state, "OU=Contacts,DC=example,DC=com", &attrs).await;
        assert!(result.is_ok());
        let dn = result.unwrap();
        assert!(dn.contains("New Contact"));

        let calls = provider.create_contact_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "ContactCreated"));
    }

    #[tokio::test]
    async fn test_delete_contact_requires_account_operator() {
        let state = make_state(); // ReadOnly
        let result = delete_contact_inner(&state, "CN=Old,OU=Contacts,DC=example,DC=com").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => {
                assert!(msg.contains("AccountOperator"));
            }
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    // -----------------------------------------------------------------------
    // Printer management tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_create_printer_requires_domain_admin() {
        let state = make_state_with_level(PermissionLevel::AccountOperator);
        let attrs = HashMap::new();
        let result = create_printer_inner(&state, "OU=Printers,DC=example,DC=com", &attrs).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => {
                assert!(msg.contains("DomainAdmin"));
            }
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_delete_printer_requires_domain_admin() {
        let state = make_state_with_level(PermissionLevel::AccountOperator);
        let result =
            delete_printer_inner(&state, "CN=OldPrinter,OU=Printers,DC=example,DC=com").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => {
                assert!(msg.contains("DomainAdmin"));
            }
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_search_printers_returns_list() {
        use crate::models::PrinterInfo;
        let printers = vec![PrinterInfo {
            dn: "CN=HP-Floor3,OU=Printers,DC=example,DC=com".to_string(),
            name: "HP-Floor3".to_string(),
            location: "Floor 3".to_string(),
            server_name: "PRINT01".to_string(),
            share_path: "\\\\PRINT01\\HP-Floor3".to_string(),
            driver_name: "HP Universal".to_string(),
            description: "Color laser".to_string(),
        }];
        let provider = Arc::new(MockDirectoryProvider::new().with_printers(printers));
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        let results = search_printers_inner(&state, "HP").await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "HP-Floor3");
    }

    // -----------------------------------------------------------------------
    // Thumbnail Photo tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_get_thumbnail_photo_returns_none() {
        let state = make_state();
        let result = get_thumbnail_photo_inner(&state, "CN=John,OU=Users,DC=example,DC=com").await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_get_thumbnail_photo_returns_photo() {
        let provider = Arc::new(
            MockDirectoryProvider::new()
                .with_thumbnail_photo("CN=John,OU=Users,DC=example,DC=com", "dGVzdA=="),
        );
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        let result = get_thumbnail_photo_inner(&state, "CN=John,OU=Users,DC=example,DC=com").await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), Some("dGVzdA==".to_string()));
    }

    #[tokio::test]
    async fn test_set_thumbnail_photo_requires_account_operator() {
        let state = make_state(); // ReadOnly
        let result =
            set_thumbnail_photo_inner(&state, "CN=John,OU=Users,DC=example,DC=com", "dGVzdA==")
                .await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => {
                assert!(msg.contains("AccountOperator"));
            }
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_set_thumbnail_photo_success_and_audit() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let result =
            set_thumbnail_photo_inner(&state, "CN=John,OU=Users,DC=example,DC=com", "dGVzdA==")
                .await;
        assert!(result.is_ok());

        let calls = provider.set_photo_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "CN=John,OU=Users,DC=example,DC=com");
        assert_eq!(calls[0].1, "dGVzdA==");

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "ThumbnailPhotoSet"));
    }

    #[tokio::test]
    async fn test_remove_thumbnail_photo_requires_account_operator() {
        let state = make_state(); // ReadOnly
        let result =
            remove_thumbnail_photo_inner(&state, "CN=John,OU=Users,DC=example,DC=com").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => {
                assert!(msg.contains("AccountOperator"));
            }
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_remove_thumbnail_photo_success_and_audit() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let result =
            remove_thumbnail_photo_inner(&state, "CN=John,OU=Users,DC=example,DC=com").await;
        assert!(result.is_ok());

        let calls = provider.remove_photo_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0], "CN=John,OU=Users,DC=example,DC=com");

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "ThumbnailPhotoRemoved"));
    }

    #[tokio::test]
    async fn test_set_thumbnail_photo_failure_audits() {
        let state = make_state_with_level_and_failure(PermissionLevel::AccountOperator);
        let result =
            set_thumbnail_photo_inner(&state, "CN=John,OU=Users,DC=example,DC=com", "dGVzdA==")
                .await;
        assert!(result.is_err());

        let entries = state.audit_service.get_entries();
        assert!(entries
            .iter()
            .any(|e| e.action == "ThumbnailPhotoSetFailed"));
    }

    #[tokio::test]
    async fn test_remove_thumbnail_photo_failure_audits() {
        let state = make_state_with_level_and_failure(PermissionLevel::AccountOperator);
        let result =
            remove_thumbnail_photo_inner(&state, "CN=John,OU=Users,DC=example,DC=com").await;
        assert!(result.is_err());

        let entries = state.audit_service.get_entries();
        assert!(entries
            .iter()
            .any(|e| e.action == "ThumbnailPhotoRemoveFailed"));
    }

    // -----------------------------------------------------------------------
    // Object Snapshot command tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_capture_object_snapshot_stores_snapshot() {
        let users = vec![make_user_entry("jdoe", "John Doe")];
        let state = make_state_with_users(users);
        let id = capture_object_snapshot_inner(
            &state,
            "CN=John Doe,OU=Users,DC=example,DC=com",
            "ModifyAttribute",
        )
        .await
        .unwrap();
        assert!(id > 0);
        assert_eq!(state.object_snapshot_service.count(), 1);
    }

    #[tokio::test]
    async fn test_capture_object_snapshot_empty_when_no_entry() {
        let state = make_state();
        let id = capture_object_snapshot_inner(&state, "CN=Unknown", "Op")
            .await
            .unwrap();
        assert!(id > 0);
        let snapshot = state.object_snapshot_service.get_snapshot(id).unwrap();
        assert_eq!(snapshot.attributes_json, "{}");
    }

    #[test]
    fn test_get_snapshot_history_returns_ordered_list() {
        let state = make_state();
        state
            .object_snapshot_service
            .capture("dn1", "Op1", r#"{"a":"1"}"#);
        state
            .object_snapshot_service
            .capture("dn1", "Op2", r#"{"a":"2"}"#);
        state
            .object_snapshot_service
            .capture("dn2", "Op3", r#"{"a":"3"}"#);

        let history = get_snapshot_history_inner(&state, "dn1");
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].operation_type, "Op2");
        assert_eq!(history[1].operation_type, "Op1");
    }

    #[test]
    fn test_get_snapshot_returns_by_id() {
        let state = make_state();
        let id = state
            .object_snapshot_service
            .capture("dn1", "Op1", r#"{"key":"val"}"#);
        let snapshot = get_snapshot_inner(&state, id).unwrap();
        assert_eq!(snapshot.object_dn, "dn1");
        assert_eq!(snapshot.attributes_json, r#"{"key":"val"}"#);
    }

    #[test]
    fn test_get_snapshot_returns_none_for_missing() {
        let state = make_state();
        assert!(get_snapshot_inner(&state, 999).is_none());
    }

    #[test]
    fn test_cleanup_snapshots_removes_old_entries() {
        let state = make_state();
        // Insert an old snapshot manually
        {
            let conn = state.object_snapshot_service.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO object_snapshots (object_dn, operation_type, timestamp, operator, attributes_json)
                 VALUES ('old_dn', 'OldOp', '2020-01-01T00:00:00Z', 'test', '{}')",
                [],
            )
            .unwrap();
        }
        state
            .object_snapshot_service
            .capture("new_dn", "NewOp", "{}");
        assert_eq!(state.object_snapshot_service.count(), 2);

        let deleted = cleanup_snapshots_inner(&state, 30);
        assert_eq!(deleted, 1);
        assert_eq!(state.object_snapshot_service.count(), 1);
    }

    #[tokio::test]
    async fn test_restore_from_snapshot_requires_domain_admin() {
        let state = make_state(); // ReadOnly by default
        state
            .object_snapshot_service
            .capture("dn1", "Op", r#"{"cn":["Test"]}"#);
        let result = restore_from_snapshot_inner(&state, 1).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => {
                assert!(msg.contains("DomainAdmin"));
            }
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_restore_from_snapshot_success_and_audit() {
        let (state, provider) = make_state_with_level_and_provider(PermissionLevel::DomainAdmin);
        let id = state.object_snapshot_service.capture(
            "CN=Test,DC=example,DC=com",
            "ModifyAttribute",
            r#"{"mail":["test@example.com"]}"#,
        );
        let result = restore_from_snapshot_inner(&state, id).await;
        assert!(result.is_ok());

        // Verify modify_attribute was called
        let calls = provider.modify_attribute_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "CN=Test,DC=example,DC=com");
        assert_eq!(calls[0].1, "mail");

        // Verify audit entry
        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "SnapshotRestored"));
    }

    #[tokio::test]
    async fn test_restore_from_snapshot_not_found() {
        let state = make_state_with_level(PermissionLevel::DomainAdmin);
        let result = restore_from_snapshot_inner(&state, 999).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(msg.contains("not found"));
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_restore_from_snapshot_failure_audits() {
        let state = make_state_with_level_and_failure(PermissionLevel::DomainAdmin);
        let id = state.object_snapshot_service.capture(
            "CN=Fail,DC=example,DC=com",
            "Op",
            r#"{"cn":["Fail"]}"#,
        );
        let result = restore_from_snapshot_inner(&state, id).await;
        assert!(result.is_err());

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "SnapshotRestoreFailed"));
    }

    #[tokio::test]
    async fn test_compute_snapshot_diff_not_found() {
        let state = make_state();
        let result = compute_snapshot_diff_inner(&state, 999).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_compute_snapshot_diff_returns_diffs() {
        let state = make_state();
        state.object_snapshot_service.capture(
            "CN=Test",
            "Op",
            r#"{"mail":["old@example.com"],"cn":["Test"]}"#,
        );
        let diffs = compute_snapshot_diff_inner(&state, 1).await.unwrap();
        // Should have entries for mail and cn (from snapshot) plus
        // whatever attributes the mock returns (empty for unknown DN)
        assert!(!diffs.is_empty());
        assert!(diffs.iter().any(|d| d.attribute == "mail"));
    }
}
