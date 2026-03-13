use tauri::State;

use crate::services::PermissionLevel;
use crate::state::AppState;

/// Returns the application title from managed state.
#[tauri::command]
pub fn get_app_title(state: State<'_, AppState>) -> String {
    state.title.lock().unwrap().clone()
}

/// Returns the current user's permission level.
#[tauri::command]
pub fn get_permission_level(state: State<'_, AppState>) -> PermissionLevel {
    state.permission_service.current_level()
}

/// Returns the current user's detected AD group names.
#[tauri::command]
pub fn get_user_groups(state: State<'_, AppState>) -> Vec<String> {
    state.permission_service.user_groups()
}

/// Checks if the current user has the required permission level.
#[tauri::command]
pub fn has_permission(
    state: State<'_, AppState>,
    required: PermissionLevel,
) -> bool {
    state.permission_service.has_permission(required)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::directory::tests::MockDirectoryProvider;
    use crate::services::PermissionConfig;
    use std::sync::Arc;

    fn make_state() -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new());
        AppState::new(provider, PermissionConfig::default())
    }

    #[test]
    fn test_get_app_title_returns_default() {
        let state = make_state();
        let title = state.title.lock().unwrap().clone();
        assert_eq!(title, "DSPanel");
    }

    #[test]
    fn test_get_permission_level_returns_readonly_by_default() {
        let state = make_state();
        assert_eq!(
            state.permission_service.current_level(),
            PermissionLevel::ReadOnly
        );
    }

    #[test]
    fn test_has_permission_check() {
        let state = make_state();
        assert!(state
            .permission_service
            .has_permission(PermissionLevel::ReadOnly));
        assert!(!state
            .permission_service
            .has_permission(PermissionLevel::HelpDesk));
    }

    #[test]
    fn test_get_user_groups_empty_by_default() {
        let state = make_state();
        assert!(state.permission_service.user_groups().is_empty());
    }
}
