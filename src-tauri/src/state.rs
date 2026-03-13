use std::sync::{Arc, Mutex};

use crate::services::DirectoryProvider;

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
}

impl AppState {
    pub fn new(provider: Arc<dyn DirectoryProvider>) -> Self {
        Self {
            title: Mutex::new("DSPanel".to_string()),
            initialized: Mutex::new(false),
            directory_provider: provider,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::directory::tests::MockDirectoryProvider;

    fn make_state() -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new());
        AppState::new(provider)
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
        let state = AppState::new(provider);
        assert!(!state.directory_provider.is_connected());
    }
}
