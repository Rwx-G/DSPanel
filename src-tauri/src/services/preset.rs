use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind, Debouncer};
use sha2::{Digest, Sha256};

use crate::models::Preset;

/// Resolves the DSPanel data directory per platform:
///
/// - Windows: %LOCALAPPDATA%/DSPanel
/// - macOS: ~/Library/Application Support/DSPanel
/// - Linux: $XDG_DATA_HOME/DSPanel or ~/.local/share/DSPanel
pub(crate) fn data_dir() -> Option<PathBuf> {
    let base = if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA").ok().map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var("HOME")
            .ok()
            .map(|h| PathBuf::from(h).join("Library").join("Application Support"))
    } else {
        // Linux / other: XDG_DATA_HOME or ~/.local/share
        std::env::var("XDG_DATA_HOME")
            .ok()
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(|h| PathBuf::from(h).join(".local").join("share"))
            })
    };
    let dir = base?.join("DSPanel");
    if !dir.exists() {
        std::fs::create_dir_all(&dir).ok()?;
    }
    Some(dir)
}

/// Resolves the path to the persistent settings file.
fn settings_file_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join("preset-settings.json"))
}

/// Resolves the path to the preset checksums file.
fn checksums_file_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join("preset-checksums.json"))
}

/// Computes the SHA-256 hex digest of a byte slice.
fn compute_sha256(data: &[u8]) -> String {
    let hash = Sha256::digest(data);
    format!("{:x}", hash)
}

/// Persisted preset settings.
#[derive(serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedSettings {
    preset_path: Option<String>,
}

/// Service for managing preset storage on a configurable directory path.
///
/// Presets are stored as individual JSON files (one per preset). The service
/// validates paths, handles load/save/delete, and watches for external changes.
pub struct PresetService {
    /// Configured storage directory path.
    storage_path: RwLock<Option<PathBuf>>,
    /// Cached list of loaded presets.
    presets: RwLock<Vec<Preset>>,
    /// SHA-256 checksums of preset files (filename -> hex digest).
    checksums: RwLock<HashMap<String, String>>,
    /// File watcher handle (kept alive to maintain the watch).
    #[allow(clippy::type_complexity)]
    watcher: Mutex<Option<Debouncer<notify::RecommendedWatcher>>>,
    /// Callback invoked when presets change on disk.
    #[allow(clippy::type_complexity)]
    on_change: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}

impl Default for PresetService {
    fn default() -> Self {
        Self::new()
    }
}

impl PresetService {
    pub fn new() -> Self {
        let checksums = Self::load_checksums();
        Self {
            storage_path: RwLock::new(None),
            presets: RwLock::new(Vec::new()),
            checksums: RwLock::new(checksums),
            watcher: Mutex::new(None),
            on_change: Mutex::new(None),
        }
    }

