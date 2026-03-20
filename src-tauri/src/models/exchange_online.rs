use serde::{Deserialize, Serialize};

/// Exchange Online mailbox information retrieved via Microsoft Graph API.
///
/// All fields are read-only. The struct is populated when Graph integration
/// is configured and the user has an Exchange Online mailbox.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeOnlineInfo {
    pub primary_smtp_address: String,
    pub email_aliases: Vec<String>,
    pub forwarding_smtp_address: Option<String>,
    pub auto_reply_status: String,
    pub mailbox_usage_bytes: u64,
    pub mailbox_quota_bytes: u64,
    pub usage_percentage: f64,
    pub delegates: Vec<String>,
}

/// Computes the usage percentage from usage and quota bytes.
///
/// Returns 0.0 if quota is 0 (avoids division by zero).
pub fn compute_usage_percentage(usage_bytes: u64, quota_bytes: u64) -> f64 {
    if quota_bytes == 0 {
        return 0.0;
    }
    (usage_bytes as f64 / quota_bytes as f64) * 100.0
}

/// Formats byte count as a human-readable size string.
pub fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_usage_percentage_normal() {
        let pct = compute_usage_percentage(500_000_000, 1_000_000_000);
        assert!((pct - 50.0).abs() < 0.01);
    }

    #[test]
    fn test_compute_usage_percentage_zero_quota() {
        assert_eq!(compute_usage_percentage(100, 0), 0.0);
    }

    #[test]
    fn test_compute_usage_percentage_full() {
        let pct = compute_usage_percentage(1_000, 1_000);
        assert!((pct - 100.0).abs() < 0.01);
    }

    #[test]
    fn test_compute_usage_percentage_empty() {
        assert_eq!(compute_usage_percentage(0, 1_000_000), 0.0);
    }

    #[test]
    fn test_format_bytes_gb() {
        assert_eq!(format_bytes(2_147_483_648), "2.0 GB");
    }

    #[test]
    fn test_format_bytes_mb() {
        assert_eq!(format_bytes(52_428_800), "50.0 MB");
    }

    #[test]
    fn test_format_bytes_kb() {
        assert_eq!(format_bytes(10_240), "10.0 KB");
    }

    #[test]
    fn test_format_bytes_bytes() {
        assert_eq!(format_bytes(512), "512 B");
    }

    #[test]
    fn test_format_bytes_zero() {
        assert_eq!(format_bytes(0), "0 B");
    }

    #[test]
    fn test_serialization_roundtrip() {
        let info = ExchangeOnlineInfo {
            primary_smtp_address: "user@example.com".to_string(),
            email_aliases: vec!["alias@example.com".to_string()],
            forwarding_smtp_address: Some("forward@example.com".to_string()),
            auto_reply_status: "Disabled".to_string(),
            mailbox_usage_bytes: 500_000_000,
            mailbox_quota_bytes: 1_000_000_000,
            usage_percentage: 50.0,
            delegates: vec!["CN=Alice,DC=example,DC=com".to_string()],
        };
        let json = serde_json::to_string(&info).unwrap();
        let deserialized: ExchangeOnlineInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(info, deserialized);
    }

    #[test]
    fn test_serialization_uses_camel_case() {
        let info = ExchangeOnlineInfo {
            primary_smtp_address: "user@example.com".to_string(),
            email_aliases: vec![],
            forwarding_smtp_address: None,
            auto_reply_status: "Disabled".to_string(),
            mailbox_usage_bytes: 0,
            mailbox_quota_bytes: 0,
            usage_percentage: 0.0,
            delegates: vec![],
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("primarySmtpAddress"));
        assert!(json.contains("emailAliases"));
        assert!(json.contains("forwardingSmtpAddress"));
        assert!(json.contains("autoReplyStatus"));
        assert!(json.contains("mailboxUsageBytes"));
        assert!(json.contains("mailboxQuotaBytes"));
        assert!(json.contains("usagePercentage"));
    }
}
