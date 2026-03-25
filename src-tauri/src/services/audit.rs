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
    operator: Mutex<String>,
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
            operator: Mutex::new(operator),
        };
        svc.init_schema();
        svc
    }

    /// Updates the operator identity (called after WhoAmI resolves the
    /// authenticated user, which may differ from the Windows USERNAME).
    pub fn set_operator(&self, operator: String) {
        *self.operator.lock().expect("lock poisoned") = operator;
    }

    /// Creates an AuditService with an in-memory database (for testing).
    #[allow(clippy::unwrap_used)]
    #[cfg(test)]
    pub fn new_in_memory() -> Self {
        let conn = Connection::open_in_memory().expect("Failed to open in-memory SQLite");
        let svc = Self {
            conn: Mutex::new(conn),
            operator: Mutex::new(std::env::var("USERNAME").unwrap_or_else(|_| "Test".to_string())),
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
        let conn = self.conn.lock().expect("lock poisoned");
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
        let conn = self.conn.lock().expect("lock poisoned");
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
            operator: self.operator.lock().expect("lock poisoned").clone(),
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
            operator: self.operator.lock().expect("lock poisoned").clone(),
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
        let conn = self.conn.lock().expect("lock poisoned");
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
        let conn = self.conn.lock().expect("lock poisoned");
        conn.query_row("SELECT COUNT(*) FROM audit_entries", [], |row| {
            row.get::<_, i64>(0).map(|n| n as usize)
        })
        .unwrap_or(0)
    }

    /// Queries audit entries with optional filters and pagination.
    /// Returns matching entries and total count (for pagination).
    pub fn query_filtered(&self, filter: &AuditFilter) -> AuditQueryResult {
        let conn = self.conn.lock().expect("lock poisoned");

        let mut where_clauses: Vec<String> = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(ref from) = filter.date_from {
            where_clauses.push(format!("timestamp >= ?{}", params.len() + 1));
            params.push(Box::new(from.clone()));
        }
        if let Some(ref to) = filter.date_to {
            where_clauses.push(format!("timestamp <= ?{}", params.len() + 1));
            params.push(Box::new(to.clone()));
        }
        if let Some(ref user) = filter.operator {
            if !user.is_empty() {
                where_clauses.push(format!("operator LIKE ?{}", params.len() + 1));
                params.push(Box::new(format!("%{}%", user)));
            }
        }
        if let Some(ref action) = filter.action {
            if !action.is_empty() {
                where_clauses.push(format!("action = ?{}", params.len() + 1));
                params.push(Box::new(action.clone()));
            }
        }
        if let Some(ref target) = filter.target_dn {
            if !target.is_empty() {
                where_clauses.push(format!("target_dn LIKE ?{}", params.len() + 1));
                params.push(Box::new(format!("%{}%", target)));
            }
        }
        if let Some(success) = filter.success {
            where_clauses.push(format!("success = ?{}", params.len() + 1));
            params.push(Box::new(success as i32));
        }

        let where_sql = if where_clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_clauses.join(" AND "))
        };

        // Count total matching
        let count_sql = format!("SELECT COUNT(*) FROM audit_entries {}", where_sql);
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| &**p).collect();
        let total_count = conn
            .query_row(&count_sql, param_refs.as_slice(), |row| {
                row.get::<_, i64>(0).map(|n| n as usize)
            })
            .unwrap_or(0);

        // Fetch page
        let offset = filter.page * filter.page_size;
        let order = if filter.sort_ascending { "ASC" } else { "DESC" };
        let query_sql = format!(
            "SELECT timestamp, operator, action, target_dn, details, success
             FROM audit_entries {} ORDER BY id {} LIMIT ?{} OFFSET ?{}",
            where_sql,
            order,
            params.len() + 1,
            params.len() + 2,
        );
        params.push(Box::new(filter.page_size as i64));
        params.push(Box::new(offset as i64));

        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| &**p).collect();
        let mut stmt = conn
            .prepare(&query_sql)
            .expect("Failed to prepare filtered audit query");

        let entries = stmt
            .query_map(param_refs.as_slice(), |row| {
                Ok(AuditEntry {
                    timestamp: row.get(0)?,
                    operator: row.get(1)?,
                    action: row.get(2)?,
                    target_dn: row.get(3)?,
                    details: row.get(4)?,
                    success: row.get::<_, i32>(5)? != 0,
                })
            })
            .expect("Failed to query filtered audit entries")
            .filter_map(|r| r.ok())
            .collect();

        AuditQueryResult {
            entries,
            total_count,
        }
    }

    /// Returns distinct action types from the audit log.
    pub fn distinct_actions(&self) -> Vec<String> {
        let conn = self.conn.lock().expect("lock poisoned");
        let mut stmt = conn
            .prepare("SELECT DISTINCT action FROM audit_entries ORDER BY action")
            .expect("Failed to prepare distinct actions query");

        stmt.query_map([], |row| row.get(0))
            .expect("Failed to query distinct actions")
            .filter_map(|r| r.ok())
            .collect()
    }

    /// Deletes audit entries older than the specified number of days.
    /// Returns the number of deleted entries.
    pub fn purge_older_than(&self, retention_days: i64) -> usize {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days);
        let cutoff_str = cutoff.to_rfc3339();
        let conn = self.conn.lock().expect("lock poisoned");
        conn.execute(
            "DELETE FROM audit_entries WHERE timestamp < ?1",
            rusqlite::params![cutoff_str],
        )
        .unwrap_or(0)
    }
}

