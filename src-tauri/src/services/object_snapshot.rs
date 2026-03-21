use crate::models::ObjectSnapshot;
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

/// Service for capturing and managing full AD object snapshots in SQLite.
///
/// Unlike the lightweight `SnapshotService` (which records intent markers),
/// this service stores the actual attribute values of AD objects before
/// modifications, enabling diff comparison and restore operations.
pub struct ObjectSnapshotService {
    /// SQLite connection. `pub(crate)` for test access only.
    pub(crate) conn: Mutex<Connection>,
}

impl Default for ObjectSnapshotService {
    fn default() -> Self {
        Self::new()
    }
}

impl ObjectSnapshotService {
    /// Creates a new service backed by a SQLite file in LOCALAPPDATA/DSPanel/.
    pub fn new() -> Self {
        let persist_path = Self::resolve_persist_path();

        let conn = match &persist_path {
            Some(path) => Connection::open(path).unwrap_or_else(|e| {
                tracing::warn!(
                    "Failed to open snapshot DB at {}: {}, using in-memory",
                    path.display(),
                    e
                );
                Connection::open_in_memory().expect("Failed to open in-memory SQLite")
            }),
            None => Connection::open_in_memory().expect("Failed to open in-memory SQLite"),
        };

        let svc = Self {
            conn: Mutex::new(conn),
        };
        svc.init_schema();
        svc
    }

    /// Creates a service with an in-memory database (for testing).
    #[allow(clippy::unwrap_used)]
    #[cfg(test)]
    pub fn new_in_memory() -> Self {
        let conn = Connection::open_in_memory().expect("Failed to open in-memory SQLite");
        let svc = Self {
            conn: Mutex::new(conn),
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
        Some(dir.join("snapshots.db"))
    }

    fn init_schema(&self) {
        let conn = self.conn.lock().expect("lock poisoned");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS object_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                object_dn TEXT NOT NULL,
                operation_type TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                operator TEXT NOT NULL DEFAULT '',
                attributes_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_snapshots_dn ON object_snapshots(object_dn);
            CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON object_snapshots(timestamp);",
        )
        .expect("Failed to initialize snapshot schema");
    }

    /// Captures a snapshot storing the provided attributes JSON.
    /// Returns the row ID of the inserted snapshot.
    pub fn capture(
        &self,
        object_dn: &str,
        operation_type: &str,
        attributes_json: &str,
        operator: &str,
    ) -> i64 {
        let timestamp = chrono::Utc::now().to_rfc3339();

        let conn = self.conn.lock().expect("lock poisoned");
        if let Err(e) = conn.execute(
            "INSERT INTO object_snapshots (object_dn, operation_type, timestamp, operator, attributes_json)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![object_dn, operation_type, timestamp, operator, attributes_json],
        ) {
            tracing::error!("Failed to insert object snapshot: {}", e);
            return -1;
        }

        conn.last_insert_rowid()
    }

    /// Gets snapshot history for an object DN, ordered by timestamp desc.
    pub fn get_history(&self, object_dn: &str) -> Vec<ObjectSnapshot> {
        let conn = self.conn.lock().expect("lock poisoned");
        let mut stmt = conn
            .prepare(
                "SELECT id, object_dn, operation_type, timestamp, operator, attributes_json
                 FROM object_snapshots
                 WHERE object_dn = ?1
                 ORDER BY id DESC",
            )
            .expect("Failed to prepare snapshot history query");

        stmt.query_map(rusqlite::params![object_dn], |row| {
            Ok(ObjectSnapshot {
                id: row.get(0)?,
                object_dn: row.get(1)?,
                operation_type: row.get(2)?,
                timestamp: row.get(3)?,
                operator: row.get(4)?,
                attributes_json: row.get(5)?,
            })
        })
        .expect("Failed to query snapshot history")
        .filter_map(|r| r.ok())
        .collect()
    }

    /// Gets a single snapshot by ID.
    pub fn get_snapshot(&self, id: i64) -> Option<ObjectSnapshot> {
        let conn = self.conn.lock().expect("lock poisoned");
        let mut stmt = conn
            .prepare(
                "SELECT id, object_dn, operation_type, timestamp, operator, attributes_json
                 FROM object_snapshots
                 WHERE id = ?1",
            )
            .expect("Failed to prepare snapshot query");

        stmt.query_row(rusqlite::params![id], |row| {
            Ok(ObjectSnapshot {
                id: row.get(0)?,
                object_dn: row.get(1)?,
                operation_type: row.get(2)?,
                timestamp: row.get(3)?,
                operator: row.get(4)?,
                attributes_json: row.get(5)?,
            })
        })
        .ok()
    }

