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
    /// Whether the account has an SPN set (Kerberoastable).
    pub kerberoastable: bool,
    /// Whether Kerberos pre-authentication is not required (AS-REP Roastable).
    pub asrep_roastable: bool,
    /// Whether reversible encryption is enabled.
    pub reversible_encryption: bool,
    /// Whether DES-only Kerberos encryption is set.
    pub des_only: bool,
    /// Whether constrained delegation with protocol transition is enabled.
    pub constrained_delegation_transition: bool,
    /// Whether the account has SIDHistory attribute set.
    pub has_sid_history: bool,
    /// Whether this appears to be a service account (has SPN + password never expires).
    pub is_service_account: bool,
    /// Whether the account is in the Protected Users group.
    pub in_protected_users: bool,
    /// Whether adminCount=1 but account is not actually in any admin group (orphaned).
    pub admin_count_orphaned: bool,
    /// Computed security alerts for this account.
    pub alerts: Vec<SecurityAlert>,
}

/// Domain-level security findings not tied to individual accounts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainSecurityFindings {
    /// KRBTGT password age in days (null if not accessible).
    pub krbtgt_password_age_days: Option<i64>,
    /// LAPS coverage percentage (computers with LAPS / total computers).
    pub laps_coverage_percent: Option<f64>,
    /// Number of computers with LAPS deployed.
    pub laps_deployed_count: usize,
    /// Total computer count.
    pub total_computer_count: usize,
    /// Number of Fine-Grained Password Policies (PSOs) found.
    pub pso_count: usize,
    /// Domain functional level string.
    pub domain_functional_level: Option<String>,
    /// Forest functional level string.
    pub forest_functional_level: Option<String>,
    /// Whether LDAP signing is enforced.
    pub ldap_signing_enforced: Option<bool>,
    /// Whether the AD Recycle Bin is enabled.
    pub recycle_bin_enabled: Option<bool>,
    /// Number of accounts with RBCD configured.
    pub rbcd_configured_count: usize,
    /// Alerts generated from domain-level findings.
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
    /// Domain-level security findings.
    pub domain_findings: DomainSecurityFindings,
    /// Summary of alert counts.
    pub summary: AlertSummary,
    /// Timestamp of when this scan was performed (ISO 8601).
    pub scanned_at: String,
}

// ---------------------------------------------------------------------------
// Domain Risk Score models (Story 9.2)
// ---------------------------------------------------------------------------

/// Complexity of a remediation action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RemediationComplexity {
    Easy,
    Medium,
    Hard,
}

/// An individual security finding within a risk factor.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskFinding {
    /// Machine-readable identifier (e.g., "GPO-001").
    pub id: String,
    /// Human-readable description.
    pub description: String,
    /// Severity of this finding.
    pub severity: AlertSeverity,
    /// Points deducted from the factor score.
    pub points_deducted: f64,
    /// Recommended remediation action.
    pub remediation: String,
    /// Remediation complexity.
    pub complexity: RemediationComplexity,
    /// CIS Benchmark or MITRE ATT&CK reference, if applicable.
    pub framework_ref: Option<String>,
}

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
    /// Individual findings that contributed to the score.
    pub findings: Vec<RiskFinding>,
    /// How many points the total score would gain if all findings in this factor were fixed.
    pub impact_if_fixed: f64,
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
    /// Worst factor name and score (PingCastle-style "weakest link" indicator).
    pub worst_factor_name: String,
    /// Worst factor score.
    pub worst_factor_score: f64,
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
    pub kerberos_security: f64,
    pub dangerous_configs: f64,
    pub infrastructure_hardening: f64,
    pub gpo_security: f64,
    pub trust_security: f64,
    pub certificate_security: f64,
}

