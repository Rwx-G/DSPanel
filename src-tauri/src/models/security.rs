use serde::{Deserialize, Serialize};

/// Severity level for security alerts on privileged accounts.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum AlertSeverity {
    Info,
    Medium,
    High,
    Critical,
}

/// A security alert raised on a privileged account.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityAlert {
    /// The severity of this alert.
    pub severity: AlertSeverity,
    /// Human-readable description of the issue.
    pub message: String,
    /// Machine-readable alert type for filtering.
    pub alert_type: String,
}

/// Information about a privileged account with computed alerts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivilegedAccountInfo {
    /// The distinguished name of the account.
    pub distinguished_name: String,
    /// The sAMAccountName (login name).
    pub sam_account_name: String,
    /// Display name of the account.
    pub display_name: String,
    /// Which privileged groups this account belongs to.
    pub privileged_groups: Vec<String>,
    /// Last logon timestamp (ISO 8601), or null if never logged on.
    pub last_logon: Option<String>,
    /// Number of days since the password was last set.
    pub password_age_days: Option<i64>,
    /// Password expiry date (ISO 8601), or null if never expires.
    pub password_expiry_date: Option<String>,
    /// Whether the account is enabled.
    pub enabled: bool,
    /// Whether the password is set to never expire.
    pub password_never_expires: bool,
    /// Computed security alerts for this account.
    pub alerts: Vec<SecurityAlert>,
}

/// Summary of alert counts by severity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertSummary {
    pub critical: usize,
    pub high: usize,
    pub medium: usize,
    pub info: usize,
}

/// Full result returned by the privileged accounts scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivilegedAccountsReport {
    /// All privileged accounts with their alerts.
    pub accounts: Vec<PrivilegedAccountInfo>,
    /// Summary of alert counts.
    pub summary: AlertSummary,
    /// Timestamp of when this scan was performed (ISO 8601).
    pub scanned_at: String,
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_alert_severity_ordering() {
        assert!(AlertSeverity::Critical > AlertSeverity::High);
        assert!(AlertSeverity::High > AlertSeverity::Medium);
        assert!(AlertSeverity::Medium > AlertSeverity::Info);
    }

    #[test]
    fn test_security_alert_serialization() {
        let alert = SecurityAlert {
            severity: AlertSeverity::Critical,
            message: "Password older than 90 days".to_string(),
            alert_type: "password_age".to_string(),
        };
        let json = serde_json::to_string(&alert).unwrap();
        assert!(json.contains("alertType"));
        assert!(json.contains("Critical"));
    }

    #[test]
    fn test_privileged_account_info_serialization() {
        let account = PrivilegedAccountInfo {
            distinguished_name: "CN=Admin,OU=Users,DC=example,DC=com".to_string(),
            sam_account_name: "admin".to_string(),
            display_name: "Administrator".to_string(),
            privileged_groups: vec!["Domain Admins".to_string()],
            last_logon: Some("2026-03-20T10:00:00Z".to_string()),
            password_age_days: Some(45),
            password_expiry_date: Some("2026-06-01T00:00:00Z".to_string()),
            enabled: true,
            password_never_expires: false,
            alerts: vec![],
        };
        let json = serde_json::to_string(&account).unwrap();
        assert!(json.contains("samAccountName"));
        assert!(json.contains("privilegedGroups"));
        assert!(json.contains("passwordAgeDays"));
        assert!(json.contains("passwordNeverExpires"));
    }

    #[test]
    fn test_privileged_accounts_report_serialization() {
        let report = PrivilegedAccountsReport {
            accounts: vec![],
            summary: AlertSummary {
                critical: 2,
                high: 1,
                medium: 0,
                info: 3,
            },
            scanned_at: "2026-03-23T10:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&report).unwrap();
        assert!(json.contains("scannedAt"));
        assert!(json.contains("\"critical\":2"));
    }

    #[test]
    fn test_alert_summary_serialization() {
        let summary = AlertSummary {
            critical: 1,
            high: 2,
            medium: 3,
            info: 4,
        };
        let json = serde_json::to_string(&summary).unwrap();
        let deserialized: AlertSummary = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.critical, 1);
        assert_eq!(deserialized.high, 2);
        assert_eq!(deserialized.medium, 3);
        assert_eq!(deserialized.info, 4);
    }
}