    /// Deletes snapshots older than `days` days. Returns count deleted.
    /// Deletes a single snapshot by ID.
    pub fn delete_snapshot(&self, id: i64) -> bool {
        let conn = self.conn.lock().expect("lock poisoned");
        conn.execute(
            "DELETE FROM object_snapshots WHERE id = ?1",
            rusqlite::params![id],
        )
        .map(|n| n > 0)
        .unwrap_or(false)
    }

    pub fn cleanup_expired(&self, days: i64) -> usize {
        let conn = self.conn.lock().expect("lock poisoned");
        let cutoff = chrono::Utc::now() - chrono::Duration::days(days);
        let cutoff_str = cutoff.to_rfc3339();

        conn.execute(
            "DELETE FROM object_snapshots WHERE timestamp < ?1",
            rusqlite::params![cutoff_str],
        )
        .unwrap_or(0)
    }

    /// Returns total snapshot count.
    pub fn count(&self) -> usize {
        let conn = self.conn.lock().expect("lock poisoned");
        conn.query_row("SELECT COUNT(*) FROM object_snapshots", [], |row| {
            row.get::<_, usize>(0)
        })
        .unwrap_or(0)
    }
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_capture_returns_positive_id() {
        let svc = ObjectSnapshotService::new_in_memory();
        let id = svc.capture(
            "CN=Test,DC=example,DC=com",
            "ModifyAttribute",
            r#"{"mail":["test@example.com"]}"#,
            "test",
        );
        assert!(id > 0);
    }

    #[test]
    fn test_capture_increments_id() {
        let svc = ObjectSnapshotService::new_in_memory();
        let id1 = svc.capture("dn1", "Op1", "{}", "test");
        let id2 = svc.capture("dn2", "Op2", "{}", "test");
        assert!(id2 > id1);
    }

    #[test]
    fn test_get_snapshot_by_id() {
        let svc = ObjectSnapshotService::new_in_memory();
        let id = svc.capture(
            "CN=User,DC=example,DC=com",
            "PasswordReset",
            r#"{"attr":"val"}"#,
            "test",
        );
        let snapshot = svc.get_snapshot(id).unwrap();
        assert_eq!(snapshot.id, id);
        assert_eq!(snapshot.object_dn, "CN=User,DC=example,DC=com");
        assert_eq!(snapshot.operation_type, "PasswordReset");
        assert_eq!(snapshot.attributes_json, r#"{"attr":"val"}"#);
    }

    #[test]
    fn test_get_snapshot_not_found() {
        let svc = ObjectSnapshotService::new_in_memory();
        assert!(svc.get_snapshot(999).is_none());
    }

    #[test]
    fn test_get_history_returns_matching_dn_only() {
        let svc = ObjectSnapshotService::new_in_memory();
        svc.capture("dn1", "Op1", "{}", "test");
        svc.capture("dn2", "Op2", "{}", "test");
        svc.capture("dn1", "Op3", "{}", "test");

        let history = svc.get_history("dn1");
        assert_eq!(history.len(), 2);
        for s in &history {
            assert_eq!(s.object_dn, "dn1");
        }
    }

    #[test]
    fn test_get_history_ordered_by_most_recent_first() {
        let svc = ObjectSnapshotService::new_in_memory();
        svc.capture("dn1", "First", "{}", "test");
        svc.capture("dn1", "Second", "{}", "test");
        svc.capture("dn1", "Third", "{}", "test");

        let history = svc.get_history("dn1");
        assert_eq!(history.len(), 3);
        assert_eq!(history[0].operation_type, "Third");
        assert_eq!(history[1].operation_type, "Second");
        assert_eq!(history[2].operation_type, "First");
    }

    #[test]
    fn test_get_history_empty_for_unknown_dn() {
        let svc = ObjectSnapshotService::new_in_memory();
        svc.capture("dn1", "Op", "{}", "test");
        assert!(svc.get_history("unknown").is_empty());
    }

    #[test]
    fn test_count_returns_total() {
        let svc = ObjectSnapshotService::new_in_memory();
        assert_eq!(svc.count(), 0);
        svc.capture("dn1", "Op1", "{}", "test");
        svc.capture("dn2", "Op2", "{}", "test");
        assert_eq!(svc.count(), 2);
    }

    #[test]
    fn test_cleanup_expired_removes_old_entries() {
        let svc = ObjectSnapshotService::new_in_memory();

        // Insert a snapshot with a very old timestamp manually
        {
            let conn = svc.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO object_snapshots (object_dn, operation_type, timestamp, operator, attributes_json)
                 VALUES ('old_dn', 'OldOp', '2020-01-01T00:00:00Z', 'test', '{}')",
                [],
            )
            .unwrap();
        }

        // Insert a fresh one via the normal API
        svc.capture("new_dn", "NewOp", "{}", "test");

        assert_eq!(svc.count(), 2);

        let deleted = svc.cleanup_expired(30);
        assert_eq!(deleted, 1);
        assert_eq!(svc.count(), 1);

        let remaining = svc.get_history("new_dn");
        assert_eq!(remaining.len(), 1);
    }

