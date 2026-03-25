// Enforced: unwrap() is forbidden in production code.
// Use expect("context") for Mutex locks, or proper error handling for Result/Option.
// Tests are exempt via #[allow(clippy::unwrap_used)] attributes.
#![deny(clippy::unwrap_used)]

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
        use services::ldap_directory::LdapTlsConfig;

        let server = std::env::var("DSPANEL_LDAP_SERVER").ok();
        let bind_dn = std::env::var("DSPANEL_LDAP_BIND_DN").ok();
        let bind_password = std::env::var("DSPANEL_LDAP_BIND_PASSWORD").ok();
        let use_tls = std::env::var("DSPANEL_LDAP_USE_TLS")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        let starttls = std::env::var("DSPANEL_LDAP_STARTTLS")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        let skip_verify = std::env::var("DSPANEL_LDAP_TLS_SKIP_VERIFY")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        let ca_cert_file = std::env::var("DSPANEL_LDAP_CA_CERT").ok();

        let tls_config = LdapTlsConfig {
            enabled: use_tls,
            starttls,
            skip_verify,
            ca_cert_file,
        };

        match (server, bind_dn, bind_password) {
            (Some(s), Some(d), Some(p)) => Arc::new(LdapDirectoryProvider::new_with_credentials(
                s, d, p, tls_config,
            )),
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
                // Store the authenticated identity resolved during permission detection
                if let Some(ref name) = provider.authenticated_user() {
                    permission_svc.set_authenticated_user(name.clone());
                    state.audit_service.set_operator(name.clone());
                    tracing::info!(operator = %name, "Audit operator set to authenticated identity");
                }
            });
            // Start LDAP keepalive background task (ping every 5 minutes)
            let keepalive_provider = state.directory_provider.clone();
            tauri::async_runtime::spawn(async move {
                let interval = std::time::Duration::from_secs(300); // 5 minutes
                loop {
                    tokio::time::sleep(interval).await;
                    if keepalive_provider.is_connected() {
                        match keepalive_provider.test_connection().await {
                            Ok(true) => {
                                tracing::debug!("LDAP keepalive: connection alive");
                            }
                            _ => {
                                tracing::debug!("LDAP keepalive: connection lost, will reconnect on next operation");
                            }
                        }
                    }
                }
            });

            // Restore persisted settings
            state.app_settings.load();
            state.preset_service.load_persisted();

            // Load custom permission mappings from preset storage path
            if let Some(preset_path) = state.preset_service.get_path() {
                match services::PermissionMappings::load_from(&preset_path) {
                    Ok(Some(custom)) => {
                        state.permission_service.apply_custom_mappings(&custom);
                        tracing::info!("Custom permission mappings applied from preset storage");
                    }
                    Ok(None) => {
                        tracing::debug!("No custom permission mappings found in preset storage");
                    }
                    Err(e) => {
                        tracing::warn!("Failed to load permission mappings: {}", e);
                    }
                }
            }

            // Sync Graph config from persisted settings + credential store
            {
                let settings = state.app_settings.get();
                let client_secret = state
                    .credential_store
                    .retrieve("graph_client_secret")
                    .unwrap_or(None);
                let graph_config = services::graph_exchange::GraphConfig {
                    tenant_id: settings.graph_tenant_id.unwrap_or_default(),
                    client_id: settings.graph_client_id.unwrap_or_default(),
                    client_secret,
                };
                if graph_config.is_configured() {
                    state.graph_exchange.set_config(graph_config);
                    tracing::info!("Graph integration configured from persisted settings");
                }
            }

            // Run audit log retention cleanup at startup
            {
                let retention_days = state
                    .app_settings
                    .get()
                    .audit_retention_days
                    .unwrap_or(365);
                let purged = state.audit_service.purge_older_than(retention_days);
                if purged > 0 {
                    tracing::info!(
                        purged_count = purged,
                        retention_days = retention_days,
                        "Audit log: startup cleanup completed"
                    );
                    state.audit_service.log_success(
                        "AuditPurge",
                        "audit_log",
                        &format!("Purged {} entries older than {} days", purged, retention_days),
                    );
                }
            }

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
            commands::get_platform,
            commands::get_current_username,
            commands::get_authenticated_identity,
            commands::get_computer_name,
            commands::reset_password,
            commands::unlock_account,
            commands::enable_account,
            commands::disable_account,
            commands::get_cannot_change_password,
            commands::set_password_flags,
            commands::get_audit_entries,
            commands::audit_log,
            commands::query_audit_log,
            commands::get_audit_action_types,
            commands::purge_audit_entries,
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
            commands::export_table,
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
            commands::delete_ad_object,
            commands::create_group,
            commands::move_object,
            commands::bulk_move_objects,
            commands::is_recycle_bin_enabled,
            commands::get_deleted_objects,
            commands::restore_deleted_object,
            commands::update_managed_by,
            commands::get_ou_tree,
            commands::get_preset_path,
            commands::set_preset_path,
            commands::test_preset_path,
            commands::list_presets,
            commands::save_preset,
            commands::delete_preset,
            commands::accept_preset_checksum,
            commands::pick_folder_dialog,
            commands::create_user,
            commands::modify_attribute,
            commands::get_app_settings,
            commands::set_app_settings,
            commands::store_credential,
            commands::get_credential,
            commands::delete_credential,
            commands::test_graph_connection,
            commands::get_exchange_online_info,
            commands::is_graph_configured,
            commands::browse_contacts,
            commands::browse_printers,
            commands::search_contacts,
            commands::search_printers,
            commands::create_contact,
            commands::update_contact,
            commands::delete_contact,
            commands::create_printer,
            commands::update_printer,
            commands::delete_printer,
            commands::capture_object_snapshot,
            commands::get_snapshot_history,
            commands::get_snapshot,
            commands::compute_snapshot_diff,
            commands::restore_from_snapshot,
            commands::cleanup_snapshots,
            commands::delete_snapshot,
            commands::get_thumbnail_photo,
            commands::set_thumbnail_photo,
            commands::remove_thumbnail_photo,
            commands::get_dc_health,
            commands::get_replication_status,
            commands::force_replication_cmd,
            commands::get_dns_kerberos_validation,
            commands::get_workstation_metrics,
            commands::get_topology,
            commands::get_privileged_accounts,
            commands::get_risk_score,
            commands::get_risk_score_history,
            commands::detect_ad_attacks,
            commands::get_escalation_paths,
            commands::get_cleanup_rules,
            commands::save_cleanup_rules,
            commands::cleanup_dry_run,
            commands::cleanup_execute,
            commands::get_compliance_frameworks,
            commands::run_compliance_scan,
            commands::export_compliance_framework_report,
            commands::get_gpo_links,
            commands::get_gpo_scope,
            commands::get_gpo_list,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            tracing::error!("Fatal: failed to start Tauri application: {}", e);
            std::process::exit(1);
        });
}

#[allow(clippy::unwrap_used)]
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
