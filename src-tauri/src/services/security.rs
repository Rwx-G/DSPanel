use std::sync::Arc;

use anyhow::Result;
use chrono::{DateTime, Utc};

use crate::models::security::{
    AlertSeverity, AlertSummary, PrivilegedAccountInfo, PrivilegedAccountsReport, SecurityAlert,
};
use crate::services::DirectoryProvider;

/// Well-known privileged group names queried by default.
const DEFAULT_PRIVILEGED_GROUPS: &[&str] = &[
    "Domain Admins",
    "Enterprise Admins",
    "Schema Admins",
    "Administrators",
];

/// Password age threshold in days before raising a Critical alert.
const PASSWORD_AGE_THRESHOLD_DAYS: i64 = 90;

/// Windows FILETIME epoch offset (100-nanosecond intervals from 1601-01-01 to 1970-01-01).
const FILETIME_EPOCH_OFFSET: i64 = 116_444_736_000_000_000;

/// Scans all default privileged groups and returns a full report with alerts.
pub async fn get_privileged_accounts_report(
    provider: Arc<dyn DirectoryProvider>,
    additional_groups: &[String],
) -> Result<PrivilegedAccountsReport> {
    let mut all_accounts: Vec<PrivilegedAccountInfo> = Vec::new();
    let mut seen_dns = std::collections::HashSet::new();

    // Combine default groups with any additional configured groups
    let group_names: Vec<String> = DEFAULT_PRIVILEGED_GROUPS
        .iter()
        .map(|s| s.to_string())
        .chain(additional_groups.iter().cloned())
        .collect();

    for group_name in &group_names {
        let members = match provider.search_groups(group_name, 1).await {
            Ok(groups) => {
                if let Some(group) = groups.first() {
                    provider
                        .get_group_members(&group.distinguished_name, 1000)
                        .await
                        .unwrap_or_default()
                } else {
                    Vec::new()
                }
            }
            Err(_) => Vec::new(),
        };

        for member in members {
            // Skip if we already processed this account (may be in multiple groups)
            if !seen_dns.insert(member.distinguished_name.clone()) {
                // Account already seen - just add the group name to its groups list
                if let Some(existing) = all_accounts
                    .iter_mut()
                    .find(|a| a.distinguished_name == member.distinguished_name)
                {
                    if !existing.privileged_groups.contains(group_name) {
                        existing.privileged_groups.push(group_name.clone());
                    }
                }
                continue;
            }

            // Only include user objects (skip nested groups)
            let object_class = member.object_class.as_deref().unwrap_or("");
            if object_class != "user" && !object_class.is_empty() {
                // Accept if empty (some providers don't set it) or if it's "user"
                if object_class == "group" || object_class == "computer" {
                    continue;
                }
            }

            let last_logon = parse_ad_timestamp(member.get_attribute("lastLogonTimestamp"));
            let pwd_last_set = parse_ad_timestamp(member.get_attribute("pwdLastSet"));
            let uac = member
                .get_attribute("userAccountControl")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);

            let enabled = (uac & 0x0002) == 0; // ACCOUNTDISABLE flag
            let password_never_expires = (uac & 0x10000) != 0; // DONT_EXPIRE_PASSWORD flag

            let password_age_days = pwd_last_set.as_ref().map(|pwd_set| {
                let now = Utc::now();
                (now - *pwd_set).num_days()
            });

            let password_expiry_date = if password_never_expires {
                None
            } else {
                // Default domain max password age is typically 42 days
                // We don't query GPO here, so just report None if it's not "never expires"
                None
            };

            let last_logon_str = last_logon
                .as_ref()
                .map(|dt| dt.to_rfc3339());

            let mut account = PrivilegedAccountInfo {
                distinguished_name: member.distinguished_name.clone(),
                sam_account_name: member
                    .sam_account_name
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string()),
                display_name: member
                    .display_name
                    .clone()
                    .unwrap_or_else(|| {
                        member
                            .sam_account_name
                            .clone()
                            .unwrap_or_else(|| "unknown".to_string())
                    }),
                privileged_groups: vec![group_name.clone()],
                last_logon: last_logon_str,
                password_age_days,
                password_expiry_date,
                enabled,
                password_never_expires,
                alerts: Vec::new(),
            };

            // Compute alerts
            account.alerts = compute_alerts(&account);
            all_accounts.push(account);
        }
    }

    // Sort by severity (most alerts first, then by highest severity)
    all_accounts.sort_by(|a, b| {
        let a_max = a.alerts.iter().map(|al| &al.severity).max();
        let b_max = b.alerts.iter().map(|al| &al.severity).max();
        b_max.cmp(&a_max).then_with(|| b.alerts.len().cmp(&a.alerts.len()))
    });

    let summary = compute_summary(&all_accounts);

    Ok(PrivilegedAccountsReport {
        accounts: all_accounts,
        summary,
        scanned_at: Utc::now().to_rfc3339(),
    })
}

