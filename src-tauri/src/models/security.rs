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

// ---------------------------------------------------------------------------
// Domain Risk Score models (Story 9.2)
// ---------------------------------------------------------------------------

/// A single risk factor contributing to the domain risk score.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskFactor {
    /// Machine-readable identifier (e.g., "privileged_hygiene").
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Individual factor score (0-100, higher is better).
    pub score: f64,
    /// Weight of this factor as a percentage (0-100).
    pub weight: f64,
    /// Explanation of the score.
    pub explanation: String,
    /// Actionable recommendations if score is below threshold.
    pub recommendations: Vec<String>,
}

/// Color zone for the risk gauge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RiskZone {
    Red,
    Orange,
    Green,
}

/// Result of a domain risk score computation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskScoreResult {
    /// Overall weighted risk score (0-100).
    pub total_score: f64,
    /// Color zone based on the total score.
    pub zone: RiskZone,
    /// Individual factor breakdowns.
    pub factors: Vec<RiskFactor>,
    /// Timestamp of computation (ISO 8601).
    pub computed_at: String,
}

/// A historical risk score entry stored in SQLite.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskScoreHistory {
    /// Date of the score (YYYY-MM-DD).
    pub date: String,
    /// The total score on that date.
    pub total_score: f64,
}

/// Configurable weights for risk factors.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskWeights {
    pub privileged_hygiene: f64,
    pub password_policy: f64,
    pub stale_accounts: f64,
    pub dangerous_configs: f64,
}

impl Default for RiskWeights {
    fn default() -> Self {
        Self {
            privileged_hygiene: 30.0,
            password_policy: 25.0,
            stale_accounts: 25.0,
            dangerous_configs: 20.0,
        }
    }
}

// ---------------------------------------------------------------------------
// Attack Detection models (Story 9.3)
// ---------------------------------------------------------------------------

/// Type of AD attack detected.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AttackType {
    GoldenTicket,
    DCSync,
    DCShadow,
    AbnormalKerberos,
}

/// A detected attack alert.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttackAlert {
    /// Type of attack detected.
    pub attack_type: AttackType,
    /// Severity level.
    pub severity: AlertSeverity,
    /// When the suspicious event occurred (ISO 8601).
    pub timestamp: String,
    /// Source domain controller or host.
    pub source: String,
    /// Human-readable description.
    pub description: String,
    /// Recommended response action.
    pub recommendation: String,
    /// Related Windows event ID.
    pub event_id: Option<u32>,
}

/// Result of an attack detection scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttackDetectionReport {
    /// Detected attack alerts.
    pub alerts: Vec<AttackAlert>,
    /// Time window analyzed (hours).
    pub time_window_hours: u32,
    /// Timestamp of the scan (ISO 8601).
    pub scanned_at: String,
}

// ---------------------------------------------------------------------------
// Escalation Path models (Story 9.4)
// ---------------------------------------------------------------------------

/// Type of node in the escalation graph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeType {
    User,
    Group,
}

/// Type of edge in the escalation graph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EdgeType {
    Membership,
    Ownership,
    Delegation,
}

/// A node in the privilege escalation graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    /// Distinguished name of the object.
    pub dn: String,
    /// Display name.
    pub display_name: String,
    /// Type of node.
    pub node_type: NodeType,
    /// Whether this is a privileged group.
    pub is_privileged: bool,
}

/// An edge in the privilege escalation graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    /// Source node DN.
    pub source_dn: String,
    /// Target node DN.
    pub target_dn: String,
    /// Type of relationship.
    pub edge_type: EdgeType,
}

/// A privilege escalation path (sequence of edges from source to target).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EscalationPath {
    /// The nodes in this path, from source to privileged target.
    pub nodes: Vec<String>,
    /// Number of hops.
    pub hop_count: usize,
    /// Whether this path reaches Domain Admins.
    pub is_critical: bool,
}

/// Full escalation graph result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EscalationGraphResult {
    /// All nodes in the graph.
    pub nodes: Vec<GraphNode>,
    /// All edges in the graph.
    pub edges: Vec<GraphEdge>,
    /// Critical escalation paths.
    pub critical_paths: Vec<EscalationPath>,
    /// Timestamp of computation (ISO 8601).
    pub computed_at: String,
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

    #[test]
    fn test_risk_score_result_serialization() {
        let result = RiskScoreResult {
            total_score: 72.5,
            zone: RiskZone::Green,
            factors: vec![RiskFactor {
                id: "privileged_hygiene".to_string(),
                name: "Privileged Account Hygiene".to_string(),
                score: 80.0,
                weight: 30.0,
                explanation: "Most accounts are well-maintained".to_string(),
                recommendations: vec![],
            }],
            computed_at: "2026-03-23T10:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("totalScore"));
        assert!(json.contains("computedAt"));
        assert!(json.contains("\"zone\":\"Green\""));
    }

    #[test]
    fn test_risk_weights_default() {
        let weights = RiskWeights::default();
        let total = weights.privileged_hygiene
            + weights.password_policy
            + weights.stale_accounts
            + weights.dangerous_configs;
        assert!((total - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_attack_alert_serialization() {
        let alert = AttackAlert {
            attack_type: AttackType::GoldenTicket,
            severity: AlertSeverity::Critical,
            timestamp: "2026-03-23T10:00:00Z".to_string(),
            source: "DC1.example.com".to_string(),
            description: "TGT with abnormal lifetime detected".to_string(),
            recommendation: "Reset KRBTGT password twice".to_string(),
            event_id: Some(4768),
        };
        let json = serde_json::to_string(&alert).unwrap();
        assert!(json.contains("attackType"));
        assert!(json.contains("GoldenTicket"));
        assert!(json.contains("eventId"));
    }

    #[test]
    fn test_escalation_graph_result_serialization() {
        let result = EscalationGraphResult {
            nodes: vec![GraphNode {
                dn: "CN=User1,DC=example,DC=com".to_string(),
                display_name: "User 1".to_string(),
                node_type: NodeType::User,
                is_privileged: false,
            }],
            edges: vec![GraphEdge {
                source_dn: "CN=User1,DC=example,DC=com".to_string(),
                target_dn: "CN=Domain Admins,DC=example,DC=com".to_string(),
                edge_type: EdgeType::Membership,
            }],
            critical_paths: vec![EscalationPath {
                nodes: vec![
                    "CN=User1,DC=example,DC=com".to_string(),
                    "CN=Domain Admins,DC=example,DC=com".to_string(),
                ],
                hop_count: 1,
                is_critical: true,
            }],
            computed_at: "2026-03-23T10:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("nodeType"));
        assert!(json.contains("edgeType"));
        assert!(json.contains("criticalPaths"));
        assert!(json.contains("hopCount"));
    }
}
