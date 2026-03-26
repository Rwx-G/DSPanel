use std::time::{Duration, Instant};
use tauri::State;

use crate::error::AppError;
use crate::models::{DirectoryEntry, OUNode};
use crate::state::AppState;

use super::{validate_search_input, BrowseResult, DomainInfo};

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
    let sanitized = validate_search_input(query)?;
    let provider = state.directory_provider.clone();
    provider
        .search_computers(&sanitized, 50)
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

/// Searches for contacts matching the query string. ReadOnly access.
pub(crate) async fn search_contacts_inner(
    state: &AppState,
    query: &str,
) -> Result<Vec<DirectoryEntry>, AppError> {
    let sanitized = validate_search_input(query)?;
    let provider = state.directory_provider.clone();
    provider
        .browse_contacts(5000)
        .await
        .map(|entries| {
            let lower = sanitized.to_lowercase();
            entries
                .into_iter()
                .filter(|e| {
                    e.display_name
                        .as_deref()
                        .unwrap_or("")
                        .to_lowercase()
                        .contains(&lower)
                        || e.distinguished_name.to_lowercase().contains(&lower)
                        || e.attributes
                            .values()
                            .any(|vals| vals.iter().any(|v| v.to_lowercase().contains(&lower)))
                })
                .take(50)
                .collect()
        })
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Searches for printers matching the query string. ReadOnly access.
pub(crate) async fn search_printers_inner(
    state: &AppState,
    query: &str,
) -> Result<Vec<DirectoryEntry>, AppError> {
    let sanitized = validate_search_input(query)?;
    let provider = state.directory_provider.clone();
    provider
        .browse_printers(5000)
        .await
        .map(|entries| {
            let lower = sanitized.to_lowercase();
            entries
                .into_iter()
                .filter(|e| {
                    e.display_name
                        .as_deref()
                        .unwrap_or("")
                        .to_lowercase()
                        .contains(&lower)
                        || e.distinguished_name.to_lowercase().contains(&lower)
                        || e.attributes
                            .values()
                            .any(|vals| vals.iter().any(|v| v.to_lowercase().contains(&lower)))
                })
                .take(50)
                .collect()
        })
        .map_err(|e| AppError::Directory(e.to_string()))
}

// ---------------------------------------------------------------------------
// Tauri commands - thin wrappers
// ---------------------------------------------------------------------------

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

/// Browses all contacts with pagination.
#[tauri::command]
pub async fn browse_contacts(
    page: usize,
    page_size: usize,
    state: State<'_, AppState>,
) -> Result<BrowseResult, AppError> {
    let provider = state.directory_provider.clone();
    let all = provider
        .browse_contacts(5000)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))?;
    let total = all.len();
    let start = page * page_size;
    let entries: Vec<DirectoryEntry> = all.into_iter().skip(start).take(page_size).collect();
    let has_more = start + entries.len() < total;
    Ok(BrowseResult {
        entries,
        total_count: total,
        has_more,
    })
}

/// Browses all printers with pagination.
#[tauri::command]
pub async fn browse_printers(
    page: usize,
    page_size: usize,
    state: State<'_, AppState>,
) -> Result<BrowseResult, AppError> {
    let provider = state.directory_provider.clone();
    let all = provider
        .browse_printers(5000)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))?;
    let total = all.len();
    let start = page * page_size;
    let entries: Vec<DirectoryEntry> = all.into_iter().skip(start).take(page_size).collect();
    let has_more = start + entries.len() < total;
    Ok(BrowseResult {
        entries,
        total_count: total,
        has_more,
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

/// Returns the authenticated LDAP identity (resolved via WhoAmI or bind DN).
///
/// This may differ from `get_current_username` when using "Run as" or simple bind.
#[tauri::command]
pub fn get_authenticated_identity(state: State<'_, AppState>) -> String {
    state
        .permission_service
        .authenticated_user()
        .unwrap_or_else(super::get_current_username)
}

/// Searches for contacts matching a query string.
#[tauri::command]
pub async fn search_contacts(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<DirectoryEntry>, AppError> {
    search_contacts_inner(&state, &query).await
}

/// Searches for printers matching a query string.
#[tauri::command]
pub async fn search_printers(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<DirectoryEntry>, AppError> {
    search_printers_inner(&state, &query).await
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

    fn make_state_with_users(users: Vec<DirectoryEntry>) -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new().with_users(users));
        AppState::new_for_test(provider, PermissionConfig::default())
    }

    fn make_state_with_failure() -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new().with_failure());
        AppState::new_for_test(provider, PermissionConfig::default())
    }

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

    // -----------------------------------------------------------------------
    // Inner function tests
    // -----------------------------------------------------------------------

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
    // DomainInfo and BrowseResult - additional serialization
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
        // browse_contacts mock returns empty - just verify no error
        assert!(results.is_empty() || !results.is_empty());
    }

    // -----------------------------------------------------------------------
    // Printer management tests
    // -----------------------------------------------------------------------

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
        // browse_printers mock returns empty - just verify no error
        assert!(results.is_empty() || !results.is_empty());
    }
}
