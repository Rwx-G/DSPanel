use tauri::State;

use crate::error::AppError;
use crate::models::DirectoryEntry;
use crate::services::audit::{AuditEntry, AuditFilter, AuditQueryResult, ChainVerification};
use crate::services::comparison::GroupComparisonResult;
use crate::services::mfa::{MfaConfig, MfaSetupResult};
use crate::services::password::{HibpResult, PasswordOptions};
use crate::services::{AccountHealthStatus, HealthInput, PermissionLevel};
use crate::state::AppState;

use super::capture_snapshot;

/// Re-detects AD permissions and verifies the required level before a critical write.
/// If re-detection fails or would lower the current level, the existing level is preserved.
async fn require_fresh_permission(
    state: &AppState,
    required: PermissionLevel,
    operation: &str,
) -> Result<(), AppError> {
    let previous_level = state.permission_service.current_level();
    let provider = state.provider();
    match state
        .permission_service
        .detect_permissions(&*provider)
        .await
    {
        Ok(()) => {
            // If re-detection returned a lower level, keep the previous one
            // to avoid false negatives from transient AD query issues
            if state.permission_service.current_level() < previous_level {
                tracing::warn!(
                    "Permission re-detection returned lower level than cached; keeping {:?}",
                    previous_level
                );
                state.permission_service.set_level(previous_level);
            }
        }
        Err(e) => {
            tracing::warn!("Permission re-detection failed before {}: {}", operation, e);
        }
    }
    if !state.permission_service.has_permission(required) {
        return Err(AppError::PermissionDenied(format!(
            "{} requires {:?} permission or higher",
            operation, required
        )));
    }
    Ok(())
}

