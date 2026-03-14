use std::sync::{Arc, Mutex};

use crate::services::{
    AuditService, DirectoryProvider, MfaService, PermissionConfig, PermissionService,
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
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::directory::tests::MockDirectoryProvider;
    use crate::services::PermissionLevel;

    fn make_state() -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new());
        AppState::new(provider, PermissionConfig::default())
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
        let state = AppState::new(provider, PermissionConfig::default());
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
}
