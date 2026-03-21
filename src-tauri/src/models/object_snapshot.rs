use serde::{Deserialize, Serialize};

/// Represents a full snapshot of an AD object's attributes at a point in time.
///
/// Unlike the lightweight `Snapshot` struct, this captures the actual attribute
/// values and persists them in SQLite for later comparison or restore.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectSnapshot {
    pub id: i64,
    pub object_dn: String,
    pub operation_type: String,
    pub timestamp: String,
    pub operator: String,
    pub attributes_json: String,
}

/// Represents a difference between a snapshot attribute value and the current value.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDiff {
    pub attribute: String,
    pub snapshot_value: Option<String>,
    pub current_value: Option<String>,
    pub changed: bool,
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_object_snapshot_serialization_camel_case() {
        let snapshot = ObjectSnapshot {
            id: 1,
            object_dn: "CN=Test,DC=example,DC=com".to_string(),
            operation_type: "ModifyAttribute".to_string(),
            timestamp: "2026-03-21T10:00:00Z".to_string(),
            operator: "admin".to_string(),
            attributes_json: "{}".to_string(),
        };
        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(json.contains("objectDn"));
        assert!(json.contains("operationType"));
        assert!(json.contains("attributesJson"));
    }

    #[test]
    fn test_object_snapshot_deserialization() {
        let json = r#"{"id":1,"objectDn":"CN=X","operationType":"Op","timestamp":"t","operator":"admin","attributesJson":"{}"}"#;
        let snapshot: ObjectSnapshot = serde_json::from_str(json).unwrap();
        assert_eq!(snapshot.id, 1);
        assert_eq!(snapshot.object_dn, "CN=X");
        assert_eq!(snapshot.operation_type, "Op");
    }

    #[test]
    fn test_object_snapshot_clone() {
        let snapshot = ObjectSnapshot {
            id: 1,
            object_dn: "dn".to_string(),
            operation_type: "op".to_string(),
            timestamp: "t".to_string(),
            operator: "admin".to_string(),
            attributes_json: "{}".to_string(),
        };
        let cloned = snapshot.clone();
        assert_eq!(cloned.id, snapshot.id);
        assert_eq!(cloned.object_dn, snapshot.object_dn);
    }

    #[test]
    fn test_snapshot_diff_serialization_camel_case() {
        let diff = SnapshotDiff {
            attribute: "mail".to_string(),
            snapshot_value: Some("old@example.com".to_string()),
            current_value: Some("new@example.com".to_string()),
            changed: true,
        };
        let json = serde_json::to_string(&diff).unwrap();
        assert!(json.contains("snapshotValue"));
        assert!(json.contains("currentValue"));
    }

    #[test]
    fn test_snapshot_diff_with_none_values() {
        let diff = SnapshotDiff {
            attribute: "title".to_string(),
            snapshot_value: None,
            current_value: Some("Manager".to_string()),
            changed: true,
        };
        let json = serde_json::to_string(&diff).unwrap();
        assert!(json.contains("\"snapshotValue\":null"));
    }

    #[test]
    fn test_snapshot_diff_unchanged() {
        let diff = SnapshotDiff {
            attribute: "cn".to_string(),
            snapshot_value: Some("John".to_string()),
            current_value: Some("John".to_string()),
            changed: false,
        };
        assert!(!diff.changed);
    }

    #[test]
    fn test_object_snapshot_debug_format() {
        let snapshot = ObjectSnapshot {
            id: 1,
            object_dn: "dn".to_string(),
            operation_type: "op".to_string(),
            timestamp: "t".to_string(),
            operator: "admin".to_string(),
            attributes_json: "{}".to_string(),
        };
        let debug = format!("{:?}", snapshot);
        assert!(debug.contains("ObjectSnapshot"));
    }
}
