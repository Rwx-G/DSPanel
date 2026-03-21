use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::models::DirectoryEntry;
use crate::services::credential_store::CredentialStore;
use crate::services::graph_exchange::GraphExchangeService;
use crate::services::{
    AppSettingsService, AuditService, DirectoryProvider, MfaService, ObjectSnapshotService,
    PermissionConfig, PermissionService, PresetService, SnapshotService,
};

/// Global application state managed by Tauri.
///
/// This struct is registered via `tauri::Builder::manage()` and accessible
/// from all Tauri commands via `State<'_, AppState>`.
pub struct AppState {
    /// Application display title.
    pub title: Mutex<String>,
    /// Whether the app has completed initialization.
    pub initialized: Mutex<bool>,
    /// Directory provider for AD operations (trait object behind Arc for sharing).
    pub directory_provider: Arc<dyn DirectoryProvider>,
    /// Permission service for checking user authorization levels.
    pub permission_service: PermissionService,
    /// Audit service for logging sensitive operations.
    pub audit_service: AuditService,
    /// MFA service for TOTP verification.
    pub mfa_service: MfaService,
    /// HTTP client for external API calls (HIBP, etc.).
    pub http_client: reqwest::Client,
    /// Snapshot service for capturing object state before modifications.
    pub snapshot_service: SnapshotService,
    /// Object snapshot service for full SQLite-backed attribute snapshots.
    pub object_snapshot_service: ObjectSnapshotService,
    /// Preset service for managing onboarding/offboarding preset files.
    pub preset_service: PresetService,
    /// Application settings service (disabled OU, Graph config, etc.).
    pub app_settings: AppSettingsService,
    /// Graph Exchange service for Exchange Online diagnostics.
    pub graph_exchange: GraphExchangeService,
    /// Credential store for secure OS-native secret storage.
    pub credential_store: Box<dyn CredentialStore>,
    /// Cache for browse_users: (fetch_time, sorted_entries). TTL: 60 seconds.
    pub browse_cache: Mutex<Option<(Instant, Vec<DirectoryEntry>)>>,
    /// Cache for browse_computers: (fetch_time, sorted_entries). TTL: 60 seconds.
    pub browse_computers_cache: Mutex<Option<(Instant, Vec<DirectoryEntry>)>>,
    /// Cache for browse_groups: (fetch_time, sorted_entries). TTL: 60 seconds.
    pub browse_groups_cache: Mutex<Option<(Instant, Vec<DirectoryEntry>)>>,
}

impl AppState {
    pub fn new(provider: Arc<dyn DirectoryProvider>, permission_config: PermissionConfig) -> Self {
        let http_client = reqwest::Client::builder()
            .user_agent(format!("DSPanel/{}", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap_or_default();

        Self {
            title: Mutex::new("DSPanel".to_string()),
            initialized: Mutex::new(false),
            directory_provider: provider,
            permission_service: PermissionService::new(permission_config),
            audit_service: AuditService::new(),
            mfa_service: MfaService::new(),
            http_client,
            snapshot_service: SnapshotService::new(),
            object_snapshot_service: ObjectSnapshotService::new(),
            preset_service: PresetService::new(),
            app_settings: AppSettingsService::new(),
            graph_exchange: GraphExchangeService::new(),
            credential_store: Box::new(
                crate::services::credential_store::KeyringCredentialStore::new(),
            ),
            browse_cache: Mutex::new(None),
            browse_computers_cache: Mutex::new(None),
            browse_groups_cache: Mutex::new(None),
        }
    }

    /// Creates an AppState with in-memory services (no file I/O) for testing.
    #[allow(clippy::unwrap_used)]
    #[cfg(test)]
    pub fn new_for_test(
        provider: Arc<dyn DirectoryProvider>,
        permission_config: PermissionConfig,
    ) -> Self {
        Self {
            title: Mutex::new("DSPanel".to_string()),
            initialized: Mutex::new(false),
            directory_provider: provider,
            permission_service: PermissionService::new(permission_config),
            audit_service: AuditService::new_in_memory(),
            mfa_service: MfaService::new_in_memory(),
            http_client: reqwest::Client::new(),
            snapshot_service: SnapshotService::new(),
            object_snapshot_service: ObjectSnapshotService::new_in_memory(),
            preset_service: PresetService::new(),
            app_settings: AppSettingsService::new(),
            graph_exchange: GraphExchangeService::new(),
            credential_store: Box::new(
                crate::services::credential_store::InMemoryCredentialStore::new(),
            ),
            browse_cache: Mutex::new(None),
            browse_computers_cache: Mutex::new(None),
            browse_groups_cache: Mutex::new(None),
        }
    }
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::directory::tests::MockDirectoryProvider;
    use crate::services::PermissionLevel;

    fn make_state() -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new());
        AppState::new_for_test(provider, PermissionConfig::default())
    }

