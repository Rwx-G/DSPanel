pub mod commands;
pub mod error;
pub mod logging;
pub mod models;
pub mod services;
pub mod state;

use std::sync::Arc;

use services::{LdapDirectoryProvider, PermissionConfig};
use state::AppState;

/// Installs a custom panic hook that logs panics via tracing before
/// delegating to the default handler. This ensures panics in async tasks
/// or background threads are always captured in the log file.
pub fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        let location = panic_info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());

        let message = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic payload".to_string()
        };

        tracing::error!(
            location = %location,
            message = %message,
            "PANIC: unhandled panic caught by global hook"
        );

        default_hook(panic_info);
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init_logging("logs");
    install_panic_hook();

    tracing::info!("DSPanel starting up");

    let provider = Arc::new(LdapDirectoryProvider::new());
    let app_state = AppState::new(provider, PermissionConfig::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .setup(|_app| {
            tracing::info!("DSPanel setup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_title,
            commands::get_permission_level,
            commands::get_user_groups,
            commands::has_permission,
            commands::check_connection,
            commands::get_domain_info,
            commands::search_users,
            commands::get_user,
            commands::search_computers,
            commands::ping_host,
            commands::resolve_dns,
            commands::evaluate_health_cmd,
            commands::get_current_username,
            commands::get_computer_name,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            tracing::error!("Fatal: failed to start Tauri application: {}", e);
            std::process::exit(1);
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::directory::tests::MockDirectoryProvider;

    #[test]
    fn test_app_state_builds_without_panic() {
        let provider = Arc::new(MockDirectoryProvider::new());
        let state = AppState::new(provider, PermissionConfig::default());
        assert_eq!(*state.title.lock().unwrap(), "DSPanel");
    }

    #[test]
    fn test_modules_are_accessible() {
        let provider = Arc::new(MockDirectoryProvider::new());
        let _ = AppState::new(provider, PermissionConfig::default());
        let _ = error::AppError::Internal("test".to_string());
    }

    #[test]
    fn test_install_panic_hook_does_not_panic() {
        install_panic_hook();
        // Hook installed successfully
    }

    #[test]
    fn test_panic_hook_catches_str_panic() {
        install_panic_hook();
        let result = std::panic::catch_unwind(|| {
            panic!("test string panic");
        });
        assert!(result.is_err());
    }

    #[test]
    fn test_panic_hook_catches_string_panic() {
        install_panic_hook();
        let result = std::panic::catch_unwind(|| {
            panic!("{}", "formatted panic".to_string());
        });
        assert!(result.is_err());
    }

    #[test]
    fn test_panic_hook_catches_non_string_payload() {
        install_panic_hook();
        let result = std::panic::catch_unwind(|| {
            std::panic::panic_any(42i32);
        });
        assert!(result.is_err());
    }
}