/// Computes security alerts for a privileged account based on its properties.
pub fn compute_alerts(account: &PrivilegedAccountInfo) -> Vec<SecurityAlert> {
    let mut alerts = Vec::new();

    // Critical: Password older than 90 days
    if let Some(age) = account.password_age_days {
        if age > PASSWORD_AGE_THRESHOLD_DAYS {
            alerts.push(SecurityAlert {
                severity: AlertSeverity::Critical,
                message: format!("Password not changed for {} days (threshold: {})", age, PASSWORD_AGE_THRESHOLD_DAYS),
                alert_type: "password_age".to_string(),
            });
        }
    }

    // High: Password set to never expire on admin account
    if account.password_never_expires {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::High,
            message: "Password set to never expire on privileged account".to_string(),
            alert_type: "password_never_expires".to_string(),
        });
    }

    // High: Disabled account still in privileged group
    if !account.enabled {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::High,
            message: format!(
                "Disabled account still member of: {}",
                account.privileged_groups.join(", ")
            ),
            alert_type: "disabled_in_privileged_group".to_string(),
        });
    }

    // Medium: Account never logged on
    if account.last_logon.is_none() {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::Medium,
            message: "Account has never logged on".to_string(),
            alert_type: "never_logged_on".to_string(),
        });
    }

    alerts
}

/// Computes alert summary counts from a list of accounts.
fn compute_summary(accounts: &[PrivilegedAccountInfo]) -> AlertSummary {
    let mut summary = AlertSummary {
        critical: 0,
        high: 0,
        medium: 0,
        info: 0,
    };

    for account in accounts {
        for alert in &account.alerts {
            match alert.severity {
                AlertSeverity::Critical => summary.critical += 1,
                AlertSeverity::High => summary.high += 1,
                AlertSeverity::Medium => summary.medium += 1,
                AlertSeverity::Info => summary.info += 1,
            }
        }
    }

    summary
}

/// Parses an AD timestamp (Windows FILETIME as string) into a DateTime<Utc>.
///
/// AD stores timestamps like `lastLogonTimestamp` and `pwdLastSet` as 64-bit
/// integers representing 100-nanosecond intervals since 1601-01-01.
/// A value of "0" or "9223372036854775807" means "never".
fn parse_ad_timestamp(value: Option<&str>) -> Option<DateTime<Utc>> {
    let s = value?;
    let filetime: i64 = s.parse().ok()?;

    // 0 means "not set" and max i64 means "never"
    if filetime <= 0 || filetime == i64::MAX {
        return None;
    }

    let unix_100ns = filetime - FILETIME_EPOCH_OFFSET;
    if unix_100ns < 0 {
        return None;
    }

    let secs = unix_100ns / 10_000_000;
    let nsecs = (unix_100ns % 10_000_000) * 100;

    DateTime::from_timestamp(secs, nsecs as u32)
}

// ---------------------------------------------------------------------------
// Domain Risk Score (Story 9.2)
// ---------------------------------------------------------------------------

use crate::models::security::{
    RiskFactor, RiskScoreHistory, RiskScoreResult, RiskWeights, RiskZone,
};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

/// Computes the domain risk score based on data from the directory provider.
pub async fn compute_risk_score(
    provider: Arc<dyn DirectoryProvider>,
    weights: &RiskWeights,
) -> Result<RiskScoreResult> {
    let mut factors = Vec::new();

    // Factor 1: Privileged Account Hygiene
    let priv_score = compute_privileged_hygiene_factor(provider.clone()).await;
    factors.push(RiskFactor {
        id: "privileged_hygiene".to_string(),
        name: "Privileged Account Hygiene".to_string(),
        score: priv_score.0,
        weight: weights.privileged_hygiene,
        explanation: priv_score.1,
        recommendations: priv_score.2,
    });

    // Factor 2: Password Policy Strength
    let pwd_score = compute_password_policy_factor(provider.clone()).await;
    factors.push(RiskFactor {
        id: "password_policy".to_string(),
        name: "Password Policy Strength".to_string(),
        score: pwd_score.0,
        weight: weights.password_policy,
        explanation: pwd_score.1,
        recommendations: pwd_score.2,
    });

    // Factor 3: Stale Account Ratio
    let stale_score = compute_stale_accounts_factor(provider.clone()).await;
    factors.push(RiskFactor {
        id: "stale_accounts".to_string(),
        name: "Stale Account Ratio".to_string(),
        score: stale_score.0,
        weight: weights.stale_accounts,
        explanation: stale_score.1,
        recommendations: stale_score.2,
    });

    // Factor 4: Dangerous Configurations
    let danger_score = compute_dangerous_configs_factor(provider.clone()).await;
    factors.push(RiskFactor {
        id: "dangerous_configs".to_string(),
        name: "Dangerous Configurations".to_string(),
        score: danger_score.0,
        weight: weights.dangerous_configs,
        explanation: danger_score.1,
        recommendations: danger_score.2,
    });

    // Compute weighted total
    let total_weight: f64 = factors.iter().map(|f| f.weight).sum();
    let total_score = if total_weight > 0.0 {
        factors
            .iter()
            .map(|f| f.score * f.weight)
            .sum::<f64>()
            / total_weight
    } else {
        0.0
    };

    let zone = match total_score as u32 {
        0..=40 => RiskZone::Red,
        41..=70 => RiskZone::Orange,
        _ => RiskZone::Green,
    };

    Ok(RiskScoreResult {
        total_score,
        zone,
        factors,
        computed_at: Utc::now().to_rfc3339(),
    })
}

