use std::path::PathBuf;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

/// Application-wide settings persisted to %LOCALAPPDATA%/DSPanel/app-settings.json
/// (or platform equivalent).
///
/// The `graph_client_secret` field is deprecated in the JSON file. Secrets are
/// now stored in the OS credential store. The field is kept for deserialization
/// only (backwards-compatible migration) and is never written back to JSON.
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
    /// Deprecated: client secret is now in the OS credential store.
    /// Kept for deserialization during migration only.
    #[serde(default, skip_serializing)]
    pub graph_client_secret: Option<String>,
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
        let mut settings: AppSettings = serde_json::from_str(&json).ok()?;
        // Decrypt legacy DPAPI-protected secrets for migration
        if let Some(ref secret) = settings.graph_client_secret {
            settings.graph_client_secret = Some(Self::decrypt_legacy_secret(secret));
        }
        Some(settings)
    }

    fn write_to_disk(settings: &AppSettings) {
        if let Some(path) = Self::settings_path() {
            // graph_client_secret has skip_serializing, so it won't be written
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

    /// Decrypts a legacy DPAPI-protected secret during migration.
    /// Handles `DPAPI:<base64>` (encrypted) and plain strings.
    fn decrypt_legacy_secret(value: &str) -> String {
        if let Some(b64) = value.strip_prefix("DPAPI:") {
            use base64::Engine;
            match base64::engine::general_purpose::STANDARD.decode(b64) {
                Ok(encrypted) => match super::dpapi::unprotect(&encrypted) {
                    Ok(decrypted) => {
                        return String::from_utf8(decrypted).unwrap_or_else(|_| value.to_string());
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "DPAPI decryption failed during migration");
                    }
                },
                Err(e) => {
                    tracing::warn!(error = %e, "Base64 decode of DPAPI blob failed during migration");
                }
            }
            value.to_string()
        } else {
            // Plain text (legacy) - return as-is for migration
            value.to_string()
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
        assert!(settings.graph_client_secret.is_none());
    }

    #[test]
    fn test_serde_graph_fields_secret_not_serialized() {
        let settings = AppSettings {
            disabled_ou: None,
            graph_tenant_id: Some("tenant-123".to_string()),
            graph_client_id: Some("client-456".to_string()),
            graph_client_secret: Some("secret".to_string()),
        };
        let json = serde_json::to_string(&settings).unwrap();
        // Secret must NOT appear in serialized output (skip_serializing)
        assert!(!json.contains("secret"));
        assert!(!json.contains("graphClientSecret"));
        // But tenant and client ID are preserved
        assert!(json.contains("tenant-123"));
        assert!(json.contains("client-456"));
    }

    #[test]
    fn test_serde_graph_secret_deserialized_for_migration() {
        // Old JSON files may still contain the secret - we must read it for migration
        let json = r#"{"graphTenantId":"t","graphClientId":"c","graphClientSecret":"old-secret"}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.graph_client_secret.as_deref(), Some("old-secret"));
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

    #[test]
    fn test_decrypt_legacy_plain_secret() {
        let plain = "old-plaintext-secret";
        let result = AppSettingsService::decrypt_legacy_secret(plain);
        assert_eq!(result, plain);
    }
}