impl Default for RiskWeights {
    fn default() -> Self {
        Self {
            privileged_hygiene: 15.0,
            password_policy: 10.0,
            stale_accounts: 10.0,
            kerberos_security: 20.0,
            dangerous_configs: 10.0,
            infrastructure_hardening: 10.0,
            gpo_security: 10.0,
            trust_security: 10.0,
            certificate_security: 5.0,
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
    PasswordSpray,
    PrivGroupChange,
    Kerberoasting,
    AsrepRoasting,
    BruteForce,
    PassTheHash,
    ShadowCredentials,
    RbcdAbuse,
    AdminSdHolderTamper,
    SuspiciousAccountActivity,
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
    /// MITRE ATT&CK technique reference.
    pub mitre_ref: Option<String>,
}

/// Configurable thresholds for attack detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttackDetectionConfig {
    /// Minimum failed logins from same IP to trigger brute force alert.
    pub brute_force_threshold: u32,
    /// Minimum TGS requests with RC4 to trigger Kerberoasting alert.
    pub kerberoasting_threshold: u32,
    /// IPs to exclude from alerts (known DCs).
    pub excluded_ips: Vec<String>,
    /// Accounts to exclude from alerts (known service accounts).
    pub excluded_accounts: Vec<String>,
}

impl Default for AttackDetectionConfig {
    fn default() -> Self {
        Self {
            brute_force_threshold: 10,
            kerberoasting_threshold: 3,
            excluded_ips: Vec::new(),
            excluded_accounts: Vec::new(),
        }
    }
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
    Computer,
    GPO,
    CertTemplate,
}

/// Type of edge in the escalation graph.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EdgeType {
    Membership,
    Ownership,
    Delegation,
    UnconstrainedDeleg,
    RBCD,
    SIDHistory,
    GPLink,
    CertESC,
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
    /// Human-readable description of the edge.
    pub label: Option<String>,
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
    /// Weighted path score (lower = more dangerous / easier to exploit).
    pub risk_score: f64,
    /// Edge type labels for each hop in the path.
    pub edge_types: Vec<String>,
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
            kerberoastable: true,
            asrep_roastable: false,
            reversible_encryption: false,
            des_only: false,
            constrained_delegation_transition: false,
            has_sid_history: false,
            is_service_account: true,
            in_protected_users: false,
            admin_count_orphaned: false,
            alerts: vec![],
        };
        let json = serde_json::to_string(&account).unwrap();
        assert!(json.contains("samAccountName"));
        assert!(json.contains("privilegedGroups"));
        assert!(json.contains("passwordAgeDays"));
        assert!(json.contains("passwordNeverExpires"));
        assert!(json.contains("kerberoastable"));
        assert!(json.contains("asrepRoastable"));
        assert!(json.contains("isServiceAccount"));
    }

    #[test]
    fn test_privileged_accounts_report_serialization() {
        let report = PrivilegedAccountsReport {
            accounts: vec![],
            domain_findings: DomainSecurityFindings {
                krbtgt_password_age_days: Some(365),
                laps_coverage_percent: Some(80.0),
                laps_deployed_count: 40,
                total_computer_count: 50,
                pso_count: 2,
                domain_functional_level: Some("Windows Server 2016".to_string()),
                forest_functional_level: Some("Windows Server 2016".to_string()),
                ldap_signing_enforced: Some(true),
                recycle_bin_enabled: Some(true),
                rbcd_configured_count: 0,
                alerts: vec![],
            },
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
            worst_factor_name: "Privileged Account Hygiene".to_string(),
            worst_factor_score: 80.0,
            factors: vec![RiskFactor {
                id: "privileged_hygiene".to_string(),
                name: "Privileged Account Hygiene".to_string(),
                score: 80.0,
                weight: 30.0,
                explanation: "Most accounts are well-maintained".to_string(),
                recommendations: vec![],
                findings: vec![],
                impact_if_fixed: 0.0,
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
            + weights.kerberos_security
            + weights.dangerous_configs
            + weights.infrastructure_hardening
            + weights.gpo_security
            + weights.trust_security
            + weights.certificate_security;
        assert!((total - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_risk_finding_serialization() {
        let finding = RiskFinding {
            id: "GPO-001".to_string(),
            description: "GPP passwords may exist".to_string(),
            severity: AlertSeverity::High,
            points_deducted: 15.0,
            remediation: "Audit SYSVOL for cpassword entries".to_string(),
            complexity: RemediationComplexity::Easy,
            framework_ref: Some("MITRE T1552.006".to_string()),
        };
        let json = serde_json::to_string(&finding).unwrap();
        assert!(json.contains("pointsDeducted"));
        assert!(json.contains("frameworkRef"));
        assert!(json.contains("GPO-001"));
    }

    #[test]
    fn test_remediation_complexity_serialization() {
        let easy = RemediationComplexity::Easy;
        let json = serde_json::to_string(&easy).unwrap();
        assert_eq!(json, "\"Easy\"");
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
            mitre_ref: Some("T1558.001".to_string()),
        };
        let json = serde_json::to_string(&alert).unwrap();
        assert!(json.contains("attackType"));
        assert!(json.contains("GoldenTicket"));
        assert!(json.contains("eventId"));
        assert!(json.contains("mitreRef"));
        assert!(json.contains("T1558.001"));
    }

    #[test]
    fn test_attack_detection_config_default() {
        let config = AttackDetectionConfig::default();
        assert_eq!(config.brute_force_threshold, 10);
        assert_eq!(config.kerberoasting_threshold, 3);
        assert!(config.excluded_ips.is_empty());
        assert!(config.excluded_accounts.is_empty());
    }

    #[test]
    fn test_attack_type_new_variants_serialization() {
        let types = vec![
            AttackType::Kerberoasting,
            AttackType::AsrepRoasting,
            AttackType::BruteForce,
            AttackType::PassTheHash,
            AttackType::ShadowCredentials,
            AttackType::RbcdAbuse,
            AttackType::AdminSdHolderTamper,
            AttackType::SuspiciousAccountActivity,
        ];
        for attack_type in types {
            let json = serde_json::to_string(&attack_type).unwrap();
            let deserialized: AttackType = serde_json::from_str(&json).unwrap();
            assert_eq!(deserialized, attack_type);
        }
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
                label: Some("Member of".to_string()),
            }],
            critical_paths: vec![EscalationPath {
                nodes: vec![
                    "CN=User1,DC=example,DC=com".to_string(),
                    "CN=Domain Admins,DC=example,DC=com".to_string(),
                ],
                hop_count: 1,
                is_critical: true,
                risk_score: 1.0,
                edge_types: vec!["Membership".to_string()],
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