/// Scores privileged account hygiene (0-100).
async fn compute_privileged_hygiene_factor(
    provider: Arc<dyn DirectoryProvider>,
) -> (f64, String, Vec<String>) {
    let report = get_privileged_accounts_report(provider, &[]).await;
    match report {
        Ok(report) if !report.accounts.is_empty() => {
            let total = report.accounts.len() as f64;
            let with_alerts = report.accounts.iter().filter(|a| !a.alerts.is_empty()).count() as f64;
            let score = ((total - with_alerts) / total * 100.0).clamp(0.0, 100.0);

            let mut recommendations = Vec::new();
            if report.summary.critical > 0 {
                recommendations.push(format!(
                    "Address {} critical alert(s) on privileged accounts",
                    report.summary.critical
                ));
            }
            if report.summary.high > 0 {
                recommendations.push(format!(
                    "Review {} high-severity alert(s) on privileged accounts",
                    report.summary.high
                ));
            }

            (
                score,
                format!("{}/{} privileged accounts have no alerts", total as usize - with_alerts as usize, total as usize),
                recommendations,
            )
        }
        Ok(_) => (100.0, "No privileged accounts found to assess".to_string(), vec![]),
        Err(_) => (50.0, "Could not assess privileged accounts".to_string(), vec!["Ensure directory connectivity to scan privileged groups".to_string()]),
    }
}

/// Scores password policy strength (0-100).
async fn compute_password_policy_factor(
    provider: Arc<dyn DirectoryProvider>,
) -> (f64, String, Vec<String>) {
    // Read the default domain password policy from rootDSE
    let entry = provider.read_entry("").await;
    match entry {
        Ok(Some(root_dse)) => {
            let base_dn = root_dse.get_attribute("defaultNamingContext").unwrap_or("");
            if base_dn.is_empty() {
                return (50.0, "Could not determine domain base DN".to_string(), vec![]);
            }

            // Read domain object for password policy attributes
            let domain = provider.read_entry(base_dn).await;
            match domain {
                Ok(Some(domain_entry)) => {
                    let mut score = 100.0_f64;
                    let mut issues = Vec::new();
                    let mut recommendations = Vec::new();

                    // Check minPwdLength
                    let min_length = domain_entry
                        .get_attribute("minPwdLength")
                        .and_then(|v| v.parse::<u32>().ok())
                        .unwrap_or(0);
                    if min_length < 12 {
                        score -= 25.0;
                        issues.push(format!("Minimum password length is {} (should be 12+)", min_length));
                        recommendations.push("Increase minimum password length to 12 or more characters".to_string());
                    }

                    // Check lockoutThreshold
                    let lockout = domain_entry
                        .get_attribute("lockoutThreshold")
                        .and_then(|v| v.parse::<u32>().ok())
                        .unwrap_or(0);
                    if lockout == 0 {
                        score -= 25.0;
                        issues.push("Account lockout is disabled".to_string());
                        recommendations.push("Enable account lockout after 5-10 failed attempts".to_string());
                    }

                    // Check pwdProperties for complexity
                    let pwd_props = domain_entry
                        .get_attribute("pwdProperties")
                        .and_then(|v| v.parse::<u32>().ok())
                        .unwrap_or(0);
                    if pwd_props & 1 == 0 {
                        score -= 25.0;
                        issues.push("Password complexity requirement is disabled".to_string());
                        recommendations.push("Enable password complexity requirements".to_string());
                    }

                    // Check maxPwdAge (negative 100ns intervals)
                    let max_age = domain_entry
                        .get_attribute("maxPwdAge")
                        .and_then(|v| v.parse::<i64>().ok())
                        .unwrap_or(0);
                    if max_age == 0 {
                        score -= 25.0;
                        issues.push("Password expiration is disabled".to_string());
                        recommendations.push("Set maximum password age to 90 days or less".to_string());
                    }

                    let explanation = if issues.is_empty() {
                        "Password policy meets all recommended thresholds".to_string()
                    } else {
                        format!("Issues found: {}", issues.join("; "))
                    };

                    (score.clamp(0.0, 100.0), explanation, recommendations)
                }
                _ => (50.0, "Could not read domain password policy".to_string(), vec![]),
            }
        }
        _ => (50.0, "Could not connect to directory to assess password policy".to_string(), vec![]),
    }
}

