use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use crate::models::DirectoryEntry;
use crate::services::credential_store::CredentialStore;
use crate::services::graph_exchange::GraphExchangeService;
use crate::services::{
    AppSettingsService, AuditService, DirectoryProvider, ForestProvider, MfaService,
    ObjectSnapshotService, PermissionConfig, PermissionService, PresetService, SnapshotService,
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
    /// Directory provider for AD operations, always a `ForestProvider`: a bare
    /// provider is wrapped as a single-partition forest on installation, so
    /// forest-specific commands never need a downcast and never observe a
    /// provider without its forest view. Wrapped in RwLock to allow runtime
    /// replacement (e.g., after login prompt provides credentials).
    pub directory_provider: RwLock<Arc<ForestProvider>>,
    /// Set while a forest promotion runs, so concurrent triggers (login
    /// prompt, connection checks, keepalive) do not stack bind fan-outs.
    pub forest_promotion_in_flight: AtomicBool,
    /// When the last promotion failed, for the retry cooldown.
    pub forest_promotion_failed_at: Mutex<Option<Instant>>,
    /// Whether the app is waiting for simple bind credentials from the user.
    pub needs_credentials: Mutex<bool>,
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
    /// Cache for browse_users: (fetch_time, sorted_entries, truncated). TTL: 60 seconds.
    pub browse_cache: Mutex<Option<(Instant, Vec<DirectoryEntry>, bool)>>,
    /// Cache for browse_computers: (fetch_time, sorted_entries, truncated). TTL: 60 seconds.
    pub browse_computers_cache: Mutex<Option<(Instant, Vec<DirectoryEntry>, bool)>>,
    /// Cache for browse_groups: (fetch_time, sorted_entries, truncated). TTL: 60 seconds.
    pub browse_groups_cache: Mutex<Option<(Instant, Vec<DirectoryEntry>, bool)>>,
    /// Cache for GPO DN -> display name mapping. TTL: 5 minutes.
    pub gpo_name_cache: Mutex<Option<(Instant, std::collections::HashMap<String, String>)>>,
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
            directory_provider: RwLock::new(Arc::new(ForestProvider::single_partition(provider))),
            forest_promotion_in_flight: AtomicBool::new(false),
            forest_promotion_failed_at: Mutex::new(None),
            needs_credentials: Mutex::new(false),
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
            gpo_name_cache: Mutex::new(None),
        }
    }

    /// Returns a cloned Arc to the current directory provider.
    pub fn provider(&self) -> Arc<dyn DirectoryProvider> {
        self.forest()
    }

    /// Replaces the directory provider at runtime (e.g., after login prompt),
    /// wrapped as a single-partition forest. Use `set_forest` once the real
    /// forest has been assembled.
    pub fn set_provider(&self, provider: Arc<dyn DirectoryProvider>) {
        self.set_forest(Arc::new(ForestProvider::single_partition(provider)));
    }

    /// Installs a forest as the active directory provider.
    pub fn set_forest(&self, forest: Arc<ForestProvider>) {
        *self
            .directory_provider
            .write()
            .expect("directory_provider lock poisoned") = forest;
    }

    /// The active `ForestProvider`.
    pub fn forest(&self) -> Arc<ForestProvider> {
        self.directory_provider
            .read()
            .expect("directory_provider lock poisoned")
            .clone()
    }

    /// Installs `promoted` only if `placeholder` is still the active forest,
    /// so a promotion started for a superseded seed (a newer login prompt)
    /// never overwrites the current one. Returns whether it was installed.
    pub fn install_promoted_forest(
        &self,
        placeholder: &Arc<ForestProvider>,
        promoted: Arc<ForestProvider>,
    ) -> bool {
        let mut current = self
            .directory_provider
            .write()
            .expect("directory_provider lock poisoned");
        if Arc::ptr_eq(&current, placeholder) {
            *current = promoted;
            true
        } else {
            false
        }
    }

    /// Cooldown after a failed promotion before the next attempt is accepted,
    /// so a webview looping on connection checks cannot drive back-to-back
    /// partition bind fan-outs.
    pub const FOREST_PROMOTION_RETRY_COOLDOWN: Duration = Duration::from_secs(30);

    /// Claims the promotion slot. Returns false when one is already running
    /// or the last attempt failed less than the cooldown ago.
    pub fn begin_forest_promotion(&self) -> bool {
        let cooling_down = self
            .forest_promotion_failed_at
            .lock()
            .expect("forest_promotion_failed_at lock poisoned")
            .is_some_and(|failed_at| failed_at.elapsed() < Self::FOREST_PROMOTION_RETRY_COOLDOWN);
        if cooling_down {
            return false;
        }
        self.forest_promotion_in_flight
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    /// Records a failed promotion so `begin_forest_promotion` applies the cooldown.
    pub fn note_forest_promotion_failure(&self) {
        *self
            .forest_promotion_failed_at
            .lock()
            .expect("forest_promotion_failed_at lock poisoned") = Some(Instant::now());
    }

    /// Releases the promotion slot claimed by `begin_forest_promotion`.
    pub fn end_forest_promotion(&self) {
        self.forest_promotion_in_flight
            .store(false, Ordering::Release);
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
            directory_provider: RwLock::new(Arc::new(ForestProvider::single_partition(provider))),
            forest_promotion_in_flight: AtomicBool::new(false),
            forest_promotion_failed_at: Mutex::new(None),
            needs_credentials: Mutex::new(false),
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
            gpo_name_cache: Mutex::new(None),
        }
    }
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::PermissionLevel;
    use crate::services::directory::tests::MockDirectoryProvider;

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
        assert!(state.provider().is_connected());
    }

    #[test]
    fn test_app_state_with_disconnected_provider() {
        let provider = Arc::new(MockDirectoryProvider::disconnected());
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        assert!(!state.provider().is_connected());
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
        assert!(
            state
                .permission_service
                .has_permission(PermissionLevel::ReadOnly)
        );
        assert!(
            !state
                .permission_service
                .has_permission(PermissionLevel::HelpDesk)
        );
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
        *state.browse_cache.lock().unwrap() = Some((now, Vec::new(), false));
        assert!(state.browse_cache.lock().unwrap().is_some());
    }

    #[test]
    fn test_app_state_http_client_exists() {
        let state = make_state();
        // Verify the HTTP client was created (no panic)
        let _ = &state.http_client;
    }

    #[test]
    fn forest_promotion_slot_is_single_flight() {
        let state = make_state();
        assert!(state.begin_forest_promotion());
        assert!(!state.begin_forest_promotion());
        state.end_forest_promotion();
        assert!(state.begin_forest_promotion());
        state.end_forest_promotion();
    }

    #[test]
    fn failed_promotion_starts_a_cooldown() {
        let state = make_state();
        state.note_forest_promotion_failure();
        assert!(!state.begin_forest_promotion());
        // Backdate the failure past the cooldown: the slot opens again.
        *state.forest_promotion_failed_at.lock().unwrap() =
            Some(Instant::now() - AppState::FOREST_PROMOTION_RETRY_COOLDOWN * 2);
        assert!(state.begin_forest_promotion());
        state.end_forest_promotion();
    }

    #[test]
    fn promoted_forest_installs_only_over_its_placeholder() {
        let state = make_state();
        let placeholder = state.forest();
        let promoted = Arc::new(ForestProvider::single_partition(Arc::new(
            MockDirectoryProvider::new(),
        )));
        let newer = Arc::new(ForestProvider::single_partition(Arc::new(
            MockDirectoryProvider::new(),
        )));
        state.set_forest(newer.clone());
        assert!(!state.install_promoted_forest(&placeholder, promoted.clone()));
        assert!(Arc::ptr_eq(&state.forest(), &newer));
        assert!(state.install_promoted_forest(&newer, promoted.clone()));
        assert!(Arc::ptr_eq(&state.forest(), &promoted));
    }

    #[test]
    fn bare_provider_is_wrapped_as_a_single_partition_forest() {
        let state = make_state();
        assert!(!state.forest().is_promoted());
        assert!(state.forest().repromote().is_none());
        assert_eq!(state.provider().domain_name(), Some("EXAMPLE.COM"));
    }
}