/// Filter parameters for querying audit entries.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditFilter {
    /// Start of date range (ISO 8601 / RFC 3339).
    pub date_from: Option<String>,
    /// End of date range (ISO 8601 / RFC 3339).
    pub date_to: Option<String>,
    /// Partial match on operator name.
    pub operator: Option<String>,
    /// Exact match on action type.
    pub action: Option<String>,
    /// Partial match on target DN.
    pub target_dn: Option<String>,
    /// Filter by success/failure.
    pub success: Option<bool>,
    /// Page number (0-based).
    #[serde(default)]
    pub page: usize,
    /// Page size (default 50).
    #[serde(default = "default_page_size")]
    pub page_size: usize,
    /// Sort ascending (oldest first) instead of descending (newest first).
    #[serde(default)]
    pub sort_ascending: bool,
}

fn default_page_size() -> usize {
    50
}

impl Default for AuditFilter {
    fn default() -> Self {
        Self {
            date_from: None,
            date_to: None,
            operator: None,
            action: None,
            target_dn: None,
            success: None,
            page: 0,
            page_size: 50,
            sort_ascending: false,
        }
    }
}

/// Result of a filtered audit query with pagination info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditQueryResult {
    pub entries: Vec<AuditEntry>,
    pub total_count: usize,
}

