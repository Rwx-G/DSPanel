pub mod commands;
pub mod db;
pub mod error;
pub mod logging;
pub mod models;
pub mod services;
pub mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init_logging("logs");

    tracing::info!("DSPanel starting up");

    let app_state = AppState::new();

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

    #[test]
    fn test_app_state_builds_without_panic() {
        let state = AppState::new();
        assert_eq!(*state.title.lock().unwrap(), "DSPanel");
    }

    #[test]
    fn test_modules_are_accessible() {
        // Verify all module declarations compile and are accessible
        let _ = AppState::new();
        let _ = error::AppError::Internal("test".to_string());
    }
}
