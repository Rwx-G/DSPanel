use rusqlite::Connection;
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
/// Entries are stored in a SQLite database for durability and query performance.
pub struct AuditService {
    conn: Mutex<Connection>,
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
        let persist_path = Self::resolve_persist_path();

        let conn = match &persist_path {
            Some(path) => Connection::open(path).unwrap_or_else(|e| {
                tracing::warn!(
                    "Failed to open audit DB at {}: {}, using in-memory",
                    path.display(),
                    e
                );
                Connection::open_in_memory().expect("Failed to open in-memory SQLite")
            }),
            None => Connection::open_in_memory().expect("Failed to open in-memory SQLite"),
        };

        let svc = Self {
            conn: Mutex::new(conn),
            operator,
        };
        svc.init_schema();
        svc
    }

    /// Creates an AuditService with an in-memory database (for testing).
    #[cfg(test)]
    pub fn new_in_memory() -> Self {
        let conn = Connection::open_in_memory().expect("Failed to open in-memory SQLite");
        let svc = Self {
            conn: Mutex::new(conn),
            operator: std::env::var("USERNAME").unwrap_or_else(|_| "Test".to_string()),
        };
        svc.init_schema();
        svc
    }

    fn resolve_persist_path() -> Option<PathBuf> {
        let base = std::env::var("LOCALAPPDATA")
            .or_else(|_| std::env::var("HOME"))
            .ok()?;
        let dir = PathBuf::from(base).join("DSPanel");
        if !dir.exists() {
            fs::create_dir_all(&dir).ok()?;
        }
        Some(dir.join("audit.db"))
    }

    fn init_schema(&self) {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS audit_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                operator TEXT NOT NULL,
                action TEXT NOT NULL,
                target_dn TEXT NOT NULL,
                details TEXT NOT NULL,
                success INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_entries(timestamp);
            CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_entries(action);",
        )
        .expect("Failed to initialize audit schema");
    }

    fn insert_entry(&self, entry: &AuditEntry) {
        let conn = self.conn.lock().unwrap();
        if let Err(e) = conn.execute(
            "INSERT INTO audit_entries (timestamp, operator, action, target_dn, details, success)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                entry.timestamp,
                entry.operator,
                entry.action,
                entry.target_dn,
                entry.details,
                entry.success as i32,
            ],
        ) {
            tracing::error!("Failed to insert audit entry: {}", e);
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
        self.insert_entry(&entry);
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
        self.insert_entry(&entry);
    }

    /// Returns all audit entries (most recent first).
    pub fn get_entries(&self) -> Vec<AuditEntry> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT timestamp, operator, action, target_dn, details, success
                 FROM audit_entries ORDER BY id DESC",
            )
            .expect("Failed to prepare audit query");

        stmt.query_map([], |row| {
            Ok(AuditEntry {
                timestamp: row.get(0)?,
                operator: row.get(1)?,
                action: row.get(2)?,
                target_dn: row.get(3)?,
                details: row.get(4)?,
                success: row.get::<_, i32>(5)? != 0,
            })
        })
        .expect("Failed to query audit entries")
        .filter_map(|r| r.ok())
        .collect()
    }

    /// Returns the total number of audit entries.
    pub fn count(&self) -> usize {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM audit_entries", [], |row| {
            row.get::<_, usize>(0)
        })
        .unwrap_or(0)
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
        let dir = std::env::temp_dir().join("dspanel_test_audit_sqlite");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("audit-test.db");
        let _ = fs::remove_file(&path);

        // Write
        {
            let conn = Connection::open(&path).unwrap();
            let svc = AuditService {
                conn: Mutex::new(conn),
                operator: "test".to_string(),
            };
            svc.init_schema();
            svc.log_success("TestAction", "CN=Test", "test details");
            assert_eq!(svc.count(), 1);
        }

        // Reload
        {
            let conn = Connection::open(&path).unwrap();
            let svc = AuditService {
                conn: Mutex::new(conn),
                operator: "test".to_string(),
            };
            svc.init_schema();
            assert_eq!(svc.count(), 1);
            let entries = svc.get_entries();
            assert_eq!(entries[0].action, "TestAction");
        }

        // Cleanup
        let _ = fs::remove_file(&path);
        let _ = fs::remove_dir(&dir);
    }

    #[test]
    fn test_log_success_details_preserved() {
        let svc = AuditService::new_in_memory();
        svc.log_success(
            "AccountEnabled",
            "CN=Jane,DC=corp,DC=com",
            "Account enabled by operator",
        );
        let entries = svc.get_entries();
        assert_eq!(entries[0].details, "Account enabled by operator");
        assert_eq!(entries[0].target_dn, "CN=Jane,DC=corp,DC=com");
        assert!(entries[0].success);
    }

    #[test]
    fn test_log_failure_details_preserved() {
        let svc = AuditService::new_in_memory();
        svc.log_failure(
            "AccountDisableFailed",
            "CN=Bob,DC=corp,DC=com",
            "LDAP error: insufficient access",
        );
        let entries = svc.get_entries();
        assert_eq!(entries[0].details, "LDAP error: insufficient access");
        assert!(!entries[0].success);
    }

    #[test]
    fn test_multiple_entries_persist() {
        let svc = AuditService::new_in_memory();
        svc.log_success("Action1", "dn1", "first");
        svc.log_failure("Action2", "dn2", "second failed");
        svc.log_success("Action3", "dn3", "third");
        assert_eq!(svc.count(), 3);
        let entries = svc.get_entries();
        assert_eq!(entries[0].action, "Action3");
        assert!(entries[0].success);
        assert_eq!(entries[1].action, "Action2");
        assert!(!entries[1].success);
        assert_eq!(entries[2].action, "Action1");
    }

    #[test]
    fn test_entry_deserialization() {
        let json = r#"{"timestamp":"2026-03-14","operator":"admin","action":"Test","targetDn":"CN=X","details":"d","success":true}"#;
        let entry: AuditEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.action, "Test");
        assert_eq!(entry.target_dn, "CN=X");
        assert!(entry.success);
    }

    #[test]
    fn test_init_schema_idempotent() {
        // Calling init_schema twice must not error
        let conn = Connection::open_in_memory().expect("open in-memory");
        let svc = AuditService {
            conn: Mutex::new(conn),
            operator: "test".to_string(),
        };
        svc.init_schema();
        svc.init_schema(); // second call - should be a no-op
        // Service still works after double init
        svc.log_success("Check", "dn", "idempotent");
        assert_eq!(svc.count(), 1);
    }

    #[test]
    fn test_empty_action_and_details() {
        let svc = AuditService::new_in_memory();
        svc.log_success("", "", "");
        let entries = svc.get_entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].action, "");
        assert_eq!(entries[0].details, "");
        assert_eq!(entries[0].target_dn, "");
    }

    #[test]
    fn test_count_after_mixed_success_and_failure() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn1", "ok");
        svc.log_failure("B", "dn2", "fail");
        svc.log_success("C", "dn3", "ok2");
        svc.log_failure("D", "dn4", "fail2");
        svc.log_failure("E", "dn5", "fail3");
        assert_eq!(svc.count(), 5);

        let entries = svc.get_entries();
        let success_count = entries.iter().filter(|e| e.success).count();
        let failure_count = entries.iter().filter(|e| !e.success).count();
        assert_eq!(success_count, 2);
        assert_eq!(failure_count, 3);
    }

    #[test]
    fn test_resolve_persist_path_returns_some_or_none() {
        // resolve_persist_path depends on env vars; verify it does not panic
        let result = AuditService::resolve_persist_path();
        // On CI or local, either Some or None is valid
        if let Some(path) = &result {
            assert!(path.to_string_lossy().contains("DSPanel"));
            assert!(path.to_string_lossy().contains("audit.db"));
        }
    }

    #[test]
    fn test_default_trait() {
        let svc = AuditService::default();
        assert_eq!(svc.count(), 0);
    }

    #[test]
    fn test_get_entries_empty() {
        let svc = AuditService::new_in_memory();
        let entries = svc.get_entries();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_entry_success_field_false_roundtrip() {
        let svc = AuditService::new_in_memory();
        svc.log_failure("Fail", "dn", "error msg");
        let entries = svc.get_entries();
        assert!(!entries[0].success);
    }

    #[test]
    fn test_unicode_in_fields() {
        let svc = AuditService::new_in_memory();
        svc.log_success(
            "MotDePasseReset",
            "CN=\u{00e9}l\u{00e8}ve,DC=example,DC=com",
            "R\u{00e9}initialisation du mot de passe",
        );
        let entries = svc.get_entries();
        assert!(entries[0].target_dn.contains('\u{00e9}'));
        assert!(entries[0].details.contains('\u{00e9}'));
    }

    #[test]
    fn test_large_batch_entries() {
        let svc = AuditService::new_in_memory();
        for i in 0..100 {
            if i % 2 == 0 {
                svc.log_success(&format!("Action{}", i), "dn", "ok");
            } else {
                svc.log_failure(&format!("Action{}", i), "dn", "err");
            }
        }
        assert_eq!(svc.count(), 100);
        let entries = svc.get_entries();
        assert_eq!(entries.len(), 100);
        // Most recent first
        assert_eq!(entries[0].action, "Action99");
    }
}
