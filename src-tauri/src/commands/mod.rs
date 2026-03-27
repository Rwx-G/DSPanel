mod account;
mod cleanup;
mod compliance;
mod directory;
mod group;
mod infrastructure;
mod security;
mod storage;

pub use account::*;
pub use cleanup::*;
pub use compliance::*;
pub use directory::*;
pub use group::*;
pub use infrastructure::*;
pub use security::*;
pub use storage::*;

use tauri::State;

use crate::error::AppError;
use crate::models::DirectoryEntry;
use crate::services::PermissionLevel;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Shared helpers used by multiple submodules
// ---------------------------------------------------------------------------

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

/// Captures a snapshot in both the lightweight SnapshotService and the
/// SQLite-backed ObjectSnapshotService. Fetches current attributes from
/// the directory for the full snapshot. Non-blocking: errors are logged
/// but do not prevent the write operation.
async fn capture_snapshot(state: &AppState, object_dn: &str, operation: &str) {
    // Lightweight marker
    state.snapshot_service.capture(object_dn, operation);

    // Resolve the authenticated LDAP user (or fall back to OS username)
    let provider = state.provider();
    let operator = provider
        .authenticated_user()
        .unwrap_or_else(|| std::env::var("USERNAME").unwrap_or_else(|_| "Unknown".to_string()));

    // Fetch current object attributes by extracting CN from DN and searching
    let cn = object_dn
        .split(',')
        .next()
        .and_then(|part| {
            part.strip_prefix("CN=")
                .or_else(|| part.strip_prefix("cn="))
        })
        .unwrap_or("");

    let attrs_json = if !cn.is_empty() {
        // Try user search first, then computer, then group
        let user_result = provider.search_users(cn, 5).await;
        let entry = user_result.ok().and_then(|entries| {
            entries
                .into_iter()
                .find(|e| e.distinguished_name == object_dn)
        });

        if let Some(entry) = entry {
            serde_json::to_string(&entry.attributes).unwrap_or_else(|_| "{}".to_string())
        } else {
            "{}".to_string()
        }
    } else {
        "{}".to_string()
    };

    state
        .object_snapshot_service
        .capture(object_dn, operation, &attrs_json, &operator);
}

// ---------------------------------------------------------------------------
// Shared structs used by multiple submodules
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Core app-level inner functions
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

// ---------------------------------------------------------------------------
// Core app-level Tauri commands
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

/// Returns the platform the application is running on.
#[tauri::command]
pub fn get_platform() -> String {
    get_platform_inner()
}

/// Returns true if the app is using simple bind (explicit credentials).
///
/// In simple bind mode, some OS-level operations (like force replication
/// via repadmin/PowerShell) are not available.
#[tauri::command]
pub fn is_simple_bind() -> bool {
    std::env::var("DSPANEL_LDAP_BIND_DN").is_ok()
}

/// Returns true if the app is waiting for the user to provide credentials.
/// This happens when DSPANEL_LDAP_SERVER and DSPANEL_LDAP_BIND_DN are set
/// but DSPANEL_LDAP_BIND_PASSWORD is not.
#[tauri::command]
pub fn needs_credentials(state: State<'_, AppState>) -> bool {
    *state.needs_credentials.lock().expect("lock poisoned")
}

/// Returns the configured LDAP server and bind DN for display on the login dialog.
#[tauri::command]
pub fn get_bind_info() -> (String, String) {
    let server = std::env::var("DSPANEL_LDAP_SERVER").unwrap_or_default();
    let bind_dn = std::env::var("DSPANEL_LDAP_BIND_DN").unwrap_or_default();
    (server, bind_dn)
}

/// Connects to LDAP using the provided password (completing the simple bind
/// flow when credentials were not fully provided at startup).
///
/// Reads server and bind_dn from environment variables, combines with the
/// user-provided password, creates a new LdapDirectoryProvider, and replaces
/// the current (disconnected) provider.
#[tauri::command]
pub async fn connect_simple_bind(
    password: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    use crate::services::ldap_directory::{LdapDirectoryProvider, LdapTlsConfig};
    use std::sync::Arc;

    let server = std::env::var("DSPANEL_LDAP_SERVER")
        .map_err(|_| AppError::Configuration("DSPANEL_LDAP_SERVER not set".to_string()))?;
    let bind_dn = std::env::var("DSPANEL_LDAP_BIND_DN")
        .map_err(|_| AppError::Configuration("DSPANEL_LDAP_BIND_DN not set".to_string()))?;

    let use_tls = std::env::var("DSPANEL_LDAP_USE_TLS")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);
    let starttls = std::env::var("DSPANEL_LDAP_STARTTLS")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);
    let skip_verify = std::env::var("DSPANEL_LDAP_TLS_SKIP_VERIFY")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);
    let ca_cert_file = std::env::var("DSPANEL_LDAP_CA_CERT").ok();

    let tls_config = LdapTlsConfig {
        enabled: use_tls,
        starttls,
        skip_verify,
        ca_cert_file,
    };

    let provider: Arc<dyn crate::services::DirectoryProvider> = Arc::new(
        LdapDirectoryProvider::new_with_credentials(server, bind_dn, password, tls_config),
    );

    // Test the connection
    match provider.test_connection().await {
        Ok(true) => {
            // Detect permissions
            if let Err(e) = state
                .permission_service
                .detect_permissions(&*provider)
                .await
            {
                tracing::warn!("Permission detection failed after login: {}", e);
            }
            if let Some(ref name) = provider.authenticated_user() {
                state
                    .permission_service
                    .set_authenticated_user(name.clone());
                state.audit_service.set_operator(name.clone());
                tracing::info!(operator = %name, "Authenticated after login prompt");
            }

            // Swap the provider
            state.set_provider(provider);
            *state.needs_credentials.lock().expect("lock poisoned") = false;

            tracing::info!("Simple bind connection established via login prompt");
            Ok(true)
        }
        Ok(false) => {
            tracing::warn!("Simple bind connection test returned false");
            Err(AppError::Network("Connection test failed".to_string()))
        }
        Err(e) => {
            tracing::warn!("Simple bind connection failed: {}", e);
            Err(AppError::Network(format!("Connection failed: {}", e)))
        }
    }
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::PermissionConfig;
    use crate::services::directory::tests::MockDirectoryProvider;
    use std::sync::Arc;

    fn make_state() -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new());
        AppState::new_for_test(provider, PermissionConfig::default())
    }

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

    #[test]
    fn test_get_current_username_returns_value() {
        let result = get_current_username();
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
        if cfg!(target_os = "windows") {
            assert_eq!(result, "windows");
        }
    }

    #[test]
    fn test_get_computer_name_returns_value() {
        let result = get_computer_name();
        assert!(!result.is_empty());
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
}
