use serde::{Deserialize, Serialize};

/// Represents a replication partnership between two domain controllers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicationPartnership {
    /// Source DC hostname.
    pub source_dc: String,
    /// Target DC hostname.
    pub target_dc: String,
    /// Naming context being replicated (e.g., "DC=example,DC=com").
    pub naming_context: String,
    /// Last successful replication time (ISO 8601), if available.
    pub last_sync_time: Option<String>,
    /// Result of the last replication attempt (0 = success).
    pub last_sync_result: u32,
    /// Number of consecutive failures.
    pub consecutive_failures: u32,
    /// Error message from the last failed replication, if any.
    pub last_sync_message: Option<String>,
    /// Overall status of this partnership.
    pub status: ReplicationStatus,
}

/// Status of a replication partnership.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReplicationStatus {
    Healthy,
    Warning,
    Failed,
    Unknown,
}

/// Computes the replication status based on result code and latency.
pub fn compute_replication_status(
    last_sync_result: u32,
    last_sync_time: Option<&str>,
    now_ms: i64,
) -> ReplicationStatus {
    if last_sync_result != 0 {
        return ReplicationStatus::Failed;
    }

    if let Some(sync_time) = last_sync_time {
        if let Ok(sync_ms) = parse_date_to_ms(sync_time) {
            let elapsed_minutes = (now_ms - sync_ms) / 60_000;
            if elapsed_minutes > 60 {
                return ReplicationStatus::Warning;
            }
        }
    }

    ReplicationStatus::Healthy
}

/// Computes a human-readable latency string from a sync time.
pub fn format_latency(last_sync_time: Option<&str>, now_ms: i64) -> String {
    let Some(sync_time) = last_sync_time else {
        return "N/A".to_string();
    };

    let Ok(sync_ms) = parse_date_to_ms(sync_time) else {
        return "N/A".to_string();
    };

    let elapsed_seconds = (now_ms - sync_ms) / 1000;
    if elapsed_seconds < 0 {
        return "just now".to_string();
    }

    if elapsed_seconds < 60 {
        format!("{}s ago", elapsed_seconds)
    } else if elapsed_seconds < 3600 {
        format!("{}m ago", elapsed_seconds / 60)
    } else if elapsed_seconds < 86400 {
        format!("{}h ago", elapsed_seconds / 3600)
    } else {
        format!("{}d ago", elapsed_seconds / 86400)
    }
}

/// Parses an ISO 8601 date string to milliseconds since Unix epoch.
fn parse_date_to_ms(date_str: &str) -> Result<i64, ()> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(date_str) {
        return Ok(dt.timestamp_millis());
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S%.f") {
        return Ok(dt.and_utc().timestamp_millis());
    }
    if let Ok(d) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
        return Ok(d
            .and_hms_opt(0, 0, 0)
            .expect("midnight is always valid")
            .and_utc()
            .timestamp_millis());
    }
    Err(())
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    fn now_ms() -> i64 {
        chrono::NaiveDate::from_ymd_opt(2026, 3, 21)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis()
    }

    #[test]
    fn test_healthy_replication() {
        let status = compute_replication_status(0, Some("2026-03-21T11:50:00Z"), now_ms());
        assert_eq!(status, ReplicationStatus::Healthy);
    }

    #[test]
    fn test_failed_replication() {
        let status = compute_replication_status(8453, Some("2026-03-21T11:50:00Z"), now_ms());
        assert_eq!(status, ReplicationStatus::Failed);
    }

    #[test]
    fn test_warning_old_sync() {
        // Last sync > 1 hour ago
        let status = compute_replication_status(0, Some("2026-03-21T10:00:00Z"), now_ms());
        assert_eq!(status, ReplicationStatus::Warning);
    }

    #[test]
    fn test_healthy_no_sync_time() {
        let status = compute_replication_status(0, None, now_ms());
        assert_eq!(status, ReplicationStatus::Healthy);
    }

    #[test]
    fn test_format_latency_seconds() {
        // 30 seconds ago
        let sync_time = "2026-03-21T11:59:30Z";
        let result = format_latency(Some(sync_time), now_ms());
        assert_eq!(result, "30s ago");
    }

    #[test]
    fn test_format_latency_minutes() {
        // 10 minutes ago
        let sync_time = "2026-03-21T11:50:00Z";
        let result = format_latency(Some(sync_time), now_ms());
        assert_eq!(result, "10m ago");
    }

    #[test]
    fn test_format_latency_hours() {
        // 3 hours ago
        let sync_time = "2026-03-21T09:00:00Z";
        let result = format_latency(Some(sync_time), now_ms());
        assert_eq!(result, "3h ago");
    }

    #[test]
    fn test_format_latency_days() {
        // 2 days ago
        let sync_time = "2026-03-19T12:00:00Z";
        let result = format_latency(Some(sync_time), now_ms());
        assert_eq!(result, "2d ago");
    }

    #[test]
    fn test_format_latency_none() {
        assert_eq!(format_latency(None, now_ms()), "N/A");
    }

    #[test]
    fn test_format_latency_invalid_date() {
        assert_eq!(format_latency(Some("not-a-date"), now_ms()), "N/A");
    }

    #[test]
    fn test_serialization_uses_camel_case() {
        let partnership = ReplicationPartnership {
            source_dc: "DC1".to_string(),
            target_dc: "DC2".to_string(),
            naming_context: "DC=example,DC=com".to_string(),
            last_sync_time: Some("2026-03-21T12:00:00Z".to_string()),
            last_sync_result: 0,
            consecutive_failures: 0,
            last_sync_message: None,
            status: ReplicationStatus::Healthy,
        };
        let json = serde_json::to_string(&partnership).unwrap();
        assert!(json.contains("sourceDc"));
        assert!(json.contains("namingContext"));
        assert!(json.contains("lastSyncTime"));
        assert!(json.contains("consecutiveFailures"));
    }
}