/// Scores stale account ratio (0-100).
async fn compute_stale_accounts_factor(
    provider: Arc<dyn DirectoryProvider>,
) -> (f64, String, Vec<String>) {
    let users = provider.browse_users(5000).await;
    match users {
        Ok(users) if !users.is_empty() => {
            let total = users.len();
            let now = Utc::now();
            let stale_count = users
                .iter()
                .filter(|u| {
                    let last_logon = parse_ad_timestamp(u.get_attribute("lastLogonTimestamp"));
                    match last_logon {
                        Some(dt) => (now - dt).num_days() > 90,
                        None => true, // Never logged on = stale
                    }
                })
                .count();

            let ratio = stale_count as f64 / total as f64;
            let score = ((1.0 - ratio) * 100.0).clamp(0.0, 100.0);

            let mut recommendations = Vec::new();
            if stale_count > 0 {
                recommendations.push(format!(
                    "Review and disable/remove {} stale account(s) (inactive > 90 days)",
                    stale_count
                ));
            }

            (
                score,
                format!("{}/{} accounts are stale (inactive > 90 days)", stale_count, total),
                recommendations,
            )
        }
        Ok(_) => (100.0, "No user accounts found to assess".to_string(), vec![]),
        Err(_) => (50.0, "Could not retrieve user accounts".to_string(), vec![]),
    }
}

/// Scores dangerous configurations (0-100).
async fn compute_dangerous_configs_factor(
    provider: Arc<dyn DirectoryProvider>,
) -> (f64, String, Vec<String>) {
    let users = provider.browse_users(5000).await;
    match users {
        Ok(users) if !users.is_empty() => {
            let total = users.len();
            let mut score = 100.0_f64;
            let mut issues = Vec::new();
            let mut recommendations = Vec::new();

            // Check for unconstrained delegation
            let unconstrained = users
                .iter()
                .filter(|u| {
                    let uac = u
                        .get_attribute("userAccountControl")
                        .and_then(|v| v.parse::<u32>().ok())
                        .unwrap_or(0);
                    uac & 0x80000 != 0 // TRUSTED_FOR_DELEGATION
                })
                .count();

            if unconstrained > 0 {
                let penalty = (unconstrained as f64 / total as f64 * 100.0).min(50.0);
                score -= penalty;
                issues.push(format!("{} account(s) with unconstrained delegation", unconstrained));
                recommendations.push(format!(
                    "Review and restrict unconstrained delegation on {} account(s)",
                    unconstrained
                ));
            }

            // Check for password never expires on regular accounts
            let never_expires = users
                .iter()
                .filter(|u| {
                    let uac = u
                        .get_attribute("userAccountControl")
                        .and_then(|v| v.parse::<u32>().ok())
                        .unwrap_or(0);
                    uac & 0x10000 != 0 // DONT_EXPIRE_PASSWORD
                })
                .count();

            let never_expires_ratio = never_expires as f64 / total as f64;
            if never_expires_ratio > 0.1 {
                score -= 25.0;
                issues.push(format!("{}% of accounts have passwords set to never expire", (never_expires_ratio * 100.0) as u32));
                recommendations.push("Reduce the number of accounts with non-expiring passwords".to_string());
            }

            let explanation = if issues.is_empty() {
                "No dangerous configurations detected".to_string()
            } else {
                format!("Issues: {}", issues.join("; "))
            };

            (score.clamp(0.0, 100.0), explanation, recommendations)
        }
        Ok(_) => (100.0, "No user accounts found to assess".to_string(), vec![]),
        Err(_) => (50.0, "Could not retrieve user accounts for configuration audit".to_string(), vec![]),
    }
}

/// Service for storing and retrieving risk score history.
pub struct RiskScoreStore {
    conn: Mutex<Connection>,
}

impl Default for RiskScoreStore {
    fn default() -> Self {
        Self::new()
    }
}

impl RiskScoreStore {
    /// Creates a new store backed by a file in the DSPanel data directory.
    pub fn new() -> Self {
        let conn = if let Some(path) = Self::db_path() {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            Connection::open(&path).unwrap_or_else(|_| Connection::open_in_memory().expect("in-memory SQLite"))
        } else {
            Connection::open_in_memory().expect("in-memory SQLite")
        };

        let store = Self {
            conn: Mutex::new(conn),
        };
        store.init_schema();
        store
    }