/// Resets a user's password via the directory provider.
pub(crate) async fn reset_password_inner(
    state: &AppState,
    user_dn: &str,
    new_password: &str,
    must_change_at_next_logon: bool,
) -> Result<(), AppError> {
    require_fresh_permission(state, PermissionLevel::HelpDesk, "Password reset").await?;

    state
        .mfa_service
        .check_mfa_for_action("PasswordReset")
        .map_err(|e| AppError::PermissionDenied(e.to_string()))?;

    capture_snapshot(state, user_dn, "PasswordReset").await;
    let provider = state.provider();
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
    require_fresh_permission(state, PermissionLevel::HelpDesk, "Account unlock").await?;

    capture_snapshot(state, user_dn, "AccountUnlock").await;
    let provider = state.provider();
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
    require_fresh_permission(state, PermissionLevel::HelpDesk, "Account enable").await?;

    capture_snapshot(state, user_dn, "AccountEnable").await;
    let provider = state.provider();
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
    require_fresh_permission(state, PermissionLevel::HelpDesk, "Account disable").await?;

    state
        .mfa_service
        .check_mfa_for_action("AccountDisable")
        .map_err(|e| AppError::PermissionDenied(e.to_string()))?;

    capture_snapshot(state, user_dn, "AccountDisable").await;
    let provider = state.provider();
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
    let provider = state.provider();
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
    require_fresh_permission(
        state,
        PermissionLevel::AccountOperator,
        "Password flag management",
    )
    .await?;

    state
        .mfa_service
        .check_mfa_for_action("PasswordFlagsChange")
        .map_err(|e| AppError::PermissionDenied(e.to_string()))?;

    state
        .snapshot_service
        .capture(user_dn, "PasswordFlagsChange");
    let provider = state.provider();
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
    let provider = state.provider();

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

    capture_snapshot(state, user_dn, "AddToGroup").await;

    let provider = state.provider();
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

    let provider = state.provider();

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

    capture_snapshot(state, container_dn, "CreateUser").await;

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

    capture_snapshot(state, dn, "ModifyAttribute").await;

    let provider = state.provider();
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

/// Clears the PASSWORD_NOT_REQUIRED flag (`userAccountControl & 0x0020`) on a
/// user account (Story 14.4 quick-fix from Epic 14).
///
/// Reads the current `userAccountControl`, clears bit 0x0020, and writes the
/// result back when the value changed. When the bit is already clear, the
/// command returns `Ok(())` early without writing or auditing - operators
/// double-clicking "Fix" within seconds will not produce duplicate audit
/// entries or duplicate LDAP writes.
///
/// Requires `AccountOperator` permission, may require MFA, and captures an
/// object snapshot before the write for rollback.
pub(crate) async fn clear_password_not_required_inner(
    state: &AppState,
    user_dn: &str,
) -> Result<(), AppError> {
    require_fresh_permission(
        state,
        PermissionLevel::AccountOperator,
        "Clear PasswordNotRequired",
    )
    .await?;

    state
        .mfa_service
        .check_mfa_for_action("ClearPasswordNotRequired")
        .map_err(|e| AppError::PermissionDenied(e.to_string()))?;

    capture_snapshot(state, user_dn, "ClearPasswordNotRequired").await;

    let provider = state.provider();
    match provider
        .clear_user_account_control_bits(user_dn, 0x0020)
        .await
    {
        Ok((previous, new)) if previous == new => {
            // Idempotent no-op - the bit was already clear, nothing to audit.
            // The snapshot capture above was wasted; accepted trade-off for
            // simpler code (no extra trait peek round-trip).
            Ok(())
        }
        Ok((previous, new)) => {
            state.audit_service.log_success(
                "ClearedPasswordNotRequired",
                user_dn,
                &format!("uac: 0x{:X} -> 0x{:X}", previous, new),
            );
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "ClearPasswordNotRequiredFailed",
                user_dn,
                &e.to_string(),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Disables Kerberos unconstrained delegation on a computer object by
/// clearing the TRUSTED_FOR_DELEGATION bit (`userAccountControl & 0x80000`)
/// (Story 14.6 quick-fix from Epic 14).
///
/// Reuses the generic `clear_user_account_control_bits` trait method
/// introduced by Story 14.4 - the command needs zero new backend trait
/// surface and inherits the same idempotent-no-op + read-modify-write
/// semantics.
///
/// Requires `Admin` permission (HIGHER bar than the AccountOperator gate
/// used by Stories 14.4 and 14.5: computer delegation changes can break
/// production Kerberos services like SQL Server linked servers, IIS with
/// constrained delegation, etc.). May require MFA.
///
/// The audit action `DisabledUnconstrainedDelegation` is intentionally
/// unique and identifiable - SOC consumers tail or grep for it as a
/// stand-in for a structural Critical-severity field on AuditEntry (the
/// severity field amendment is deferred to a future Epic 11 story).
pub(crate) async fn disable_unconstrained_delegation_inner(
    state: &AppState,
    computer_dn: &str,
) -> Result<(), AppError> {
    require_fresh_permission(
        state,
        PermissionLevel::Admin,
        "Disable unconstrained delegation",
    )
    .await?;

    state
        .mfa_service
        .check_mfa_for_action("DisableUnconstrainedDelegation")
        .map_err(|e| AppError::PermissionDenied(e.to_string()))?;

    capture_snapshot(state, computer_dn, "DisableUnconstrainedDelegation").await;

    let provider = state.provider();
    match provider
        .clear_user_account_control_bits(computer_dn, 0x80000)
        .await
    {
        Ok((previous, new)) if previous == new => {
            // Idempotent no-op - the bit was already clear, nothing to audit.
            // The snapshot capture above was wasted; same accepted trade-off
            // as Story 14.4. Story 14.5 has the no-op-before-snapshot
            // optimization but only because its read happens explicitly in
            // the command layer.
            Ok(())
        }
        Ok((previous, new)) => {
            state.audit_service.log_success(
                "DisabledUnconstrainedDelegation",
                computer_dn,
                &format!("uac: 0x{:X} -> 0x{:X}", previous, new),
            );
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "DisableUnconstrainedDelegationFailed",
                computer_dn,
                &e.to_string(),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Result of a `remove_user_spns` invocation. Lists every SPN that was
/// actually removed, every SPN kept on the user object after the call, and
/// every SPN the operator requested but the system-SPN guard refused to
/// remove. The three lists are sorted alphabetically so the audit chain
/// hash and any UI rendering are deterministic regardless of input order.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveSpnsResult {
    pub removed: Vec<String>,
    pub kept: Vec<String>,
    pub blocked_system: Vec<String>,
}

/// Removes one or more values from a user's `servicePrincipalName` attribute
/// (Story 14.5 quick-fix). System SPNs (HOST/, ldap/, krbtgt/, etc.) are
/// blocked even if requested by the operator - those values would cause a
/// service outage if removed and the policy is enforced server-side as a
/// defense in depth (the dialog also hides them).
///
/// Idempotent no-op: when the requested removals do not change the SPN set
/// (all already absent or all system-blocked), returns Ok without writing
/// or auditing.
///
/// Requires `AccountOperator` permission, may require MFA, and captures an
/// object snapshot before the write for rollback.
pub(crate) async fn remove_user_spns_inner(
    state: &AppState,
    user_dn: &str,
    spns_to_remove: &[String],
) -> Result<RemoveSpnsResult, AppError> {
    require_fresh_permission(state, PermissionLevel::AccountOperator, "Remove user SPNs").await?;

    state
        .mfa_service
        .check_mfa_for_action("RemoveUserSpns")
        .map_err(|e| AppError::PermissionDenied(e.to_string()))?;

    let provider = state.provider();
    let current = match provider.get_user_spns(user_dn).await {
        Ok(spns) => spns,
        Err(e) => {
            // Audit-completeness: a transient AD outage on the read must
            // be visible in the audit trail, not silently propagated as
            // an Err only the IPC caller sees. Tracked as QA-14.5-001.
            state.audit_service.log_failure(
                "RemoveUserSpnsFailed",
                user_dn,
                &format!("get_user_spns: {}", e),
            );
            return Err(AppError::Directory(e.to_string()));
        }
    };

    // Split requested removals: anything in the system list goes into
    // blocked_system; the rest is approved (only if also present in current).
    use std::collections::HashSet;
    let current_set: HashSet<&String> = current.iter().collect();
    let mut approved: Vec<String> = Vec::new();
    let mut blocked_system: Vec<String> = Vec::new();
    for spn in spns_to_remove {
        if crate::services::spn::is_system_spn(spn) {
            blocked_system.push(spn.clone());
        } else if current_set.contains(spn) {
            approved.push(spn.clone());
        }
        // SPN not in current set and not system: silently dropped (already
        // removed - idempotent no-op for that value).
    }

    let approved_set: HashSet<&String> = approved.iter().collect();
    let new_set: Vec<String> = current
        .iter()
        .filter(|s| !approved_set.contains(s))
        .cloned()
        .collect();

    // Sort all result lists alphabetically for deterministic audit chain hash.
    let mut removed_sorted = approved.clone();
    removed_sorted.sort();
    let mut kept_sorted = new_set.clone();
    kept_sorted.sort();
    let mut blocked_sorted = blocked_system.clone();
    blocked_sorted.sort();

    if new_set.len() == current.len() {
        // Idempotent no-op - either nothing requested existed in current,
        // or every requested removal was system-blocked. No state change,
        // no snapshot, no audit entry.
        return Ok(RemoveSpnsResult {
            removed: Vec::new(),
            kept: kept_sorted,
            blocked_system: blocked_sorted,
        });
    }

    capture_snapshot(state, user_dn, "RemoveUserSpns").await;

    match provider
        .modify_attribute(user_dn, "servicePrincipalName", &new_set)
        .await
    {
        Ok(()) => {
            state.audit_service.log_success(
                "RemovedUserSpns",
                user_dn,
                &format!(
                    "removed: [{}]; kept: [{}]; blocked_system: [{}]",
                    removed_sorted.join(", "),
                    kept_sorted.join(", "),
                    blocked_sorted.join(", "),
                ),
            );
            Ok(RemoveSpnsResult {
                removed: removed_sorted,
                kept: kept_sorted,
                blocked_system: blocked_sorted,
            })
        }
        Err(e) => {
            state
                .audit_service
                .log_failure("RemoveUserSpnsFailed", user_dn, &e.to_string());
            Err(AppError::Directory(e.to_string()))
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands - thin wrappers
// ---------------------------------------------------------------------------

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

/// Queries audit log entries with filters and pagination.
#[tauri::command]
pub fn query_audit_log(filter: AuditFilter, state: State<'_, AppState>) -> AuditQueryResult {
    query_audit_log_inner(&state, &filter)
}

pub(crate) fn query_audit_log_inner(state: &AppState, filter: &AuditFilter) -> AuditQueryResult {
    state.audit_service.query_filtered(filter)
}

/// Returns distinct action types from the audit log (for filter dropdown).
#[tauri::command]
pub fn get_audit_action_types(state: State<'_, AppState>) -> Vec<String> {
    get_audit_action_types_inner(&state)
}

pub(crate) fn get_audit_action_types_inner(state: &AppState) -> Vec<String> {
    state.audit_service.distinct_actions()
}

/// Purges audit entries older than the specified number of days.
/// Returns the number of deleted entries. Requires DomainAdmin permission.
#[tauri::command]
pub fn purge_audit_entries(
    retention_days: i64,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    purge_audit_entries_inner(&state, retention_days)
}

pub(crate) fn purge_audit_entries_inner(
    state: &AppState,
    retention_days: i64,
) -> Result<usize, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Audit purge requires DomainAdmin permission".to_string(),
        ));
    }

    let deleted = state.audit_service.purge_older_than(retention_days);
    if deleted > 0 {
        tracing::info!(
            deleted_count = deleted,
            retention_days = retention_days,
            "Audit log: purged old entries"
        );
    }
    Ok(deleted)
}

/// Verifies the hash chain integrity of the audit log.
/// Requires DomainAdmin permission.
#[tauri::command]
pub fn verify_audit_chain(state: State<'_, AppState>) -> Result<ChainVerification, AppError> {
    verify_audit_chain_inner(&state)
}

pub(crate) fn verify_audit_chain_inner(state: &AppState) -> Result<ChainVerification, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Audit chain verification requires DomainAdmin permission".to_string(),
        ));
    }
    Ok(state.audit_service.verify_chain())
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

/// Clears the PASSWORD_NOT_REQUIRED flag (`userAccountControl & 0x0020`) on a
/// user account (Story 14.4 quick-fix). Requires AccountOperator+, may
/// require MFA, captures snapshot, audits.
#[tauri::command]
pub async fn clear_password_not_required(
    user_dn: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    clear_password_not_required_inner(&state, &user_dn).await
}

/// Removes one or more values from a user's `servicePrincipalName` attribute
/// (Story 14.5 quick-fix). System SPNs are blocked even if requested.
/// Requires AccountOperator+, may require MFA, captures snapshot, audits.
#[tauri::command]
pub async fn remove_user_spns(
    user_dn: String,
    spns_to_remove: Vec<String>,
    state: State<'_, AppState>,
) -> Result<RemoveSpnsResult, AppError> {
    remove_user_spns_inner(&state, &user_dn, &spns_to_remove).await
}

/// Disables Kerberos unconstrained delegation on a computer object by
/// clearing the TRUSTED_FOR_DELEGATION bit (`userAccountControl & 0x80000`)
/// (Story 14.6 quick-fix). Requires Admin+, may require MFA, captures
/// snapshot, audits.
#[tauri::command]
pub async fn disable_unconstrained_delegation(
    computer_dn: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    disable_unconstrained_delegation_inner(&state, &computer_dn).await
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::PermissionConfig;
    use crate::services::directory::tests::MockDirectoryProvider;
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

    fn make_state_with_users(users: Vec<DirectoryEntry>) -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new().with_users(users));
        AppState::new_for_test(provider, PermissionConfig::default())
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

    // -----------------------------------------------------------------------
    // reset_password_inner
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
        assert!(
            entries[0]
                .details
                .contains("must_change_at_next_logon=true")
        );
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
    // unlock_account_inner
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
    // enable_account_inner
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
    // disable_account_inner
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
    // set_password_flags_inner
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_set_password_flags_requires_account_operator() {
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
        assert!(
            entries[0]
                .details
                .contains("user_cannot_change_password=false")
        );
    }

    // -----------------------------------------------------------------------
    // get_audit_entries_inner
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_audit_entries_returns_entries() {
        let state = make_state();
        assert!(get_audit_entries_inner(&state).is_empty());
        state.audit_service.log_success("Action1", "dn1", "detail1");
        state.audit_service.log_failure("Action2", "dn2", "detail2");
        let entries = get_audit_entries_inner(&state);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].action, "Action2");
        assert_eq!(entries[1].action, "Action1");
    }

    // -----------------------------------------------------------------------
    // evaluate_health_cmd tests
    // -----------------------------------------------------------------------

    /// Returns an ISO 8601 UTC timestamp `days` days before `now`.
    ///
    /// Used by health tests that hit the real `Utc::now()` through
    /// `evaluate_health_cmd`, so assertions stay stable regardless of when
    /// the suite runs.
    fn days_ago_iso(days: i64) -> String {
        let ts = chrono::Utc::now() - chrono::Duration::days(days);
        ts.format("%Y-%m-%dT%H:%M:%SZ").to_string()
    }

    #[test]
    fn test_evaluate_health_cmd_healthy_user() {
        let input = HealthInput {
            enabled: true,
            locked_out: false,
            account_expires: None,
            // Password set 30 days ago - distinct from when_created, not stale
            password_last_set: Some(days_ago_iso(30)),
            password_expired: false,
            password_never_expires: false,
            // Logon 5 days ago - well under the 30-day Inactive30Days threshold
            last_logon: Some(days_ago_iso(5)),
            // Account created 1 year ago - not recent, not co-created with password
            when_created: Some(days_ago_iso(365)),
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
            password_last_set: Some(days_ago_iso(30)),
            password_expired: false,
            password_never_expires: false,
            last_logon: Some(days_ago_iso(5)),
            when_created: Some(days_ago_iso(365)),
        };
        let result = evaluate_health_cmd(input);
        assert_eq!(result.level, crate::services::HealthLevel::Critical);
        assert!(result.active_flags.iter().any(|f| f.name == "Disabled"));
    }

    // -----------------------------------------------------------------------
    // compare_users_inner
    // -----------------------------------------------------------------------

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

    #[tokio::test]
    async fn test_compare_users_same_user() {
        let users = vec![make_user_with_groups(
            "jdoe",
            "John Doe",
            vec!["CN=Group1,DC=test", "CN=Group2,DC=test"],
        )];
        let state = make_state_with_users(users);
        let result = compare_users_inner(&state, "jdoe", "jdoe").await.unwrap();
        assert_eq!(result.shared_groups.len(), 2);
        assert!(result.only_a_groups.is_empty());
        assert!(result.only_b_groups.is_empty());
        assert_eq!(result.total_a, 2);
        assert_eq!(result.total_b, 2);
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
        assert!(
            entries[0]
                .details
                .contains("user_cannot_change_password=true")
        );
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
        assert!(
            entries[0]
                .details
                .contains("user_cannot_change_password=true")
        );
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
        assert!(
            entries[0]
                .details
                .contains("user_cannot_change_password=false")
        );
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
    // clear_password_not_required_inner (Story 14.4)
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_clear_password_not_required_requires_account_operator() {
        // ReadOnly default
        let state = make_state();
        let result = clear_password_not_required_inner(&state, "CN=User,DC=example,DC=com").await;
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));

        // HelpDesk also denied (gate is AccountOperator+)
        let state = make_state_with_level(PermissionLevel::HelpDesk);
        let result = clear_password_not_required_inner(&state, "CN=User,DC=example,DC=com").await;
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_clear_password_not_required_succeeds_for_account_operator() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let dn = "CN=Alice,DC=example,DC=com";
        // 0x0220 = PASSWORD_NOT_REQUIRED | ACCOUNTDISABLE
        provider.set_user_account_control(dn, 0x0220);

        let result = clear_password_not_required_inner(&state, dn).await;
        assert!(result.is_ok());

        let calls = provider.clear_uac_bits_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        // (dn, mask, previous, new)
        assert_eq!(calls[0], (dn.to_string(), 0x0020, 0x0220, 0x0200));

        let entries = state.audit_service.get_entries();
        let cleared = entries
            .iter()
            .find(|e| e.action == "ClearedPasswordNotRequired")
            .expect("audit entry recorded");
        assert_eq!(cleared.target_dn, dn);
        assert!(cleared.details.contains("0x220"));
        assert!(cleared.details.contains("0x200"));
        assert!(cleared.success);
    }

    #[tokio::test]
    async fn test_clear_password_not_required_succeeds_for_admin() {
        let (state, provider) = make_state_with_level_and_provider(PermissionLevel::Admin);
        let dn = "CN=Alice,DC=example,DC=com";
        provider.set_user_account_control(dn, 0x0020);

        let result = clear_password_not_required_inner(&state, dn).await;
        assert!(result.is_ok());

        let entries = state.audit_service.get_entries();
        assert!(
            entries
                .iter()
                .any(|e| e.action == "ClearedPasswordNotRequired")
        );
    }

    #[tokio::test]
    async fn test_clear_password_not_required_idempotent_no_op() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let dn = "CN=Bob,DC=example,DC=com";
        // ACCOUNTDISABLE only - PASSWORD_NOT_REQUIRED already clear
        provider.set_user_account_control(dn, 0x0200);

        let result = clear_password_not_required_inner(&state, dn).await;
        assert!(result.is_ok(), "idempotent no-op returns Ok");

        let calls = provider.clear_uac_bits_calls.lock().unwrap();
        assert!(calls.is_empty(), "no recorded state-change call on no-op");

        let writes = provider.modify_attribute_calls.lock().unwrap();
        assert!(writes.is_empty(), "no LDAP write on no-op");

        let entries = state.audit_service.get_entries();
        assert!(
            !entries
                .iter()
                .any(|e| e.action == "ClearedPasswordNotRequired"),
            "no audit entry on no-op"
        );
    }

    #[tokio::test]
    async fn test_clear_password_not_required_captures_snapshot() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let dn = "CN=Alice,DC=example,DC=com";
        provider.set_user_account_control(dn, 0x0220);

        clear_password_not_required_inner(&state, dn).await.unwrap();

        assert_eq!(
            state.snapshot_service.count(),
            1,
            "snapshot captured before write"
        );
    }

    #[tokio::test]
    async fn test_clear_password_not_required_audit_on_directory_failure() {
        let provider = Arc::new(MockDirectoryProvider::new().with_failure());
        let provider_ref = Arc::clone(&provider);
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        state
            .permission_service
            .set_level(PermissionLevel::AccountOperator);

        let dn = "CN=Alice,DC=example,DC=com";
        provider_ref.set_user_account_control(dn, 0x0020);

        let result = clear_password_not_required_inner(&state, dn).await;
        assert!(matches!(result.unwrap_err(), AppError::Directory(_)));

        let entries = state.audit_service.get_entries();
        let failed = entries
            .iter()
            .find(|e| e.action == "ClearPasswordNotRequiredFailed")
            .expect("failure audit entry recorded");
        assert!(!failed.success);
    }

    // -----------------------------------------------------------------------
    // remove_user_spns_inner (Story 14.5)
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_remove_user_spns_requires_account_operator() {
        // ReadOnly default
        let state = make_state();
        let result = remove_user_spns_inner(
            &state,
            "CN=User,DC=example,DC=com",
            &["MSSQLSvc/db.corp.local:1433".to_string()],
        )
        .await;
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));

        // HelpDesk also denied
        let state = make_state_with_level(PermissionLevel::HelpDesk);
        let result = remove_user_spns_inner(
            &state,
            "CN=User,DC=example,DC=com",
            &["MSSQLSvc/db.corp.local:1433".to_string()],
        )
        .await;
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_remove_user_spns_succeeds_for_account_operator_single_removal() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let dn = "CN=SvcSql,DC=example,DC=com";
        provider.set_user_spns(
            dn,
            vec![
                "MSSQLSvc/db.corp.local:1433".to_string(),
                "HTTP/web1.corp.local".to_string(),
                "FtpSvc/files.corp.local".to_string(),
            ],
        );

        let result = remove_user_spns_inner(&state, dn, &["HTTP/web1.corp.local".to_string()])
            .await
            .unwrap();

        assert_eq!(result.removed, vec!["HTTP/web1.corp.local"]);
        assert_eq!(
            result.kept,
            vec![
                "FtpSvc/files.corp.local".to_string(),
                "MSSQLSvc/db.corp.local:1433".to_string(),
            ]
        );
        assert!(result.blocked_system.is_empty());

        // Verify the LDAP write happened with the correct new set
        let writes = provider.modify_attribute_calls.lock().unwrap();
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].1, "servicePrincipalName");
        assert_eq!(writes[0].2.len(), 2);
        assert!(writes[0].2.contains(&"FtpSvc/files.corp.local".to_string()));
        assert!(
            writes[0]
                .2
                .contains(&"MSSQLSvc/db.corp.local:1433".to_string())
        );

        // Verify the audit entry shape
        let entries = state.audit_service.get_entries();
        let entry = entries
            .iter()
            .find(|e| e.action == "RemovedUserSpns")
            .expect("audit entry recorded");
        assert_eq!(entry.target_dn, dn);
        assert!(entry.details.contains("HTTP/web1.corp.local"));
        assert!(entry.details.contains("FtpSvc/files.corp.local"));
        assert!(entry.details.contains("MSSQLSvc/db.corp.local:1433"));
        assert!(entry.success);
    }

    #[tokio::test]
    async fn test_remove_user_spns_blocks_system_spns() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let dn = "CN=DC01,DC=example,DC=com";
        provider.set_user_spns(
            dn,
            vec![
                "HOST/dc01.corp.local".to_string(),
                "MSSQLSvc/db.corp.local:1433".to_string(),
            ],
        );

        // Operator requests removal of both - HOST is blocked, MSSQLSvc removed
        let result = remove_user_spns_inner(
            &state,
            dn,
            &[
                "HOST/dc01.corp.local".to_string(),
                "MSSQLSvc/db.corp.local:1433".to_string(),
            ],
        )
        .await
        .unwrap();

        assert_eq!(result.removed, vec!["MSSQLSvc/db.corp.local:1433"]);
        assert_eq!(result.kept, vec!["HOST/dc01.corp.local"]);
        assert_eq!(result.blocked_system, vec!["HOST/dc01.corp.local"]);

        // Audit details mention both removed and blocked
        let entries = state.audit_service.get_entries();
        let entry = entries
            .iter()
            .find(|e| e.action == "RemovedUserSpns")
            .expect("audit entry recorded");
        assert!(
            entry
                .details
                .contains("removed: [MSSQLSvc/db.corp.local:1433]")
        );
        assert!(
            entry
                .details
                .contains("blocked_system: [HOST/dc01.corp.local]")
        );
    }

    #[tokio::test]
    async fn test_remove_user_spns_idempotent_when_spn_not_present() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let dn = "CN=Svc,DC=example,DC=com";
        provider.set_user_spns(dn, vec!["MSSQLSvc/db.corp.local:1433".to_string()]);

        // Request removal of an SPN that the user does not have
        let result = remove_user_spns_inner(&state, dn, &["HTTP/web1.corp.local".to_string()])
            .await
            .unwrap();

        assert!(result.removed.is_empty());
        assert_eq!(result.kept, vec!["MSSQLSvc/db.corp.local:1433"]);
        assert!(result.blocked_system.is_empty());

        // No LDAP write, no audit entry
        let writes = provider.modify_attribute_calls.lock().unwrap();
        assert!(writes.is_empty(), "no LDAP write on idempotent no-op");

        let entries = state.audit_service.get_entries();
        assert!(
            !entries.iter().any(|e| e.action == "RemovedUserSpns"),
            "no audit entry on no-op"
        );
    }

    #[tokio::test]
    async fn test_remove_user_spns_all_system_no_op() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let dn = "CN=DC01,DC=example,DC=com";
        provider.set_user_spns(
            dn,
            vec![
                "HOST/dc01.corp.local".to_string(),
                "ldap/dc01.corp.local".to_string(),
            ],
        );

        // Request removal of only system SPNs - all blocked
        let result = remove_user_spns_inner(
            &state,
            dn,
            &[
                "HOST/dc01.corp.local".to_string(),
                "ldap/dc01.corp.local".to_string(),
            ],
        )
        .await
        .unwrap();

        assert!(result.removed.is_empty());
        assert_eq!(result.blocked_system.len(), 2);

        // No LDAP write, no audit entry
        let writes = provider.modify_attribute_calls.lock().unwrap();
        assert!(writes.is_empty());

        let entries = state.audit_service.get_entries();
        assert!(!entries.iter().any(|e| e.action == "RemovedUserSpns"));
    }

    #[tokio::test]
    async fn test_remove_user_spns_all_removed_writes_empty_set() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let dn = "CN=Svc,DC=example,DC=com";
        provider.set_user_spns(dn, vec!["MSSQLSvc/db.corp.local:1433".to_string()]);

        let result =
            remove_user_spns_inner(&state, dn, &["MSSQLSvc/db.corp.local:1433".to_string()])
                .await
                .unwrap();

        assert_eq!(result.removed, vec!["MSSQLSvc/db.corp.local:1433"]);
        assert!(result.kept.is_empty());

        // modify_attribute called with an empty Vec - LDAP layer turns this
        // into Mod::Replace with empty HashSet, deleting the attribute
        let writes = provider.modify_attribute_calls.lock().unwrap();
        assert_eq!(writes.len(), 1);
        assert!(writes[0].2.is_empty());
    }

    #[tokio::test]
    async fn test_remove_user_spns_captures_snapshot_before_write() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let dn = "CN=Svc,DC=example,DC=com";
        provider.set_user_spns(dn, vec!["MSSQLSvc/db.corp.local:1433".to_string()]);

        remove_user_spns_inner(&state, dn, &["MSSQLSvc/db.corp.local:1433".to_string()])
            .await
            .unwrap();

        assert_eq!(state.snapshot_service.count(), 1);
    }

    #[tokio::test]
    async fn test_remove_user_spns_audit_on_directory_failure() {
        let provider = Arc::new(MockDirectoryProvider::new().with_failure());
        let provider_ref = Arc::clone(&provider);
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        state
            .permission_service
            .set_level(PermissionLevel::AccountOperator);

        let dn = "CN=Svc,DC=example,DC=com";
        provider_ref.set_user_spns(dn, vec!["MSSQLSvc/db.corp.local:1433".to_string()]);

        let result =
            remove_user_spns_inner(&state, dn, &["MSSQLSvc/db.corp.local:1433".to_string()]).await;
        // get_user_spns will fail first since with_failure() short-circuits
        // every method - the resulting error is still AppError::Directory
        assert!(matches!(result.unwrap_err(), AppError::Directory(_)));

        // Audit-completeness (QA-14.5-001): the read failure must be
        // recorded as an audit entry so SOC consumers see transient AD
        // outages, not just IPC callers.
        let entries = state.audit_service.get_entries();
        let failed = entries
            .iter()
            .find(|e| e.action == "RemoveUserSpnsFailed")
            .expect("read-failure audit entry recorded");
        assert!(!failed.success);
        assert_eq!(failed.target_dn, dn);
        assert!(
            failed.details.contains("get_user_spns:"),
            "audit details should identify the failed read phase, got: {}",
            failed.details
        );
    }

    #[tokio::test]
    async fn test_remove_user_spns_audit_details_sorted() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let dn = "CN=Svc,DC=example,DC=com";
        provider.set_user_spns(
            dn,
            vec![
                "ZetaSvc/z.corp.local".to_string(),
                "AlphaSvc/a.corp.local".to_string(),
                "MidSvc/m.corp.local".to_string(),
            ],
        );

        let result = remove_user_spns_inner(
            &state,
            dn,
            // Pass in non-alphabetic order to verify sorting
            &[
                "ZetaSvc/z.corp.local".to_string(),
                "AlphaSvc/a.corp.local".to_string(),
            ],
        )
        .await
        .unwrap();

        // Removed list sorted alphabetically
        assert_eq!(
            result.removed,
            vec!["AlphaSvc/a.corp.local", "ZetaSvc/z.corp.local"]
        );

        // Audit details have the sorted lists
        let entries = state.audit_service.get_entries();
        let entry = entries
            .iter()
            .find(|e| e.action == "RemovedUserSpns")
            .expect("audit entry recorded");
        assert!(
            entry
                .details
                .contains("removed: [AlphaSvc/a.corp.local, ZetaSvc/z.corp.local]")
        );
    }

    // -----------------------------------------------------------------------
    // disable_unconstrained_delegation_inner (Story 14.6)
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_disable_unconstrained_delegation_requires_admin() {
        // ReadOnly default - denied
        let state = make_state();
        let result =
            disable_unconstrained_delegation_inner(&state, "CN=Computer,DC=example,DC=com").await;
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));

        // HelpDesk also denied
        let state = make_state_with_level(PermissionLevel::HelpDesk);
        let result =
            disable_unconstrained_delegation_inner(&state, "CN=Computer,DC=example,DC=com").await;
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));

        // AccountOperator ALSO denied (HIGHER bar than 14.4 / 14.5)
        let state = make_state_with_level(PermissionLevel::AccountOperator);
        let result =
            disable_unconstrained_delegation_inner(&state, "CN=Computer,DC=example,DC=com").await;
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_disable_unconstrained_delegation_succeeds_for_admin() {
        let (state, provider) = make_state_with_level_and_provider(PermissionLevel::Admin);
        let dn = "CN=DC01,OU=Domain Controllers,DC=example,DC=com";
        // 0x80020 = TRUSTED_FOR_DELEGATION | ACCOUNTDISABLE
        provider.set_user_account_control(dn, 0x80020);

        let result = disable_unconstrained_delegation_inner(&state, dn).await;
        assert!(result.is_ok());

        // Verify the trait method recorded the correct mask + before/after
        let calls = provider.clear_uac_bits_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0], (dn.to_string(), 0x80000, 0x80020, 0x00020));

        // Verify the audit entry shape (action name, target_dn, details
        // contain uac before/after)
        let entries = state.audit_service.get_entries();
        let entry = entries
            .iter()
            .find(|e| e.action == "DisabledUnconstrainedDelegation")
            .expect("audit entry recorded");
        assert_eq!(entry.target_dn, dn);
        assert!(entry.details.contains("0x80020"));
        assert!(entry.details.contains("0x20"));
        assert!(entry.success);
    }

    #[tokio::test]
    async fn test_disable_unconstrained_delegation_succeeds_for_domain_admin() {
        let (state, provider) = make_state_with_level_and_provider(PermissionLevel::DomainAdmin);
        let dn = "CN=Server01,OU=Servers,DC=example,DC=com";
        provider.set_user_account_control(dn, 0x80000);

        let result = disable_unconstrained_delegation_inner(&state, dn).await;
        assert!(result.is_ok());

        let entries = state.audit_service.get_entries();
        assert!(
            entries
                .iter()
                .any(|e| e.action == "DisabledUnconstrainedDelegation")
        );
    }

    #[tokio::test]
    async fn test_disable_unconstrained_delegation_idempotent_no_op() {
        let (state, provider) = make_state_with_level_and_provider(PermissionLevel::Admin);
        let dn = "CN=Server01,OU=Servers,DC=example,DC=com";
        // 0x00020 = ACCOUNTDISABLE only - TRUSTED_FOR_DELEGATION already clear
        provider.set_user_account_control(dn, 0x00020);

        let result = disable_unconstrained_delegation_inner(&state, dn).await;
        assert!(result.is_ok(), "idempotent no-op returns Ok");

        let calls = provider.clear_uac_bits_calls.lock().unwrap();
        assert!(calls.is_empty(), "no recorded state-change call on no-op");

        let writes = provider.modify_attribute_calls.lock().unwrap();
        assert!(writes.is_empty(), "no LDAP write on no-op");

        let entries = state.audit_service.get_entries();
        assert!(
            !entries
                .iter()
                .any(|e| e.action == "DisabledUnconstrainedDelegation"),
            "no audit entry on no-op"
        );
    }

    #[tokio::test]
    async fn test_disable_unconstrained_delegation_preserves_unrelated_uac_bits() {
        let (state, provider) = make_state_with_level_and_provider(PermissionLevel::Admin);
        let dn = "CN=DC01,DC=example,DC=com";
        // 0x82020 = TRUSTED_FOR_DELEGATION | DONT_EXPIRE_PASSWORD | ACCOUNTDISABLE | a flag at 0x2000
        // We pick a value with several unrelated bits set to verify mask isolation
        provider.set_user_account_control(dn, 0x82020);

        disable_unconstrained_delegation_inner(&state, dn)
            .await
            .unwrap();

        let calls = provider.clear_uac_bits_calls.lock().unwrap();
        // previous=0x82020, mask=0x80000, new=0x82020 & !0x80000 = 0x02020
        assert_eq!(calls[0].2, 0x82020);
        assert_eq!(calls[0].3, 0x02020, "unrelated bits preserved");
    }

    #[tokio::test]
    async fn test_disable_unconstrained_delegation_captures_snapshot() {
        let (state, provider) = make_state_with_level_and_provider(PermissionLevel::Admin);
        let dn = "CN=DC01,DC=example,DC=com";
        provider.set_user_account_control(dn, 0x80020);

        disable_unconstrained_delegation_inner(&state, dn)
            .await
            .unwrap();

        assert_eq!(
            state.snapshot_service.count(),
            1,
            "snapshot captured before write"
        );
    }

    #[tokio::test]
    async fn test_disable_unconstrained_delegation_audit_on_directory_failure() {
        let provider = Arc::new(MockDirectoryProvider::new().with_failure());
        let provider_ref = Arc::clone(&provider);
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        state.permission_service.set_level(PermissionLevel::Admin);

        let dn = "CN=DC01,DC=example,DC=com";
        provider_ref.set_user_account_control(dn, 0x80000);

        let result = disable_unconstrained_delegation_inner(&state, dn).await;
        assert!(matches!(result.unwrap_err(), AppError::Directory(_)));

        let entries = state.audit_service.get_entries();
        let failed = entries
            .iter()
            .find(|e| e.action == "DisableUnconstrainedDelegationFailed")
            .expect("failure audit entry recorded");
        assert!(!failed.success);
    }
}
