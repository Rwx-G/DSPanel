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

    #[test]
    fn test_get_app_title_returns_default() {
        // Directly test the logic without Tauri runtime
        let state = AppState::new();
        let title = state.title.lock().unwrap().clone();
        assert_eq!(title, "DSPanel");
    }
}