#[allow(clippy::unwrap_used)]
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
                operator: Mutex::new("test".to_string()),
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
                operator: Mutex::new("test".to_string()),
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
            operator: Mutex::new("test".to_string()),
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
        // Default uses file-backed DB which may have entries from other tests,
        // just verify it does not panic
        let _ = svc.count();
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

    // -----------------------------------------------------------------------
    // Filtered query tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_query_filtered_no_filters() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn1", "d1");
        svc.log_failure("B", "dn2", "d2");

        let result = svc.query_filtered(&AuditFilter::default());
        assert_eq!(result.total_count, 2);
        assert_eq!(result.entries.len(), 2);
    }

    #[test]
    fn test_query_filtered_by_action() {
        let svc = AuditService::new_in_memory();
        svc.log_success("PasswordReset", "dn1", "d1");
        svc.log_success("AccountEnabled", "dn2", "d2");
        svc.log_success("PasswordReset", "dn3", "d3");

        let filter = AuditFilter {
            action: Some("PasswordReset".to_string()),
            ..Default::default()
        };
        let result = svc.query_filtered(&filter);
        assert_eq!(result.total_count, 2);
        assert!(result.entries.iter().all(|e| e.action == "PasswordReset"));
    }

    #[test]
    fn test_query_filtered_by_operator() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn1", "d1");

        let filter = AuditFilter {
            operator: Some(svc.operator.lock().unwrap().clone()),
            ..Default::default()
        };
        let result = svc.query_filtered(&filter);
        assert_eq!(result.total_count, 1);
    }

    #[test]
    fn test_query_filtered_by_target_partial() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "CN=John,OU=Users,DC=test,DC=com", "d1");
        svc.log_success("B", "CN=Jane,OU=Admins,DC=test,DC=com", "d2");

        let filter = AuditFilter {
            target_dn: Some("OU=Users".to_string()),
            ..Default::default()
        };
        let result = svc.query_filtered(&filter);
        assert_eq!(result.total_count, 1);
        assert_eq!(result.entries[0].action, "A");
    }

    #[test]
    fn test_query_filtered_by_success() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn", "ok");
        svc.log_failure("B", "dn", "err");
        svc.log_success("C", "dn", "ok");

        let filter = AuditFilter {
            success: Some(false),
            ..Default::default()
        };
        let result = svc.query_filtered(&filter);
        assert_eq!(result.total_count, 1);
        assert!(!result.entries[0].success);
    }

    #[test]
    fn test_query_filtered_pagination() {
        let svc = AuditService::new_in_memory();
        for i in 0..25 {
            svc.log_success(&format!("Action{}", i), "dn", "d");
        }

        let filter = AuditFilter {
            page: 0,
            page_size: 10,
            ..Default::default()
        };
        let result = svc.query_filtered(&filter);
        assert_eq!(result.total_count, 25);
        assert_eq!(result.entries.len(), 10);

        let filter2 = AuditFilter {
            page: 2,
            page_size: 10,
            ..Default::default()
        };
        let result2 = svc.query_filtered(&filter2);
        assert_eq!(result2.entries.len(), 5);
    }

    #[test]
    fn test_query_filtered_empty_strings_ignored() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn", "d");

        let filter = AuditFilter {
            operator: Some("".to_string()),
            action: Some("".to_string()),
            target_dn: Some("".to_string()),
            ..Default::default()
        };
        let result = svc.query_filtered(&filter);
        assert_eq!(result.total_count, 1);
    }

    // -----------------------------------------------------------------------
    // Distinct actions tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_distinct_actions() {
        let svc = AuditService::new_in_memory();
        svc.log_success("PasswordReset", "dn", "d");
        svc.log_success("AccountEnabled", "dn", "d");
        svc.log_success("PasswordReset", "dn", "d");

        let actions = svc.distinct_actions();
        assert_eq!(actions.len(), 2);
        assert!(actions.contains(&"AccountEnabled".to_string()));
        assert!(actions.contains(&"PasswordReset".to_string()));
    }

    #[test]
    fn test_distinct_actions_empty() {
        let svc = AuditService::new_in_memory();
        let actions = svc.distinct_actions();
        assert!(actions.is_empty());
    }

    // -----------------------------------------------------------------------
    // Purge tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_purge_older_than() {
        let svc = AuditService::new_in_memory();

        // Insert an entry with an old timestamp directly
        let old_ts = "2020-01-01T00:00:00+00:00";
        {
            let conn = svc.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO audit_entries (timestamp, operator, action, target_dn, details, success)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![old_ts, "test", "OldAction", "dn", "old", 1],
            )
            .unwrap();
        }

        // Insert a recent entry
        svc.log_success("RecentAction", "dn", "recent");

        assert_eq!(svc.count(), 2);

        let deleted = svc.purge_older_than(365);
        assert_eq!(deleted, 1);
        assert_eq!(svc.count(), 1);

        let entries = svc.get_entries();
        assert_eq!(entries[0].action, "RecentAction");
    }

    #[test]
    fn test_purge_nothing_to_delete() {
        let svc = AuditService::new_in_memory();
        svc.log_success("Recent", "dn", "d");
        let deleted = svc.purge_older_than(365);
        assert_eq!(deleted, 0);
        assert_eq!(svc.count(), 1);
    }
}