    /// Creates an in-memory store for testing.
    #[cfg(test)]
    pub fn new_in_memory() -> Self {
        let conn = Connection::open_in_memory().expect("in-memory SQLite");
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.init_schema();
        store
    }

    fn db_path() -> Option<PathBuf> {
        crate::services::preset::data_dir().map(|d| d.join("risk-scores.db"))
    }

    fn init_schema(&self) {
        let conn = self.conn.lock().expect("lock poisoned");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS risk_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL UNIQUE,
                total_score REAL NOT NULL,
                factors_json TEXT NOT NULL
            )"
        ).expect("risk_scores schema creation");
    }

    /// Stores a risk score for today (upserts by date).
    pub fn store_score(&self, result: &RiskScoreResult) {
        let conn = self.conn.lock().expect("lock poisoned");
        let date = Utc::now().format("%Y-%m-%d").to_string();
        let factors_json = serde_json::to_string(&result.factors).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "INSERT INTO risk_scores (date, total_score, factors_json)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(date) DO UPDATE SET total_score = ?2, factors_json = ?3",
            rusqlite::params![date, result.total_score, factors_json],
        ).unwrap_or_else(|e| {
            tracing::warn!("Failed to store risk score: {}", e);
            0
        });
    }

    /// Retrieves the last N days of risk score history.
    pub fn get_history(&self, days: u32) -> Vec<RiskScoreHistory> {
        let conn = self.conn.lock().expect("lock poisoned");
        let mut stmt = match conn.prepare(
            "SELECT date, total_score FROM risk_scores ORDER BY date DESC LIMIT ?1",
        ) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("Failed to prepare risk score query: {}", e);
                return Vec::new();
            }
        };

        let rows = match stmt.query_map(rusqlite::params![days], |row| {
            Ok(RiskScoreHistory {
                date: row.get(0)?,
                total_score: row.get(1)?,
            })
        }) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Failed to query risk score history: {}", e);
                return Vec::new();
            }
        };

        rows.filter_map(|r| r.ok()).collect()
    }
}

// ---------------------------------------------------------------------------
// Attack Detection (Story 9.3)
// ---------------------------------------------------------------------------

use crate::models::security::{AttackAlert, AttackDetectionReport, AttackType};

/// Performs on-demand attack detection by analyzing Windows Security event logs.
///
/// This queries the event log for suspicious patterns over the configured time window.
/// On non-Windows platforms or when event log access fails, returns an empty report.
pub async fn detect_attacks(
    _provider: Arc<dyn DirectoryProvider>,
    time_window_hours: u32,
) -> Result<AttackDetectionReport> {
    #[cfg(target_os = "windows")]
    let alerts = analyze_windows_event_log(time_window_hours);

    #[cfg(not(target_os = "windows"))]
    let alerts: Vec<AttackAlert> = Vec::new();

    Ok(AttackDetectionReport {
        alerts,
        time_window_hours,
        scanned_at: Utc::now().to_rfc3339(),
    })
}

/// Analyzes Windows Security event log for attack indicators.
#[cfg(target_os = "windows")]
fn analyze_windows_event_log(time_window_hours: u32) -> Vec<AttackAlert> {
    use std::process::Command;

    let mut alerts = Vec::new();

    // Query for suspicious event IDs using PowerShell
    // Event 4768: Kerberos TGT request (Golden Ticket indicators)
    // Event 4769: Kerberos TGS request (abnormal Kerberos)
    // Event 4662: Directory service access (DCSync)
    // Event 4742: Computer account changed (DCShadow)
    let event_ids = [
        (4768, AttackType::GoldenTicket, "Kerberos TGT with unusual parameters"),
        (4662, AttackType::DCSync, "Directory replication request from non-DC"),
        (4742, AttackType::DCShadow, "Suspicious computer account modification"),
    ];

    for (event_id, attack_type, description) in &event_ids {
        let query = format!(
            "Get-WinEvent -FilterHashtable @{{LogName='Security';Id={};StartTime=(Get-Date).AddHours(-{})}} -MaxEvents 50 -ErrorAction SilentlyContinue | Select-Object TimeCreated,Message | ConvertTo-Json -Compress",
            event_id, time_window_hours
        );

        let output = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &query])
            .output();

        if let Ok(output) = output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if !stdout.trim().is_empty() && stdout.trim() != "null" {
                    // Parse event count to determine if suspicious activity exists
                    let event_count = if stdout.trim().starts_with('[') {
                        stdout.matches("TimeCreated").count()
                    } else if stdout.contains("TimeCreated") {
                        1
                    } else {
                        0
                    };

                    if event_count > 0 {
                        let severity = match attack_type {
                            AttackType::GoldenTicket => AlertSeverity::Critical,
                            AttackType::DCSync => AlertSeverity::Critical,
                            AttackType::DCShadow => AlertSeverity::High,
                            _ => AlertSeverity::Medium,
                        };

                        let recommendation = match attack_type {
                            AttackType::GoldenTicket => "Reset KRBTGT password twice with a 12-hour interval".to_string(),
                            AttackType::DCSync => "Review replication permissions - ensure only DCs have DS-Replication-Get-Changes rights".to_string(),
                            AttackType::DCShadow => "Audit computer account changes and verify no rogue DCs registered".to_string(),
                            _ => "Investigate the suspicious activity".to_string(),
                        };

                        alerts.push(AttackAlert {
                            attack_type: attack_type.clone(),
                            severity,
                            timestamp: Utc::now().to_rfc3339(),
                            source: "Local Security Event Log".to_string(),
                            description: format!("{} - {} event(s) detected in last {} hours", description, event_count, time_window_hours),
                            recommendation,
                            event_id: Some(*event_id),
                        });
                    }
                }
            }
        }
    }

    alerts
}

