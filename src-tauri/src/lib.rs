pub mod commands;
pub mod db;
pub mod error;
pub mod logging;
pub mod models;
pub mod services;
pub mod state;

use std::sync::Arc;

use services::LdapDirectoryProvider;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init_logging("logs");

    tracing::info!("DSPanel starting up");

    let provider = Arc::new(LdapDirectoryProvider::new());
    let app_state = AppState::new(provider);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .setup(|_app| {
            tracing::info!("DSPanel setup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::get_app_title])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::directory::tests::MockDirectoryProvider;

    #[test]
    fn test_app_state_builds_without_panic() {
        let provider = Arc::new(MockDirectoryProvider::new());
        let state = AppState::new(provider);
        assert_eq!(*state.title.lock().unwrap(), "DSPanel");
    }

    #[test]
    fn test_modules_are_accessible() {
        let provider = Arc::new(MockDirectoryProvider::new());
        let _ = AppState::new(provider);
        let _ = error::AppError::Internal("test".to_string());
    }
}
