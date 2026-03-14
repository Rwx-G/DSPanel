use serde::{Deserialize, Serialize};
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
pub struct AuditService {
    entries: Mutex<Vec<AuditEntry>>,
    operator: String,
}

impl Default for AuditService {
    fn default() -> Self {
        Self::new()
    }
}

impl AuditService {
    pub fn new() -> Self {
        let operator = std::env::var("USERNAME").unwrap_or_else(|_| "Unknown".to_string());
        Self {
            entries: Mutex::new(Vec::new()),
            operator,
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
        let svc = AuditService::new();
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
        let svc = AuditService::new();
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
        let svc = AuditService::new();
        svc.log_success("Action1", "dn1", "first");
        svc.log_success("Action2", "dn2", "second");
        let entries = svc.get_entries();
        assert_eq!(entries[0].action, "Action2");
        assert_eq!(entries[1].action, "Action1");
    }

    #[test]
    fn test_count_returns_correct_count() {
        let svc = AuditService::new();
        assert_eq!(svc.count(), 0);
        svc.log_success("A", "dn", "d");
        svc.log_failure("B", "dn", "e");
        assert_eq!(svc.count(), 2);
    }

    #[test]
    fn test_entry_has_operator() {
        let svc = AuditService::new();
        svc.log_success("Test", "dn", "details");
        let entries = svc.get_entries();
        assert!(!entries[0].operator.is_empty());
    }

    #[test]
    fn test_entry_has_timestamp() {
        let svc = AuditService::new();
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
}