// ---------------------------------------------------------------------------
// Escalation Path Visualization (Story 9.4)
// ---------------------------------------------------------------------------

use crate::models::security::{
    EdgeType, EscalationGraphResult, EscalationPath, GraphEdge, GraphNode, NodeType,
};

/// Builds the privilege escalation graph by querying group memberships.
pub async fn build_escalation_graph(
    provider: Arc<dyn DirectoryProvider>,
) -> Result<EscalationGraphResult> {
    let mut nodes: Vec<GraphNode> = Vec::new();
    let mut edges: Vec<GraphEdge> = Vec::new();
    let mut node_dns = std::collections::HashSet::new();

    let privileged_group_names = DEFAULT_PRIVILEGED_GROUPS;

    // Add privileged groups as nodes
    for group_name in privileged_group_names {
        let groups = provider.search_groups(group_name, 1).await.unwrap_or_default();
        for group in groups {
            if node_dns.insert(group.distinguished_name.clone()) {
                nodes.push(GraphNode {
                    dn: group.distinguished_name.clone(),
                    display_name: group
                        .display_name
                        .clone()
                        .or_else(|| group.sam_account_name.clone())
                        .unwrap_or_else(|| group_name.to_string()),
                    node_type: NodeType::Group,
                    is_privileged: true,
                });
            }

            // Get members of this privileged group
            let members = provider
                .get_group_members(&group.distinguished_name, 500)
                .await
                .unwrap_or_default();

            for member in members {
                let member_type = match member.object_class.as_deref() {
                    Some("group") => NodeType::Group,
                    _ => NodeType::User,
                };

                if node_dns.insert(member.distinguished_name.clone()) {
                    nodes.push(GraphNode {
                        dn: member.distinguished_name.clone(),
                        display_name: member
                            .display_name
                            .clone()
                            .or_else(|| member.sam_account_name.clone())
                            .unwrap_or_else(|| "Unknown".to_string()),
                        node_type: member_type,
                        is_privileged: false,
                    });
                }

                edges.push(GraphEdge {
                    source_dn: member.distinguished_name.clone(),
                    target_dn: group.distinguished_name.clone(),
                    edge_type: EdgeType::Membership,
                });
            }
        }
    }

    // Find critical paths using BFS
    let critical_paths = find_critical_paths(&nodes, &edges);

    Ok(EscalationGraphResult {
        nodes,
        edges,
        critical_paths,
        computed_at: Utc::now().to_rfc3339(),
    })
}

