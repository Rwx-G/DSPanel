use anyhow::{Context, Result};

/// Platform-agnostic trait for secure credential storage.
///
/// Each credential is identified by a string key (e.g., "graph_client_secret").
/// Implementations use OS-native secure storage: Windows Credential Manager,
/// macOS Keychain, or Linux Secret Service.
pub trait CredentialStore: Send + Sync {
    /// Stores a credential value under the given key.
    fn store(&self, key: &str, value: &str) -> Result<()>;

    /// Retrieves a credential value by key. Returns None if not found.
    fn retrieve(&self, key: &str) -> Result<Option<String>>;

    /// Deletes a credential by key. Returns Ok even if key did not exist.
    fn delete(&self, key: &str) -> Result<()>;
}

/// Allowed credential keys. Prevents arbitrary key access from frontend.
const ALLOWED_KEYS: &[&str] = &["graph_client_secret"];

/// Validates that a credential key is in the allowlist.
pub fn validate_key(key: &str) -> Result<()> {
    if ALLOWED_KEYS.contains(&key) {
        Ok(())
    } else {
        anyhow::bail!("Credential key '{}' is not allowed", key)
    }
}

/// CredentialStore backed by the OS keychain via the `keyring` crate.
///
/// - Windows: Windows Credential Manager
/// - macOS: Keychain
/// - Linux: Secret Service (GNOME Keyring / KWallet)
pub struct KeyringCredentialStore;

impl Default for KeyringCredentialStore {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyringCredentialStore {
    pub fn new() -> Self {
        Self
    }

    fn entry(&self, key: &str) -> Result<keyring::Entry> {
        keyring::Entry::new("DSPanel", key).context("Failed to create keyring entry")
    }
}

impl CredentialStore for KeyringCredentialStore {
    fn store(&self, key: &str, value: &str) -> Result<()> {
        validate_key(key)?;
        self.entry(key)?
            .set_password(value)
            .context("Failed to store credential in OS keychain")
    }

    fn retrieve(&self, key: &str) -> Result<Option<String>> {
        validate_key(key)?;
        match self.entry(key)?.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(anyhow::anyhow!("Failed to retrieve credential: {}", e)),
        }
    }

    fn delete(&self, key: &str) -> Result<()> {
        validate_key(key)?;
        match self.entry(key)?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(anyhow::anyhow!("Failed to delete credential: {}", e)),
        }
    }
}

/// In-memory credential store for testing. Not persistent.
pub struct InMemoryCredentialStore {
    store: std::sync::Mutex<std::collections::HashMap<String, String>>,
}

impl Default for InMemoryCredentialStore {
    fn default() -> Self {
        Self::new()
    }
}

impl InMemoryCredentialStore {
    pub fn new() -> Self {
        Self {
            store: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }
}

impl CredentialStore for InMemoryCredentialStore {
    fn store(&self, key: &str, value: &str) -> Result<()> {
        validate_key(key)?;
        self.store
            .lock()
            .expect("lock poisoned")
            .insert(key.to_string(), value.to_string());
        Ok(())
    }

    fn retrieve(&self, key: &str) -> Result<Option<String>> {
        validate_key(key)?;
        Ok(self.store.lock().expect("lock poisoned").get(key).cloned())
    }

    fn delete(&self, key: &str) -> Result<()> {
        validate_key(key)?;
        self.store.lock().expect("lock poisoned").remove(key);
        Ok(())
    }
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_in_memory_store_retrieve() {
        let store = InMemoryCredentialStore::new();
        store.store("graph_client_secret", "my-secret").unwrap();
        let retrieved = store.retrieve("graph_client_secret").unwrap();
        assert_eq!(retrieved, Some("my-secret".to_string()));
    }

    #[test]
    fn test_in_memory_retrieve_missing_key() {
        let store = InMemoryCredentialStore::new();
        let retrieved = store.retrieve("graph_client_secret").unwrap();
        assert_eq!(retrieved, None);
    }

    #[test]
    fn test_in_memory_delete() {
        let store = InMemoryCredentialStore::new();
        store.store("graph_client_secret", "my-secret").unwrap();
        store.delete("graph_client_secret").unwrap();
        let retrieved = store.retrieve("graph_client_secret").unwrap();
        assert_eq!(retrieved, None);
    }

    #[test]
    fn test_in_memory_delete_missing_key_ok() {
        let store = InMemoryCredentialStore::new();
        assert!(store.delete("graph_client_secret").is_ok());
    }

    #[test]
    fn test_in_memory_overwrite() {
        let store = InMemoryCredentialStore::new();
        store.store("graph_client_secret", "v1").unwrap();
        store.store("graph_client_secret", "v2").unwrap();
        assert_eq!(
            store.retrieve("graph_client_secret").unwrap(),
            Some("v2".to_string()),
        );
    }

    #[test]
    fn test_validate_key_allowed() {
        assert!(validate_key("graph_client_secret").is_ok());
    }

    #[test]
    fn test_validate_key_rejected() {
        assert!(validate_key("random_key").is_err());
        assert!(validate_key("").is_err());
    }

    #[test]
    fn test_in_memory_rejects_invalid_key() {
        let store = InMemoryCredentialStore::new();
        assert!(store.store("bad_key", "value").is_err());
        assert!(store.retrieve("bad_key").is_err());
        assert!(store.delete("bad_key").is_err());
    }
}
