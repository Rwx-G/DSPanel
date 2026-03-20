use std::sync::Mutex;

/// Record of a captured snapshot before a write operation.
#[derive(Debug, Clone)]
pub struct Snapshot {
    pub timestamp: String,
    pub target_dn: String,
    pub operation: String,
    pub attributes: Vec<(String, String)>,
}

/// Service for capturing object state before modifications.
///
/// Per coding standards: "Snapshot before modify - every write operation
/// on AD objects must call snapshot::capture() before the modification."
pub struct SnapshotService {
    snapshots: Mutex<Vec<Snapshot>>,
}

impl Default for SnapshotService {
    fn default() -> Self {
        Self::new()
    }
}

impl SnapshotService {
    pub fn new() -> Self {
        Self {
            snapshots: Mutex::new(Vec::new()),
        }
    }

    /// Captures a snapshot of the target object before modification.
    ///
    /// In a full implementation this would query the AD object and record
    /// its current attributes. For now it records the intent with a timestamp.
    pub fn capture(&self, target_dn: &str, operation: &str) {
        let snapshot = Snapshot {
            timestamp: chrono::Utc::now().to_rfc3339(),
            target_dn: target_dn.to_string(),
            operation: operation.to_string(),
            attributes: Vec::new(),
        };
        tracing::debug!(
            target_dn = %target_dn,
            operation = %operation,
            "Snapshot captured before modify"
        );
        self.snapshots.lock().expect("lock poisoned").push(snapshot);
    }

    /// Returns the number of captured snapshots.
    pub fn count(&self) -> usize {
        self.snapshots.lock().expect("lock poisoned").len()
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_capture_records_snapshot() {
        let svc = SnapshotService::new();
        svc.capture("CN=Test,DC=example,DC=com", "PasswordReset");
        assert_eq!(svc.count(), 1);
    }

    #[test]
    fn test_capture_multiple() {
        let svc = SnapshotService::new();
        svc.capture("dn1", "Op1");
        svc.capture("dn2", "Op2");
        assert_eq!(svc.count(), 2);
    }

    #[test]
    fn test_initially_empty() {
        let svc = SnapshotService::new();
        assert_eq!(svc.count(), 0);
    }

    #[test]
    fn test_default_trait() {
        let svc = SnapshotService::default();
        assert_eq!(svc.count(), 0);
    }

    #[test]
    fn test_snapshot_fields_populated() {
        let svc = SnapshotService::new();
        svc.capture("CN=User,DC=example,DC=com", "PasswordReset");
        // Access the internal snapshots to verify fields
        let snapshots = svc.snapshots.lock().unwrap();
        assert_eq!(snapshots[0].target_dn, "CN=User,DC=example,DC=com");
        assert_eq!(snapshots[0].operation, "PasswordReset");
        assert!(!snapshots[0].timestamp.is_empty());
        assert!(snapshots[0].attributes.is_empty());
    }

    #[test]
    fn test_snapshot_clone() {
        let snapshot = Snapshot {
            timestamp: "2026-03-15T00:00:00Z".to_string(),
            target_dn: "CN=Test".to_string(),
            operation: "Modify".to_string(),
            attributes: vec![("attr1".to_string(), "val1".to_string())],
        };
        let cloned = snapshot.clone();
        assert_eq!(cloned.target_dn, snapshot.target_dn);
        assert_eq!(cloned.attributes.len(), 1);
    }

    #[test]
    fn test_snapshot_debug_format() {
        let snapshot = Snapshot {
            timestamp: "t".to_string(),
            target_dn: "dn".to_string(),
            operation: "op".to_string(),
            attributes: Vec::new(),
        };
        let debug = format!("{:?}", snapshot);
        assert!(debug.contains("Snapshot"));
        assert!(debug.contains("dn"));
    }
}