    #[test]
    fn test_app_state_new_has_correct_defaults() {
        let state = make_state();
        assert_eq!(*state.title.lock().unwrap(), "DSPanel");
        assert!(!*state.initialized.lock().unwrap());
    }

    #[test]
    fn test_app_state_title_is_mutable() {
        let state = make_state();
        *state.title.lock().unwrap() = "Modified Title".to_string();
        assert_eq!(*state.title.lock().unwrap(), "Modified Title");
    }

    #[test]
    fn test_app_state_initialized_is_mutable() {
        let state = make_state();
        *state.initialized.lock().unwrap() = true;
        assert!(*state.initialized.lock().unwrap());
    }

    #[test]
    fn test_app_state_has_directory_provider() {
        let state = make_state();
        assert!(state.directory_provider.is_connected());
    }

    #[test]
    fn test_app_state_with_disconnected_provider() {
        let provider = Arc::new(MockDirectoryProvider::disconnected());
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        assert!(!state.directory_provider.is_connected());
    }

    #[test]
    fn test_app_state_has_permission_service() {
        let state = make_state();
        assert_eq!(
            state.permission_service.current_level(),
            PermissionLevel::ReadOnly
        );
    }

    #[test]
    fn test_app_state_permission_service_has_permission() {
        let state = make_state();
        assert!(state
            .permission_service
            .has_permission(PermissionLevel::ReadOnly));
        assert!(!state
            .permission_service
            .has_permission(PermissionLevel::HelpDesk));
    }

    #[test]
    fn test_app_state_audit_service_works() {
        let state = make_state();
        state.audit_service.log_success("Test", "dn", "test detail");
        assert_eq!(state.audit_service.count(), 1);
    }

    #[test]
    fn test_app_state_mfa_service_not_configured() {
        let state = make_state();
        assert!(!state.mfa_service.is_configured());
    }

    #[test]
    fn test_app_state_snapshot_service_works() {
        let state = make_state();
        state.snapshot_service.capture("dn", "Op");
        assert_eq!(state.snapshot_service.count(), 1);
    }

    #[test]
    fn test_app_state_browse_cache_initially_none() {
        let state = make_state();
        assert!(state.browse_cache.lock().unwrap().is_none());
    }

    #[test]
    fn test_app_state_browse_computers_cache_initially_none() {
        let state = make_state();
        assert!(state.browse_computers_cache.lock().unwrap().is_none());
    }

    #[test]
    fn test_app_state_browse_groups_cache_initially_none() {
        let state = make_state();
        assert!(state.browse_groups_cache.lock().unwrap().is_none());
    }

    #[test]
    fn test_app_state_browse_cache_can_be_set() {
        let state = make_state();
        let now = Instant::now();
        *state.browse_cache.lock().unwrap() = Some((now, Vec::new()));
        assert!(state.browse_cache.lock().unwrap().is_some());
    }

    #[test]
    fn test_app_state_http_client_exists() {
        let state = make_state();
        // Verify the HTTP client was created (no panic)
        let _ = &state.http_client;
    }
}