    #[test]
    fn test_cleanup_expired_large_retention_keeps_all() {
        let svc = ObjectSnapshotService::new_in_memory();
        svc.capture("dn1", "Op", "{}", "test");
        // With a very large retention, nothing should be deleted
        let deleted = svc.cleanup_expired(365);
        assert_eq!(deleted, 0);
        assert_eq!(svc.count(), 1);
    }

    #[test]
    fn test_snapshot_has_operator() {
        let svc = ObjectSnapshotService::new_in_memory();
        let id = svc.capture("dn", "Op", "{}", "test");
        let snapshot = svc.get_snapshot(id).unwrap();
        assert!(!snapshot.operator.is_empty());
    }

    #[test]
    fn test_snapshot_has_timestamp() {
        let svc = ObjectSnapshotService::new_in_memory();
        let id = svc.capture("dn", "Op", "{}", "test");
        let snapshot = svc.get_snapshot(id).unwrap();
        assert!(!snapshot.timestamp.is_empty());
    }

    #[test]
    fn test_init_schema_idempotent() {
        let conn = Connection::open_in_memory().expect("open in-memory");
        let svc = ObjectSnapshotService {
            conn: Mutex::new(conn),
        };
        svc.init_schema();
        svc.init_schema(); // second call - should be a no-op
        svc.capture("dn", "Op", "{}", "test");
        assert_eq!(svc.count(), 1);
    }

    #[test]
    fn test_unicode_in_fields() {
        let svc = ObjectSnapshotService::new_in_memory();
        let id = svc.capture(
            "CN=\u{00e9}l\u{00e8}ve,DC=example,DC=com",
            "Modification",
            r#"{"displayName":["\u00e9l\u00e8ve"]}"#,
            "test",
        );
        let snapshot = svc.get_snapshot(id).unwrap();
        assert!(snapshot.object_dn.contains('\u{00e9}'));
    }

    #[test]
    fn test_large_attributes_json() {
        let svc = ObjectSnapshotService::new_in_memory();
        let large_json = format!(r#"{{"data":"{}"}}"#, "x".repeat(10_000));
        let id = svc.capture("dn", "Op", &large_json, "test");
        let snapshot = svc.get_snapshot(id).unwrap();
        assert_eq!(snapshot.attributes_json.len(), large_json.len());
    }

    #[test]
    fn test_default_trait() {
        let svc = ObjectSnapshotService::default();
        let _ = svc.count();
    }

    #[test]
    fn test_persist_and_reload() {
        let dir = std::env::temp_dir().join("dspanel_test_obj_snapshot_sqlite");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("snapshot-test.db");
        let _ = fs::remove_file(&path);

        // Write
        {
            let conn = Connection::open(&path).unwrap();
            let svc = ObjectSnapshotService {
                conn: Mutex::new(conn),
            };
            svc.init_schema();
            svc.capture("CN=Test", "TestOp", r#"{"a":"b"}"#, "test");
            assert_eq!(svc.count(), 1);
        }

        // Reload
        {
            let conn = Connection::open(&path).unwrap();
            let svc = ObjectSnapshotService {
                conn: Mutex::new(conn),
            };
            svc.init_schema();
            assert_eq!(svc.count(), 1);
            let history = svc.get_history("CN=Test");
            assert_eq!(history[0].operation_type, "TestOp");
        }

        // Cleanup
        let _ = fs::remove_file(&path);
        let _ = fs::remove_dir(&dir);
    }
}
