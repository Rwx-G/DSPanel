use std::path::PathBuf;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

/// Application-wide settings persisted to %LOCALAPPDATA%/DSPanel/app-settings.json
/// (or platform equivalent).
///
/// Graph client secret is stored in the OS credential store (keyring),
/// not in this settings file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Default OU for offboarding (move disabled users here).
    #[serde(default)]
    pub disabled_ou: Option<String>,
    /// Microsoft Graph API - Azure AD tenant ID.
    #[serde(default)]
    pub graph_tenant_id: Option<String>,
    /// Microsoft Graph API - Application (client) ID.
    #[serde(default)]
    pub graph_client_id: Option<String>,
    /// Additional privileged groups to monitor beyond the defaults
    /// (Domain Admins, Enterprise Admins, Schema Admins, Administrators).
    #[serde(default)]
    pub privileged_groups: Option<Vec<String>>,
    /// Cleanup rules for automated stale account management.
    #[serde(default)]
    pub cleanup_rules: Option<Vec<super::cleanup::CleanupRule>>,
    /// Audit log retention period in days (default: 365).
    #[serde(default)]
    pub audit_retention_days: Option<i64>,
}

/// Service for managing persisted application settings.
pub struct AppSettingsService {
    settings: RwLock<AppSettings>,
}

impl Default for AppSettingsService {
    fn default() -> Self {
        Self::new()
    }
}

impl AppSettingsService {
    pub fn new() -> Self {
        Self {
            settings: RwLock::new(AppSettings::default()),
        }
    }

    /// Loads settings from disk. Called at startup.
    pub fn load(&self) {
        if let Some(loaded) = Self::read_from_disk() {
            *self.settings.write().expect("lock poisoned") = loaded;
            tracing::info!("Application settings loaded");
        }
    }

    /// Returns the current settings.
    pub fn get(&self) -> AppSettings {
        self.settings.read().expect("lock poisoned").clone()
    }

    /// Updates settings and persists to disk.
    pub fn update(&self, settings: AppSettings) {
        *self.settings.write().expect("lock poisoned") = settings.clone();
        Self::write_to_disk(&settings);
    }

    /// Returns the configured disabled OU, if any.
    pub fn disabled_ou(&self) -> Option<String> {
        self.settings
            .read()
            .expect("lock poisoned")
            .disabled_ou
            .clone()
    }

    /// Sets the disabled OU and persists.
    pub fn set_disabled_ou(&self, ou: Option<String>) {
        let mut s = self.settings.write().expect("lock poisoned");
        s.disabled_ou = ou;
        Self::write_to_disk(&s);
    }

    fn settings_path() -> Option<PathBuf> {
        super::preset::data_dir().map(|d| d.join("app-settings.json"))
    }

    fn read_from_disk() -> Option<AppSettings> {
        let path = Self::settings_path()?;
        let json = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&json).ok()
    }

    fn write_to_disk(settings: &AppSettings) {
        if let Some(path) = Self::settings_path() {
            match serde_json::to_string_pretty(settings) {
                Ok(json) => {
                    if let Err(e) = std::fs::write(&path, json) {
                        tracing::warn!(error = %e, "Failed to persist app settings");
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "Failed to serialize app settings");
                }
            }
        }
    }
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings() {
        let settings = AppSettings::default();
        assert!(settings.disabled_ou.is_none());
    }

    #[test]
    fn test_serde_roundtrip() {
        let settings = AppSettings {
            disabled_ou: Some("OU=Disabled,DC=example,DC=com".to_string()),
            ..Default::default()
        };
        let json = serde_json::to_string(&settings).unwrap();
        let loaded: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(
            loaded.disabled_ou.as_deref(),
            Some("OU=Disabled,DC=example,DC=com")
        );
    }

    #[test]
    fn test_serde_missing_fields_use_defaults() {
        let json = "{}";
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert!(settings.disabled_ou.is_none());
    }

    #[test]
    fn test_service_get_set() {
        let svc = AppSettingsService::new();
        assert!(svc.disabled_ou().is_none());

        svc.set_disabled_ou(Some("OU=Disabled,DC=test,DC=com".to_string()));
        assert_eq!(
            svc.disabled_ou().as_deref(),
            Some("OU=Disabled,DC=test,DC=com")
        );
    }

    #[test]
    fn test_service_update() {
        let svc = AppSettingsService::new();
        svc.update(AppSettings {
            disabled_ou: Some("OU=Test".to_string()),
            ..Default::default()
        });
        assert_eq!(svc.get().disabled_ou.as_deref(), Some("OU=Test"));
    }

    #[test]
    fn test_default_settings_graph_fields_none() {
        let settings = AppSettings::default();
        assert!(settings.graph_tenant_id.is_none());
        assert!(settings.graph_client_id.is_none());
    }

    #[test]
    fn test_serde_graph_fields() {
        let settings = AppSettings {
            disabled_ou: None,
            graph_tenant_id: Some("tenant-123".to_string()),
            graph_client_id: Some("client-456".to_string()),
            privileged_groups: None,
            cleanup_rules: None,
            audit_retention_days: None,
        };
        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains("tenant-123"));
        assert!(json.contains("client-456"));
    }

    #[test]
    fn test_serde_graph_fields_backwards_compatible() {
        let json = r#"{"disabledOu":"OU=Test"}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.disabled_ou.as_deref(), Some("OU=Test"));
        assert!(settings.graph_tenant_id.is_none());
    }

    #[test]
    fn test_load_does_not_panic_when_no_file() {
        let svc = AppSettingsService::new();
        svc.load();
    }
}