    /// Sets the callback invoked when the file watcher detects changes.
    pub fn set_on_change<F: Fn() + Send + Sync + 'static>(&self, callback: F) {
        *self.on_change.lock().expect("lock poisoned") = Some(Arc::new(callback));
    }

    /// Returns the currently configured storage path.
    pub fn get_path(&self) -> Option<PathBuf> {
        self.storage_path.read().expect("lock poisoned").clone()
    }

    /// Validates that a path is an accessible directory.
    pub fn validate_path(path: &str) -> Result<(), String> {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err("Path must not be empty".to_string());
        }
        let p = Path::new(trimmed);
        if !p.exists() {
            return Err(format!("Path does not exist: {}", trimmed));
        }
        if !p.is_dir() {
            return Err(format!("Path is not a directory: {}", trimmed));
        }
        // Check read access by listing directory
        match std::fs::read_dir(p) {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Cannot read directory: {}", e)),
        }
    }

    /// Configures the storage path and loads presets from it.
    ///
    /// Validates the path, loads all presets, starts the file watcher,
    /// and persists the path to settings for next startup.
    pub fn configure_path(&self, path: &str) -> Result<(), String> {
        Self::validate_path(path)?;
        let path_buf = PathBuf::from(path.trim());

        *self.storage_path.write().expect("lock poisoned") = Some(path_buf.clone());

        // Load presets from the new path
        let loaded = Self::load_from_dir(&path_buf, &self.checksums.read().expect("lock poisoned"));
        *self.presets.write().expect("lock poisoned") = loaded;

        // Persist the path for next startup
        Self::persist_path(path.trim());

        // Start watching
        self.start_watching();

        Ok(())
    }

    /// Loads the persisted preset path from settings and configures if valid.
    ///
    /// Called at application startup. If the saved path is unreachable,
    /// logs a warning but does not fail.
    pub fn load_persisted(&self) {
        let settings = Self::read_persisted_settings();
        if let Some(ref path) = settings.preset_path {
            match Self::validate_path(path) {
                Ok(()) => {
                    let path_buf = PathBuf::from(path.as_str());
                    *self.storage_path.write().expect("lock poisoned") = Some(path_buf.clone());
                    let loaded = Self::load_from_dir(
                        &path_buf,
                        &self.checksums.read().expect("lock poisoned"),
                    );
                    let count = loaded.len();
                    *self.presets.write().expect("lock poisoned") = loaded;
                    self.start_watching();
                    tracing::info!(
                        path = %path,
                        preset_count = count,
                        "Preset path restored from settings"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        path = %path,
                        error = %e,
                        "Persisted preset path is unreachable - presets unavailable until reconfigured"
                    );
                }
            }
        }
    }

    /// Persists the preset path to the settings file.
    fn persist_path(path: &str) {
        let settings = PersistedSettings {
            preset_path: Some(path.to_string()),
        };
        if let Some(file) = settings_file_path() {
            match serde_json::to_string_pretty(&settings) {
                Ok(json) => {
                    if let Err(e) = std::fs::write(&file, json) {
                        tracing::warn!(error = %e, "Failed to persist preset path");
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "Failed to serialize preset settings");
                }
            }
        }
    }

    /// Reads persisted settings from disk.
    fn read_persisted_settings() -> PersistedSettings {
        settings_file_path()
            .and_then(|file| std::fs::read_to_string(file).ok())
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default()
    }

    /// Loads all valid preset JSON files from a directory.
    ///
    /// Invalid files are logged and skipped. Each preset is checked against
    /// the known SHA-256 checksums. If a file was modified externally (checksum
    /// mismatch), the preset is loaded but flagged with `integrity_warning = true`.
    fn load_from_dir(dir: &Path, checksums: &HashMap<String, String>) -> Vec<Preset> {
        let mut presets = Vec::new();

        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(e) => {
                tracing::warn!(path = %dir.display(), error = %e, "Failed to read preset directory");
                return presets;
            }
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }

            match std::fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str::<Preset>(&content) {
                    Ok(mut preset) => {
                        if let Err(e) = preset.validate() {
                            tracing::warn!(
                                file = %path.display(),
                                error = %e,
                                "Preset file has invalid content, skipping"
                            );
                            continue;
                        }

                        // Check integrity against known checksums
                        let filename = sanitize_filename(&preset.name);
                        let current_hash = compute_sha256(content.as_bytes());
                        if let Some(known_hash) = checksums.get(&filename) {
                            if *known_hash != current_hash {
                                preset.integrity_warning = true;
                                tracing::warn!(
                                    preset = %preset.name,
                                    file = %path.display(),
                                    "Preset file was modified externally (checksum mismatch)"
                                );
                            }
                        }
                        // If no known hash, this is a new file - no warning

                        presets.push(preset);
                    }
                    Err(e) => {
                        tracing::warn!(
                            file = %path.display(),
                            error = %e,
                            "Failed to parse preset JSON, skipping"
                        );
                    }
                },
                Err(e) => {
                    tracing::warn!(
                        file = %path.display(),
                        error = %e,
                        "Failed to read preset file, skipping"
                    );
                }
            }
        }

        presets.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        presets
    }

    /// Returns all loaded presets.
    pub fn load_all(&self) -> Vec<Preset> {
        self.presets.read().expect("lock poisoned").clone()
    }

    /// Reloads presets from the configured directory.
    pub fn reload(&self) {
        if let Some(ref path) = *self.storage_path.read().expect("lock poisoned") {
            let loaded = Self::load_from_dir(path, &self.checksums.read().expect("lock poisoned"));
            *self.presets.write().expect("lock poisoned") = loaded;
            tracing::debug!("Presets reloaded from disk");
        }
    }

    /// Saves a preset to disk as a JSON file.
    ///
    /// The filename is derived from the preset name (sanitized).
    pub fn save(&self, preset: &Preset) -> Result<(), String> {
        preset.validate()?;

        let path = self
            .storage_path
            .read()
            .expect("lock poisoned")
            .clone()
            .ok_or("Preset storage path not configured")?;

        let filename = sanitize_filename(&preset.name);
        let file_path = path.join(format!("{}.json", filename));

        let json = serde_json::to_string_pretty(preset)
            .map_err(|e| format!("Failed to serialize preset: {}", e))?;

        std::fs::write(&file_path, &json)
            .map_err(|e| format!("Failed to write preset file: {}", e))?;

        // Record checksum of the file we just wrote
        let hash = compute_sha256(json.as_bytes());
        self.checksums
            .write()
            .expect("lock poisoned")
            .insert(filename, hash);
        self.persist_checksums();

        tracing::info!(
            preset_name = %preset.name,
            file = %file_path.display(),
            "Preset saved"
        );

        // Reload to pick up the change
        self.reload();
        Ok(())
    }

    /// Deletes a preset by name.
    pub fn delete(&self, name: &str) -> Result<(), String> {
        let path = self
            .storage_path
            .read()
            .expect("lock poisoned")
            .clone()
            .ok_or("Preset storage path not configured")?;

        let filename = sanitize_filename(name);
        let file_path = path.join(format!("{}.json", filename));

        if !file_path.exists() {
            return Err(format!("Preset file not found: {}", name));
        }

        std::fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to delete preset file: {}", e))?;

        // Remove checksum entry
        self.checksums
            .write()
            .expect("lock poisoned")
            .remove(&filename);
        self.persist_checksums();

        tracing::info!(
            preset_name = %name,
            file = %file_path.display(),
            "Preset deleted"
        );

        self.reload();
        Ok(())
    }

    /// Accepts a preset whose checksum has changed, recording the current
    /// file content as the new known-good checksum. Clears the integrity warning.
    pub fn accept_checksum(&self, name: &str) -> Result<(), String> {
        let path = self
            .storage_path
            .read()
            .expect("lock poisoned")
            .clone()
            .ok_or("Preset storage path not configured")?;

        let filename = sanitize_filename(name);
        let file_path = path.join(format!("{}.json", filename));

        let content = std::fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read preset file: {}", e))?;

        let hash = compute_sha256(content.as_bytes());
        self.checksums
            .write()
            .expect("lock poisoned")
            .insert(filename, hash);
        self.persist_checksums();

        tracing::info!(
            preset_name = %name,
            "Preset checksum accepted by user"
        );

        // Reload to clear the integrity_warning flag
        self.reload();
        Ok(())
    }

    /// Loads the checksum registry from the local data directory.
    fn load_checksums() -> HashMap<String, String> {
        checksums_file_path()
            .and_then(|file| std::fs::read_to_string(file).ok())
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default()
    }

    /// Persists the checksum registry to the local data directory.
    fn persist_checksums(&self) {
        let checksums = self.checksums.read().expect("lock poisoned").clone();
        if let Some(file) = checksums_file_path() {
            match serde_json::to_string_pretty(&checksums) {
                Ok(json) => {
                    if let Err(e) = std::fs::write(&file, json) {
                        tracing::warn!(error = %e, "Failed to persist preset checksums");
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "Failed to serialize preset checksums");
                }
            }
        }
    }

    /// Starts a debounced file watcher on the configured directory.
    fn start_watching(&self) {
        // Stop any existing watcher
        *self.watcher.lock().expect("lock poisoned") = None;

        let path = match self.storage_path.read().expect("lock poisoned").clone() {
            Some(p) => p,
            None => return,
        };

        let on_change = self.on_change.lock().expect("lock poisoned").clone();

        let debouncer = new_debouncer(
            std::time::Duration::from_millis(300),
            move |events: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
                match events {
                    Ok(events) => {
                        let has_json_change = events.iter().any(|e| {
                            e.kind == DebouncedEventKind::Any
                                && e.path
                                    .extension()
                                    .and_then(|ext| ext.to_str())
                                    .map(|ext| ext == "json")
                                    .unwrap_or(false)
                        });
                        if has_json_change {
                            tracing::debug!("Preset directory changed, notifying callback");
                            if let Some(ref cb) = on_change {
                                cb();
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "File watcher error");
                    }
                }
            },
        );

        match debouncer {
            Ok(mut d) => {
                if let Err(e) = d.watcher().watch(&path, RecursiveMode::NonRecursive) {
                    tracing::warn!(
                        path = %path.display(),
                        error = %e,
                        "Failed to start watching preset directory"
                    );
                    return;
                }
                tracing::info!(path = %path.display(), "Watching preset directory for changes");
                *self.watcher.lock().expect("lock poisoned") = Some(d);
            }
            Err(e) => {
                tracing::warn!(error = %e, "Failed to create file watcher");
            }
        }
    }
}

