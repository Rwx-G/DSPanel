use tauri::State;

use crate::state::AppState;

/// Returns the application title from managed state.
#[tauri::command]
pub fn get_app_title(state: State<'_, AppState>) -> String {
    state.title.lock().unwrap().clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::directory::tests::MockDirectoryProvider;
    use std::sync::Arc;

    #[test]
    fn test_get_app_title_returns_default() {
        let provider = Arc::new(MockDirectoryProvider::new());
        let state = AppState::new(provider);
        let title = state.title.lock().unwrap().clone();
        assert_eq!(title, "DSPanel");
    }
}
