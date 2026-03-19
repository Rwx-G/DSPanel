pub mod commands;
pub mod error;
pub mod logging;
pub mod models;
pub mod services;
pub mod state;

use std::sync::Arc;

#[cfg(not(feature = "demo"))]
use services::LdapDirectoryProvider;
use services::PermissionConfig;
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

    #[cfg(feature = "demo")]
    let provider: Arc<dyn services::DirectoryProvider> = {
        tracing::warn!("DEMO MODE ACTIVE - using mock directory data");
        Arc::new(services::demo_provider::DemoDirectoryProvider::new())
    };
    #[cfg(not(feature = "demo"))]
    let provider: Arc<dyn services::DirectoryProvider> = {
        let server = std::env::var("DSPANEL_LDAP_SERVER").ok();
        let bind_dn = std::env::var("DSPANEL_LDAP_BIND_DN").ok();
        let bind_password = std::env::var("DSPANEL_LDAP_BIND_PASSWORD").ok();

        match (server, bind_dn, bind_password) {
            (Some(s), Some(d), Some(p)) => {
                Arc::new(LdapDirectoryProvider::new_with_credentials(s, d, p))
            }
            (None, None, None) => Arc::new(LdapDirectoryProvider::new()),
            _ => {
                tracing::warn!(
                    "Partial LDAP credentials detected - all three variables must be set: \
                     DSPANEL_LDAP_SERVER, DSPANEL_LDAP_BIND_DN, DSPANEL_LDAP_BIND_PASSWORD. \
                     Falling back to GSSAPI"
                );
                Arc::new(LdapDirectoryProvider::new())
            }
        }
    };

    let app_state = AppState::new(provider, PermissionConfig::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .setup(|app| {
            // Detect permissions from AD groups on startup
            use tauri::Manager;
            let state = app.state::<AppState>();
            let provider = state.directory_provider.clone();
            let permission_svc = &state.permission_service;
            tauri::async_runtime::block_on(async {
                if let Err(e) = permission_svc.detect_permissions(&*provider).await {
                    tracing::warn!("Permission detection failed: {}", e);
                }
            });
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
            commands::browse_users,
            commands::browse_computers,
            commands::get_group_members,
            commands::search_computers,
            commands::ping_host,
            commands::resolve_dns,
            commands::get_schema_attributes,
            commands::evaluate_health_cmd,
            commands::evaluate_health_batch,
            commands::get_current_username,
            commands::get_computer_name,
            commands::reset_password,
            commands::unlock_account,
            commands::enable_account,
            commands::disable_account,
            commands::get_cannot_change_password,
            commands::set_password_flags,
            commands::get_audit_entries,
            commands::generate_password,
            commands::check_password_hibp,
            commands::mfa_setup,
            commands::mfa_verify,
            commands::mfa_is_configured,
            commands::mfa_revoke,
            commands::mfa_get_config,
            commands::mfa_set_config,
            commands::mfa_requires,
            commands::compare_users,
            commands::save_file_dialog,
            commands::add_user_to_group,
            commands::get_replication_metadata,
            commands::compute_attribute_diff,
            commands::analyze_ntfs,
            commands::audit_ntfs_permissions,
            commands::cross_reference_ntfs,
            commands::search_groups,
            commands::browse_groups,
            commands::remove_group_member,
            commands::detect_empty_groups,
            commands::detect_circular_groups,
            commands::detect_single_member_groups,
            commands::detect_stale_groups,
            commands::detect_undescribed_groups,
            commands::detect_deep_nesting,
            commands::detect_duplicate_groups,
            commands::delete_group,
            commands::create_group,
            commands::move_object,
            commands::update_managed_by,
            commands::get_ou_tree,
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
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        assert_eq!(*state.title.lock().unwrap(), "DSPanel");
    }

    #[test]
    fn test_modules_are_accessible() {
        let provider = Arc::new(MockDirectoryProvider::new());
        let _ = AppState::new_for_test(provider, PermissionConfig::default());
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