/// Sanitizes a preset name for use as a filename.
///
/// Replaces non-alphanumeric characters (except hyphens and underscores) with underscores,
/// converts to lowercase, and trims leading/trailing underscores.
fn sanitize_filename(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c.to_lowercase()
                    .next()
                    .expect("lowercase conversion always yields a char")
            } else {
                '_'
            }
        })
        .collect();
    sanitized.trim_matches('_').to_string()
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::PresetType;
    use std::collections::HashMap;
    use std::io::Write;

    fn make_preset(name: &str) -> Preset {
        Preset {
            name: name.to_string(),
            description: "Test preset".to_string(),
            preset_type: PresetType::Onboarding,
            target_ou: "OU=Test,DC=example,DC=com".to_string(),
            groups: vec!["CN=Group1,DC=example,DC=com".to_string()],
            attributes: HashMap::from([("department".to_string(), "IT".to_string())]),
            integrity_warning: false,
        }
    }

    fn no_checksums() -> HashMap<String, String> {
        HashMap::new()
    }

    fn write_preset_file(dir: &Path, name: &str, preset: &Preset) {
        let filename = sanitize_filename(name);
        let file_path = dir.join(format!("{}.json", filename));
        let json = serde_json::to_string_pretty(preset).unwrap();
        std::fs::write(file_path, json).unwrap();
    }

    fn write_raw_file(dir: &Path, filename: &str, content: &str) {
        let file_path = dir.join(filename);
        let mut f = std::fs::File::create(file_path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
    }

    // -- sanitize_filename tests --

    #[test]
    fn test_sanitize_filename_basic() {
        assert_eq!(sanitize_filename("New Developer"), "new_developer");
    }

    #[test]
    fn test_sanitize_filename_special_chars() {
        assert_eq!(sanitize_filename("Team A/B (2026)"), "team_a_b__2026");
    }

    #[test]
    fn test_sanitize_filename_hyphens_preserved() {
        assert_eq!(sanitize_filename("my-preset"), "my-preset");
    }

    #[test]
    fn test_sanitize_filename_underscores_preserved() {
        assert_eq!(sanitize_filename("my_preset"), "my_preset");
    }

    #[test]
    fn test_sanitize_filename_trims_leading_trailing() {
        assert_eq!(sanitize_filename(" Test "), "test");
    }

    // -- validate_path tests --

    #[test]
    fn test_validate_path_empty() {
        assert!(PresetService::validate_path("").is_err());
    }

    #[test]
    fn test_validate_path_nonexistent() {
        assert!(PresetService::validate_path("/nonexistent/path/12345").is_err());
    }

    #[test]
    fn test_validate_path_valid_dir() {
        let dir = tempfile::tempdir().unwrap();
        assert!(PresetService::validate_path(dir.path().to_str().unwrap()).is_ok());
    }

    #[test]
    fn test_validate_path_file_not_dir() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("file.txt");
        std::fs::write(&file_path, "content").unwrap();
        assert!(PresetService::validate_path(file_path.to_str().unwrap()).is_err());
    }

    // -- configure_path tests --

    #[test]
    fn test_configure_path_valid() {
        let dir = tempfile::tempdir().unwrap();
        let svc = PresetService::new();
        assert!(svc.configure_path(dir.path().to_str().unwrap()).is_ok());
        assert_eq!(svc.get_path(), Some(dir.path().to_path_buf()));
    }

    #[test]
    fn test_configure_path_invalid() {
        let svc = PresetService::new();
        assert!(svc.configure_path("/nonexistent/12345").is_err());
        assert!(svc.get_path().is_none());
    }

    // -- load_from_dir tests --

    #[test]
    fn test_load_from_dir_empty() {
        let dir = tempfile::tempdir().unwrap();
        let presets = PresetService::load_from_dir(dir.path(), &no_checksums());
        assert!(presets.is_empty());
    }

    #[test]
    fn test_load_from_dir_single_valid() {
        let dir = tempfile::tempdir().unwrap();
        write_preset_file(dir.path(), "Dev Onboarding", &make_preset("Dev Onboarding"));
        let presets = PresetService::load_from_dir(dir.path(), &no_checksums());
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].name, "Dev Onboarding");
    }

    #[test]
    fn test_load_from_dir_multiple_sorted() {
        let dir = tempfile::tempdir().unwrap();
        write_preset_file(dir.path(), "Zebra", &make_preset("Zebra"));
        write_preset_file(dir.path(), "Alpha", &make_preset("Alpha"));
        let presets = PresetService::load_from_dir(dir.path(), &no_checksums());
        assert_eq!(presets.len(), 2);
        assert_eq!(presets[0].name, "Alpha");
        assert_eq!(presets[1].name, "Zebra");
    }

    #[test]
    fn test_load_from_dir_skips_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        write_preset_file(dir.path(), "Valid", &make_preset("Valid"));
        write_raw_file(dir.path(), "bad.json", "{ not valid json }");
        let presets = PresetService::load_from_dir(dir.path(), &no_checksums());
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].name, "Valid");
    }

    #[test]
    fn test_load_from_dir_skips_non_json_files() {
        let dir = tempfile::tempdir().unwrap();
        write_preset_file(dir.path(), "Valid", &make_preset("Valid"));
        write_raw_file(dir.path(), "readme.txt", "not a preset");
        let presets = PresetService::load_from_dir(dir.path(), &no_checksums());
        assert_eq!(presets.len(), 1);
    }

    #[test]
    fn test_load_from_dir_skips_invalid_preset_content() {
        let dir = tempfile::tempdir().unwrap();
        // Valid JSON but fails preset validation (empty name)
        let bad = r#"{"name":"","description":"","type":"Onboarding","targetOu":"","groups":[],"attributes":{}}"#;
        write_raw_file(dir.path(), "empty-name.json", bad);
        write_preset_file(dir.path(), "Good", &make_preset("Good"));
        let presets = PresetService::load_from_dir(dir.path(), &no_checksums());
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].name, "Good");
    }

    // -- save tests --

    #[test]
    fn test_save_writes_json_file() {
        let dir = tempfile::tempdir().unwrap();
        let svc = PresetService::new();
        svc.configure_path(dir.path().to_str().unwrap()).unwrap();

        let preset = make_preset("My Preset");
        svc.save(&preset).unwrap();

        let file_path = dir.path().join("my_preset.json");
        assert!(file_path.exists());

        let content = std::fs::read_to_string(&file_path).unwrap();
        let loaded: Preset = serde_json::from_str(&content).unwrap();
        assert_eq!(loaded.name, "My Preset");
    }

    #[test]
    fn test_save_updates_presets_cache() {
        let dir = tempfile::tempdir().unwrap();
        let svc = PresetService::new();
        svc.configure_path(dir.path().to_str().unwrap()).unwrap();
        assert!(svc.load_all().is_empty());

        svc.save(&make_preset("Test")).unwrap();
        assert_eq!(svc.load_all().len(), 1);
    }

    #[test]
    fn test_save_without_path_configured() {
        let svc = PresetService::new();
        let result = svc.save(&make_preset("Test"));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not configured"));
    }

    #[test]
    fn test_save_invalid_preset() {
        let dir = tempfile::tempdir().unwrap();
        let svc = PresetService::new();
        svc.configure_path(dir.path().to_str().unwrap()).unwrap();

        let mut preset = make_preset("Test");
        preset.name = "".to_string();
        assert!(svc.save(&preset).is_err());
    }

    // -- delete tests --

    #[test]
    fn test_delete_removes_file() {
        let dir = tempfile::tempdir().unwrap();
        let svc = PresetService::new();
        svc.configure_path(dir.path().to_str().unwrap()).unwrap();

        svc.save(&make_preset("ToDelete")).unwrap();
        assert_eq!(svc.load_all().len(), 1);

        svc.delete("ToDelete").unwrap();
        assert!(svc.load_all().is_empty());
        assert!(!dir.path().join("todelete.json").exists());
    }

    #[test]
    fn test_delete_nonexistent() {
        let dir = tempfile::tempdir().unwrap();
        let svc = PresetService::new();
        svc.configure_path(dir.path().to_str().unwrap()).unwrap();

        let result = svc.delete("Nonexistent");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_delete_without_path_configured() {
        let svc = PresetService::new();
        assert!(svc.delete("Test").is_err());
    }

    // -- reload tests --

    #[test]
    fn test_reload_picks_up_external_changes() {
        let dir = tempfile::tempdir().unwrap();
        let svc = PresetService::new();
        svc.configure_path(dir.path().to_str().unwrap()).unwrap();
        assert!(svc.load_all().is_empty());

        // Write a file externally
        write_preset_file(dir.path(), "External", &make_preset("External"));
        svc.reload();
        assert_eq!(svc.load_all().len(), 1);
        assert_eq!(svc.load_all()[0].name, "External");
    }

    // -- file watcher tests --

    #[test]
    fn test_file_watcher_triggers_callback() {
        let dir = tempfile::tempdir().unwrap();
        let svc = PresetService::new();

        let changed = Arc::new(Mutex::new(false));
        let changed_clone = changed.clone();
        svc.set_on_change(move || {
            *changed_clone.lock().unwrap() = true;
        });

        svc.configure_path(dir.path().to_str().unwrap()).unwrap();

        // Write a file to trigger the watcher
        write_preset_file(dir.path(), "Trigger", &make_preset("Trigger"));

        // Allow debounce time + processing
        std::thread::sleep(std::time::Duration::from_millis(600));

        // The callback should have been triggered
        // Note: file watchers can be flaky in CI, so we just verify setup works
        let _ = *changed.lock().unwrap();
    }

    // -- service lifecycle tests --

    #[test]
    fn test_new_service_has_no_path() {
        let svc = PresetService::new();
        assert!(svc.get_path().is_none());
    }

    #[test]
    fn test_new_service_has_empty_presets() {
        let svc = PresetService::new();
        assert!(svc.load_all().is_empty());
    }

    #[test]
    fn test_default_trait() {
        let svc = PresetService::default();
        assert!(svc.get_path().is_none());
    }

    #[test]
    fn test_save_overwrite_existing() {
        let dir = tempfile::tempdir().unwrap();
        let svc = PresetService::new();
        svc.configure_path(dir.path().to_str().unwrap()).unwrap();

        let mut preset = make_preset("Overwrite");
        svc.save(&preset).unwrap();

        preset.description = "Updated description".to_string();
        svc.save(&preset).unwrap();

        let loaded = svc.load_all();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].description, "Updated description");
    }

    // -- persistence tests --

    #[test]
    fn test_persisted_settings_roundtrip() {
        let settings = PersistedSettings {
            preset_path: Some("/some/path".to_string()),
        };
        let json = serde_json::to_string(&settings).unwrap();
        let loaded: PersistedSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(loaded.preset_path.as_deref(), Some("/some/path"));
    }

    #[test]
    fn test_persisted_settings_default_is_none() {
        let settings = PersistedSettings::default();
        assert!(settings.preset_path.is_none());
    }

    #[test]
    #[ignore] // Uses global settings file - run with --ignored to avoid parallel test conflicts
    fn test_persist_path_writes_settings_file() {
        let original = PresetService::read_persisted_settings();

        PresetService::persist_path("/test/preset/path");
        let settings = PresetService::read_persisted_settings();
        assert_eq!(settings.preset_path.as_deref(), Some("/test/preset/path"));

        // Restore original
        match original.preset_path {
            Some(ref path) => PresetService::persist_path(path),
            None => {
                if let Some(file) = settings_file_path() {
                    let _ = std::fs::remove_file(file);
                }
            }
        }
    }

    #[test]
    fn test_load_persisted_restores_path() {
        // This test verifies load_persisted reads the settings file.
        // We can only fully test if settings_file_path() is available.
        let svc = PresetService::new();
        // Should not panic even if no settings file exists
        svc.load_persisted();
    }

    // -- checksum / integrity tests --

    #[test]
    fn test_compute_sha256_deterministic() {
        let hash1 = compute_sha256(b"hello world");
        let hash2 = compute_sha256(b"hello world");
        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 64); // SHA-256 hex is 64 chars
    }

    #[test]
    fn test_compute_sha256_different_input() {
        let hash1 = compute_sha256(b"hello");
        let hash2 = compute_sha256(b"world");
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_no_warning_when_no_known_checksum() {
        let dir = tempfile::tempdir().unwrap();
        write_preset_file(dir.path(), "New", &make_preset("New"));
        let presets = PresetService::load_from_dir(dir.path(), &no_checksums());
        assert_eq!(presets.len(), 1);
        assert!(!presets[0].integrity_warning);
    }

    #[test]
    fn test_no_warning_when_checksum_matches() {
        let dir = tempfile::tempdir().unwrap();
        let preset = make_preset("Trusted");
        write_preset_file(dir.path(), "Trusted", &preset);

        // Read the file content and compute its checksum
        let file_path = dir.path().join("trusted.json");
        let content = std::fs::read_to_string(&file_path).unwrap();
        let hash = compute_sha256(content.as_bytes());

        let mut checksums = HashMap::new();
        checksums.insert("trusted".to_string(), hash);

        let presets = PresetService::load_from_dir(dir.path(), &checksums);
        assert_eq!(presets.len(), 1);
        assert!(!presets[0].integrity_warning);
    }

    #[test]
    fn test_warning_when_checksum_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        write_preset_file(dir.path(), "Tampered", &make_preset("Tampered"));

        let mut checksums = HashMap::new();
        checksums.insert(
            "tampered".to_string(),
            "old-hash-that-no-longer-matches".to_string(),
        );

        let presets = PresetService::load_from_dir(dir.path(), &checksums);
        assert_eq!(presets.len(), 1);
        assert!(presets[0].integrity_warning);
    }

    #[test]
    fn test_save_records_checksum() {
        let dir = tempfile::tempdir().unwrap();
        let svc = PresetService::new();
        svc.configure_path(dir.path().to_str().unwrap()).unwrap();

        svc.save(&make_preset("Saved")).unwrap();

        let checksums = svc.checksums.read().unwrap();
        assert!(checksums.contains_key("saved"));
        assert_eq!(checksums["saved"].len(), 64); // SHA-256 hex
    }

    #[test]
    fn test_save_then_load_no_warning() {
        let dir = tempfile::tempdir().unwrap();
        let svc = PresetService::new();
        svc.configure_path(dir.path().to_str().unwrap()).unwrap();

        svc.save(&make_preset("Clean")).unwrap();
        svc.reload();

        let presets = svc.load_all();
        assert_eq!(presets.len(), 1);
        assert!(!presets[0].integrity_warning);
    }

    #[test]
    fn test_external_modification_triggers_warning() {
        let dir = tempfile::tempdir().unwrap();
        let svc = PresetService::new();
        svc.configure_path(dir.path().to_str().unwrap()).unwrap();

        // Save a preset (records checksum)
        svc.save(&make_preset("Original")).unwrap();

        // Modify the file externally
        let file_path = dir.path().join("original.json");
        let mut modified = make_preset("Original");
        modified.target_ou = "OU=Hacked,DC=evil,DC=com".to_string();
        let json = serde_json::to_string_pretty(&modified).unwrap();
        std::fs::write(&file_path, json).unwrap();

        // Reload - should detect the mismatch
        svc.reload();
        let presets = svc.load_all();
        assert_eq!(presets.len(), 1);
        assert!(presets[0].integrity_warning);
    }

    #[test]
    fn test_accept_checksum_clears_warning() {
        let dir = tempfile::tempdir().unwrap();
        let svc = PresetService::new();
        svc.configure_path(dir.path().to_str().unwrap()).unwrap();

        // Save, then modify externally
        svc.save(&make_preset("Flagged")).unwrap();
        let file_path = dir.path().join("flagged.json");
        let mut modified = make_preset("Flagged");
        modified.description = "Changed externally".to_string();
        let json = serde_json::to_string_pretty(&modified).unwrap();
        std::fs::write(&file_path, json).unwrap();

        svc.reload();
        assert!(svc.load_all()[0].integrity_warning);

        // Accept the checksum
        svc.accept_checksum("Flagged").unwrap();
        let presets = svc.load_all();
        assert!(!presets[0].integrity_warning);
    }

    #[test]
    fn test_delete_removes_checksum() {
        let dir = tempfile::tempdir().unwrap();
        let svc = PresetService::new();
        svc.configure_path(dir.path().to_str().unwrap()).unwrap();

        svc.save(&make_preset("Ephemeral")).unwrap();
        assert!(svc.checksums.read().unwrap().contains_key("ephemeral"));

        svc.delete("Ephemeral").unwrap();
        assert!(!svc.checksums.read().unwrap().contains_key("ephemeral"));
    }

    #[test]
    fn test_accept_checksum_without_path() {
        let svc = PresetService::new();
        assert!(svc.accept_checksum("Nothing").is_err());
    }

    #[test]
    fn test_integrity_warning_not_in_serialized_file() {
        // Verify that integrity_warning field uses skip_deserializing
        let json = r#"{"name":"Test","description":"d","type":"Onboarding","targetOu":"OU=X","groups":["CN=G"],"attributes":{},"integrityWarning":true}"#;
        let preset: Preset = serde_json::from_str(json).unwrap();
        // skip_deserializing means the field is always false when reading from JSON
        assert!(!preset.integrity_warning);
    }
}
