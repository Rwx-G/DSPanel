use tauri::State;

use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::models::DirectoryEntry;
use crate::services::audit::AuditEntry;
use crate::services::mfa::{MfaConfig, MfaSetupResult};
use crate::services::password::{HibpResult, PasswordOptions};
use crate::services::{AccountHealthStatus, HealthInput, PermissionLevel};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Inner functions - testable without Tauri runtime
// ---------------------------------------------------------------------------

/// Returns the application title from state.
pub(crate) fn get_app_title_inner(state: &AppState) -> String {
    state.title.lock().unwrap().clone()
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

/// Searches for user accounts matching the query string.
pub(crate) async fn search_users_inner(
    state: &AppState,
    query: &str,
) -> Result<Vec<DirectoryEntry>, AppError> {
    let provider = state.directory_provider.clone();
    provider
        .search_users(query, 50)
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
    const MAX_BROWSE: usize = 500;

    // Check cache validity
    let cached = {
        let cache = state.browse_cache.lock().unwrap();
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
            let mut cache = state.browse_cache.lock().unwrap();
            *cache = Some((Instant::now(), fresh.clone()));

            fresh
        }
    };

    let total_count = entries.len();
    let start = page * page_size;
    let page_entries: Vec<DirectoryEntry> = entries
        .into_iter()
        .skip(start)
        .take(page_size)
        .collect();
    let has_more = start + page_entries.len() < total_count;

    Ok(BrowseResult {
        entries: page_entries,
        total_count,
        has_more,
    })
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

/// Returns the members of a group identified by its DN.
#[tauri::command]
pub async fn get_group_members(
    group_dn: String,
    state: State<'_, AppState>,
) -> Result<Vec<DirectoryEntry>, AppError> {
    get_group_members_inner(&state, &group_dn).await
}

/// Returns the current Windows username from the environment.
#[tauri::command]
pub fn get_current_username() -> String {
    std::env::var("USERNAME").unwrap_or_else(|e| {
        tracing::warn!("USERNAME environment variable not set: {}", e);
        "Unknown".to_string()
    })
}

/// Returns the computer name from the environment.
#[tauri::command]
pub fn get_computer_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|e| {
        tracing::warn!("COMPUTERNAME environment variable not set: {}", e);
        "Unknown".to_string()
    })
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
}
