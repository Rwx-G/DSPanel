use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

/// Represents a single audit log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub timestamp: String,
    pub operator: String,
    pub action: String,
    pub target_dn: String,
    pub details: String,
    pub success: bool,
}

/// Service for recording audit trail of sensitive operations.
///
/// Every write operation (password reset, account enable/disable, flag changes)
/// must be logged through this service. Password values are never recorded.
/// Entries are kept in memory and persisted to a JSON file for durability.
pub struct AuditService {
    entries: Mutex<Vec<AuditEntry>>,
    operator: String,
    persist_path: Option<PathBuf>,
}

impl Default for AuditService {
    fn default() -> Self {
        Self::new()
    }
}

impl AuditService {
    pub fn new() -> Self {
        let operator = std::env::var("USERNAME").unwrap_or_else(|_| "Unknown".to_string());
        let persist_path = Self::resolve_persist_path();
        let entries = persist_path
            .as_ref()
            .and_then(Self::load_from_file)
            .unwrap_or_default();

        Self {
            entries: Mutex::new(entries),
            operator,
            persist_path,
        }
    }

    /// Creates an AuditService without file persistence (for testing).
    #[cfg(test)]
    pub fn new_in_memory() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
            operator: std::env::var("USERNAME").unwrap_or_else(|_| "Test".to_string()),
            persist_path: None,
        }
    }

    fn resolve_persist_path() -> Option<PathBuf> {
        let base = std::env::var("LOCALAPPDATA")
            .or_else(|_| std::env::var("HOME"))
            .ok()?;
        let dir = PathBuf::from(base).join("DSPanel");
        if !dir.exists() {
            fs::create_dir_all(&dir).ok()?;
        }
        Some(dir.join("audit-log.json"))
    }

    fn load_from_file(path: &PathBuf) -> Option<Vec<AuditEntry>> {
        let data = fs::read_to_string(path).ok()?;
        serde_json::from_str(&data).ok()
    }

    fn persist(&self) {
        if let Some(ref path) = self.persist_path {
            let entries = self.entries.lock().unwrap();
            if let Ok(json) = serde_json::to_string_pretty(&*entries) {
                if let Err(e) = fs::write(path, json) {
                    tracing::warn!("Failed to persist audit log: {}", e);
                }
            }
        }
    }

    /// Logs a successful operation.
    pub fn log_success(&self, action: &str, target_dn: &str, details: &str) {
        let entry = AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            operator: self.operator.clone(),
            action: action.to_string(),
            target_dn: target_dn.to_string(),
            details: details.to_string(),
            success: true,
        };
        tracing::info!(
            action = %entry.action,
            target = %entry.target_dn,
            operator = %entry.operator,
            "Audit: {}",
            details
        );
        self.entries.lock().unwrap().push(entry);
        self.persist();
    }

    /// Logs a failed operation.
    pub fn log_failure(&self, action: &str, target_dn: &str, error: &str) {
        let entry = AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            operator: self.operator.clone(),
            action: action.to_string(),
            target_dn: target_dn.to_string(),
            details: error.to_string(),
            success: false,
        };
        tracing::warn!(
            action = %entry.action,
            target = %entry.target_dn,
            operator = %entry.operator,
            "Audit FAILED: {}",
            error
        );
        self.entries.lock().unwrap().push(entry);
        self.persist();
    }

    /// Returns all audit entries (most recent first).
    pub fn get_entries(&self) -> Vec<AuditEntry> {
        let mut entries = self.entries.lock().unwrap().clone();
        entries.reverse();
        entries
    }

    /// Returns the total number of audit entries.
    pub fn count(&self) -> usize {
        self.entries.lock().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_success_records_entry() {
        let svc = AuditService::new_in_memory();
        svc.log_success(
            "PasswordReset",
            "CN=John,DC=example,DC=com",
            "Password reset by operator",
        );
        let entries = svc.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].success);
        assert_eq!(entries[0].action, "PasswordReset");
        assert_eq!(entries[0].target_dn, "CN=John,DC=example,DC=com");
    }

    #[test]
    fn test_log_failure_records_entry() {
        let svc = AuditService::new_in_memory();
        svc.log_failure(
            "PasswordResetFailed",
            "CN=John,DC=example,DC=com",
            "Insufficient rights",
        );
        let entries = svc.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].success);
        assert_eq!(entries[0].action, "PasswordResetFailed");
    }

    #[test]
    fn test_entries_returned_most_recent_first() {
        let svc = AuditService::new_in_memory();
        svc.log_success("Action1", "dn1", "first");
        svc.log_success("Action2", "dn2", "second");
        let entries = svc.get_entries();
        assert_eq!(entries[0].action, "Action2");
        assert_eq!(entries[1].action, "Action1");
    }

    #[test]
    fn test_count_returns_correct_count() {
        let svc = AuditService::new_in_memory();
        assert_eq!(svc.count(), 0);
        svc.log_success("A", "dn", "d");
        svc.log_failure("B", "dn", "e");
        assert_eq!(svc.count(), 2);
    }

    #[test]
    fn test_entry_has_operator() {
        let svc = AuditService::new_in_memory();
        svc.log_success("Test", "dn", "details");
        let entries = svc.get_entries();
        assert!(!entries[0].operator.is_empty());
    }

    #[test]
    fn test_entry_has_timestamp() {
        let svc = AuditService::new_in_memory();
        svc.log_success("Test", "dn", "details");
        let entries = svc.get_entries();
        assert!(!entries[0].timestamp.is_empty());
    }

    #[test]
    fn test_entry_serialization() {
        let entry = AuditEntry {
            timestamp: "2026-03-14T10:00:00Z".to_string(),
            operator: "admin".to_string(),
            action: "PasswordReset".to_string(),
            target_dn: "CN=Test,DC=example,DC=com".to_string(),
            details: "Reset by admin".to_string(),
            success: true,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("targetDn")); // camelCase
        assert!(json.contains("PasswordReset"));
    }

    #[test]
    fn test_persist_and_reload() {
        let dir = std::env::temp_dir().join("dspanel_test_audit");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("audit-test.json");

        // Write
        {
            let svc = AuditService {
                entries: Mutex::new(Vec::new()),
                operator: "test".to_string(),
                persist_path: Some(path.clone()),
            };
            svc.log_success("TestAction", "CN=Test", "test details");
            assert_eq!(svc.count(), 1);
        }

        // Reload
        let loaded = AuditService::load_from_file(&path);
        assert!(loaded.is_some());
        let entries = loaded.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].action, "TestAction");

        // Cleanup
        let _ = fs::remove_file(&path);
        let _ = fs::remove_dir(&dir);
    }
}