/// Finds critical escalation paths (shortest paths to privileged groups) using BFS.
pub fn find_critical_paths(nodes: &[GraphNode], edges: &[GraphEdge]) -> Vec<EscalationPath> {
    use std::collections::{HashMap, VecDeque};

    // Build adjacency list (source -> targets)
    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in edges {
        adj.entry(edge.source_dn.as_str())
            .or_default()
            .push(edge.target_dn.as_str());
    }

    let privileged_dns: std::collections::HashSet<&str> = nodes
        .iter()
        .filter(|n| n.is_privileged)
        .map(|n| n.dn.as_str())
        .collect();

    let non_privileged: Vec<&GraphNode> = nodes.iter().filter(|n| !n.is_privileged).collect();

    let mut paths = Vec::new();

    for start_node in non_privileged {
        // BFS from this node to any privileged node
        let mut visited = std::collections::HashSet::new();
        let mut queue: VecDeque<Vec<&str>> = VecDeque::new();
        queue.push_back(vec![start_node.dn.as_str()]);
        visited.insert(start_node.dn.as_str());

        while let Some(path) = queue.pop_front() {
            let current = *path.last().expect("path is non-empty");

            if privileged_dns.contains(current) && path.len() > 1 {
                paths.push(EscalationPath {
                    nodes: path.iter().map(|s| s.to_string()).collect(),
                    hop_count: path.len() - 1,
                    is_critical: true,
                });
                break; // Only shortest path per source
            }

            if let Some(neighbors) = adj.get(current) {
                for &next in neighbors {
                    if visited.insert(next) {
                        let mut new_path = path.clone();
                        new_path.push(next);
                        queue.push_back(new_path);
                    }
                }
            }
        }
    }

    // Sort by hop count (shortest first)
    paths.sort_by_key(|p| p.hop_count);
    paths
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    fn make_account(
        enabled: bool,
        password_never_expires: bool,
        password_age_days: Option<i64>,
        last_logon: Option<&str>,
    ) -> PrivilegedAccountInfo {
        PrivilegedAccountInfo {
            distinguished_name: "CN=TestUser,OU=Users,DC=example,DC=com".to_string(),
            sam_account_name: "testuser".to_string(),
            display_name: "Test User".to_string(),
            privileged_groups: vec!["Domain Admins".to_string()],
            last_logon: last_logon.map(|s| s.to_string()),
            password_age_days,
            password_expiry_date: None,
            enabled,
            password_never_expires,
            alerts: Vec::new(),
        }
    }

    #[test]
    fn test_compute_alerts_password_age_critical() {
        let account = make_account(true, false, Some(120), Some("2026-01-01T00:00:00Z"));
        let alerts = compute_alerts(&account);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].severity, AlertSeverity::Critical);
        assert_eq!(alerts[0].alert_type, "password_age");
    }

    #[test]
    fn test_compute_alerts_password_age_ok() {
        let account = make_account(true, false, Some(30), Some("2026-03-01T00:00:00Z"));
        let alerts = compute_alerts(&account);
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_compute_alerts_password_never_expires() {
        let account = make_account(true, true, Some(10), Some("2026-03-01T00:00:00Z"));
        let alerts = compute_alerts(&account);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].severity, AlertSeverity::High);
        assert_eq!(alerts[0].alert_type, "password_never_expires");
    }

    #[test]
    fn test_compute_alerts_disabled_in_privileged_group() {
        let account = make_account(false, false, Some(10), Some("2026-03-01T00:00:00Z"));
        let alerts = compute_alerts(&account);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].severity, AlertSeverity::High);
        assert_eq!(alerts[0].alert_type, "disabled_in_privileged_group");
    }

    #[test]
    fn test_compute_alerts_never_logged_on() {
        let account = make_account(true, false, Some(10), None);
        let alerts = compute_alerts(&account);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].severity, AlertSeverity::Medium);
        assert_eq!(alerts[0].alert_type, "never_logged_on");
    }

    #[test]
    fn test_compute_alerts_multiple_issues() {
        let account = make_account(false, true, Some(120), None);
        let alerts = compute_alerts(&account);
        // Should have: password_age (Critical), password_never_expires (High),
        // disabled_in_privileged_group (High), never_logged_on (Medium)
        assert_eq!(alerts.len(), 4);
        let types: Vec<&str> = alerts.iter().map(|a| a.alert_type.as_str()).collect();
        assert!(types.contains(&"password_age"));
        assert!(types.contains(&"password_never_expires"));
        assert!(types.contains(&"disabled_in_privileged_group"));
        assert!(types.contains(&"never_logged_on"));
    }

    #[test]
    fn test_compute_alerts_healthy_account() {
        let account = make_account(true, false, Some(10), Some("2026-03-20T00:00:00Z"));
        let alerts = compute_alerts(&account);
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_compute_summary() {
        let mut a1 = make_account(true, true, Some(120), None);
        a1.alerts = compute_alerts(&a1);

        let mut a2 = make_account(true, false, Some(10), Some("2026-03-01T00:00:00Z"));
        a2.alerts = compute_alerts(&a2);

        let summary = compute_summary(&[a1, a2]);
        assert_eq!(summary.critical, 1); // password_age
        assert_eq!(summary.high, 1); // password_never_expires
        assert_eq!(summary.medium, 1); // never_logged_on
        assert_eq!(summary.info, 0);
    }

    #[test]
    fn test_parse_ad_timestamp_valid() {
        // Unix timestamp for 2024-01-01 00:00:00 UTC = 1704067200
        // FILETIME = (unix_secs * 10_000_000) + FILETIME_EPOCH_OFFSET
        let unix_secs: i64 = 1_704_067_200;
        let filetime = unix_secs * 10_000_000 + FILETIME_EPOCH_OFFSET;
        let result = parse_ad_timestamp(Some(&filetime.to_string()));
        assert!(result.is_some());
        let dt = result.unwrap();
        assert_eq!(dt.format("%Y-%m-%d").to_string(), "2024-01-01");
    }

    #[test]
    fn test_parse_ad_timestamp_zero() {
        assert!(parse_ad_timestamp(Some("0")).is_none());
    }

    #[test]
    fn test_parse_ad_timestamp_max() {
        assert!(parse_ad_timestamp(Some("9223372036854775807")).is_none());
    }

    #[test]
    fn test_parse_ad_timestamp_none() {
        assert!(parse_ad_timestamp(None).is_none());
    }

    #[test]
    fn test_parse_ad_timestamp_invalid() {
        assert!(parse_ad_timestamp(Some("not_a_number")).is_none());
    }

    #[test]
    fn test_parse_ad_timestamp_negative() {
        assert!(parse_ad_timestamp(Some("-1")).is_none());
    }

    // Risk Score Store tests

    #[test]
    fn test_risk_score_store_create() {
        let store = RiskScoreStore::new_in_memory();
        let history = store.get_history(30);
        assert!(history.is_empty());
    }

    #[test]
    fn test_risk_score_store_insert_and_retrieve() {
        let store = RiskScoreStore::new_in_memory();
        let result = RiskScoreResult {
            total_score: 75.0,
            zone: RiskZone::Green,
            factors: vec![],
            computed_at: Utc::now().to_rfc3339(),
        };
        store.store_score(&result);
        let history = store.get_history(30);
        assert_eq!(history.len(), 1);
        assert!((history[0].total_score - 75.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_risk_score_store_upsert_same_day() {
        let store = RiskScoreStore::new_in_memory();
        let result1 = RiskScoreResult {
            total_score: 60.0,
            zone: RiskZone::Orange,
            factors: vec![],
            computed_at: Utc::now().to_rfc3339(),
        };
        store.store_score(&result1);

        let result2 = RiskScoreResult {
            total_score: 80.0,
            zone: RiskZone::Green,
            factors: vec![],
            computed_at: Utc::now().to_rfc3339(),
        };
        store.store_score(&result2);

        let history = store.get_history(30);
        assert_eq!(history.len(), 1); // Should upsert, not insert
        assert!((history[0].total_score - 80.0).abs() < f64::EPSILON);
    }

    // BFS path finding tests

    #[test]
    fn test_find_critical_paths_simple() {
        let nodes = vec![
            GraphNode {
                dn: "CN=User1,DC=test".to_string(),
                display_name: "User 1".to_string(),
                node_type: NodeType::User,
                is_privileged: false,
            },
            GraphNode {
                dn: "CN=Domain Admins,DC=test".to_string(),
                display_name: "Domain Admins".to_string(),
                node_type: NodeType::Group,
                is_privileged: true,
            },
        ];
        let edges = vec![GraphEdge {
            source_dn: "CN=User1,DC=test".to_string(),
            target_dn: "CN=Domain Admins,DC=test".to_string(),
            edge_type: EdgeType::Membership,
        }];

        let paths = find_critical_paths(&nodes, &edges);
        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0].hop_count, 1);
        assert!(paths[0].is_critical);
    }

    #[test]
    fn test_find_critical_paths_transitive() {
        let nodes = vec![
            GraphNode {
                dn: "CN=User1,DC=test".to_string(),
                display_name: "User 1".to_string(),
                node_type: NodeType::User,
                is_privileged: false,
            },
            GraphNode {
                dn: "CN=GroupA,DC=test".to_string(),
                display_name: "Group A".to_string(),
                node_type: NodeType::Group,
                is_privileged: false,
            },
            GraphNode {
                dn: "CN=Domain Admins,DC=test".to_string(),
                display_name: "Domain Admins".to_string(),
                node_type: NodeType::Group,
                is_privileged: true,
            },
        ];
        let edges = vec![
            GraphEdge {
                source_dn: "CN=User1,DC=test".to_string(),
                target_dn: "CN=GroupA,DC=test".to_string(),
                edge_type: EdgeType::Membership,
            },
            GraphEdge {
                source_dn: "CN=GroupA,DC=test".to_string(),
                target_dn: "CN=Domain Admins,DC=test".to_string(),
                edge_type: EdgeType::Membership,
            },
        ];

        let paths = find_critical_paths(&nodes, &edges);
        // User1 -> GroupA -> Domain Admins (2 hops)
        // GroupA -> Domain Admins (1 hop)
        assert_eq!(paths.len(), 2);
        assert_eq!(paths[0].hop_count, 1); // Shortest first
    }

    #[test]
    fn test_find_critical_paths_no_path() {
        let nodes = vec![
            GraphNode {
                dn: "CN=User1,DC=test".to_string(),
                display_name: "User 1".to_string(),
                node_type: NodeType::User,
                is_privileged: false,
            },
            GraphNode {
                dn: "CN=Domain Admins,DC=test".to_string(),
                display_name: "Domain Admins".to_string(),
                node_type: NodeType::Group,
                is_privileged: true,
            },
        ];
        // No edges connecting them
        let paths = find_critical_paths(&nodes, &[]);
        assert!(paths.is_empty());
    }
}
