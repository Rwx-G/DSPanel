use std::path::PathBuf;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

/// Application-wide settings persisted to %LOCALAPPDATA%/DSPanel/app-settings.json
/// (or platform equivalent).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Default OU for offboarding (move disabled users here).
    #[serde(default)]
    pub disabled_ou: Option<String>,
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
            *self.settings.write().unwrap() = loaded;
            tracing::info!("Application settings loaded");
        }
    }

    /// Returns the current settings.
    pub fn get(&self) -> AppSettings {
        self.settings.read().unwrap().clone()
    }

    /// Updates settings and persists to disk.
    pub fn update(&self, settings: AppSettings) {
        *self.settings.write().unwrap() = settings.clone();
        Self::write_to_disk(&settings);
    }

    /// Returns the configured disabled OU, if any.
    pub fn disabled_ou(&self) -> Option<String> {
        self.settings.read().unwrap().disabled_ou.clone()
    }

    /// Sets the disabled OU and persists.
    pub fn set_disabled_ou(&self, ou: Option<String>) {
        let mut s = self.settings.write().unwrap();
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
        };
        let json = serde_json::to_string(&settings).unwrap();
        let loaded: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(loaded.disabled_ou.as_deref(), Some("OU=Disabled,DC=example,DC=com"));
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
        assert_eq!(svc.disabled_ou().as_deref(), Some("OU=Disabled,DC=test,DC=com"));
    }

    #[test]
    fn test_service_update() {
        let svc = AppSettingsService::new();
        svc.update(AppSettings {
            disabled_ou: Some("OU=Test".to_string()),
        });
        assert_eq!(svc.get().disabled_ou.as_deref(), Some("OU=Test"));
    }

    #[test]
    fn test_load_does_not_panic_when_no_file() {
        let svc = AppSettingsService::new();
        svc.load();
    }
}
