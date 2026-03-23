use std::sync::Arc;

use anyhow::Result;
use chrono::{DateTime, Utc};

use crate::models::security::{
    AlertSeverity, AlertSummary, DomainSecurityFindings, PrivilegedAccountInfo,
    PrivilegedAccountsReport, SecurityAlert,
};
use crate::services::DirectoryProvider;

/// Password age threshold in days before raising a Critical alert.
const PASSWORD_AGE_THRESHOLD_DAYS: i64 = 90;

/// KRBTGT password age threshold in days before raising a Critical alert.
const KRBTGT_PASSWORD_AGE_THRESHOLD_DAYS: i64 = 180;

// UAC flag constants
const UAC_ACCOUNTDISABLE: u32 = 0x0002;
const UAC_PASSWD_NOTREQD: u32 = 0x0020;
const UAC_ENCRYPTED_TEXT_PWD_ALLOWED: u32 = 0x0080; // Reversible encryption
const UAC_DONT_EXPIRE_PASSWORD: u32 = 0x10000;
const UAC_TRUSTED_FOR_DELEGATION: u32 = 0x80000; // Unconstrained delegation
const UAC_USE_DES_KEY_ONLY: u32 = 0x200000;
const UAC_DONT_REQUIRE_PREAUTH: u32 = 0x400000; // AS-REP Roastable
const UAC_TRUSTED_TO_AUTH_FOR_DELEGATION: u32 = 0x1000000; // Constrained deleg + protocol transition

/// Windows FILETIME epoch offset (100-nanosecond intervals from 1601-01-01 to 1970-01-01).
const FILETIME_EPOCH_OFFSET: i64 = 116_444_736_000_000_000;

/// Well-known RIDs for privileged groups (language-independent).
const PRIVILEGED_GROUP_RIDS: &[(u32, &str)] = &[
    (512, "Domain Admins"),
    (519, "Enterprise Admins"),
    (518, "Schema Admins"),
    (544, "Administrators"),
];

/// RID for the Protected Users group.
const RID_PROTECTED_USERS: u32 = 525;

/// Scans all default privileged groups and returns a full report with alerts.
pub async fn get_privileged_accounts_report(
    provider: Arc<dyn DirectoryProvider>,
    additional_groups: &[String],
) -> Result<PrivilegedAccountsReport> {
    let mut all_accounts: Vec<PrivilegedAccountInfo> = Vec::new();
    let mut seen_dns = std::collections::HashSet::new();

    // Resolve privileged groups by well-known RID (language-independent)
    let mut resolved_groups: Vec<(String, String)> = Vec::new(); // (dn, display_name)
    for (rid, fallback_name) in PRIVILEGED_GROUP_RIDS {
        if let Ok(Some(group)) = provider.resolve_group_by_rid(*rid).await {
            let name = group
                .display_name
                .clone()
                .or_else(|| group.sam_account_name.clone())
                .unwrap_or_else(|| fallback_name.to_string());
            resolved_groups.push((group.distinguished_name, name));
        }
    }

    // Also resolve additional groups configured by name (these are user-specified)
    for group_name in additional_groups {
        if let Ok(groups) = provider.search_groups(group_name, 1).await {
            if let Some(group) = groups.first() {
                let name = group
                    .display_name
                    .clone()
                    .or_else(|| group.sam_account_name.clone())
                    .unwrap_or_else(|| group_name.clone());
                resolved_groups.push((group.distinguished_name.clone(), name));
            }
        }
    }

    // Resolve Protected Users group by RID for membership check (recursive)
    let protected_users_members = match provider.resolve_group_by_rid(RID_PROTECTED_USERS).await {
        Ok(Some(pu_group)) => {
            let members = get_recursive_members(&provider, &pu_group.distinguished_name).await;
            members
                .into_iter()
                .map(|m| m.distinguished_name)
                .collect::<std::collections::HashSet<_>>()
        }
        _ => std::collections::HashSet::new(),
    };

    for (group_dn, group_name) in &resolved_groups {
        // Use LDAP_MATCHING_RULE_IN_CHAIN to get all members recursively
        // (including members of nested groups)
        let members = get_recursive_members(&provider, group_dn).await;

        for member in members {
            // Skip if we already processed this account (may be in multiple groups)
            if !seen_dns.insert(member.distinguished_name.clone()) {
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
            if !object_class.is_empty()
                && object_class != "user"
                && (object_class == "group" || object_class == "computer")
            {
                continue;
            }

            // Prefer lastLogonTimestamp (replicated) over lastLogon (per-DC)
            let last_logon = parse_ad_timestamp(member.get_attribute("lastLogonTimestamp"))
                .or_else(|| parse_ad_timestamp(member.get_attribute("lastLogon")));
            let pwd_last_set = parse_ad_timestamp(member.get_attribute("pwdLastSet"));
            let uac = member
                .get_attribute("userAccountControl")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);

            let enabled = (uac & UAC_ACCOUNTDISABLE) == 0;
            let password_never_expires = (uac & UAC_DONT_EXPIRE_PASSWORD) != 0;
            let kerberoastable = !member
                .get_attribute_values("servicePrincipalName")
                .is_empty();
            let asrep_roastable = (uac & UAC_DONT_REQUIRE_PREAUTH) != 0;
            let reversible_encryption = (uac & UAC_ENCRYPTED_TEXT_PWD_ALLOWED) != 0;
            let des_only = (uac & UAC_USE_DES_KEY_ONLY) != 0;
            let constrained_delegation_transition = (uac & UAC_TRUSTED_TO_AUTH_FOR_DELEGATION) != 0;
            let has_sid_history = !member.get_attribute_values("sIDHistory").is_empty();
            let is_service_account = kerberoastable && password_never_expires;
            let in_protected_users = protected_users_members.contains(&member.distinguished_name);
            let admin_count = member
                .get_attribute("adminCount")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);

            let password_age_days = pwd_last_set
                .as_ref()
                .map(|pwd_set| (Utc::now() - *pwd_set).num_days());

            let last_logon_str = last_logon.as_ref().map(|dt| dt.to_rfc3339());

            // Inactive admin: last logon > 90 days (not just "never logged on")
            let last_logon_age_days = last_logon.map(|dt| (Utc::now() - dt).num_days());

            let mut account = PrivilegedAccountInfo {
                distinguished_name: member.distinguished_name.clone(),
                sam_account_name: member
                    .sam_account_name
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string()),
                display_name: member.display_name.clone().unwrap_or_else(|| {
                    member
                        .sam_account_name
                        .clone()
                        .unwrap_or_else(|| "unknown".to_string())
                }),
                privileged_groups: vec![group_name.clone()],
                last_logon: last_logon_str,
                password_age_days,
                password_expiry_date: None,
                enabled,
                password_never_expires,
                kerberoastable,
                asrep_roastable,
                reversible_encryption,
                des_only,
                constrained_delegation_transition,
                has_sid_history,
                is_service_account,
                in_protected_users,
                admin_count_orphaned: admin_count == 1 && !enabled, // Simplified: disabled with adminCount=1
                alerts: Vec::new(),
            };

            account.alerts = compute_alerts(&account, last_logon_age_days);
            all_accounts.push(account);
        }
    }

    // Second pass: detect true adminCount orphans (adminCount=1 but not in any priv group)
    // This requires checking accounts NOT in our list that have adminCount=1
    // For now, we mark accounts in the list that are disabled with adminCount=1

    // Sort by severity (most alerts first, then by highest severity)
    all_accounts.sort_by(|a, b| {
        let a_max = a.alerts.iter().map(|al| &al.severity).max();
        let b_max = b.alerts.iter().map(|al| &al.severity).max();
        b_max
            .cmp(&a_max)
            .then_with(|| b.alerts.len().cmp(&a.alerts.len()))
    });

    // Domain-level findings
    let domain_findings = get_domain_security_findings(provider.clone()).await;

    let summary = compute_summary(&all_accounts, &domain_findings);

    Ok(PrivilegedAccountsReport {
        accounts: all_accounts,
        domain_findings,
        summary,
        scanned_at: Utc::now().to_rfc3339(),
    })
}

/// Gathers domain-level security findings (KRBTGT, LAPS, PSO, functional level, etc.).
async fn get_domain_security_findings(
    provider: Arc<dyn DirectoryProvider>,
) -> DomainSecurityFindings {
    let mut findings = DomainSecurityFindings {
        krbtgt_password_age_days: None,
        laps_coverage_percent: None,
        laps_deployed_count: 0,
        total_computer_count: 0,
        pso_count: 0,
        domain_functional_level: None,
        forest_functional_level: None,
        ldap_signing_enforced: None,
        recycle_bin_enabled: None,
        rbcd_configured_count: 0,
        alerts: Vec::new(),
    };

    // KRBTGT password age
    if let Ok(Some(krbtgt)) = provider.get_user_by_identity("krbtgt").await {
        let pwd_set = parse_ad_timestamp(krbtgt.get_attribute("pwdLastSet"));
        if let Some(dt) = pwd_set {
            let age = (Utc::now() - dt).num_days();
            findings.krbtgt_password_age_days = Some(age);
            if age > KRBTGT_PASSWORD_AGE_THRESHOLD_DAYS {
                findings.alerts.push(SecurityAlert {
                    severity: AlertSeverity::Critical,
                    message: format!(
                        "KRBTGT password not changed for {} days (threshold: {})",
                        age, KRBTGT_PASSWORD_AGE_THRESHOLD_DAYS
                    ),
                    alert_type: "krbtgt_password_age".to_string(),
                });
            }
        }
    }

    // LAPS coverage: count computers with ms-Mcs-AdmPwdExpirationTime
    let computers = provider.browse_computers(5000).await.unwrap_or_default();
    findings.total_computer_count = computers.len();
    findings.laps_deployed_count = computers
        .iter()
        .filter(|c| {
            c.get_attribute("ms-Mcs-AdmPwdExpirationTime").is_some()
                || c.get_attribute("msLAPS-PasswordExpirationTime").is_some()
        })
        .count();
    if findings.total_computer_count > 0 {
        let pct =
            findings.laps_deployed_count as f64 / findings.total_computer_count as f64 * 100.0;
        findings.laps_coverage_percent = Some(pct);
        if pct < 80.0 {
            findings.alerts.push(SecurityAlert {
                severity: AlertSeverity::High,
                message: format!(
                    "LAPS coverage is {:.0}% ({}/{} computers)",
                    pct, findings.laps_deployed_count, findings.total_computer_count
                ),
                alert_type: "laps_low_coverage".to_string(),
            });
        }
    }

    // Fine-Grained Password Policies (PSOs)
    if let Some(base_dn) = provider.base_dn() {
        let pso_base = format!("CN=Password Settings Container,CN=System,{}", base_dn);
        if let Ok(psos) = provider
            .search_configuration(&pso_base, "(objectClass=msDS-PasswordSettings)")
            .await
        {
            findings.pso_count = psos.len();
        }
    }

    // Domain/Forest functional level from rootDSE
    if let Ok(Some(root_dse)) = provider.read_entry("").await {
        findings.domain_functional_level = root_dse
            .get_attribute("domainFunctionality")
            .map(functional_level_label);
        findings.forest_functional_level = root_dse
            .get_attribute("forestFunctionality")
            .map(functional_level_label);

        // Check if domain level is low (< 2012 R2 = level 6)
        if let Some(level_str) = root_dse.get_attribute("domainFunctionality") {
            if let Ok(level) = level_str.parse::<u32>() {
                if level < 6 {
                    findings.alerts.push(SecurityAlert {
                        severity: AlertSeverity::Medium,
                        message: format!(
                            "Domain functional level is {} - consider upgrading for security features",
                            findings
                                .domain_functional_level
                                .as_deref()
                                .unwrap_or("unknown")
                        ),
                        alert_type: "low_functional_level".to_string(),
                    });
                }
            }
        }
    }

    // Recycle Bin
    findings.recycle_bin_enabled = provider.is_recycle_bin_enabled().await.ok();
    if findings.recycle_bin_enabled == Some(false) {
        findings.alerts.push(SecurityAlert {
            severity: AlertSeverity::Medium,
            message: "AD Recycle Bin is not enabled".to_string(),
            alert_type: "recycle_bin_disabled".to_string(),
        });
    }

    // RBCD: count users/computers with msDS-AllowedToActOnBehalfOfOtherIdentity
    let all_users = provider.browse_users(5000).await.unwrap_or_default();
    findings.rbcd_configured_count = all_users
        .iter()
        .chain(computers.iter())
        .filter(|e| {
            e.get_attribute("msDS-AllowedToActOnBehalfOfOtherIdentity")
                .is_some()
        })
        .count();
    if findings.rbcd_configured_count > 0 {
        findings.alerts.push(SecurityAlert {
            severity: AlertSeverity::High,
            message: format!(
                "{} object(s) with Resource-Based Constrained Delegation configured",
                findings.rbcd_configured_count
            ),
            alert_type: "rbcd_configured".to_string(),
        });
    }

    findings
}

/// Converts AD functional level number to human-readable label.
fn functional_level_label(value: &str) -> String {
    match value {
        "0" => "Windows 2000".to_string(),
        "1" => "Windows Server 2003 Interim".to_string(),
        "2" => "Windows Server 2003".to_string(),
        "3" => "Windows Server 2008".to_string(),
        "4" => "Windows Server 2008 R2".to_string(),
        "5" => "Windows Server 2012".to_string(),
        "6" => "Windows Server 2012 R2".to_string(),
        "7" => "Windows Server 2016".to_string(),
        _ => format!("Level {}", value),
    }
}

/// Gets all user members of a group recursively (up to 3 levels deep).
///
/// Uses `get_group_members` and recurses into nested groups to collect
/// all user accounts. This ensures full attribute resolution (sAMAccountName,
/// displayName, etc.) since `get_group_members` returns properly populated
/// `DirectoryEntry` objects.
async fn get_recursive_members(
    provider: &Arc<dyn DirectoryProvider>,
    group_dn: &str,
) -> Vec<crate::models::DirectoryEntry> {
    let mut all_users = Vec::new();
    let mut visited_groups = std::collections::HashSet::new();
    collect_members_recursive(provider, group_dn, &mut all_users, &mut visited_groups, 0).await;
    all_users
}

/// Recursive helper with depth limit and visited tracking to prevent cycles.
async fn collect_members_recursive(
    provider: &Arc<dyn DirectoryProvider>,
    group_dn: &str,
    users: &mut Vec<crate::models::DirectoryEntry>,
    visited: &mut std::collections::HashSet<String>,
    depth: usize,
) {
    const MAX_DEPTH: usize = 5;
    if depth >= MAX_DEPTH || !visited.insert(group_dn.to_string()) {
        return;
    }

    let members = provider
        .get_group_members(group_dn, 1000)
        .await
        .unwrap_or_default();

    for member in members {
        match member.object_class.as_deref() {
            Some("group") => {
                // Recurse into nested group
                Box::pin(collect_members_recursive(
                    provider,
                    &member.distinguished_name,
                    users,
                    visited,
                    depth + 1,
                ))
                .await;
            }
            _ => {
                // User or unknown - include it
                users.push(member);
            }
        }
    }
}

/// Computes security alerts for a privileged account based on its properties.
///
/// `last_logon_age_days` is provided separately because it's computed from the
/// raw AD timestamp during account construction.
pub fn compute_alerts(
    account: &PrivilegedAccountInfo,
    last_logon_age_days: Option<i64>,
) -> Vec<SecurityAlert> {
    let mut alerts = Vec::new();

    // --- Critical severity ---

    // Password older than 90 days
    if let Some(age) = account.password_age_days {
        if age > PASSWORD_AGE_THRESHOLD_DAYS {
            alerts.push(SecurityAlert {
                severity: AlertSeverity::Critical,
                message: format!(
                    "Password not changed for {} days (threshold: {})",
                    age, PASSWORD_AGE_THRESHOLD_DAYS
                ),
                alert_type: "password_age".to_string(),
            });
        }
    }

    // Reversible encryption enabled
    if account.reversible_encryption {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::Critical,
            message: "Reversible encryption enabled - password recoverable in plaintext"
                .to_string(),
            alert_type: "reversible_encryption".to_string(),
        });
    }

    // AS-REP Roastable (no pre-auth)
    if account.asrep_roastable {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::Critical,
            message: "Kerberos pre-authentication disabled - AS-REP Roastable".to_string(),
            alert_type: "asrep_roastable".to_string(),
        });
    }

    // --- High severity ---

    // Kerberoastable (SPN set on user account)
    if account.kerberoastable {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::High,
            message: "SPN set on privileged account - Kerberoastable".to_string(),
            alert_type: "kerberoastable".to_string(),
        });
    }

    // Password set to never expire
    if account.password_never_expires {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::High,
            message: "Password set to never expire on privileged account".to_string(),
            alert_type: "password_never_expires".to_string(),
        });
    }

    // Disabled account still in privileged group
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

    // Constrained delegation with protocol transition
    if account.constrained_delegation_transition {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::High,
            message:
                "Constrained delegation with protocol transition enabled - can impersonate any user"
                    .to_string(),
            alert_type: "constrained_delegation_transition".to_string(),
        });
    }

    // SIDHistory present on admin account
    if account.has_sid_history {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::High,
            message: "SIDHistory attribute present - potential cross-domain escalation vector"
                .to_string(),
            alert_type: "sid_history".to_string(),
        });
    }

    // Service account in Domain Admins (SPN + password never expires + privileged)
    if account.is_service_account {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::High,
            message: "Service account in privileged group (has SPN + password never expires)"
                .to_string(),
            alert_type: "service_account_in_admins".to_string(),
        });
    }

    // Not in Protected Users group
    if account.enabled && !account.in_protected_users {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::High,
            message: "Privileged account not in Protected Users group".to_string(),
            alert_type: "not_in_protected_users".to_string(),
        });
    }

    // --- Medium severity ---

    // DES-only Kerberos encryption
    if account.des_only {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::Medium,
            message: "DES-only Kerberos encryption enabled - weak cryptography".to_string(),
            alert_type: "des_only".to_string(),
        });
    }

    // Account never logged on
    if account.last_logon.is_none() {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::Medium,
            message: "Account has never logged on".to_string(),
            alert_type: "never_logged_on".to_string(),
        });
    }

    // Inactive admin (last logon > 90 days but did log on at some point)
    if let Some(age) = last_logon_age_days {
        if age > 90 {
            alerts.push(SecurityAlert {
                severity: AlertSeverity::Medium,
                message: format!("Inactive admin account - last logon {} days ago", age),
                alert_type: "inactive_admin".to_string(),
            });
        }
    }

    // AdminCount orphaned
    if account.admin_count_orphaned {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::Medium,
            message: "adminCount=1 on disabled account - orphaned AdminSDHolder protection"
                .to_string(),
            alert_type: "admin_count_orphaned".to_string(),
        });
    }

    alerts
}

/// Computes alert summary counts from accounts and domain findings.
fn compute_summary(
    accounts: &[PrivilegedAccountInfo],
    domain_findings: &DomainSecurityFindings,
) -> AlertSummary {
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

    for alert in &domain_findings.alerts {
        match alert.severity {
            AlertSeverity::Critical => summary.critical += 1,
            AlertSeverity::High => summary.high += 1,
            AlertSeverity::Medium => summary.medium += 1,
            AlertSeverity::Info => summary.info += 1,
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
    RemediationComplexity, RiskFactor, RiskFinding, RiskScoreHistory, RiskScoreResult, RiskWeights,
    RiskZone,
};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

/// Helper struct to bundle factor computation results.
struct FactorResult {
    score: f64,
    explanation: String,
    recommendations: Vec<String>,
    findings: Vec<RiskFinding>,
}

/// Derives severity from points deducted.
fn severity_from_points(points: f64) -> AlertSeverity {
    if points >= 20.0 {
        AlertSeverity::Critical
    } else if points >= 10.0 {
        AlertSeverity::High
    } else if points >= 5.0 {
        AlertSeverity::Medium
    } else {
        AlertSeverity::Info
    }
}

/// Builds a `RiskFactor` from a `FactorResult`.
fn build_risk_factor(id: &str, name: &str, weight: f64, result: FactorResult) -> RiskFactor {
    let raw_impact: f64 = result.findings.iter().map(|f| f.points_deducted).sum();
    // Cap at the actual deficit - can't gain more than what's missing
    let impact_if_fixed = raw_impact.min(100.0 - result.score);
    RiskFactor {
        id: id.to_string(),
        name: name.to_string(),
        score: result.score,
        weight,
        explanation: result.explanation,
        recommendations: result.recommendations,
        findings: result.findings,
        impact_if_fixed,
    }
}

/// Computes the domain risk score based on data from the directory provider.
pub async fn compute_risk_score(
    provider: Arc<dyn DirectoryProvider>,
    weights: &RiskWeights,
) -> Result<RiskScoreResult> {
    let mut factors = Vec::new();

    // Collect domain findings once for reuse across factors
    let domain_findings = get_domain_security_findings(provider.clone()).await;

    // Factor 1: Privileged Account Hygiene
    let priv_result = compute_privileged_hygiene_factor(provider.clone()).await;
    factors.push(build_risk_factor(
        "privileged_hygiene",
        "Privileged Account Hygiene",
        weights.privileged_hygiene,
        priv_result,
    ));

    // Factor 2: Password Policy Strength
    let pwd_result = compute_password_policy_factor(provider.clone()).await;
    factors.push(build_risk_factor(
        "password_policy",
        "Password Policy Strength",
        weights.password_policy,
        pwd_result,
    ));

    // Factor 3: Stale Account Ratio
    let stale_result = compute_stale_accounts_factor(provider.clone()).await;
    factors.push(build_risk_factor(
        "stale_accounts",
        "Stale Account Ratio",
        weights.stale_accounts,
        stale_result,
    ));

    // Factor 4: Kerberos Security
    let kerb_result = compute_kerberos_security_factor(provider.clone(), &domain_findings).await;
    factors.push(build_risk_factor(
        "kerberos_security",
        "Kerberos Security",
        weights.kerberos_security,
        kerb_result,
    ));

    // Factor 5: Dangerous Configurations
    let danger_result = compute_dangerous_configs_factor(provider.clone()).await;
    factors.push(build_risk_factor(
        "dangerous_configs",
        "Dangerous Configurations",
        weights.dangerous_configs,
        danger_result,
    ));

    // Factor 6: Infrastructure Hardening
    let infra_result =
        compute_infrastructure_hardening_factor(provider.clone(), &domain_findings).await;
    factors.push(build_risk_factor(
        "infrastructure_hardening",
        "Infrastructure Hardening",
        weights.infrastructure_hardening,
        infra_result,
    ));

    // Factor 7: GPO Security
    let gpo_result = compute_gpo_security_factor(provider.clone()).await;
    factors.push(build_risk_factor(
        "gpo_security",
        "GPO Security",
        weights.gpo_security,
        gpo_result,
    ));

    // Factor 8: Trust Security
    let trust_result = compute_trust_security_factor(provider.clone()).await;
    factors.push(build_risk_factor(
        "trust_security",
        "Trust Security",
        weights.trust_security,
        trust_result,
    ));

    // Factor 9: Certificate Security (AD CS)
    let cert_result = compute_certificate_security_factor(provider.clone()).await;
    factors.push(build_risk_factor(
        "certificate_security",
        "Certificate Security",
        weights.certificate_security,
        cert_result,
    ));

    // Compute weighted total
    let total_weight: f64 = factors.iter().map(|f| f.weight).sum();
    let total_score = if total_weight > 0.0 {
        factors.iter().map(|f| f.score * f.weight).sum::<f64>() / total_weight
    } else {
        0.0
    };

    // Worst factor (PingCastle-style "weakest link" indicator)
    let worst = factors.iter().min_by(|a, b| {
        a.score
            .partial_cmp(&b.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let (worst_factor_name, worst_factor_score) = worst
        .map(|f| (f.name.clone(), f.score))
        .unwrap_or_else(|| ("None".to_string(), 100.0));

    let zone = match total_score as u32 {
        0..=40 => RiskZone::Red,
        41..=70 => RiskZone::Orange,
        _ => RiskZone::Green,
    };

    Ok(RiskScoreResult {
        total_score,
        zone,
        worst_factor_name,
        worst_factor_score,
        factors,
        computed_at: Utc::now().to_rfc3339(),
    })
}

/// Scores privileged account hygiene (0-100).
async fn compute_privileged_hygiene_factor(provider: Arc<dyn DirectoryProvider>) -> FactorResult {
    let report = get_privileged_accounts_report(provider.clone(), &[]).await;
    match report {
        Ok(report) if !report.accounts.is_empty() => {
            let total = report.accounts.len() as f64;
            let with_alerts = report
                .accounts
                .iter()
                .filter(|a| !a.alerts.is_empty())
                .count() as f64;
            let mut score = ((total - with_alerts) / total * 100.0).clamp(0.0, 100.0);

            let mut recommendations = Vec::new();
            let mut findings = Vec::new();

            if report.summary.critical > 0 {
                let points = (report.summary.critical as f64 * 5.0).min(30.0);
                recommendations.push(format!(
                    "Address {} critical alert(s) on privileged accounts",
                    report.summary.critical
                ));
                findings.push(RiskFinding {
                    id: "PRIV-001".to_string(),
                    description: format!(
                        "{} critical alert(s) on privileged accounts",
                        report.summary.critical
                    ),
                    severity: severity_from_points(points),
                    points_deducted: points,
                    remediation: "Address critical alerts on privileged accounts".to_string(),
                    complexity: RemediationComplexity::Medium,
                    framework_ref: Some("CIS 5.1".to_string()),
                });
            }
            if report.summary.high > 0 {
                let points = (report.summary.high as f64 * 3.0).min(20.0);
                recommendations.push(format!(
                    "Review {} high-severity alert(s) on privileged accounts",
                    report.summary.high
                ));
                findings.push(RiskFinding {
                    id: "PRIV-002".to_string(),
                    description: format!(
                        "{} high-severity alert(s) on privileged accounts",
                        report.summary.high
                    ),
                    severity: severity_from_points(points),
                    points_deducted: points,
                    remediation: "Review high-severity alerts on privileged accounts".to_string(),
                    complexity: RemediationComplexity::Medium,
                    framework_ref: Some("CIS 5.2".to_string()),
                });
            }

            // Inactive accounts in admin groups (enabled but last logon > 90 days)
            let now = Utc::now();
            let inactive_admins = report
                .accounts
                .iter()
                .filter(|a| {
                    a.enabled
                        && a.last_logon
                            .as_ref()
                            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                            .map(|dt| (now - dt.with_timezone(&Utc)).num_days() > 90)
                            .unwrap_or(true)
                })
                .count();
            if inactive_admins > 0 {
                let penalty = (inactive_admins as f64 * 5.0).min(20.0);
                score -= penalty;
                recommendations.push(format!(
                    "Disable or remove {} inactive admin account(s)",
                    inactive_admins
                ));
                findings.push(RiskFinding {
                    id: "PRIV-INACTIVE-ADMIN".to_string(),
                    description: format!(
                        "{} enabled admin account(s) have not logged on in 90+ days",
                        inactive_admins
                    ),
                    severity: AlertSeverity::High,
                    points_deducted: penalty,
                    remediation: format!(
                        "Disable {} inactive admin account(s) or remove from privileged groups",
                        inactive_admins
                    ),
                    complexity: RemediationComplexity::Easy,
                    framework_ref: Some("CIS 5.1.1".to_string()),
                });
            }

            // Computer accounts in admin groups
            // Re-scan group members to find computer objects
            let mut computer_in_admin = 0_usize;
            for (rid, _) in PRIVILEGED_GROUP_RIDS {
                if let Ok(Some(group)) = provider.resolve_group_by_rid(*rid).await {
                    let members = provider
                        .get_group_members(&group.distinguished_name, 1000)
                        .await
                        .unwrap_or_default();
                    computer_in_admin += members
                        .iter()
                        .filter(|m| m.object_class.as_deref() == Some("computer"))
                        .count();
                }
            }
            if computer_in_admin > 0 {
                let penalty = 20.0;
                score -= penalty;
                recommendations.push(format!(
                    "Remove {} computer account(s) from privileged groups",
                    computer_in_admin
                ));
                findings.push(RiskFinding {
                    id: "PRIV-COMPUTER-IN-ADMIN".to_string(),
                    description: format!(
                        "{} computer account(s) found in privileged groups",
                        computer_in_admin
                    ),
                    severity: AlertSeverity::Critical,
                    points_deducted: penalty,
                    remediation: "Remove computer accounts from all privileged groups".to_string(),
                    complexity: RemediationComplexity::Easy,
                    framework_ref: Some("MITRE T1078.002".to_string()),
                });
            }

            // Excessive admin count
            let total_priv = report.accounts.len();
            if total_priv > 20 {
                let penalty = 15.0;
                score -= penalty;
                recommendations.push(format!(
                    "Reduce privileged accounts from {} to fewer than 10",
                    total_priv
                ));
                findings.push(RiskFinding {
                    id: "PRIV-EXCESSIVE".to_string(),
                    description: format!(
                        "{} privileged accounts detected - best practice is fewer than 10",
                        total_priv
                    ),
                    severity: AlertSeverity::High,
                    points_deducted: penalty,
                    remediation:
                        "Reduce the number of privileged accounts to minimize attack surface"
                            .to_string(),
                    complexity: RemediationComplexity::Medium,
                    framework_ref: Some("CIS 5.1.2".to_string()),
                });
            } else if total_priv > 10 {
                let penalty = 5.0;
                score -= penalty;
                recommendations.push(format!(
                    "Consider reducing privileged accounts from {} to fewer than 10",
                    total_priv
                ));
                findings.push(RiskFinding {
                    id: "PRIV-EXCESSIVE".to_string(),
                    description: format!(
                        "{} privileged accounts detected - consider reducing",
                        total_priv
                    ),
                    severity: AlertSeverity::Medium,
                    points_deducted: penalty,
                    remediation:
                        "Reduce the number of privileged accounts to minimize attack surface"
                            .to_string(),
                    complexity: RemediationComplexity::Medium,
                    framework_ref: Some("CIS 5.1.2".to_string()),
                });
            }

            // Empty admin groups
            let mut empty_groups = Vec::new();
            for (rid, fallback_name) in PRIVILEGED_GROUP_RIDS {
                if let Ok(Some(group)) = provider.resolve_group_by_rid(*rid).await {
                    let members = provider
                        .get_group_members(&group.distinguished_name, 1)
                        .await
                        .unwrap_or_default();
                    if members.is_empty() {
                        let name = group
                            .display_name
                            .clone()
                            .or_else(|| group.sam_account_name.clone())
                            .unwrap_or_else(|| fallback_name.to_string());
                        empty_groups.push(name);
                    }
                }
            }
            if !empty_groups.is_empty() {
                findings.push(RiskFinding {
                    id: "PRIV-EMPTY-GROUP".to_string(),
                    description: format!(
                        "Privileged group(s) with no members: {}",
                        empty_groups.join(", ")
                    ),
                    severity: AlertSeverity::Info,
                    points_deducted: 0.0,
                    remediation: "Verify empty privileged groups are intentional".to_string(),
                    complexity: RemediationComplexity::Easy,
                    framework_ref: Some("CIS 5.1".to_string()),
                });
            }

            FactorResult {
                score: score.clamp(0.0, 100.0),
                explanation: format!(
                    "{}/{} privileged accounts have security alerts",
                    with_alerts as usize, total as usize
                ),
                recommendations,
                findings,
            }
        }
        Ok(_) => FactorResult {
            score: 100.0,
            explanation: "No privileged accounts found to assess".to_string(),
            recommendations: vec![],
            findings: vec![],
        },
        Err(_) => FactorResult {
            score: 50.0,
            explanation: "Could not assess privileged accounts".to_string(),
            recommendations: vec![
                "Ensure directory connectivity to scan privileged groups".to_string()
            ],
            findings: vec![],
        },
    }
}

/// Scores password policy strength (0-100).
async fn compute_password_policy_factor(provider: Arc<dyn DirectoryProvider>) -> FactorResult {
    // Read the default domain password policy from rootDSE
    let entry = provider.read_entry("").await;
    match entry {
        Ok(Some(root_dse)) => {
            let base_dn = root_dse.get_attribute("defaultNamingContext").unwrap_or("");
            if base_dn.is_empty() {
                return FactorResult {
                    score: 50.0,
                    explanation: "Could not determine domain base DN".to_string(),
                    recommendations: vec![],
                    findings: vec![],
                };
            }

            // Read domain object for password policy attributes
            let domain = provider.read_entry(base_dn).await;
            match domain {
                Ok(Some(domain_entry)) => {
                    let mut score = 100.0_f64;
                    let mut issues = Vec::new();
                    let mut recommendations = Vec::new();
                    let mut findings = Vec::new();

                    // Check minPwdLength
                    let min_length = domain_entry
                        .get_attribute("minPwdLength")
                        .and_then(|v| v.parse::<u32>().ok())
                        .unwrap_or(0);
                    if min_length < 12 {
                        score -= 25.0;
                        issues.push(format!(
                            "Minimum password length is {} (should be 12+)",
                            min_length
                        ));
                        recommendations.push(
                            "Increase minimum password length to 12 or more characters".to_string(),
                        );
                        findings.push(RiskFinding {
                            id: "PWD-001".to_string(),
                            description: format!(
                                "Minimum password length is {} (should be 12+)",
                                min_length
                            ),
                            severity: severity_from_points(25.0),
                            points_deducted: 25.0,
                            remediation:
                                "Increase minimum password length to 12 or more characters"
                                    .to_string(),
                            complexity: RemediationComplexity::Easy,
                            framework_ref: Some("CIS 1.1.4".to_string()),
                        });
                    }

                    // Check lockoutThreshold
                    let lockout = domain_entry
                        .get_attribute("lockoutThreshold")
                        .and_then(|v| v.parse::<u32>().ok())
                        .unwrap_or(0);
                    if lockout == 0 {
                        score -= 25.0;
                        issues.push("Account lockout is disabled".to_string());
                        recommendations
                            .push("Enable account lockout after 5-10 failed attempts".to_string());
                        findings.push(RiskFinding {
                            id: "PWD-002".to_string(),
                            description: "Account lockout is disabled".to_string(),
                            severity: severity_from_points(25.0),
                            points_deducted: 25.0,
                            remediation: "Enable account lockout after 5-10 failed attempts"
                                .to_string(),
                            complexity: RemediationComplexity::Easy,
                            framework_ref: Some("CIS 1.2.1".to_string()),
                        });
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
                        findings.push(RiskFinding {
                            id: "PWD-003".to_string(),
                            description: "Password complexity requirement is disabled".to_string(),
                            severity: severity_from_points(25.0),
                            points_deducted: 25.0,
                            remediation: "Enable password complexity requirements".to_string(),
                            complexity: RemediationComplexity::Easy,
                            framework_ref: Some("CIS 1.1.5".to_string()),
                        });
                    }

                    // Check maxPwdAge (negative 100ns intervals)
                    let max_age = domain_entry
                        .get_attribute("maxPwdAge")
                        .and_then(|v| v.parse::<i64>().ok())
                        .unwrap_or(0);
                    if max_age == 0 {
                        score -= 25.0;
                        issues.push("Password expiration is disabled".to_string());
                        recommendations
                            .push("Set maximum password age to 90 days or less".to_string());
                        findings.push(RiskFinding {
                            id: "PWD-004".to_string(),
                            description: "Password expiration is disabled".to_string(),
                            severity: severity_from_points(25.0),
                            points_deducted: 25.0,
                            remediation: "Set maximum password age to 90 days or less".to_string(),
                            complexity: RemediationComplexity::Easy,
                            framework_ref: Some("CIS 1.1.2".to_string()),
                        });
                    }

                    let explanation = if issues.is_empty() {
                        "Password policy meets all recommended thresholds".to_string()
                    } else {
                        format!("Issues found: {}", issues.join("; "))
                    };

                    FactorResult {
                        score: score.clamp(0.0, 100.0),
                        explanation,
                        recommendations,
                        findings,
                    }
                }
                _ => FactorResult {
                    score: 50.0,
                    explanation: "Could not read domain password policy".to_string(),
                    recommendations: vec![],
                    findings: vec![],
                },
            }
        }
        _ => FactorResult {
            score: 50.0,
            explanation: "Could not connect to directory to assess password policy".to_string(),
            recommendations: vec![],
            findings: vec![],
        },
    }
}

/// Scores stale account ratio (0-100).
async fn compute_stale_accounts_factor(provider: Arc<dyn DirectoryProvider>) -> FactorResult {
    let users = provider.browse_users(5000).await;
    match users {
        Ok(users) if !users.is_empty() => {
            let total = users.len();
            let now = Utc::now();
            let stale_count = users
                .iter()
                .filter(|u| {
                    let last_logon = parse_ad_timestamp(u.get_attribute("lastLogonTimestamp"))
                        .or_else(|| parse_ad_timestamp(u.get_attribute("lastLogon")));
                    match last_logon {
                        Some(dt) => (now - dt).num_days() > 90,
                        None => true, // Never logged on = stale
                    }
                })
                .count();

            let ratio = stale_count as f64 / total as f64;
            let mut score = ((1.0 - ratio) * 100.0).clamp(0.0, 100.0);

            let mut recommendations = Vec::new();
            let mut findings = Vec::new();
            if stale_count > 0 {
                let points = (ratio * 100.0).min(100.0);
                recommendations.push(format!(
                    "Review and disable/remove {} stale account(s) (inactive > 90 days)",
                    stale_count
                ));
                findings.push(RiskFinding {
                    id: "STALE-001".to_string(),
                    description: format!(
                        "{}/{} accounts are stale (inactive > 90 days)",
                        stale_count, total
                    ),
                    severity: severity_from_points(points),
                    points_deducted: points,
                    remediation: format!(
                        "Review and disable/remove {} stale account(s)",
                        stale_count
                    ),
                    complexity: RemediationComplexity::Medium,
                    framework_ref: Some("CIS 5.3".to_string()),
                });
            }

            // Stale machine accounts (password > 90 days)
            let computers = provider.browse_computers(5000).await.unwrap_or_default();
            let total_machines = computers.len();
            if total_machines > 0 {
                let stale_machines = computers
                    .iter()
                    .filter(|c| {
                        let pwd_set = parse_ad_timestamp(c.get_attribute("pwdLastSet"));
                        match pwd_set {
                            Some(dt) => (now - dt).num_days() > 90,
                            None => true,
                        }
                    })
                    .count();
                if stale_machines > 0 {
                    let penalty = (stale_machines as f64 / total_machines as f64 * 15.0).min(15.0);
                    score -= penalty;
                    recommendations.push(format!(
                        "Review {} stale machine account(s) with passwords older than 90 days",
                        stale_machines
                    ));
                    findings.push(RiskFinding {
                        id: "STALE-MACHINE".to_string(),
                        description: format!(
                            "{}/{} machine accounts have passwords older than 90 days",
                            stale_machines, total_machines
                        ),
                        severity: AlertSeverity::Medium,
                        points_deducted: penalty,
                        remediation: format!(
                            "Review and remove {} stale machine account(s)",
                            stale_machines
                        ),
                        complexity: RemediationComplexity::Medium,
                        framework_ref: Some("CIS 5.5".to_string()),
                    });
                }
            }

            FactorResult {
                score: score.clamp(0.0, 100.0),
                explanation: format!(
                    "{}/{} accounts are stale (inactive > 90 days)",
                    stale_count, total
                ),
                recommendations,
                findings,
            }
        }
        Ok(_) => FactorResult {
            score: 100.0,
            explanation: "No user accounts found to assess".to_string(),
            recommendations: vec![],
            findings: vec![],
        },
        Err(_) => FactorResult {
            score: 50.0,
            explanation: "Could not retrieve user accounts".to_string(),
            recommendations: vec![],
            findings: vec![],
        },
    }
}

/// Scores dangerous configurations (0-100).
async fn compute_dangerous_configs_factor(provider: Arc<dyn DirectoryProvider>) -> FactorResult {
    let users = provider.browse_users(5000).await;
    match users {
        Ok(users) if !users.is_empty() => {
            let total = users.len();
            let mut score = 100.0_f64;
            let mut issues = Vec::new();
            let mut recommendations = Vec::new();
            let mut findings = Vec::new();

            // Parse UAC flags for all users once
            let uac_flags: Vec<u32> = users
                .iter()
                .map(|u| {
                    u.get_attribute("userAccountControl")
                        .and_then(|v| v.parse::<u32>().ok())
                        .unwrap_or(0)
                })
                .collect();

            // Unconstrained delegation
            let unconstrained = uac_flags
                .iter()
                .filter(|&&f| f & UAC_TRUSTED_FOR_DELEGATION != 0)
                .count();
            if unconstrained > 0 {
                let penalty = (unconstrained as f64 / total as f64 * 100.0).min(30.0);
                score -= penalty;
                issues.push(format!("{} unconstrained delegation", unconstrained));
                recommendations.push(format!(
                    "Remove unconstrained delegation from {} account(s)",
                    unconstrained
                ));
                findings.push(RiskFinding {
                    id: "CONF-001".to_string(),
                    description: format!(
                        "{} account(s) with unconstrained delegation",
                        unconstrained
                    ),
                    severity: severity_from_points(penalty),
                    points_deducted: penalty,
                    remediation: format!(
                        "Remove unconstrained delegation from {} account(s)",
                        unconstrained
                    ),
                    complexity: RemediationComplexity::Medium,
                    framework_ref: Some("MITRE T1558".to_string()),
                });
            }

            // Constrained delegation with protocol transition
            let constrained_transition = uac_flags
                .iter()
                .filter(|&&f| f & UAC_TRUSTED_TO_AUTH_FOR_DELEGATION != 0)
                .count();
            if constrained_transition > 0 {
                score -= 10.0;
                issues.push(format!(
                    "{} constrained delegation with protocol transition",
                    constrained_transition
                ));
                recommendations.push("Review constrained delegation with protocol transition - can impersonate any user".to_string());
                findings.push(RiskFinding {
                    id: "CONF-002".to_string(),
                    description: format!(
                        "{} account(s) with constrained delegation + protocol transition",
                        constrained_transition
                    ),
                    severity: severity_from_points(10.0),
                    points_deducted: 10.0,
                    remediation: "Review constrained delegation with protocol transition"
                        .to_string(),
                    complexity: RemediationComplexity::Medium,
                    framework_ref: Some("MITRE T1558".to_string()),
                });
            }

            // Password never expires on regular accounts (>10%)
            let never_expires = uac_flags
                .iter()
                .filter(|&&f| f & UAC_DONT_EXPIRE_PASSWORD != 0)
                .count();
            let never_expires_ratio = never_expires as f64 / total as f64;
            if never_expires_ratio > 0.1 {
                score -= 15.0;
                issues.push(format!(
                    "{}% passwords never expire",
                    (never_expires_ratio * 100.0) as u32
                ));
                recommendations.push("Reduce accounts with non-expiring passwords".to_string());
                findings.push(RiskFinding {
                    id: "CONF-003".to_string(),
                    description: format!(
                        "{}% of accounts have non-expiring passwords",
                        (never_expires_ratio * 100.0) as u32
                    ),
                    severity: severity_from_points(15.0),
                    points_deducted: 15.0,
                    remediation: "Reduce accounts with non-expiring passwords".to_string(),
                    complexity: RemediationComplexity::Medium,
                    framework_ref: Some("CIS 1.1.2".to_string()),
                });
            }

            // Reversible encryption
            let reversible = uac_flags
                .iter()
                .filter(|&&f| f & UAC_ENCRYPTED_TEXT_PWD_ALLOWED != 0)
                .count();
            if reversible > 0 {
                score -= 15.0;
                issues.push(format!("{} with reversible encryption", reversible));
                recommendations.push("Disable reversible encryption on all accounts".to_string());
                findings.push(RiskFinding {
                    id: "CONF-004".to_string(),
                    description: format!(
                        "{} account(s) with reversible encryption enabled",
                        reversible
                    ),
                    severity: severity_from_points(15.0),
                    points_deducted: 15.0,
                    remediation: "Disable reversible encryption on all accounts".to_string(),
                    complexity: RemediationComplexity::Easy,
                    framework_ref: Some("CIS 1.1.6".to_string()),
                });
            }

            // DES-only Kerberos
            let des_only = uac_flags
                .iter()
                .filter(|&&f| f & UAC_USE_DES_KEY_ONLY != 0)
                .count();
            if des_only > 0 {
                score -= 10.0;
                issues.push(format!("{} with DES-only Kerberos", des_only));
                recommendations.push("Disable DES encryption and migrate to AES".to_string());
                findings.push(RiskFinding {
                    id: "CONF-005".to_string(),
                    description: format!(
                        "{} account(s) with DES-only Kerberos encryption",
                        des_only
                    ),
                    severity: severity_from_points(10.0),
                    points_deducted: 10.0,
                    remediation: "Disable DES encryption and migrate to AES".to_string(),
                    complexity: RemediationComplexity::Easy,
                    framework_ref: Some("CIS 18.3.5".to_string()),
                });
            }

            // AS-REP Roastable
            let asrep = uac_flags
                .iter()
                .filter(|&&f| f & UAC_DONT_REQUIRE_PREAUTH != 0)
                .count();
            if asrep > 0 {
                score -= 15.0;
                issues.push(format!("{} AS-REP Roastable", asrep));
                recommendations
                    .push("Enable Kerberos pre-authentication on all accounts".to_string());
                findings.push(RiskFinding {
                    id: "CONF-006".to_string(),
                    description: format!("{} account(s) with Kerberos pre-authentication disabled (AS-REP Roastable)", asrep),
                    severity: severity_from_points(15.0),
                    points_deducted: 15.0,
                    remediation: "Enable Kerberos pre-authentication on all accounts".to_string(),
                    complexity: RemediationComplexity::Easy,
                    framework_ref: Some("MITRE T1558.004".to_string()),
                });
            }

            // RBCD configured
            let rbcd = users
                .iter()
                .filter(|u| {
                    u.get_attribute("msDS-AllowedToActOnBehalfOfOtherIdentity")
                        .is_some()
                })
                .count();
            if rbcd > 0 {
                score -= 10.0;
                issues.push(format!("{} with RBCD", rbcd));
                recommendations
                    .push("Audit Resource-Based Constrained Delegation configurations".to_string());
                findings.push(RiskFinding {
                    id: "CONF-007".to_string(),
                    description: format!(
                        "{} object(s) with Resource-Based Constrained Delegation",
                        rbcd
                    ),
                    severity: severity_from_points(10.0),
                    points_deducted: 10.0,
                    remediation: "Audit Resource-Based Constrained Delegation configurations"
                        .to_string(),
                    complexity: RemediationComplexity::Medium,
                    framework_ref: Some("MITRE T1558".to_string()),
                });
            }

            // Domain functional level check
            if let Ok(Some(root_dse)) = provider.read_entry("").await {
                if let Some(level_str) = root_dse.get_attribute("domainFunctionality") {
                    if let Ok(level) = level_str.parse::<u32>() {
                        if level < 6 {
                            score -= 10.0;
                            issues.push(format!(
                                "Domain functional level < 2012 R2 (level {})",
                                level
                            ));
                            recommendations.push(
                                "Upgrade domain functional level for modern security features"
                                    .to_string(),
                            );
                            findings.push(RiskFinding {
                                id: "CONF-008".to_string(),
                                description: format!(
                                    "Domain functional level < 2012 R2 (level {})",
                                    level
                                ),
                                severity: severity_from_points(10.0),
                                points_deducted: 10.0,
                                remediation:
                                    "Upgrade domain functional level for modern security features"
                                        .to_string(),
                                complexity: RemediationComplexity::Hard,
                                framework_ref: Some("CIS 18.1".to_string()),
                            });
                        }
                    }
                }
            }

            // Count orphaned adminCount accounts (adminCount=1 not in admin groups)
            let orphaned_admin_count = users
                .iter()
                .filter(|u| {
                    u.get_attribute("adminCount")
                        .and_then(|v| v.parse::<u32>().ok())
                        .unwrap_or(0)
                        == 1
                })
                .count();
            // This is informational - the real check is in privileged hygiene
            if orphaned_admin_count > 10 {
                findings.push(RiskFinding {
                    id: "CONF-009".to_string(),
                    description: format!(
                        "{} accounts with adminCount=1 - review for orphaned AdminSDHolder",
                        orphaned_admin_count
                    ),
                    severity: AlertSeverity::Info,
                    points_deducted: 0.0,
                    remediation: "Audit accounts with adminCount=1 and clear orphaned entries"
                        .to_string(),
                    complexity: RemediationComplexity::Medium,
                    framework_ref: Some("MITRE T1078.002".to_string()),
                });
            }

            // PASSWORD_NOT_REQUIRED flag (UAC 0x0020 = PASSWD_NOTREQD)
            let passwd_notreqd = uac_flags
                .iter()
                .filter(|&&f| f & UAC_PASSWD_NOTREQD != 0)
                .count();
            if passwd_notreqd > 0 {
                let penalty = (passwd_notreqd as f64 / total as f64 * 20.0).min(20.0);
                score -= penalty;
                issues.push(format!("{} with PASSWD_NOTREQD", passwd_notreqd));
                recommendations.push(
                    "Clear PASSWD_NOTREQD flag and set passwords on all accounts".to_string(),
                );
                findings.push(RiskFinding {
                    id: "CONF-PASSWD-NOTREQD".to_string(),
                    description: format!(
                        "{} account(s) have PASSWD_NOTREQD flag - can have empty passwords",
                        passwd_notreqd
                    ),
                    // Always at least High - empty passwords are a serious risk regardless of count
                    severity: AlertSeverity::High,
                    points_deducted: penalty,
                    remediation:
                        "Clear PASSWD_NOTREQD flag and set passwords on all affected accounts"
                            .to_string(),
                    complexity: RemediationComplexity::Easy,
                    framework_ref: Some("CIS 1.1.1".to_string()),
                });
            }

            // Accounts with SIDHistory
            let sid_history_count = users
                .iter()
                .filter(|u| !u.get_attribute_values("sIDHistory").is_empty())
                .count();
            if sid_history_count > 0 {
                let penalty = (sid_history_count as f64 * 5.0).min(20.0);
                score -= penalty;
                issues.push(format!("{} with SIDHistory", sid_history_count));
                recommendations.push(
                    "Remove SIDHistory from accounts after migration is complete".to_string(),
                );
                findings.push(RiskFinding {
                    id: "CONF-SIDHISTORY".to_string(),
                    description: format!(
                        "{} account(s) have SIDHistory attribute - potential cross-domain escalation",
                        sid_history_count
                    ),
                    severity: severity_from_points(penalty),
                    points_deducted: penalty,
                    remediation:
                        "Remove SIDHistory from accounts after domain migration is complete"
                            .to_string(),
                    complexity: RemediationComplexity::Medium,
                    framework_ref: Some("MITRE T1134.005".to_string()),
                });
            }

            // Delegation to DC services (msDS-AllowedToDelegateTo targeting DC)
            let base_domain = provider.base_dn().unwrap_or_default().to_lowercase();
            let deleg_to_dc_count = users
                .iter()
                .filter(|u| {
                    let targets = u.get_attribute_values("msDS-AllowedToDelegateTo");
                    !targets.is_empty()
                        && targets
                            .iter()
                            .any(|t| t.to_lowercase().contains(&base_domain))
                })
                .count();
            if deleg_to_dc_count > 0 {
                let penalty = 20.0;
                score -= penalty;
                issues.push(format!(
                    "{} with delegation to DC services",
                    deleg_to_dc_count
                ));
                recommendations
                    .push("Remove delegation targeting domain controller services".to_string());
                findings.push(RiskFinding {
                    id: "CONF-DELEG-DC".to_string(),
                    description: format!(
                        "{} account(s) have constrained delegation targeting DC services",
                        deleg_to_dc_count
                    ),
                    severity: AlertSeverity::Critical,
                    points_deducted: penalty,
                    remediation:
                        "Remove msDS-AllowedToDelegateTo entries targeting domain controllers"
                            .to_string(),
                    complexity: RemediationComplexity::Hard,
                    framework_ref: Some("MITRE T1134.001".to_string()),
                });
            }

            // Protocol transition to sensitive services (CIFS, LDAP, HTTP)
            let sensitive_services = ["cifs/", "ldap/", "http/"];
            let deleg_sensitive_count = users
                .iter()
                .zip(uac_flags.iter())
                .filter(|(u, f)| {
                    **f & UAC_TRUSTED_TO_AUTH_FOR_DELEGATION != 0 && {
                        let targets = u.get_attribute_values("msDS-AllowedToDelegateTo");
                        targets.iter().any(|t| {
                            let lower = t.to_lowercase();
                            sensitive_services.iter().any(|svc| lower.starts_with(svc))
                        })
                    }
                })
                .count();
            if deleg_sensitive_count > 0 {
                let penalty = 15.0;
                score -= penalty;
                issues.push(format!(
                    "{} with protocol transition to sensitive services",
                    deleg_sensitive_count
                ));
                recommendations.push(
                    "Review protocol transition delegation to CIFS/LDAP/HTTP services".to_string(),
                );
                findings.push(RiskFinding {
                    id: "CONF-DELEG-SENSITIVE".to_string(),
                    description: format!(
                        "{} account(s) with protocol transition targeting CIFS/LDAP/HTTP services",
                        deleg_sensitive_count
                    ),
                    severity: AlertSeverity::High,
                    points_deducted: penalty,
                    remediation:
                        "Review and restrict protocol transition delegation to sensitive services"
                            .to_string(),
                    complexity: RemediationComplexity::Hard,
                    framework_ref: Some("MITRE T1134.001".to_string()),
                });
            }

            // Unconstrained delegation on non-DC computers
            let computers = provider.browse_computers(5000).await.unwrap_or_default();
            let uncons_computer_count = computers
                .iter()
                .filter(|c| {
                    let c_uac = c
                        .get_attribute("userAccountControl")
                        .and_then(|v| v.parse::<u32>().ok())
                        .unwrap_or(0);
                    // TRUSTED_FOR_DELEGATION but not a DC (DCs typically have SERVER_TRUST_ACCOUNT 0x2000)
                    c_uac & UAC_TRUSTED_FOR_DELEGATION != 0 && c_uac & 0x2000 == 0
                })
                .count();
            if uncons_computer_count > 0 {
                let penalty = 20.0;
                score -= penalty;
                issues.push(format!(
                    "{} non-DC computers with unconstrained delegation",
                    uncons_computer_count
                ));
                recommendations.push(
                    "Remove unconstrained delegation from non-DC computer accounts".to_string(),
                );
                findings.push(RiskFinding {
                    id: "CONF-UNCONS-COMPUTER".to_string(),
                    description: format!(
                        "{} non-DC computer(s) with unconstrained delegation - can capture TGTs",
                        uncons_computer_count
                    ),
                    severity: AlertSeverity::Critical,
                    points_deducted: penalty,
                    remediation:
                        "Remove unconstrained delegation from all non-DC computer accounts"
                            .to_string(),
                    complexity: RemediationComplexity::Medium,
                    framework_ref: Some("MITRE T1134.001".to_string()),
                });
            }

            let explanation = if issues.is_empty() {
                "No dangerous configurations detected".to_string()
            } else {
                format!("Issues: {}", issues.join("; "))
            };

            FactorResult {
                score: score.clamp(0.0, 100.0),
                explanation,
                recommendations,
                findings,
            }
        }
        Ok(_) => FactorResult {
            score: 100.0,
            explanation: "No user accounts found to assess".to_string(),
            recommendations: vec![],
            findings: vec![],
        },
        Err(_) => FactorResult {
            score: 50.0,
            explanation: "Could not retrieve user accounts for configuration audit".to_string(),
            recommendations: vec![],
            findings: vec![],
        },
    }
}

/// Scores Kerberos security posture (0-100).
///
/// Evaluates: KRBTGT password age, Kerberoastable privileged accounts,
/// AS-REP Roastable accounts, Protected Users group adoption.
async fn compute_kerberos_security_factor(
    provider: Arc<dyn DirectoryProvider>,
    domain_findings: &DomainSecurityFindings,
) -> FactorResult {
    let mut score = 100.0_f64;
    let mut issues = Vec::new();
    let mut recommendations = Vec::new();
    let mut findings = Vec::new();

    // KRBTGT password age (from domain findings)
    if let Some(age) = domain_findings.krbtgt_password_age_days {
        if age > KRBTGT_PASSWORD_AGE_THRESHOLD_DAYS {
            score -= 30.0;
            issues.push(format!("KRBTGT password {} days old", age));
            recommendations.push("Reset KRBTGT password twice with 12-hour interval".to_string());
            findings.push(RiskFinding {
                id: "KERB-001".to_string(),
                description: format!(
                    "KRBTGT password {} days old (threshold: {})",
                    age, KRBTGT_PASSWORD_AGE_THRESHOLD_DAYS
                ),
                severity: severity_from_points(30.0),
                points_deducted: 30.0,
                remediation: "Reset KRBTGT password twice with 12-hour interval".to_string(),
                complexity: RemediationComplexity::Medium,
                framework_ref: Some("MITRE T1558.001".to_string()),
            });
        } else if age > 90 {
            score -= 10.0;
            issues.push(format!(
                "KRBTGT password {} days old (consider resetting)",
                age
            ));
            findings.push(RiskFinding {
                id: "KERB-002".to_string(),
                description: format!("KRBTGT password {} days old - consider resetting", age),
                severity: severity_from_points(10.0),
                points_deducted: 10.0,
                remediation: "Reset KRBTGT password proactively".to_string(),
                complexity: RemediationComplexity::Medium,
                framework_ref: Some("MITRE T1558.001".to_string()),
            });
        }
    }

    // Check privileged accounts for Kerberos weaknesses
    let report = get_privileged_accounts_report(provider.clone(), &[]).await;
    if let Ok(report) = report {
        let total = report.accounts.len().max(1) as f64;

        // Kerberoastable privileged accounts (proportional)
        let kerberoastable = report.accounts.iter().filter(|a| a.kerberoastable).count();
        if kerberoastable > 0 {
            let penalty = (kerberoastable as f64 / total * 30.0).min(25.0);
            score -= penalty;
            issues.push(format!(
                "{}/{} privileged accounts Kerberoastable",
                kerberoastable, total as usize
            ));
            recommendations
                .push("Remove SPNs from privileged user accounts or use gMSA".to_string());
            findings.push(RiskFinding {
                id: "KERB-003".to_string(),
                description: format!(
                    "{}/{} privileged accounts are Kerberoastable",
                    kerberoastable, total as usize
                ),
                severity: severity_from_points(penalty),
                points_deducted: penalty,
                remediation: "Remove SPNs from privileged user accounts or use gMSA".to_string(),
                complexity: RemediationComplexity::Medium,
                framework_ref: Some("MITRE T1558.003".to_string()),
            });
        }

        // AS-REP Roastable (proportional)
        let asrep = report.accounts.iter().filter(|a| a.asrep_roastable).count();
        if asrep > 0 {
            let penalty = (asrep as f64 / total * 30.0).min(25.0);
            score -= penalty;
            issues.push(format!("{} AS-REP Roastable account(s)", asrep));
            recommendations.push("Enable Kerberos pre-authentication on all accounts".to_string());
            findings.push(RiskFinding {
                id: "KERB-004".to_string(),
                description: format!("{} privileged account(s) AS-REP Roastable", asrep),
                severity: severity_from_points(penalty),
                points_deducted: penalty,
                remediation: "Enable Kerberos pre-authentication on all accounts".to_string(),
                complexity: RemediationComplexity::Easy,
                framework_ref: Some("MITRE T1558.004".to_string()),
            });
        }

        // Protected Users adoption (proportional)
        let enabled_accounts: Vec<_> = report.accounts.iter().filter(|a| a.enabled).collect();
        let not_protected = enabled_accounts
            .iter()
            .filter(|a| !a.in_protected_users)
            .count();
        if !enabled_accounts.is_empty() && not_protected > 0 {
            let ratio = not_protected as f64 / enabled_accounts.len() as f64;
            let penalty = (ratio * 20.0).min(20.0);
            score -= penalty;
            issues.push(format!(
                "{}/{} enabled admins not in Protected Users",
                not_protected,
                enabled_accounts.len()
            ));
            recommendations
                .push("Add all privileged accounts to the Protected Users group".to_string());
            findings.push(RiskFinding {
                id: "KERB-005".to_string(),
                description: format!(
                    "{}/{} enabled admins not in Protected Users group",
                    not_protected,
                    enabled_accounts.len()
                ),
                severity: severity_from_points(penalty),
                points_deducted: penalty,
                remediation: "Add all privileged accounts to the Protected Users group".to_string(),
                complexity: RemediationComplexity::Easy,
                framework_ref: Some("CIS 5.4".to_string()),
            });
        }
    }

    // AES enforcement checks require browsing users for msDS-SupportedEncryptionTypes
    let all_users = provider.browse_users(5000).await.unwrap_or_default();

    // AES not enforced on admin accounts (check msDS-SupportedEncryptionTypes)
    // Accounts with adminCount=1 that don't have AES bits set (0x8=AES128, 0x10=AES256)
    let admin_users: Vec<_> = all_users
        .iter()
        .filter(|u| {
            u.get_attribute("adminCount")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0)
                == 1
        })
        .collect();
    let total_admins = admin_users.len().max(1);
    let rc4_admins = admin_users
        .iter()
        .filter(|u| {
            let enc_types = u
                .get_attribute("msDS-SupportedEncryptionTypes")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);
            // If not set (0) or missing AES bits (0x8 | 0x10 = 0x18), RC4 is still usable
            enc_types == 0 || (enc_types & 0x18) == 0
        })
        .count();
    if rc4_admins > 0 {
        let penalty = (rc4_admins as f64 / total_admins as f64 * 15.0).min(15.0);
        score -= penalty;
        issues.push(format!("{} admin(s) without AES enforcement", rc4_admins));
        recommendations.push(
            "Configure msDS-SupportedEncryptionTypes for AES on all admin accounts".to_string(),
        );
        findings.push(RiskFinding {
            id: "KERB-RC4-ADMIN".to_string(),
            description: format!(
                "{}/{} admin account(s) lack AES encryption enforcement - RC4 still usable",
                rc4_admins, total_admins
            ),
            severity: AlertSeverity::Medium,
            points_deducted: penalty,
            remediation:
                "Set msDS-SupportedEncryptionTypes to include AES128/AES256 on admin accounts"
                    .to_string(),
            complexity: RemediationComplexity::Easy,
            framework_ref: Some("CIS 18.3.6".to_string()),
        });
    }

    // Kerberoastable accounts with weak encryption (SPN set, no AES)
    let spn_users: Vec<_> = all_users
        .iter()
        .filter(|u| !u.get_attribute_values("servicePrincipalName").is_empty())
        .collect();
    let total_spn = spn_users.len().max(1);
    let weak_spn = spn_users
        .iter()
        .filter(|u| {
            let enc_types = u
                .get_attribute("msDS-SupportedEncryptionTypes")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);
            enc_types == 0 || (enc_types & 0x18) == 0
        })
        .count();
    if weak_spn > 0 {
        let penalty = (weak_spn as f64 / total_spn as f64 * 15.0).min(15.0);
        score -= penalty;
        issues.push(format!(
            "{} Kerberoastable account(s) with weak encryption",
            weak_spn
        ));
        recommendations.push("Enable AES encryption on all service accounts with SPNs".to_string());
        findings.push(RiskFinding {
            id: "KERB-WEAK-SPN".to_string(),
            description: format!(
                "{}/{} Kerberoastable account(s) lack AES encryption - vulnerable to offline cracking",
                weak_spn, total_spn
            ),
            severity: AlertSeverity::High,
            points_deducted: penalty,
            remediation:
                "Set msDS-SupportedEncryptionTypes to include AES on all service accounts"
                    .to_string(),
            complexity: RemediationComplexity::Easy,
            framework_ref: Some("MITRE T1558.003".to_string()),
        });
    }

    let explanation = if issues.is_empty() {
        "Kerberos configuration meets security best practices".to_string()
    } else {
        format!("Issues: {}", issues.join("; "))
    };

    FactorResult {
        score: score.clamp(0.0, 100.0),
        explanation,
        recommendations,
        findings,
    }
}

/// Scores infrastructure hardening posture (0-100).
///
/// Evaluates: LAPS coverage, Recycle Bin, Fine-Grained Password Policies,
/// domain functional level, LDAP signing, DNS zones, AdminSDHolder.
async fn compute_infrastructure_hardening_factor(
    provider: Arc<dyn DirectoryProvider>,
    domain_findings: &DomainSecurityFindings,
) -> FactorResult {
    let mut score = 100.0_f64;
    let mut issues = Vec::new();
    let mut recommendations = Vec::new();
    let mut findings = Vec::new();

    // LAPS coverage (proportional)
    if let Some(pct) = domain_findings.laps_coverage_percent {
        if pct < 50.0 {
            score -= 30.0;
            issues.push(format!("LAPS coverage {:.0}%", pct));
            recommendations.push("Deploy LAPS to all workstations and servers".to_string());
            findings.push(RiskFinding {
                id: "INFRA-001".to_string(),
                description: format!("LAPS coverage is {:.0}% (target: 80%+)", pct),
                severity: severity_from_points(30.0),
                points_deducted: 30.0,
                remediation: "Deploy LAPS to all workstations and servers".to_string(),
                complexity: RemediationComplexity::Medium,
                framework_ref: Some("CIS 18.2.1".to_string()),
            });
        } else if pct < 80.0 {
            score -= 15.0;
            issues.push(format!("LAPS coverage {:.0}% (target: 80%+)", pct));
            recommendations.push("Extend LAPS deployment to remaining computers".to_string());
            findings.push(RiskFinding {
                id: "INFRA-001".to_string(),
                description: format!("LAPS coverage is {:.0}% (target: 80%+)", pct),
                severity: severity_from_points(15.0),
                points_deducted: 15.0,
                remediation: "Extend LAPS deployment to remaining computers".to_string(),
                complexity: RemediationComplexity::Medium,
                framework_ref: Some("CIS 18.2.1".to_string()),
            });
        }
    } else if domain_findings.total_computer_count > 0 {
        score -= 30.0;
        issues.push("LAPS not deployed".to_string());
        recommendations.push("Deploy LAPS for local admin password management".to_string());
        findings.push(RiskFinding {
            id: "INFRA-001".to_string(),
            description: "LAPS is not deployed on any computer".to_string(),
            severity: severity_from_points(30.0),
            points_deducted: 30.0,
            remediation: "Deploy LAPS for local admin password management".to_string(),
            complexity: RemediationComplexity::Medium,
            framework_ref: Some("CIS 18.2.1".to_string()),
        });
    }

    // Recycle Bin
    if domain_findings.recycle_bin_enabled == Some(false) {
        score -= 15.0;
        issues.push("AD Recycle Bin disabled".to_string());
        recommendations.push("Enable AD Recycle Bin for object recovery capability".to_string());
        findings.push(RiskFinding {
            id: "INFRA-002".to_string(),
            description: "AD Recycle Bin is not enabled".to_string(),
            severity: severity_from_points(15.0),
            points_deducted: 15.0,
            remediation: "Enable AD Recycle Bin for object recovery capability".to_string(),
            complexity: RemediationComplexity::Easy,
            framework_ref: Some("CIS 18.8.1".to_string()),
        });
    }

    // Fine-Grained Password Policies
    if domain_findings.pso_count == 0 {
        score -= 10.0;
        issues.push("No Fine-Grained Password Policies".to_string());
        recommendations.push(
            "Create PSOs for privileged accounts with stronger password requirements".to_string(),
        );
        findings.push(RiskFinding {
            id: "INFRA-003".to_string(),
            description: "No Fine-Grained Password Policies (PSOs) configured".to_string(),
            severity: severity_from_points(10.0),
            points_deducted: 10.0,
            remediation: "Create PSOs for privileged accounts with stronger password requirements"
                .to_string(),
            complexity: RemediationComplexity::Easy,
            framework_ref: Some("CIS 1.1.7".to_string()),
        });
    }

    // Domain functional level
    if let Some(ref level) = domain_findings.domain_functional_level {
        if level.contains("2008") || level.contains("2003") || level.contains("2000") {
            score -= 20.0;
            issues.push(format!("Domain functional level: {}", level));
            recommendations
                .push("Upgrade domain functional level to Windows Server 2016+".to_string());
            findings.push(RiskFinding {
                id: "INFRA-004".to_string(),
                description: format!("Domain functional level is {} - outdated", level),
                severity: severity_from_points(20.0),
                points_deducted: 20.0,
                remediation: "Upgrade domain functional level to Windows Server 2016+".to_string(),
                complexity: RemediationComplexity::Hard,
                framework_ref: Some("CIS 18.1".to_string()),
            });
        } else if level.contains("2012") && !level.contains("R2") {
            score -= 10.0;
            issues.push(format!(
                "Domain functional level: {} (consider upgrading)",
                level
            ));
            findings.push(RiskFinding {
                id: "INFRA-004".to_string(),
                description: format!("Domain functional level is {} - consider upgrading", level),
                severity: severity_from_points(10.0),
                points_deducted: 10.0,
                remediation: "Upgrade domain functional level to Windows Server 2016+".to_string(),
                complexity: RemediationComplexity::Hard,
                framework_ref: Some("CIS 18.1".to_string()),
            });
        }
    }

    // RBCD count as infrastructure concern
    if domain_findings.rbcd_configured_count > 0 {
        let penalty = (domain_findings.rbcd_configured_count as f64 * 5.0).min(15.0);
        score -= penalty;
        issues.push(format!(
            "{} RBCD delegation(s)",
            domain_findings.rbcd_configured_count
        ));
        recommendations
            .push("Audit Resource-Based Constrained Delegation configurations".to_string());
        findings.push(RiskFinding {
            id: "INFRA-005".to_string(),
            description: format!(
                "{} object(s) with RBCD configured",
                domain_findings.rbcd_configured_count
            ),
            severity: severity_from_points(penalty),
            points_deducted: penalty,
            remediation: "Audit Resource-Based Constrained Delegation configurations".to_string(),
            complexity: RemediationComplexity::Medium,
            framework_ref: Some("MITRE T1558".to_string()),
        });
    }

    // DNS zone inventory (ADIDNS)
    if let Some(base_dn) = provider.base_dn() {
        let dns_base = format!("CN=MicrosoftDNS,DC=DomainDnsZones,{}", base_dn);
        if let Ok(zones) = provider
            .search_configuration(&dns_base, "(objectClass=dnsZone)")
            .await
        {
            let zone_count = zones.len();
            if zone_count > 0 {
                let zone_names: Vec<String> = zones
                    .iter()
                    .filter_map(|z| {
                        z.get_attribute("name")
                            .or_else(|| z.get_attribute("dc"))
                            .map(|s| s.to_string())
                    })
                    .collect();
                findings.push(RiskFinding {
                    id: "INFRA-DNS-ZONES".to_string(),
                    description: format!(
                        "{} AD-integrated DNS zone(s) detected: {}",
                        zone_count,
                        zone_names.join(", ")
                    ),
                    severity: AlertSeverity::Info,
                    points_deducted: 0.0,
                    remediation: "Review DNS zones for proper security configuration".to_string(),
                    complexity: RemediationComplexity::Easy,
                    framework_ref: Some("CIS 9.1".to_string()),
                });
            }
        }

        // AdminSDHolder verification
        let adminsdholder_dn = format!("CN=AdminSDHolder,CN=System,{}", base_dn);
        if let Ok(Some(_)) = provider.read_entry(&adminsdholder_dn).await {
            findings.push(RiskFinding {
                id: "INFRA-ADMINSDHOLDER".to_string(),
                description: "AdminSDHolder object exists - SDProp is active".to_string(),
                severity: AlertSeverity::Info,
                points_deducted: 0.0,
                remediation:
                    "Periodically audit AdminSDHolder ACL to ensure it has not been weakened"
                        .to_string(),
                complexity: RemediationComplexity::Medium,
                framework_ref: Some("MITRE T1078".to_string()),
            });
        }
    }

    let explanation = if issues.is_empty() {
        "Infrastructure hardening meets security best practices".to_string()
    } else {
        format!("Issues: {}", issues.join("; "))
    };

    FactorResult {
        score: score.clamp(0.0, 100.0),
        explanation,
        recommendations,
        findings,
    }
}

/// Scores GPO security posture (0-100).
///
/// Evaluates: GPP password risks, domain behavior version, GPO count/editors.
async fn compute_gpo_security_factor(provider: Arc<dyn DirectoryProvider>) -> FactorResult {
    let base_dn = match provider.base_dn() {
        Some(dn) => dn,
        None => {
            return FactorResult {
                score: 50.0,
                explanation: "Could not determine domain base DN for GPO analysis".to_string(),
                recommendations: vec![],
                findings: vec![],
            };
        }
    };

    let mut score = 100.0_f64;
    let mut issues = Vec::new();
    let mut recommendations = Vec::new();
    let mut findings = Vec::new();

    // Check GPO count - GPOs with potential GPP password risks
    let gpo_base = format!("CN=Policies,CN=System,{}", base_dn);
    let gpo_count = match provider
        .search_configuration(&gpo_base, "(objectClass=groupPolicyContainer)")
        .await
    {
        Ok(gpos) => gpos.len(),
        Err(_) => 0,
    };

    if gpo_count > 0 {
        // Flag GPP password risk - we cannot read SYSVOL via LDAP but GPOs exist
        score -= 15.0;
        issues.push(format!(
            "{} GPO(s) found - audit SYSVOL for cpassword entries",
            gpo_count
        ));
        recommendations.push(
            "Audit SYSVOL for Group Policy Preferences with embedded passwords (cpassword)"
                .to_string(),
        );
        findings.push(RiskFinding {
            id: "GPO-001".to_string(),
            description: format!("{} GPO(s) exist - SYSVOL should be audited for GPP passwords (cpassword)", gpo_count),
            severity: severity_from_points(15.0),
            points_deducted: 15.0,
            remediation: "Run Get-GPPPassword or similar tool to scan SYSVOL for cpassword entries and remediate".to_string(),
            complexity: RemediationComplexity::Easy,
            framework_ref: Some("MITRE T1552.006".to_string()),
        });

        // Flag if many GPOs exist (potential for excessive editors)
        if gpo_count > 50 {
            score -= 10.0;
            issues.push(format!(
                "{} GPOs is a large number - review delegation",
                gpo_count
            ));
            recommendations
                .push("Review GPO edit permissions and consolidate where possible".to_string());
            findings.push(RiskFinding {
                id: "GPO-003".to_string(),
                description: format!(
                    "{} GPOs in the domain - large GPO count increases attack surface",
                    gpo_count
                ),
                severity: severity_from_points(10.0),
                points_deducted: 10.0,
                remediation: "Review GPO edit permissions and consolidate where possible"
                    .to_string(),
                complexity: RemediationComplexity::Medium,
                framework_ref: Some("CIS 18.9.25.1".to_string()),
            });
        }
    }

    // Check domain behavior version for advanced audit support
    if let Ok(Some(root_dse)) = provider.read_entry("").await {
        if let Some(level_str) = root_dse.get_attribute("domainFunctionality") {
            if let Ok(level) = level_str.parse::<u32>() {
                if level < 3 {
                    score -= 20.0;
                    issues.push(format!(
                        "Domain functional level {} - pre-2008, no advanced audit",
                        level
                    ));
                    recommendations.push("Upgrade domain to at least Windows Server 2008 functional level for advanced audit policy support".to_string());
                    findings.push(RiskFinding {
                        id: "GPO-002".to_string(),
                        description: format!(
                            "Domain functional level {} does not support advanced audit policies",
                            level
                        ),
                        severity: severity_from_points(20.0),
                        points_deducted: 20.0,
                        remediation:
                            "Upgrade domain to at least Windows Server 2008 functional level"
                                .to_string(),
                        complexity: RemediationComplexity::Hard,
                        framework_ref: Some("CIS 1.1.6".to_string()),
                    });
                }
            }
        }
    }

    // Note: reversible encryption check is already covered in dangerous_configs factor
    // (CONF-004), so we reference it here as informational only.
    if !findings.is_empty() {
        findings.push(RiskFinding {
            id: "GPO-004".to_string(),
            description: "Reversible encryption in GPO settings is checked in the Dangerous Configurations factor".to_string(),
            severity: AlertSeverity::Info,
            points_deducted: 0.0,
            remediation: "See Dangerous Configurations factor for reversible encryption findings".to_string(),
            complexity: RemediationComplexity::Easy,
            framework_ref: Some("CIS 1.1.6".to_string()),
        });
    }

    let explanation = if issues.is_empty() {
        "GPO security posture is acceptable".to_string()
    } else {
        format!("Issues: {}", issues.join("; "))
    };

    FactorResult {
        score: score.clamp(0.0, 100.0),
        explanation,
        recommendations,
        findings,
    }
}

/// Scores trust security posture (0-100).
///
/// Evaluates: external/forest trusts, SID filtering, selective authentication,
/// bidirectional trust risks.
async fn compute_trust_security_factor(provider: Arc<dyn DirectoryProvider>) -> FactorResult {
    let base_dn = match provider.base_dn() {
        Some(dn) => dn,
        None => {
            return FactorResult {
                score: 50.0,
                explanation: "Could not determine domain base DN for trust analysis".to_string(),
                recommendations: vec![],
                findings: vec![],
            };
        }
    };

    let system_base = format!("CN=System,{}", base_dn);
    let trusts = match provider
        .search_configuration(&system_base, "(objectClass=trustedDomain)")
        .await
    {
        Ok(t) => t,
        Err(_) => {
            return FactorResult {
                score: 100.0,
                explanation: "Could not query trust objects (may not have permissions)".to_string(),
                recommendations: vec![],
                findings: vec![],
            };
        }
    };

    if trusts.is_empty() {
        return FactorResult {
            score: 100.0,
            explanation: "No external trusts configured".to_string(),
            recommendations: vec![],
            findings: vec![],
        };
    }

    let mut score = 100.0_f64;
    let mut issues = Vec::new();
    let mut recommendations = Vec::new();
    let mut findings = Vec::new();

    for trust in &trusts {
        let trust_name = trust
            .get_attribute("name")
            .or_else(|| trust.get_attribute("cn"))
            .unwrap_or("unknown");

        let trust_direction = trust
            .get_attribute("trustDirection")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        let trust_attributes = trust
            .get_attribute("trustAttributes")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        let direction_label = match trust_direction {
            1 => "inbound",
            2 => "outbound",
            3 => "bidirectional",
            _ => "unknown",
        };

        // Bidirectional trusts are more risky
        if trust_direction == 3 {
            score -= 10.0;
            issues.push(format!("Bidirectional trust with {}", trust_name));
            recommendations.push(format!(
                "Consider restricting trust with {} to one-way if possible",
                trust_name
            ));
            findings.push(RiskFinding {
                id: "TRUST-004".to_string(),
                description: format!(
                    "Bidirectional trust with {} increases attack surface",
                    trust_name
                ),
                severity: severity_from_points(10.0),
                points_deducted: 10.0,
                remediation: format!(
                    "Consider restricting trust with {} to one-way if possible",
                    trust_name
                ),
                complexity: RemediationComplexity::Hard,
                framework_ref: Some("MITRE T1482".to_string()),
            });
        }

        // SID filtering: TRUST_ATTRIBUTE_QUARANTINED_DOMAIN (0x4) means SID filtering is ON
        let sid_filtering_enabled = (trust_attributes & 0x4) != 0;
        if !sid_filtering_enabled {
            score -= 20.0;
            issues.push(format!(
                "SID filtering disabled on {} trust ({})",
                direction_label, trust_name
            ));
            recommendations.push(format!(
                "Enable SID filtering (quarantine) on trust with {}",
                trust_name
            ));
            findings.push(RiskFinding {
                id: "TRUST-002".to_string(),
                description: format!(
                    "SID filtering is disabled on {} trust with {} - allows SID injection attacks",
                    direction_label, trust_name
                ),
                severity: severity_from_points(20.0),
                points_deducted: 20.0,
                remediation: format!(
                    "Enable SID filtering on trust with {}: netdom trust /quarantine:yes",
                    trust_name
                ),
                complexity: RemediationComplexity::Medium,
                framework_ref: Some("CIS 2.2.1".to_string()),
            });
        }

        // Selective authentication: TRUST_ATTRIBUTE_CROSS_ORGANIZATION (0x20)
        let selective_auth = (trust_attributes & 0x20) != 0;
        if !selective_auth {
            score -= 15.0;
            issues.push(format!(
                "Selective authentication not used on trust with {}",
                trust_name
            ));
            recommendations.push(format!(
                "Enable selective authentication on trust with {}",
                trust_name
            ));
            findings.push(RiskFinding {
                id: "TRUST-003".to_string(),
                description: format!("Selective authentication is not enabled on trust with {} - allows broad access", trust_name),
                severity: severity_from_points(15.0),
                points_deducted: 15.0,
                remediation: format!("Enable selective authentication on trust with {}", trust_name),
                complexity: RemediationComplexity::Medium,
                framework_ref: Some("CIS 2.2.1".to_string()),
            });
        }

        // Record the trust existence as informational
        findings.push(RiskFinding {
            id: "TRUST-001".to_string(),
            description: format!(
                "External trust detected: {} ({})",
                trust_name, direction_label
            ),
            severity: AlertSeverity::Info,
            points_deducted: 0.0,
            remediation: "Review trust necessity and security configuration periodically"
                .to_string(),
            complexity: RemediationComplexity::Easy,
            framework_ref: Some("MITRE T1482".to_string()),
        });
    }

    let explanation = if issues.is_empty() {
        format!(
            "{} trust(s) configured with acceptable security",
            trusts.len()
        )
    } else {
        format!(
            "{} trust(s) found - Issues: {}",
            trusts.len(),
            issues.join("; ")
        )
    };

    FactorResult {
        score: score.clamp(0.0, 100.0),
        explanation,
        recommendations,
        findings,
    }
}

/// Scores AD CS certificate security posture (0-100).
///
/// Evaluates: CA presence, certificate templates, enrollment services,
/// ESC1/ESC2 vulnerabilities (enrollee-supplies-subject, no manager approval).
async fn compute_certificate_security_factor(provider: Arc<dyn DirectoryProvider>) -> FactorResult {
    let base_dn = match provider.base_dn() {
        Some(dn) => dn,
        None => {
            return FactorResult {
                score: 50.0,
                explanation: "Could not determine domain base DN for certificate analysis"
                    .to_string(),
                recommendations: vec![],
                findings: vec![],
            };
        }
    };

    let pki_base = format!(
        "CN=Public Key Services,CN=Services,CN=Configuration,{}",
        base_dn
    );

    // Check if CA exists
    let ca_base = format!("CN=Certification Authorities,{}", pki_base);
    let cas = match provider
        .search_configuration(&ca_base, "(objectClass=certificationAuthority)")
        .await
    {
        Ok(cas) => cas,
        Err(_) => {
            return FactorResult {
                score: 100.0,
                explanation: "No AD CS infrastructure detected".to_string(),
                recommendations: vec![],
                findings: vec![],
            };
        }
    };

    if cas.is_empty() {
        return FactorResult {
            score: 100.0,
            explanation: "No AD CS infrastructure detected".to_string(),
            recommendations: vec![],
            findings: vec![],
        };
    }

    let mut score = 100.0_f64;
    let mut issues = Vec::new();
    let mut recommendations = Vec::new();
    let mut findings = Vec::new();

    // Note CA count
    findings.push(RiskFinding {
        id: "CERT-001".to_string(),
        description: format!("{} Certification Authority(ies) detected", cas.len()),
        severity: AlertSeverity::Info,
        points_deducted: 0.0,
        remediation: "Ensure CA infrastructure is monitored and audited regularly".to_string(),
        complexity: RemediationComplexity::Easy,
        framework_ref: Some("MITRE T1649".to_string()),
    });

    // Check enrollment services
    let enrollment_base = format!("CN=Enrollment Services,{}", pki_base);
    let enrollment_services = provider
        .search_configuration(&enrollment_base, "(objectClass=pKIEnrollmentService)")
        .await
        .unwrap_or_default();

    if !enrollment_services.is_empty() {
        findings.push(RiskFinding {
            id: "CERT-002".to_string(),
            description: format!("{} enrollment service(s) active", enrollment_services.len()),
            severity: AlertSeverity::Info,
            points_deducted: 0.0,
            remediation: "Review enrollment service access controls".to_string(),
            complexity: RemediationComplexity::Easy,
            framework_ref: Some("MITRE T1649".to_string()),
        });

        // ESC6: Check EDITF_ATTRIBUTESUBJECTALTNAME2 on CA enrollment services
        for es in &enrollment_services {
            let es_name = es
                .get_attribute("name")
                .or_else(|| es.get_attribute("cn"))
                .unwrap_or("unknown");
            let flags = es
                .get_attribute("flags")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);
            if flags & 0x0004_0000 != 0 {
                let penalty = 25.0;
                score -= penalty;
                issues.push(format!(
                    "ESC6: EDITF_ATTRIBUTESUBJECTALTNAME2 on {}",
                    es_name
                ));
                recommendations.push(format!(
                    "Disable EDITF_ATTRIBUTESUBJECTALTNAME2 on CA '{}'",
                    es_name
                ));
                findings.push(RiskFinding {
                    id: "CERT-ESC6".to_string(),
                    description: format!(
                        "CA '{}' has EDITF_ATTRIBUTESUBJECTALTNAME2 enabled - allows arbitrary SANs in certificate requests",
                        es_name
                    ),
                    severity: AlertSeverity::Critical,
                    points_deducted: penalty,
                    remediation: format!(
                        "Run: certutil -config \"{}\" -setreg policy\\EditFlags -EDITF_ATTRIBUTESUBJECTALTNAME2",
                        es_name
                    ),
                    complexity: RemediationComplexity::Medium,
                    framework_ref: Some("MITRE T1649 / ESC6".to_string()),
                });
            }

            // ESC8: Check for HTTP enrollment endpoints (not HTTPS)
            let enrollment_servers = es.get_attribute_values("msPKI-Enrollment-Servers");
            let has_http = enrollment_servers.iter().any(|s| s.contains("http://"));
            if has_http {
                let penalty = 15.0;
                score -= penalty;
                issues.push(format!("ESC8: HTTP enrollment on {}", es_name));
                recommendations.push(format!(
                    "Configure HTTPS-only enrollment on CA '{}'",
                    es_name
                ));
                findings.push(RiskFinding {
                    id: "CERT-ESC8".to_string(),
                    description: format!(
                        "CA '{}' has HTTP (non-TLS) enrollment endpoints - vulnerable to NTLM relay",
                        es_name
                    ),
                    severity: AlertSeverity::High,
                    points_deducted: penalty,
                    remediation: format!(
                        "Disable HTTP enrollment on CA '{}' and require HTTPS",
                        es_name
                    ),
                    complexity: RemediationComplexity::Medium,
                    framework_ref: Some("MITRE T1649 / ESC8".to_string()),
                });
            }
        }
    }

    // Check certificate templates for ESC1/ESC2 vulnerabilities
    let template_base = format!("CN=Certificate Templates,{}", pki_base);
    let templates = provider
        .search_configuration(&template_base, "(objectClass=pKICertificateTemplate)")
        .await
        .unwrap_or_default();

    let mut esc1_count = 0;
    let mut esc_combined_count = 0;
    let mut esc1_templates: Vec<String> = Vec::new();
    let mut esc3_count = 0;
    let mut esc3_templates: Vec<String> = Vec::new();
    let mut legacy_v1_count = 0;
    let mut legacy_v1_templates: Vec<String> = Vec::new();

    for template in &templates {
        let template_name = template
            .get_attribute("name")
            .or_else(|| template.get_attribute("cn"))
            .unwrap_or("unknown");

        // Check msPKI-Certificate-Name-Flag for CT_FLAG_ENROLLEE_SUPPLIES_SUBJECT (0x1)
        let name_flag = template
            .get_attribute("msPKI-Certificate-Name-Flag")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);
        let enrollee_supplies_subject = (name_flag & 0x1) != 0;

        // Check msPKI-Enrollment-Flag for CT_FLAG_PEND_ALL_REQUESTS (0x2)
        let enrollment_flag = template
            .get_attribute("msPKI-Enrollment-Flag")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);
        let manager_approval_required = (enrollment_flag & 0x2) != 0;

        if enrollee_supplies_subject {
            esc1_count += 1;
            esc1_templates.push(template_name.to_string());

            if !manager_approval_required {
                esc_combined_count += 1;
            }
        }

        // ESC3: Certificate Request Agent OID (1.3.6.1.4.1.311.20.2.1)
        let cert_app_policy = template.get_attribute_values("msPKI-Certificate-Application-Policy");
        let eku = template.get_attribute_values("pKIExtendedKeyUsage");
        let has_request_agent = cert_app_policy
            .iter()
            .chain(eku.iter())
            .any(|v| v.contains("1.3.6.1.4.1.311.20.2.1"));
        if has_request_agent {
            esc3_count += 1;
            esc3_templates.push(template_name.to_string());
        }

        // Schema V1 templates (legacy with weaker security defaults)
        let schema_version = template
            .get_attribute("msPKI-Template-Schema-Version")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);
        if schema_version == 1 {
            legacy_v1_count += 1;
            legacy_v1_templates.push(template_name.to_string());
        }
    }

    // Group ESC1 findings into a single finding (not one per template)
    if esc1_count > 0 {
        let penalty = (esc1_count as f64 * 5.0).min(40.0);
        score -= penalty;
        let template_list = esc1_templates.join(", ");
        issues.push(format!("{} ESC1 template(s)", esc1_count));
        recommendations.push(format!(
            "Remove CT_FLAG_ENROLLEE_SUPPLIES_SUBJECT from: {}",
            template_list
        ));
        findings.push(RiskFinding {
            id: "CERT-003".to_string(),
            description: format!(
                "{} template(s) allow enrollee to supply subject (ESC1): {}",
                esc1_count, template_list
            ),
            severity: AlertSeverity::Critical,
            points_deducted: penalty,
            remediation: format!(
                "Remove CT_FLAG_ENROLLEE_SUPPLIES_SUBJECT from: {}",
                template_list
            ),
            complexity: RemediationComplexity::Medium,
            framework_ref: Some("MITRE T1649 / ESC1".to_string()),
        });
    }

    if esc_combined_count > 0 {
        let penalty = (esc_combined_count as f64 * 3.0).min(30.0);
        score -= penalty;
        issues.push(format!("{} without manager approval", esc_combined_count));
        findings.push(RiskFinding {
            id: "CERT-004".to_string(),
            description: format!(
                "{} ESC1 template(s) also lack manager approval (ESC2 vector)",
                esc_combined_count
            ),
            severity: AlertSeverity::High,
            points_deducted: penalty,
            remediation: "Enable CT_FLAG_PEND_ALL_REQUESTS on ESC1 templates or remove enrollee-supplies-subject".to_string(),
            complexity: RemediationComplexity::Medium,
            framework_ref: Some("MITRE T1649 / ESC2".to_string()),
        });
    }

    // ESC3: Certificate Request Agent templates
    if esc3_count > 0 {
        let penalty = (esc3_count as f64 * 15.0).min(30.0);
        score -= penalty;
        let template_list = esc3_templates.join(", ");
        issues.push(format!("{} ESC3 template(s)", esc3_count));
        recommendations.push(format!(
            "Remove Certificate Request Agent EKU from: {}",
            template_list
        ));
        findings.push(RiskFinding {
            id: "CERT-ESC3".to_string(),
            description: format!(
                "{} template(s) have Certificate Request Agent EKU (ESC3): {}",
                esc3_count, template_list
            ),
            severity: AlertSeverity::High,
            points_deducted: penalty,
            remediation: format!(
                "Remove Certificate Request Agent EKU (OID 1.3.6.1.4.1.311.20.2.1) from: {}",
                template_list
            ),
            complexity: RemediationComplexity::Medium,
            framework_ref: Some("MITRE T1649 / ESC3".to_string()),
        });
    }

    // Schema V1 legacy templates
    if legacy_v1_count > 0 {
        let penalty = (legacy_v1_count as f64 * 5.0).min(15.0);
        score -= penalty;
        let template_list = legacy_v1_templates.join(", ");
        issues.push(format!("{} legacy V1 template(s)", legacy_v1_count));
        recommendations.push(format!(
            "Upgrade schema V1 templates to V2+: {}",
            template_list
        ));
        findings.push(RiskFinding {
            id: "CERT-LEGACY".to_string(),
            description: format!(
                "{} template(s) use schema V1 (weaker security defaults): {}",
                legacy_v1_count, template_list
            ),
            severity: AlertSeverity::Medium,
            points_deducted: penalty,
            remediation: format!(
                "Upgrade schema V1 certificate templates to V2 or higher: {}",
                template_list
            ),
            complexity: RemediationComplexity::Medium,
            framework_ref: Some("CIS 18.6".to_string()),
        });
    }

    if !templates.is_empty() && esc1_count == 0 {
        findings.push(RiskFinding {
            id: "CERT-005".to_string(),
            description: format!(
                "{} certificate template(s) reviewed - no ESC1 vulnerabilities found",
                templates.len()
            ),
            severity: AlertSeverity::Info,
            points_deducted: 0.0,
            remediation: "Continue monitoring certificate template configurations".to_string(),
            complexity: RemediationComplexity::Easy,
            framework_ref: Some("MITRE T1649".to_string()),
        });
    }

    let explanation = if issues.is_empty() {
        format!(
            "AD CS deployed ({} CA(s), {} template(s)) with acceptable security",
            cas.len(),
            templates.len()
        )
    } else {
        format!(
            "AD CS issues: {} ESC1 template(s), {} without manager approval - {}",
            esc1_count,
            esc_combined_count,
            issues.join("; ")
        )
    };

    FactorResult {
        score: score.clamp(0.0, 100.0),
        explanation,
        recommendations,
        findings,
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
            Connection::open(&path)
                .unwrap_or_else(|_| Connection::open_in_memory().expect("in-memory SQLite"))
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
            )",
        )
        .expect("risk_scores schema creation");
    }

    /// Stores a risk score for today (upserts by date).
    pub fn store_score(&self, result: &RiskScoreResult) {
        let conn = self.conn.lock().expect("lock poisoned");
        let date = Utc::now().format("%Y-%m-%d").to_string();
        let factors_json =
            serde_json::to_string(&result.factors).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "INSERT INTO risk_scores (date, total_score, factors_json)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(date) DO UPDATE SET total_score = ?2, factors_json = ?3",
            rusqlite::params![date, result.total_score, factors_json],
        )
        .unwrap_or_else(|e| {
            tracing::warn!("Failed to store risk score: {}", e);
            0
        });
    }

    /// Retrieves the last N days of risk score history.
    pub fn get_history(&self, days: u32) -> Vec<RiskScoreHistory> {
        let conn = self.conn.lock().expect("lock poisoned");
        let mut stmt = match conn
            .prepare("SELECT date, total_score FROM risk_scores ORDER BY date DESC LIMIT ?1")
        {
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

use crate::models::security::{
    AttackAlert, AttackDetectionConfig, AttackDetectionReport, AttackType,
};

/// A parsed Windows Security event record with structured fields.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct EventRecord {
    pub time_created: Option<String>,
    pub id: Option<u32>,
    pub ip_address: Option<String>,
    pub target_user_name: Option<String>,
    pub ticket_encryption_type: Option<String>,
    pub service_name: Option<String>,
    pub status: Option<String>,
    pub sub_status: Option<String>,
    pub logon_type: Option<String>,
    pub authentication_package_name: Option<String>,
    pub key_length: Option<String>,
    pub object_type: Option<String>,
    pub access_mask: Option<String>,
    pub subject_user_name: Option<String>,
    pub attribute_ldap_display_name: Option<String>,
    pub object_dn: Option<String>,
}

/// DS-Replication-Get-Changes GUID.
const GUID_DS_REPL_GET_CHANGES: &str = "1131f6aa-9c07-11d1-f79f-00c04fc2dcd2";
/// DS-Replication-Get-Changes-All GUID.
const GUID_DS_REPL_GET_CHANGES_ALL: &str = "1131f6ad-9c07-11d1-f79f-00c04fc2dcd2";
/// DS-Replication-Get-Changes-In-Filtered-Set GUID.
const GUID_DS_REPL_GET_CHANGES_FILTERED: &str = "89e95b76-444d-4c62-991a-0facbeda640c";

/// Performs on-demand attack detection by analyzing Windows Security event logs.
///
/// This queries the event log for suspicious patterns over the configured time window.
/// On non-Windows platforms or when event log access fails, returns an empty report.
pub async fn detect_attacks(
    _provider: Arc<dyn DirectoryProvider>,
    time_window_hours: u32,
) -> Result<AttackDetectionReport> {
    let config = AttackDetectionConfig::default();

    #[cfg(target_os = "windows")]
    let alerts = analyze_windows_event_log(time_window_hours, &config);

    #[cfg(not(target_os = "windows"))]
    let alerts: Vec<AttackAlert> = Vec::new();

    let _ = &config; // suppress unused warning on non-Windows

    Ok(AttackDetectionReport {
        alerts,
        time_window_hours,
        scanned_at: Utc::now().to_rfc3339(),
    })
}

/// Runs a PowerShell query for a batch of event IDs and returns parsed event records.
#[cfg(target_os = "windows")]
fn query_events(event_ids: &[u32], time_window_hours: u32) -> Vec<EventRecord> {
    use std::process::Command;

    let ids_str = event_ids
        .iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let query = format!(
        r#"Get-WinEvent -FilterHashtable @{{LogName='Security';Id={ids};StartTime=(Get-Date).AddHours(-{hours})}} -MaxEvents 200 -ErrorAction SilentlyContinue | ForEach-Object {{
    $xml = [xml]$_.ToXml()
    $data = @{{}}
    $xml.Event.EventData.Data | ForEach-Object {{ $data[$_.Name] = $_.'#text' }}
    [PSCustomObject]@{{
        TimeCreated = $_.TimeCreated.ToString('o')
        Id = $_.Id
        IpAddress = $data['IpAddress']
        TargetUserName = $data['TargetUserName']
        TicketEncryptionType = $data['TicketEncryptionType']
        ServiceName = $data['ServiceName']
        Status = $data['Status']
        SubStatus = $data['SubStatus']
        LogonType = $data['LogonType']
        AuthenticationPackageName = $data['AuthenticationPackageName']
        KeyLength = $data['KeyLength']
        ObjectType = $data['ObjectType']
        AccessMask = $data['AccessMask']
        SubjectUserName = $data['SubjectUserName']
        AttributeLDAPDisplayName = $data['AttributeLDAPDisplayName']
        ObjectDN = $data['ObjectDN']
    }}
}} | ConvertTo-Json -Compress"#,
        ids = ids_str,
        hours = time_window_hours,
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &query])
        .output();

    let output = match output {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() || trimmed == "null" {
        return Vec::new();
    }

    // PowerShell returns a single object (not array) when there's exactly one result.
    if trimmed.starts_with('[') {
        serde_json::from_str::<Vec<EventRecord>>(trimmed).unwrap_or_default()
    } else {
        serde_json::from_str::<EventRecord>(trimmed)
            .map(|r| vec![r])
            .unwrap_or_default()
    }
}

/// Analyzes Windows Security event log for attack indicators using structured parsing.
#[cfg(target_os = "windows")]
fn analyze_windows_event_log(
    time_window_hours: u32,
    config: &AttackDetectionConfig,
) -> Vec<AttackAlert> {
    let mut alerts = Vec::new();

    // Batch 1: Kerberos events (4768, 4769, 4771)
    let kerberos_events = query_events(&[4768, 4769, 4771], time_window_hours);
    let events_4768: Vec<&EventRecord> =
        kerberos_events.iter().filter(|e| e.id == Some(4768)).collect();
    let events_4769: Vec<&EventRecord> =
        kerberos_events.iter().filter(|e| e.id == Some(4769)).collect();
    let events_4771: Vec<&EventRecord> =
        kerberos_events.iter().filter(|e| e.id == Some(4771)).collect();

    // Batch 2: Logon events (4624, 4625)
    let logon_events = query_events(&[4624, 4625], time_window_hours);
    let events_4624: Vec<&EventRecord> =
        logon_events.iter().filter(|e| e.id == Some(4624)).collect();
    let events_4625: Vec<&EventRecord> =
        logon_events.iter().filter(|e| e.id == Some(4625)).collect();

    // Batch 3: Directory access (4662)
    let dir_events_raw = query_events(&[4662], time_window_hours);
    let dir_events: Vec<&EventRecord> = dir_events_raw.iter().collect();

    // Batch 4: Group/computer changes (4728, 4732, 4742, 4756)
    let group_events = query_events(&[4728, 4732, 4742, 4756], time_window_hours);
    let events_4742: Vec<&EventRecord> =
        group_events.iter().filter(|e| e.id == Some(4742)).collect();
    let events_group_change: Vec<&EventRecord> = group_events
        .iter()
        .filter(|e| matches!(e.id, Some(4728) | Some(4732) | Some(4756)))
        .collect();

    // Batch 5: Directory changes (5136)
    let dir_change_events_raw = query_events(&[5136], time_window_hours);
    let dir_change_events: Vec<&EventRecord> = dir_change_events_raw.iter().collect();

    // Batch 6: Account management (4720, 4738)
    let acct_events_raw = query_events(&[4720, 4738], time_window_hours);
    let acct_events: Vec<&EventRecord> = acct_events_raw.iter().collect();

    // Run detection functions
    alerts.extend(detect_golden_ticket(&events_4768, config));
    alerts.extend(detect_dcsync(&dir_events, config));
    alerts.extend(detect_kerberoasting(&events_4769, config));
    alerts.extend(detect_asrep_roasting(&events_4768, config));
    alerts.extend(detect_brute_force(&events_4625, config));
    alerts.extend(detect_pass_the_hash(&events_4624, config));
    alerts.extend(detect_password_spray(&events_4771, config));
    alerts.extend(detect_shadow_credentials(&dir_change_events, config));
    alerts.extend(detect_rbcd_abuse(&dir_change_events, config));
    alerts.extend(detect_adminsd_holder_tamper(&dir_change_events, config));
    alerts.extend(detect_suspicious_account_activity(&acct_events, config));
    alerts.extend(detect_dcshadow(&events_4742, config));
    alerts.extend(detect_priv_group_change(&events_group_change, config));

    // Sort by severity (Critical first)
    alerts.sort_by(|a, b| b.severity.cmp(&a.severity));
    alerts
}

// ---------------------------------------------------------------------------
// Detection functions - pure logic operating on EventRecord slices
// ---------------------------------------------------------------------------

/// Golden Ticket detection (Event 4768).
/// Flags TGT requests using RC4-HMAC encryption (0x17), which is unusual in modern AD.
pub fn detect_golden_ticket(
    events: &[&EventRecord],
    config: &AttackDetectionConfig,
) -> Vec<AttackAlert> {
    let mut alerts = Vec::new();
    for event in events {
        let enc_type = event.ticket_encryption_type.as_deref().unwrap_or("");
        let target = event.target_user_name.as_deref().unwrap_or("");

        // RC4-HMAC TGT requests excluding krbtgt itself
        if enc_type == "0x17" && !target.eq_ignore_ascii_case("krbtgt") {
            if is_excluded_account(target, config) {
                continue;
            }
            alerts.push(AttackAlert {
                attack_type: AttackType::GoldenTicket,
                severity: AlertSeverity::Critical,
                timestamp: event
                    .time_created
                    .clone()
                    .unwrap_or_else(|| Utc::now().to_rfc3339()),
                source: event.ip_address.clone().unwrap_or_else(|| "Unknown".to_string()),
                description: format!(
                    "TGT request with RC4-HMAC encryption for account '{}' - possible Golden Ticket usage",
                    target
                ),
                recommendation: "Reset KRBTGT password twice with 12-hour interval. Investigate the source for compromise.".to_string(),
                event_id: Some(4768),
                mitre_ref: Some("T1558.001".to_string()),
            });
        }
    }
    alerts
}

/// DCSync detection (Event 4662).
/// Flags replication permission usage by non-machine accounts.
pub fn detect_dcsync(
    events: &[&EventRecord],
    config: &AttackDetectionConfig,
) -> Vec<AttackAlert> {
    let repl_guids = [
        GUID_DS_REPL_GET_CHANGES,
        GUID_DS_REPL_GET_CHANGES_ALL,
        GUID_DS_REPL_GET_CHANGES_FILTERED,
    ];

    let mut alerts = Vec::new();
    for event in events {
        if event.id != Some(4662) {
            continue;
        }
        let access_mask = event.access_mask.as_deref().unwrap_or("");
        let object_type = event.object_type.as_deref().unwrap_or("").to_lowercase();
        let subject = event.subject_user_name.as_deref().unwrap_or("");
        let ip = event.ip_address.as_deref().unwrap_or("");

        // Must have replication access mask and matching GUID
        let has_repl_access = access_mask.contains("0x100");
        let has_repl_guid = repl_guids.iter().any(|guid| object_type.contains(guid));

        if has_repl_access && has_repl_guid {
            // Exclude machine accounts (ending with $) - these are DCs
            if subject.ends_with('$') {
                continue;
            }
            if is_excluded_ip(ip, config) || is_excluded_account(subject, config) {
                continue;
            }
            alerts.push(AttackAlert {
                attack_type: AttackType::DCSync,
                severity: AlertSeverity::Critical,
                timestamp: event
                    .time_created
                    .clone()
                    .unwrap_or_else(|| Utc::now().to_rfc3339()),
                source: event.ip_address.clone().unwrap_or_else(|| "Unknown".to_string()),
                description: format!(
                    "Directory replication requested by non-DC account '{}' - possible DCSync attack",
                    subject
                ),
                recommendation: "Review replication permissions. Remove DS-Replication-Get-Changes rights from non-DC accounts. Investigate source IP.".to_string(),
                event_id: Some(4662),
                mitre_ref: Some("T1003.006".to_string()),
            });
        }
    }
    alerts
}

/// Kerberoasting detection (Event 4769).
/// Flags multiple TGS requests with RC4-HMAC from the same user targeting service accounts.
pub fn detect_kerberoasting(
    events: &[&EventRecord],
    config: &AttackDetectionConfig,
) -> Vec<AttackAlert> {
    use std::collections::HashMap;

    let mut per_user: HashMap<String, Vec<&EventRecord>> = HashMap::new();

    for event in events {
        let enc_type = event.ticket_encryption_type.as_deref().unwrap_or("");
        let service = event.service_name.as_deref().unwrap_or("");
        let subject = event.subject_user_name.as_deref().unwrap_or("");

        // RC4-HMAC TGS requests for non-machine, non-krbtgt services
        if enc_type == "0x17"
            && !service.ends_with('$')
            && !service.eq_ignore_ascii_case("krbtgt")
            && !subject.is_empty()
        {
            per_user
                .entry(subject.to_string())
                .or_default()
                .push(event);
        }
    }

    let mut alerts = Vec::new();
    for (user, user_events) in &per_user {
        if user_events.len() >= config.kerberoasting_threshold as usize {
            if is_excluded_account(user, config) {
                continue;
            }
            let services: Vec<String> = user_events
                .iter()
                .filter_map(|e| e.service_name.clone())
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .take(5)
                .collect();
            alerts.push(AttackAlert {
                attack_type: AttackType::Kerberoasting,
                severity: AlertSeverity::High,
                timestamp: user_events
                    .first()
                    .and_then(|e| e.time_created.clone())
                    .unwrap_or_else(|| Utc::now().to_rfc3339()),
                source: user_events
                    .first()
                    .and_then(|e| e.ip_address.clone())
                    .unwrap_or_else(|| "Unknown".to_string()),
                description: format!(
                    "User '{}' requested {} TGS tickets with RC4-HMAC for services: {} - possible Kerberoasting",
                    user,
                    user_events.len(),
                    services.join(", ")
                ),
                recommendation: "Review service accounts with SPNs. Rotate passwords to 25+ char random. Enable AES encryption. Consider gMSA.".to_string(),
                event_id: Some(4769),
                mitre_ref: Some("T1558.003".to_string()),
            });
        }
    }
    alerts
}

/// AS-REP Roasting detection (Event 4768).
/// Flags multiple RC4-HMAC TGT requests from the same IP targeting different accounts.
pub fn detect_asrep_roasting(
    events: &[&EventRecord],
    config: &AttackDetectionConfig,
) -> Vec<AttackAlert> {
    use std::collections::{HashMap, HashSet};

    let mut per_ip: HashMap<String, HashSet<String>> = HashMap::new();

    for event in events {
        let enc_type = event.ticket_encryption_type.as_deref().unwrap_or("");
        let target = event.target_user_name.as_deref().unwrap_or("");
        let ip = event.ip_address.as_deref().unwrap_or("");

        if enc_type == "0x17" && !ip.is_empty() && !target.is_empty() {
            per_ip
                .entry(ip.to_string())
                .or_default()
                .insert(target.to_string());
        }
    }

    let mut alerts = Vec::new();
    for (ip, targets) in &per_ip {
        if targets.len() >= 3 {
            if is_excluded_ip(ip, config) {
                continue;
            }
            let sample: Vec<&String> = targets.iter().take(5).collect();
            alerts.push(AttackAlert {
                attack_type: AttackType::AsrepRoasting,
                severity: AlertSeverity::High,
                timestamp: Utc::now().to_rfc3339(),
                source: ip.clone(),
                description: format!(
                    "IP {} requested RC4-HMAC TGTs for {} different accounts ({}) - possible AS-REP Roasting",
                    ip,
                    targets.len(),
                    sample.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
                ),
                recommendation: "Enable Kerberos pre-authentication on all affected accounts. Review why it was disabled.".to_string(),
                event_id: Some(4768),
                mitre_ref: Some("T1558.004".to_string()),
            });
        }
    }
    alerts
}

/// Brute Force detection (Event 4625).
/// Flags excessive failed logons from the same IP.
pub fn detect_brute_force(
    events: &[&EventRecord],
    config: &AttackDetectionConfig,
) -> Vec<AttackAlert> {
    use std::collections::HashMap;

    let mut per_ip: HashMap<String, Vec<&EventRecord>> = HashMap::new();

    for event in events {
        let ip = event.ip_address.as_deref().unwrap_or("");
        if !ip.is_empty() && ip != "-" {
            per_ip.entry(ip.to_string()).or_default().push(event);
        }
    }

    let mut alerts = Vec::new();
    for (ip, ip_events) in &per_ip {
        if ip_events.len() >= config.brute_force_threshold as usize {
            if is_excluded_ip(ip, config) {
                continue;
            }
            // Collect sub-status detail
            let wrong_pwd_count = ip_events
                .iter()
                .filter(|e| {
                    e.sub_status
                        .as_deref()
                        .map(|s| s.eq_ignore_ascii_case("0xC000006A"))
                        .unwrap_or(false)
                })
                .count();
            let unknown_user_count = ip_events
                .iter()
                .filter(|e| {
                    e.sub_status
                        .as_deref()
                        .map(|s| s.eq_ignore_ascii_case("0xC0000064"))
                        .unwrap_or(false)
                })
                .count();

            let detail = format!(
                "{} failed logons from IP {} ({} wrong password, {} unknown user)",
                ip_events.len(),
                ip,
                wrong_pwd_count,
                unknown_user_count
            );

            alerts.push(AttackAlert {
                attack_type: AttackType::BruteForce,
                severity: AlertSeverity::High,
                timestamp: ip_events
                    .first()
                    .and_then(|e| e.time_created.clone())
                    .unwrap_or_else(|| Utc::now().to_rfc3339()),
                source: ip.clone(),
                description: format!("{} - possible brute force attack", detail),
                recommendation: "Investigate source IP. Consider blocking at firewall. Review affected accounts for compromise.".to_string(),
                event_id: Some(4625),
                mitre_ref: Some("T1110.001".to_string()),
            });
        }
    }
    alerts
}

/// Pass-the-Hash detection (Event 4624).
/// Flags NTLM network logons with zero key length.
pub fn detect_pass_the_hash(
    events: &[&EventRecord],
    config: &AttackDetectionConfig,
) -> Vec<AttackAlert> {
    let mut alerts = Vec::new();
    for event in events {
        let logon_type = event.logon_type.as_deref().unwrap_or("");
        let auth_pkg = event
            .authentication_package_name
            .as_deref()
            .unwrap_or("")
            .to_lowercase();
        let key_len = event.key_length.as_deref().unwrap_or("");
        let ip = event.ip_address.as_deref().unwrap_or("");
        let target = event.target_user_name.as_deref().unwrap_or("");

        if logon_type == "3"
            && (auth_pkg == "ntlm" || auth_pkg.contains("ntlmssp"))
            && (key_len == "0" || key_len.is_empty())
        {
            if is_excluded_ip(ip, config) || is_excluded_account(target, config) {
                continue;
            }
            // Skip machine accounts
            if target.ends_with('$') {
                continue;
            }
            alerts.push(AttackAlert {
                attack_type: AttackType::PassTheHash,
                severity: AlertSeverity::Critical,
                timestamp: event
                    .time_created
                    .clone()
                    .unwrap_or_else(|| Utc::now().to_rfc3339()),
                source: event.ip_address.clone().unwrap_or_else(|| "Unknown".to_string()),
                description: format!(
                    "NTLM network logon with zero key length for '{}' from {} - possible Pass-the-Hash",
                    target, ip
                ),
                recommendation: "Investigate source host for compromise. Enable Protected Users for admin accounts. Enforce Kerberos-only auth.".to_string(),
                event_id: Some(4624),
                mitre_ref: Some("T1550.002".to_string()),
            });
        }
    }
    alerts
}

/// Password Spray detection (Event 4771).
/// Flags Kerberos pre-auth failures targeting many different users.
pub fn detect_password_spray(
    events: &[&EventRecord],
    config: &AttackDetectionConfig,
) -> Vec<AttackAlert> {
    use std::collections::{HashMap, HashSet};

    let mut per_ip: HashMap<String, HashSet<String>> = HashMap::new();

    for event in events {
        let ip = event.ip_address.as_deref().unwrap_or("");
        let target = event.target_user_name.as_deref().unwrap_or("");
        if !ip.is_empty() && !target.is_empty() {
            per_ip
                .entry(ip.to_string())
                .or_default()
                .insert(target.to_string());
        }
    }

    let mut alerts = Vec::new();
    for (ip, users) in &per_ip {
        if users.len() >= 5 {
            // 5+ different users from same IP = spray
            if is_excluded_ip(ip, config) {
                continue;
            }
            alerts.push(AttackAlert {
                attack_type: AttackType::PasswordSpray,
                severity: AlertSeverity::High,
                timestamp: Utc::now().to_rfc3339(),
                source: ip.clone(),
                description: format!(
                    "Kerberos pre-authentication failures for {} different accounts from IP {} - possible password spray",
                    users.len(),
                    ip
                ),
                recommendation: "Check for compromised accounts. Review failed logon sources and consider blocking at firewall.".to_string(),
                event_id: Some(4771),
                mitre_ref: Some("T1110.003".to_string()),
            });
        }
    }
    alerts
}

/// Shadow Credentials detection (Event 5136).
/// Flags modifications to msDS-KeyCredentialLink attribute.
pub fn detect_shadow_credentials(
    events: &[&EventRecord],
    config: &AttackDetectionConfig,
) -> Vec<AttackAlert> {
    let mut alerts = Vec::new();
    for event in events {
        if event.id != Some(5136) {
            continue;
        }
        let attr = event
            .attribute_ldap_display_name
            .as_deref()
            .unwrap_or("");
        if attr == "msDS-KeyCredentialLink" {
            let subject = event.subject_user_name.as_deref().unwrap_or("Unknown");
            let object_dn = event.object_dn.as_deref().unwrap_or("Unknown");
            if is_excluded_account(subject, config) {
                continue;
            }
            alerts.push(AttackAlert {
                attack_type: AttackType::ShadowCredentials,
                severity: AlertSeverity::Critical,
                timestamp: event
                    .time_created
                    .clone()
                    .unwrap_or_else(|| Utc::now().to_rfc3339()),
                source: subject.to_string(),
                description: format!(
                    "msDS-KeyCredentialLink modified on '{}' by '{}' - possible Shadow Credentials attack",
                    object_dn, subject
                ),
                recommendation: "Remove unauthorized msDS-KeyCredentialLink values. Investigate who made the change.".to_string(),
                event_id: Some(5136),
                mitre_ref: Some("T1556.006".to_string()),
            });
        }
    }
    alerts
}

/// RBCD Abuse detection (Event 5136).
/// Flags modifications to msDS-AllowedToActOnBehalfOfOtherIdentity attribute.
pub fn detect_rbcd_abuse(
    events: &[&EventRecord],
    config: &AttackDetectionConfig,
) -> Vec<AttackAlert> {
    let mut alerts = Vec::new();
    for event in events {
        if event.id != Some(5136) {
            continue;
        }
        let attr = event
            .attribute_ldap_display_name
            .as_deref()
            .unwrap_or("");
        if attr == "msDS-AllowedToActOnBehalfOfOtherIdentity" {
            let subject = event.subject_user_name.as_deref().unwrap_or("Unknown");
            let object_dn = event.object_dn.as_deref().unwrap_or("Unknown");
            if is_excluded_account(subject, config) {
                continue;
            }
            alerts.push(AttackAlert {
                attack_type: AttackType::RbcdAbuse,
                severity: AlertSeverity::High,
                timestamp: event
                    .time_created
                    .clone()
                    .unwrap_or_else(|| Utc::now().to_rfc3339()),
                source: subject.to_string(),
                description: format!(
                    "RBCD attribute modified on '{}' by '{}' - possible Resource-Based Constrained Delegation abuse",
                    object_dn, subject
                ),
                recommendation: "Remove unauthorized msDS-AllowedToActOnBehalfOfOtherIdentity values. Audit delegation configurations.".to_string(),
                event_id: Some(5136),
                mitre_ref: Some("T1134.001".to_string()),
            });
        }
    }
    alerts
}

/// AdminSDHolder Tampering detection (Event 5136).
/// Flags modifications to the AdminSDHolder container.
pub fn detect_adminsd_holder_tamper(
    events: &[&EventRecord],
    config: &AttackDetectionConfig,
) -> Vec<AttackAlert> {
    let mut alerts = Vec::new();
    for event in events {
        if event.id != Some(5136) {
            continue;
        }
        let object_dn = event.object_dn.as_deref().unwrap_or("").to_lowercase();
        if object_dn.contains("cn=adminsdholder,cn=system") {
            let subject = event.subject_user_name.as_deref().unwrap_or("Unknown");
            if is_excluded_account(subject, config) {
                continue;
            }
            alerts.push(AttackAlert {
                attack_type: AttackType::AdminSdHolderTamper,
                severity: AlertSeverity::Critical,
                timestamp: event
                    .time_created
                    .clone()
                    .unwrap_or_else(|| Utc::now().to_rfc3339()),
                source: subject.to_string(),
                description: format!(
                    "AdminSDHolder container modified by '{}' - possible privilege persistence attempt",
                    subject
                ),
                recommendation: "Restore AdminSDHolder ACL from a known good backup. Investigate the modification source.".to_string(),
                event_id: Some(5136),
                mitre_ref: Some("T1222.001".to_string()),
            });
        }
    }
    alerts
}

/// Suspicious Account Activity detection (Events 4720, 4738).
/// Flags account creation and sensitive UAC flag changes.
pub fn detect_suspicious_account_activity(
    events: &[&EventRecord],
    config: &AttackDetectionConfig,
) -> Vec<AttackAlert> {
    let mut alerts = Vec::new();
    for event in events {
        let subject = event.subject_user_name.as_deref().unwrap_or("Unknown");
        let target = event.target_user_name.as_deref().unwrap_or("Unknown");
        if is_excluded_account(subject, config) {
            continue;
        }

        match event.id {
            Some(4720) => {
                alerts.push(AttackAlert {
                    attack_type: AttackType::SuspiciousAccountActivity,
                    severity: AlertSeverity::Medium,
                    timestamp: event
                        .time_created
                        .clone()
                        .unwrap_or_else(|| Utc::now().to_rfc3339()),
                    source: subject.to_string(),
                    description: format!(
                        "New account '{}' created by '{}'",
                        target, subject
                    ),
                    recommendation: "Verify account creation was authorized. Review the account's group memberships and permissions.".to_string(),
                    event_id: Some(4720),
                    mitre_ref: Some("T1136.001".to_string()),
                });
            }
            Some(4738) => {
                alerts.push(AttackAlert {
                    attack_type: AttackType::SuspiciousAccountActivity,
                    severity: AlertSeverity::Medium,
                    timestamp: event
                        .time_created
                        .clone()
                        .unwrap_or_else(|| Utc::now().to_rfc3339()),
                    source: subject.to_string(),
                    description: format!(
                        "Account '{}' modified by '{}' - UAC flags may have changed",
                        target, subject
                    ),
                    recommendation: "Review UAC flag changes. Check for DONT_REQUIRE_PREAUTH, TRUSTED_FOR_DELEGATION or other sensitive flags.".to_string(),
                    event_id: Some(4738),
                    mitre_ref: Some("T1098".to_string()),
                });
            }
            _ => {}
        }
    }
    alerts
}

/// DCShadow detection (Event 4742).
/// Flags suspicious SPN changes on computer accounts that may indicate rogue DC registration.
pub fn detect_dcshadow(
    events: &[&EventRecord],
    config: &AttackDetectionConfig,
) -> Vec<AttackAlert> {
    let mut alerts = Vec::new();
    for event in events {
        let subject = event.subject_user_name.as_deref().unwrap_or("Unknown");
        let target = event.target_user_name.as_deref().unwrap_or("Unknown");
        let service_name = event.service_name.as_deref().unwrap_or("");
        if is_excluded_account(subject, config) {
            continue;
        }

        // Flag if SPN modification involves GC/ or replication-related service names
        let suspicious = service_name.to_lowercase().contains("gc/")
            || service_name.to_lowercase().contains("e3514235-4b06-11d1-ab04-00c04fc2dcd2");

        if suspicious {
            alerts.push(AttackAlert {
                attack_type: AttackType::DCShadow,
                severity: AlertSeverity::High,
                timestamp: event
                    .time_created
                    .clone()
                    .unwrap_or_else(|| Utc::now().to_rfc3339()),
                source: subject.to_string(),
                description: format!(
                    "Computer account '{}' SPN modified by '{}' with replication-related values - possible DCShadow",
                    target, subject
                ),
                recommendation: "Audit computer account changes and verify no rogue DCs are registered. Check SPN values.".to_string(),
                event_id: Some(4742),
                mitre_ref: Some("T1207".to_string()),
            });
        }
    }
    alerts
}

/// Privileged Group Change detection (Events 4728, 4732, 4756).
/// Flags membership additions to security-enabled groups.
pub fn detect_priv_group_change(
    events: &[&EventRecord],
    config: &AttackDetectionConfig,
) -> Vec<AttackAlert> {
    let mut alerts = Vec::new();
    for event in events {
        let subject = event.subject_user_name.as_deref().unwrap_or("Unknown");
        let target = event.target_user_name.as_deref().unwrap_or("Unknown");
        if is_excluded_account(subject, config) {
            continue;
        }

        let event_id = event.id.unwrap_or(0);
        let group_type = match event_id {
            4728 => "global",
            4732 => "local",
            4756 => "universal",
            _ => continue,
        };

        alerts.push(AttackAlert {
            attack_type: AttackType::PrivGroupChange,
            severity: AlertSeverity::High,
            timestamp: event
                .time_created
                .clone()
                .unwrap_or_else(|| Utc::now().to_rfc3339()),
            source: subject.to_string(),
            description: format!(
                "Member '{}' added to security-enabled {} group by '{}'",
                target, group_type, subject
            ),
            recommendation: "Verify the group membership change was authorized. Review who was added and by whom.".to_string(),
            event_id: Some(event_id),
            mitre_ref: Some("T1098.001".to_string()),
        });
    }
    alerts
}

// ---------------------------------------------------------------------------
// Helper functions for exclusion checks
// ---------------------------------------------------------------------------

fn is_excluded_ip(ip: &str, config: &AttackDetectionConfig) -> bool {
    if ip.is_empty() || ip == "-" {
        return false;
    }
    config.excluded_ips.iter().any(|excluded| excluded == ip)
}

fn is_excluded_account(account: &str, config: &AttackDetectionConfig) -> bool {
    if account.is_empty() {
        return false;
    }
    config
        .excluded_accounts
        .iter()
        .any(|excluded| excluded.eq_ignore_ascii_case(account))
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

    // Resolve privileged groups by RID (language-independent)
    for (rid, fallback_name) in PRIVILEGED_GROUP_RIDS {
        let group = match provider.resolve_group_by_rid(*rid).await {
            Ok(Some(g)) => g,
            _ => continue,
        };

        {
            if node_dns.insert(group.distinguished_name.clone()) {
                nodes.push(GraphNode {
                    dn: group.distinguished_name.clone(),
                    display_name: group
                        .display_name
                        .clone()
                        .or_else(|| group.sam_account_name.clone())
                        .unwrap_or_else(|| fallback_name.to_string()),
                    node_type: NodeType::Group,
                    is_privileged: true,
                });
            }

            // Get members of this privileged group (recursive via matching rule)
            let members = get_recursive_members(&provider, &group.distinguished_name).await;

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
            kerberoastable: false,
            asrep_roastable: false,
            reversible_encryption: false,
            des_only: false,
            constrained_delegation_transition: false,
            has_sid_history: false,
            is_service_account: false,
            in_protected_users: true, // Default: in protected users (no alert)
            admin_count_orphaned: false,
            alerts: Vec::new(),
        }
    }

    #[test]
    fn test_compute_alerts_password_age_critical() {
        let account = make_account(true, false, Some(120), Some("2026-01-01T00:00:00Z"));
        let alerts = compute_alerts(&account, None);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].severity, AlertSeverity::Critical);
        assert_eq!(alerts[0].alert_type, "password_age");
    }

    #[test]
    fn test_compute_alerts_password_age_ok() {
        let account = make_account(true, false, Some(30), Some("2026-03-01T00:00:00Z"));
        let alerts = compute_alerts(&account, None);
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_compute_alerts_password_never_expires() {
        let account = make_account(true, true, Some(10), Some("2026-03-01T00:00:00Z"));
        let alerts = compute_alerts(&account, None);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].severity, AlertSeverity::High);
        assert_eq!(alerts[0].alert_type, "password_never_expires");
    }

    #[test]
    fn test_compute_alerts_disabled_in_privileged_group() {
        let account = make_account(false, false, Some(10), Some("2026-03-01T00:00:00Z"));
        let alerts = compute_alerts(&account, None);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].severity, AlertSeverity::High);
        assert_eq!(alerts[0].alert_type, "disabled_in_privileged_group");
    }

    #[test]
    fn test_compute_alerts_never_logged_on() {
        let account = make_account(true, false, Some(10), None);
        let alerts = compute_alerts(&account, None);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].severity, AlertSeverity::Medium);
        assert_eq!(alerts[0].alert_type, "never_logged_on");
    }

    #[test]
    fn test_compute_alerts_multiple_issues() {
        let account = make_account(false, true, Some(120), None);
        let alerts = compute_alerts(&account, None);
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
        let alerts = compute_alerts(&account, None);
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_compute_summary() {
        let mut a1 = make_account(true, true, Some(120), None);
        a1.alerts = compute_alerts(&a1, None);

        let mut a2 = make_account(true, false, Some(10), Some("2026-03-01T00:00:00Z"));
        a2.alerts = compute_alerts(&a2, None);

        let empty_findings = DomainSecurityFindings {
            krbtgt_password_age_days: None,
            laps_coverage_percent: None,
            laps_deployed_count: 0,
            total_computer_count: 0,
            pso_count: 0,
            domain_functional_level: None,
            forest_functional_level: None,
            ldap_signing_enforced: None,
            recycle_bin_enabled: None,
            rbcd_configured_count: 0,
            alerts: vec![],
        };
        let summary = compute_summary(&[a1, a2], &empty_findings);
        assert!(summary.critical >= 1); // password_age
        assert!(summary.high >= 1); // password_never_expires
        assert!(summary.medium >= 1); // never_logged_on
    }

    // New security checks tests

    #[test]
    fn test_compute_alerts_kerberoastable() {
        let mut account = make_account(true, false, Some(10), Some("2026-03-20T00:00:00Z"));
        account.kerberoastable = true;
        let alerts = compute_alerts(&account, None);
        let types: Vec<&str> = alerts.iter().map(|a| a.alert_type.as_str()).collect();
        assert!(types.contains(&"kerberoastable"));
    }

    #[test]
    fn test_compute_alerts_asrep_roastable() {
        let mut account = make_account(true, false, Some(10), Some("2026-03-20T00:00:00Z"));
        account.asrep_roastable = true;
        let alerts = compute_alerts(&account, None);
        let types: Vec<&str> = alerts.iter().map(|a| a.alert_type.as_str()).collect();
        assert!(types.contains(&"asrep_roastable"));
        let asrep = alerts
            .iter()
            .find(|a| a.alert_type == "asrep_roastable")
            .unwrap();
        assert_eq!(asrep.severity, AlertSeverity::Critical);
    }

    #[test]
    fn test_compute_alerts_reversible_encryption() {
        let mut account = make_account(true, false, Some(10), Some("2026-03-20T00:00:00Z"));
        account.reversible_encryption = true;
        let alerts = compute_alerts(&account, None);
        let types: Vec<&str> = alerts.iter().map(|a| a.alert_type.as_str()).collect();
        assert!(types.contains(&"reversible_encryption"));
        let rev = alerts
            .iter()
            .find(|a| a.alert_type == "reversible_encryption")
            .unwrap();
        assert_eq!(rev.severity, AlertSeverity::Critical);
    }

    #[test]
    fn test_compute_alerts_des_only() {
        let mut account = make_account(true, false, Some(10), Some("2026-03-20T00:00:00Z"));
        account.des_only = true;
        let alerts = compute_alerts(&account, None);
        let types: Vec<&str> = alerts.iter().map(|a| a.alert_type.as_str()).collect();
        assert!(types.contains(&"des_only"));
        let des = alerts.iter().find(|a| a.alert_type == "des_only").unwrap();
        assert_eq!(des.severity, AlertSeverity::Medium);
    }

    #[test]
    fn test_compute_alerts_constrained_delegation_transition() {
        let mut account = make_account(true, false, Some(10), Some("2026-03-20T00:00:00Z"));
        account.constrained_delegation_transition = true;
        let alerts = compute_alerts(&account, None);
        let types: Vec<&str> = alerts.iter().map(|a| a.alert_type.as_str()).collect();
        assert!(types.contains(&"constrained_delegation_transition"));
    }

    #[test]
    fn test_compute_alerts_sid_history() {
        let mut account = make_account(true, false, Some(10), Some("2026-03-20T00:00:00Z"));
        account.has_sid_history = true;
        let alerts = compute_alerts(&account, None);
        let types: Vec<&str> = alerts.iter().map(|a| a.alert_type.as_str()).collect();
        assert!(types.contains(&"sid_history"));
    }

    #[test]
    fn test_compute_alerts_service_account_in_admins() {
        let mut account = make_account(true, true, Some(10), Some("2026-03-20T00:00:00Z"));
        account.kerberoastable = true;
        account.is_service_account = true;
        let alerts = compute_alerts(&account, None);
        let types: Vec<&str> = alerts.iter().map(|a| a.alert_type.as_str()).collect();
        assert!(types.contains(&"service_account_in_admins"));
    }

    #[test]
    fn test_compute_alerts_not_in_protected_users() {
        let mut account = make_account(true, false, Some(10), Some("2026-03-20T00:00:00Z"));
        account.in_protected_users = false;
        let alerts = compute_alerts(&account, None);
        let types: Vec<&str> = alerts.iter().map(|a| a.alert_type.as_str()).collect();
        assert!(types.contains(&"not_in_protected_users"));
    }

    #[test]
    fn test_compute_alerts_inactive_admin() {
        let account = make_account(true, false, Some(10), Some("2026-03-20T00:00:00Z"));
        let alerts = compute_alerts(&account, Some(120)); // last logon 120 days ago
        let types: Vec<&str> = alerts.iter().map(|a| a.alert_type.as_str()).collect();
        assert!(types.contains(&"inactive_admin"));
    }

    #[test]
    fn test_compute_alerts_admin_count_orphaned() {
        let mut account = make_account(false, false, Some(10), Some("2026-03-20T00:00:00Z"));
        account.admin_count_orphaned = true;
        let alerts = compute_alerts(&account, None);
        let types: Vec<&str> = alerts.iter().map(|a| a.alert_type.as_str()).collect();
        assert!(types.contains(&"admin_count_orphaned"));
    }

    #[test]
    fn test_functional_level_label() {
        assert_eq!(functional_level_label("7"), "Windows Server 2016");
        assert_eq!(functional_level_label("3"), "Windows Server 2008");
        assert_eq!(functional_level_label("99"), "Level 99");
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
            worst_factor_name: "Test".to_string(),
            worst_factor_score: 75.0,
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
            worst_factor_name: "Test".to_string(),
            worst_factor_score: 60.0,
            factors: vec![],
            computed_at: Utc::now().to_rfc3339(),
        };
        store.store_score(&result1);

        let result2 = RiskScoreResult {
            total_score: 80.0,
            zone: RiskZone::Green,
            worst_factor_name: "Test".to_string(),
            worst_factor_score: 80.0,
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

    // New factor function tests

    #[tokio::test]
    async fn test_compute_gpo_security_factor_no_gpos() {
        let provider = Arc::new(crate::services::directory::tests::MockDirectoryProvider::new());
        let result = compute_gpo_security_factor(provider).await;
        // No GPOs returned by mock = score starts at 100, minus 0 GPO penalties
        // Domain functional level check may add info findings
        assert!(result.score >= 0.0 && result.score <= 100.0);
    }

    #[tokio::test]
    async fn test_compute_trust_security_factor_no_trusts() {
        let provider = Arc::new(crate::services::directory::tests::MockDirectoryProvider::new());
        let result = compute_trust_security_factor(provider).await;
        assert!((result.score - 100.0).abs() < f64::EPSILON);
        assert!(
            result.explanation.contains("No external trusts")
                || result.explanation.contains("Could not query")
        );
        assert!(result.findings.is_empty());
    }

    #[tokio::test]
    async fn test_compute_trust_security_factor_with_trusts() {
        use std::collections::HashMap;
        let mut attrs = HashMap::new();
        attrs.insert("name".to_string(), vec!["PARTNER.COM".to_string()]);
        attrs.insert("trustDirection".to_string(), vec!["3".to_string()]); // bidirectional
        attrs.insert("trustAttributes".to_string(), vec!["0".to_string()]); // no SID filtering, no selective auth
        let trust_entry = crate::models::DirectoryEntry {
            distinguished_name: "CN=PARTNER.COM,CN=System,DC=example,DC=com".to_string(),
            sam_account_name: None,
            display_name: None,
            object_class: Some("trustedDomain".to_string()),
            attributes: attrs,
        };

        let provider = Arc::new(
            crate::services::directory::tests::MockDirectoryProvider::new()
                .with_configuration_entries(vec![trust_entry]),
        );
        let result = compute_trust_security_factor(provider).await;
        // Bidirectional (-10) + no SID filtering (-20) + no selective auth (-15) = 55
        assert!(result.score <= 60.0);
        assert!(!result.findings.is_empty());
    }

    #[tokio::test]
    async fn test_compute_certificate_security_factor_no_ca() {
        let provider = Arc::new(crate::services::directory::tests::MockDirectoryProvider::new());
        let result = compute_certificate_security_factor(provider).await;
        assert!((result.score - 100.0).abs() < f64::EPSILON);
        assert!(result.explanation.contains("No AD CS"));
        assert!(result.findings.is_empty());
    }

    #[tokio::test]
    async fn test_compute_certificate_security_factor_with_ca() {
        use std::collections::HashMap;
        let mut ca_attrs = HashMap::new();
        ca_attrs.insert("name".to_string(), vec!["RootCA".to_string()]);
        let ca_entry = crate::models::DirectoryEntry {
            distinguished_name: "CN=RootCA,CN=Certification Authorities,CN=Public Key Services,CN=Services,CN=Configuration,DC=example,DC=com".to_string(),
            sam_account_name: None,
            display_name: None,
            object_class: Some("certificationAuthority".to_string()),
            attributes: ca_attrs,
        };

        let provider = Arc::new(
            crate::services::directory::tests::MockDirectoryProvider::new()
                .with_configuration_entries(vec![ca_entry]),
        );
        let result = compute_certificate_security_factor(provider).await;
        // CA exists, no vulnerable templates found in mock
        assert!(result.score >= 0.0 && result.score <= 100.0);
    }

    #[test]
    fn test_severity_from_points() {
        assert_eq!(severity_from_points(25.0), AlertSeverity::Critical);
        assert_eq!(severity_from_points(20.0), AlertSeverity::Critical);
        assert_eq!(severity_from_points(15.0), AlertSeverity::High);
        assert_eq!(severity_from_points(10.0), AlertSeverity::High);
        assert_eq!(severity_from_points(5.0), AlertSeverity::Medium);
        assert_eq!(severity_from_points(3.0), AlertSeverity::Info);
        assert_eq!(severity_from_points(0.0), AlertSeverity::Info);
    }

    #[test]
    fn test_build_risk_factor_impact_calculation() {
        let result = FactorResult {
            score: 60.0,
            explanation: "Test".to_string(),
            recommendations: vec![],
            findings: vec![
                RiskFinding {
                    id: "TEST-001".to_string(),
                    description: "Issue 1".to_string(),
                    severity: AlertSeverity::High,
                    points_deducted: 25.0,
                    remediation: "Fix it".to_string(),
                    complexity: RemediationComplexity::Easy,
                    framework_ref: None,
                },
                RiskFinding {
                    id: "TEST-002".to_string(),
                    description: "Issue 2".to_string(),
                    severity: AlertSeverity::Medium,
                    points_deducted: 15.0,
                    remediation: "Fix that".to_string(),
                    complexity: RemediationComplexity::Medium,
                    framework_ref: None,
                },
            ],
        };
        let factor = build_risk_factor("test", "Test Factor", 10.0, result);
        assert!((factor.impact_if_fixed - 40.0).abs() < f64::EPSILON);
        assert_eq!(factor.findings.len(), 2);
    }

    // --- New security checks tests ---

    #[tokio::test]
    async fn test_certificate_esc3_detection() {
        use std::collections::HashMap;
        let mut ca_attrs = HashMap::new();
        ca_attrs.insert("name".to_string(), vec!["RootCA".to_string()]);
        let ca_entry = crate::models::DirectoryEntry {
            distinguished_name: "CN=RootCA,CN=Certification Authorities,CN=Public Key Services,CN=Services,CN=Configuration,DC=example,DC=com".to_string(),
            sam_account_name: None,
            display_name: None,
            object_class: Some("certificationAuthority".to_string()),
            attributes: ca_attrs,
        };

        // Template with Certificate Request Agent EKU (ESC3)
        let mut tpl_attrs = HashMap::new();
        tpl_attrs.insert("name".to_string(), vec!["VulnTemplate".to_string()]);
        tpl_attrs.insert(
            "pKIExtendedKeyUsage".to_string(),
            vec!["1.3.6.1.4.1.311.20.2.1".to_string()],
        );
        tpl_attrs.insert(
            "msPKI-Certificate-Name-Flag".to_string(),
            vec!["0".to_string()],
        );
        tpl_attrs.insert("msPKI-Enrollment-Flag".to_string(), vec!["0".to_string()]);
        tpl_attrs.insert(
            "msPKI-Template-Schema-Version".to_string(),
            vec!["2".to_string()],
        );
        let tpl_entry = crate::models::DirectoryEntry {
            distinguished_name: "CN=VulnTemplate,CN=Certificate Templates,CN=Public Key Services,CN=Services,CN=Configuration,DC=example,DC=com".to_string(),
            sam_account_name: None,
            display_name: None,
            object_class: Some("pKICertificateTemplate".to_string()),
            attributes: tpl_attrs,
        };

        let provider = Arc::new(
            crate::services::directory::tests::MockDirectoryProvider::new()
                .with_configuration_entries(vec![ca_entry, tpl_entry]),
        );
        let result = compute_certificate_security_factor(provider).await;
        let finding_ids: Vec<&str> = result.findings.iter().map(|f| f.id.as_str()).collect();
        assert!(
            finding_ids.contains(&"CERT-ESC3"),
            "Expected CERT-ESC3 finding, got: {:?}",
            finding_ids
        );
    }

    #[tokio::test]
    async fn test_certificate_legacy_v1_detection() {
        use std::collections::HashMap;
        let mut ca_attrs = HashMap::new();
        ca_attrs.insert("name".to_string(), vec!["RootCA".to_string()]);
        let ca_entry = crate::models::DirectoryEntry {
            distinguished_name: "CN=RootCA,CN=Certification Authorities,CN=Public Key Services,CN=Services,CN=Configuration,DC=example,DC=com".to_string(),
            sam_account_name: None,
            display_name: None,
            object_class: Some("certificationAuthority".to_string()),
            attributes: ca_attrs,
        };

        // Schema V1 template
        let mut tpl_attrs = HashMap::new();
        tpl_attrs.insert("name".to_string(), vec!["LegacyTemplate".to_string()]);
        tpl_attrs.insert(
            "msPKI-Template-Schema-Version".to_string(),
            vec!["1".to_string()],
        );
        tpl_attrs.insert(
            "msPKI-Certificate-Name-Flag".to_string(),
            vec!["0".to_string()],
        );
        tpl_attrs.insert("msPKI-Enrollment-Flag".to_string(), vec!["0".to_string()]);
        let tpl_entry = crate::models::DirectoryEntry {
            distinguished_name: "CN=LegacyTemplate,CN=Certificate Templates,CN=Public Key Services,CN=Services,CN=Configuration,DC=example,DC=com".to_string(),
            sam_account_name: None,
            display_name: None,
            object_class: Some("pKICertificateTemplate".to_string()),
            attributes: tpl_attrs,
        };

        let provider = Arc::new(
            crate::services::directory::tests::MockDirectoryProvider::new()
                .with_configuration_entries(vec![ca_entry, tpl_entry]),
        );
        let result = compute_certificate_security_factor(provider).await;
        let finding_ids: Vec<&str> = result.findings.iter().map(|f| f.id.as_str()).collect();
        assert!(
            finding_ids.contains(&"CERT-LEGACY"),
            "Expected CERT-LEGACY finding, got: {:?}",
            finding_ids
        );
    }

    #[tokio::test]
    async fn test_dangerous_configs_passwd_notreqd() {
        use std::collections::HashMap;
        // User with PASSWD_NOTREQD flag (0x0020 = 32)
        let mut attrs = HashMap::new();
        attrs.insert(
            "userAccountControl".to_string(),
            vec!["544".to_string()], // 512 (NORMAL_ACCOUNT) + 32 (PASSWD_NOTREQD)
        );
        let user = crate::models::DirectoryEntry {
            distinguished_name: "CN=NoPass,OU=Users,DC=example,DC=com".to_string(),
            sam_account_name: Some("nopass".to_string()),
            display_name: Some("No Pass".to_string()),
            object_class: Some("user".to_string()),
            attributes: attrs,
        };

        let provider = Arc::new(
            crate::services::directory::tests::MockDirectoryProvider::new().with_users(vec![user]),
        );
        let result = compute_dangerous_configs_factor(provider).await;
        let finding_ids: Vec<&str> = result.findings.iter().map(|f| f.id.as_str()).collect();
        assert!(
            finding_ids.contains(&"CONF-PASSWD-NOTREQD"),
            "Expected CONF-PASSWD-NOTREQD finding, got: {:?}",
            finding_ids
        );
    }

    #[tokio::test]
    async fn test_dangerous_configs_sidhistory() {
        use std::collections::HashMap;
        let mut attrs = HashMap::new();
        attrs.insert("userAccountControl".to_string(), vec!["512".to_string()]);
        attrs.insert(
            "sIDHistory".to_string(),
            vec!["S-1-5-21-123456789-1234567890-1234567890-1001".to_string()],
        );
        let user = crate::models::DirectoryEntry {
            distinguished_name: "CN=MigratedUser,OU=Users,DC=example,DC=com".to_string(),
            sam_account_name: Some("migrated".to_string()),
            display_name: Some("Migrated User".to_string()),
            object_class: Some("user".to_string()),
            attributes: attrs,
        };

        let provider = Arc::new(
            crate::services::directory::tests::MockDirectoryProvider::new().with_users(vec![user]),
        );
        let result = compute_dangerous_configs_factor(provider).await;
        let finding_ids: Vec<&str> = result.findings.iter().map(|f| f.id.as_str()).collect();
        assert!(
            finding_ids.contains(&"CONF-SIDHISTORY"),
            "Expected CONF-SIDHISTORY finding, got: {:?}",
            finding_ids
        );
    }

    #[tokio::test]
    async fn test_dangerous_configs_deleg_sensitive() {
        use std::collections::HashMap;
        // User with protocol transition + delegation to CIFS service
        let mut attrs = HashMap::new();
        attrs.insert(
            "userAccountControl".to_string(),
            vec![format!("{}", 0x1000000 | 512)], // TRUSTED_TO_AUTH_FOR_DELEGATION + NORMAL
        );
        attrs.insert(
            "msDS-AllowedToDelegateTo".to_string(),
            vec!["cifs/server.example.com".to_string()],
        );
        let user = crate::models::DirectoryEntry {
            distinguished_name: "CN=DelegUser,OU=Users,DC=example,DC=com".to_string(),
            sam_account_name: Some("deleguser".to_string()),
            display_name: Some("Deleg User".to_string()),
            object_class: Some("user".to_string()),
            attributes: attrs,
        };

        let provider = Arc::new(
            crate::services::directory::tests::MockDirectoryProvider::new().with_users(vec![user]),
        );
        let result = compute_dangerous_configs_factor(provider).await;
        let finding_ids: Vec<&str> = result.findings.iter().map(|f| f.id.as_str()).collect();
        assert!(
            finding_ids.contains(&"CONF-DELEG-SENSITIVE"),
            "Expected CONF-DELEG-SENSITIVE finding, got: {:?}",
            finding_ids
        );
    }

    #[tokio::test]
    async fn test_dangerous_configs_unconstrained_computer() {
        use std::collections::HashMap;
        // Computer with TRUSTED_FOR_DELEGATION but not a DC (no SERVER_TRUST_ACCOUNT)
        let mut attrs = HashMap::new();
        attrs.insert(
            "userAccountControl".to_string(),
            vec![format!("{}", 0x80000 | 0x1000)], // TRUSTED_FOR_DELEGATION + WORKSTATION_TRUST_ACCOUNT
        );
        let computer = crate::models::DirectoryEntry {
            distinguished_name: "CN=WORKSTATION1,OU=Computers,DC=example,DC=com".to_string(),
            sam_account_name: Some("WORKSTATION1$".to_string()),
            display_name: None,
            object_class: Some("computer".to_string()),
            attributes: attrs,
        };

        // Need at least one user for the function to proceed past the match guard
        let mut user_attrs = HashMap::new();
        user_attrs.insert("userAccountControl".to_string(), vec!["512".to_string()]);
        let dummy_user = crate::models::DirectoryEntry {
            distinguished_name: "CN=User1,OU=Users,DC=example,DC=com".to_string(),
            sam_account_name: Some("user1".to_string()),
            display_name: Some("User 1".to_string()),
            object_class: Some("user".to_string()),
            attributes: user_attrs,
        };

        let provider = Arc::new(
            crate::services::directory::tests::MockDirectoryProvider::new()
                .with_users(vec![dummy_user])
                .with_computers(vec![computer]),
        );
        let result = compute_dangerous_configs_factor(provider).await;
        let finding_ids: Vec<&str> = result.findings.iter().map(|f| f.id.as_str()).collect();
        assert!(
            finding_ids.contains(&"CONF-UNCONS-COMPUTER"),
            "Expected CONF-UNCONS-COMPUTER finding, got: {:?}",
            finding_ids
        );
    }

    #[tokio::test]
    async fn test_stale_machine_accounts() {
        use std::collections::HashMap;
        // User with recent logon (not stale)
        let mut user_attrs = HashMap::new();
        let recent_filetime =
            (Utc::now().timestamp() * 10_000_000 + FILETIME_EPOCH_OFFSET).to_string();
        user_attrs.insert(
            "lastLogonTimestamp".to_string(),
            vec![recent_filetime.clone()],
        );
        user_attrs.insert("userAccountControl".to_string(), vec!["512".to_string()]);
        let user = crate::models::DirectoryEntry {
            distinguished_name: "CN=User1,OU=Users,DC=example,DC=com".to_string(),
            sam_account_name: Some("user1".to_string()),
            display_name: Some("User 1".to_string()),
            object_class: Some("user".to_string()),
            attributes: user_attrs,
        };

        // Computer with old password (stale)
        let mut comp_attrs = HashMap::new();
        let old_filetime = ((Utc::now().timestamp() - 100 * 86400) * 10_000_000
            + FILETIME_EPOCH_OFFSET)
            .to_string();
        comp_attrs.insert("pwdLastSet".to_string(), vec![old_filetime]);
        comp_attrs.insert("userAccountControl".to_string(), vec!["4096".to_string()]);
        let computer = crate::models::DirectoryEntry {
            distinguished_name: "CN=OLDPC,OU=Computers,DC=example,DC=com".to_string(),
            sam_account_name: Some("OLDPC$".to_string()),
            display_name: None,
            object_class: Some("computer".to_string()),
            attributes: comp_attrs,
        };

        let provider = Arc::new(
            crate::services::directory::tests::MockDirectoryProvider::new()
                .with_users(vec![user])
                .with_computers(vec![computer]),
        );
        let result = compute_stale_accounts_factor(provider).await;
        let finding_ids: Vec<&str> = result.findings.iter().map(|f| f.id.as_str()).collect();
        assert!(
            finding_ids.contains(&"STALE-MACHINE"),
            "Expected STALE-MACHINE finding, got: {:?}",
            finding_ids
        );
    }

    #[tokio::test]
    async fn test_kerberos_weak_spn_encryption() {
        use std::collections::HashMap;
        // User with SPN but no AES encryption type set
        let mut attrs = HashMap::new();
        attrs.insert(
            "servicePrincipalName".to_string(),
            vec!["MSSQLSvc/server.example.com:1433".to_string()],
        );
        attrs.insert("userAccountControl".to_string(), vec!["512".to_string()]);
        // msDS-SupportedEncryptionTypes not set (defaults to 0 = RC4 only)
        let user = crate::models::DirectoryEntry {
            distinguished_name: "CN=SvcAcct,OU=Users,DC=example,DC=com".to_string(),
            sam_account_name: Some("svcacct".to_string()),
            display_name: Some("Service Account".to_string()),
            object_class: Some("user".to_string()),
            attributes: attrs,
        };

        let empty_findings = DomainSecurityFindings {
            krbtgt_password_age_days: Some(30),
            laps_coverage_percent: None,
            laps_deployed_count: 0,
            total_computer_count: 0,
            pso_count: 0,
            domain_functional_level: None,
            forest_functional_level: None,
            ldap_signing_enforced: None,
            recycle_bin_enabled: None,
            rbcd_configured_count: 0,
            alerts: vec![],
        };

        let provider = Arc::new(
            crate::services::directory::tests::MockDirectoryProvider::new().with_users(vec![user]),
        );
        let result = compute_kerberos_security_factor(provider, &empty_findings).await;
        let finding_ids: Vec<&str> = result.findings.iter().map(|f| f.id.as_str()).collect();
        assert!(
            finding_ids.contains(&"KERB-WEAK-SPN"),
            "Expected KERB-WEAK-SPN finding, got: {:?}",
            finding_ids
        );
    }

    #[tokio::test]
    async fn test_kerberos_rc4_admin() {
        use std::collections::HashMap;
        // Admin account (adminCount=1) without AES encryption
        let mut attrs = HashMap::new();
        attrs.insert("userAccountControl".to_string(), vec!["512".to_string()]);
        attrs.insert("adminCount".to_string(), vec!["1".to_string()]);
        // No msDS-SupportedEncryptionTypes = defaults to RC4
        let user = crate::models::DirectoryEntry {
            distinguished_name: "CN=Admin,OU=Users,DC=example,DC=com".to_string(),
            sam_account_name: Some("admin".to_string()),
            display_name: Some("Admin".to_string()),
            object_class: Some("user".to_string()),
            attributes: attrs,
        };

        let empty_findings = DomainSecurityFindings {
            krbtgt_password_age_days: Some(30),
            laps_coverage_percent: None,
            laps_deployed_count: 0,
            total_computer_count: 0,
            pso_count: 0,
            domain_functional_level: None,
            forest_functional_level: None,
            ldap_signing_enforced: None,
            recycle_bin_enabled: None,
            rbcd_configured_count: 0,
            alerts: vec![],
        };

        let provider = Arc::new(
            crate::services::directory::tests::MockDirectoryProvider::new().with_users(vec![user]),
        );
        let result = compute_kerberos_security_factor(provider, &empty_findings).await;
        let finding_ids: Vec<&str> = result.findings.iter().map(|f| f.id.as_str()).collect();
        assert!(
            finding_ids.contains(&"KERB-RC4-ADMIN"),
            "Expected KERB-RC4-ADMIN finding, got: {:?}",
            finding_ids
        );
    }

    // -----------------------------------------------------------------------
    // Attack Detection tests
    // -----------------------------------------------------------------------

    fn make_event(id: u32) -> EventRecord {
        EventRecord {
            time_created: Some("2026-03-23T10:00:00Z".to_string()),
            id: Some(id),
            ip_address: None,
            target_user_name: None,
            ticket_encryption_type: None,
            service_name: None,
            status: None,
            sub_status: None,
            logon_type: None,
            authentication_package_name: None,
            key_length: None,
            object_type: None,
            access_mask: None,
            subject_user_name: None,
            attribute_ldap_display_name: None,
            object_dn: None,
        }
    }

    fn default_config() -> AttackDetectionConfig {
        AttackDetectionConfig::default()
    }

    #[test]
    fn test_detect_golden_ticket_rc4() {
        let mut event = make_event(4768);
        event.ticket_encryption_type = Some("0x17".to_string());
        event.target_user_name = Some("admin".to_string());
        event.ip_address = Some("10.0.0.1".to_string());

        let events: Vec<&EventRecord> = vec![&event];
        let alerts = detect_golden_ticket(&events, &default_config());
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].attack_type, AttackType::GoldenTicket);
        assert_eq!(alerts[0].severity, AlertSeverity::Critical);
        assert_eq!(alerts[0].mitre_ref.as_deref(), Some("T1558.001"));
    }

    #[test]
    fn test_detect_golden_ticket_excludes_krbtgt() {
        let mut event = make_event(4768);
        event.ticket_encryption_type = Some("0x17".to_string());
        event.target_user_name = Some("krbtgt".to_string());

        let events: Vec<&EventRecord> = vec![&event];
        let alerts = detect_golden_ticket(&events, &default_config());
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_detect_golden_ticket_aes_no_alert() {
        let mut event = make_event(4768);
        event.ticket_encryption_type = Some("0x12".to_string());
        event.target_user_name = Some("admin".to_string());

        let events: Vec<&EventRecord> = vec![&event];
        let alerts = detect_golden_ticket(&events, &default_config());
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_detect_dcsync_replication_by_user() {
        let mut event = make_event(4662);
        event.access_mask = Some("0x100".to_string());
        event.object_type = Some(GUID_DS_REPL_GET_CHANGES_ALL.to_string());
        event.subject_user_name = Some("attacker".to_string());
        event.ip_address = Some("10.0.0.50".to_string());

        let events: Vec<&EventRecord> = vec![&event];
        let alerts = detect_dcsync(&events, &default_config());
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].attack_type, AttackType::DCSync);
        assert_eq!(alerts[0].mitre_ref.as_deref(), Some("T1003.006"));
    }

    #[test]
    fn test_detect_dcsync_excludes_machine_accounts() {
        let mut event = make_event(4662);
        event.access_mask = Some("0x100".to_string());
        event.object_type = Some(GUID_DS_REPL_GET_CHANGES.to_string());
        event.subject_user_name = Some("DC01$".to_string());

        let events: Vec<&EventRecord> = vec![&event];
        let alerts = detect_dcsync(&events, &default_config());
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_detect_dcsync_excluded_ip() {
        let mut event = make_event(4662);
        event.access_mask = Some("0x100".to_string());
        event.object_type = Some(GUID_DS_REPL_GET_CHANGES_ALL.to_string());
        event.subject_user_name = Some("attacker".to_string());
        event.ip_address = Some("10.0.0.1".to_string());

        let mut config = default_config();
        config.excluded_ips = vec!["10.0.0.1".to_string()];
        let events: Vec<&EventRecord> = vec![&event];
        let alerts = detect_dcsync(&events, &config);
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_detect_kerberoasting_threshold() {
        let config = default_config(); // threshold = 3
        let mut events_owned = Vec::new();
        for i in 0..3 {
            let mut event = make_event(4769);
            event.ticket_encryption_type = Some("0x17".to_string());
            event.service_name = Some(format!("svc_{}", i));
            event.subject_user_name = Some("attacker".to_string());
            event.ip_address = Some("10.0.0.50".to_string());
            events_owned.push(event);
        }
        let events: Vec<&EventRecord> = events_owned.iter().collect();
        let alerts = detect_kerberoasting(&events, &config);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].attack_type, AttackType::Kerberoasting);
        assert_eq!(alerts[0].mitre_ref.as_deref(), Some("T1558.003"));
    }

    #[test]
    fn test_detect_kerberoasting_below_threshold() {
        let config = default_config(); // threshold = 3
        let mut events_owned = Vec::new();
        for i in 0..2 {
            let mut event = make_event(4769);
            event.ticket_encryption_type = Some("0x17".to_string());
            event.service_name = Some(format!("svc_{}", i));
            event.subject_user_name = Some("user".to_string());
            events_owned.push(event);
        }
        let events: Vec<&EventRecord> = events_owned.iter().collect();
        let alerts = detect_kerberoasting(&events, &config);
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_detect_kerberoasting_excludes_machine_accounts() {
        let config = default_config();
        let mut events_owned = Vec::new();
        for i in 0..3 {
            let mut event = make_event(4769);
            event.ticket_encryption_type = Some("0x17".to_string());
            event.service_name = Some(format!("SVC{}$", i)); // machine account
            event.subject_user_name = Some("attacker".to_string());
            events_owned.push(event);
        }
        let events: Vec<&EventRecord> = events_owned.iter().collect();
        let alerts = detect_kerberoasting(&events, &config);
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_detect_asrep_roasting() {
        let config = default_config();
        let mut events_owned = Vec::new();
        for i in 0..3 {
            let mut event = make_event(4768);
            event.ticket_encryption_type = Some("0x17".to_string());
            event.target_user_name = Some(format!("user{}", i));
            event.ip_address = Some("10.0.0.99".to_string());
            events_owned.push(event);
        }
        let events: Vec<&EventRecord> = events_owned.iter().collect();
        let alerts = detect_asrep_roasting(&events, &config);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].attack_type, AttackType::AsrepRoasting);
        assert_eq!(alerts[0].mitre_ref.as_deref(), Some("T1558.004"));
    }

    #[test]
    fn test_detect_brute_force() {
        let mut config = default_config();
        config.brute_force_threshold = 3;

        let mut events_owned = Vec::new();
        for _ in 0..5 {
            let mut event = make_event(4625);
            event.ip_address = Some("192.168.1.100".to_string());
            event.sub_status = Some("0xC000006A".to_string());
            events_owned.push(event);
        }
        let events: Vec<&EventRecord> = events_owned.iter().collect();
        let alerts = detect_brute_force(&events, &config);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].attack_type, AttackType::BruteForce);
        assert_eq!(alerts[0].mitre_ref.as_deref(), Some("T1110.001"));
        assert!(alerts[0].description.contains("5 failed logons"));
    }

    #[test]
    fn test_detect_brute_force_below_threshold() {
        let config = default_config(); // threshold = 10
        let mut events_owned = Vec::new();
        for _ in 0..5 {
            let mut event = make_event(4625);
            event.ip_address = Some("192.168.1.100".to_string());
            events_owned.push(event);
        }
        let events: Vec<&EventRecord> = events_owned.iter().collect();
        let alerts = detect_brute_force(&events, &config);
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_detect_pass_the_hash() {
        let config = default_config();
        let mut event = make_event(4624);
        event.logon_type = Some("3".to_string());
        event.authentication_package_name = Some("NTLM".to_string());
        event.key_length = Some("0".to_string());
        event.ip_address = Some("10.0.0.5".to_string());
        event.target_user_name = Some("admin".to_string());

        let events: Vec<&EventRecord> = vec![&event];
        let alerts = detect_pass_the_hash(&events, &config);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].attack_type, AttackType::PassTheHash);
        assert_eq!(alerts[0].severity, AlertSeverity::Critical);
        assert_eq!(alerts[0].mitre_ref.as_deref(), Some("T1550.002"));
    }

    #[test]
    fn test_detect_pass_the_hash_excludes_machine_accounts() {
        let config = default_config();
        let mut event = make_event(4624);
        event.logon_type = Some("3".to_string());
        event.authentication_package_name = Some("NTLM".to_string());
        event.key_length = Some("0".to_string());
        event.target_user_name = Some("DC01$".to_string());

        let events: Vec<&EventRecord> = vec![&event];
        let alerts = detect_pass_the_hash(&events, &config);
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_detect_password_spray() {
        let config = default_config();
        let mut events_owned = Vec::new();
        for i in 0..6 {
            let mut event = make_event(4771);
            event.ip_address = Some("10.0.0.42".to_string());
            event.target_user_name = Some(format!("user{}", i));
            events_owned.push(event);
        }
        let events: Vec<&EventRecord> = events_owned.iter().collect();
        let alerts = detect_password_spray(&events, &config);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].attack_type, AttackType::PasswordSpray);
        assert_eq!(alerts[0].mitre_ref.as_deref(), Some("T1110.003"));
    }

    #[test]
    fn test_detect_shadow_credentials() {
        let config = default_config();
        let mut event = make_event(5136);
        event.attribute_ldap_display_name = Some("msDS-KeyCredentialLink".to_string());
        event.subject_user_name = Some("attacker".to_string());
        event.object_dn = Some("CN=victim,OU=Users,DC=test".to_string());

        let events: Vec<&EventRecord> = vec![&event];
        let alerts = detect_shadow_credentials(&events, &config);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].attack_type, AttackType::ShadowCredentials);
        assert_eq!(alerts[0].severity, AlertSeverity::Critical);
        assert_eq!(alerts[0].mitre_ref.as_deref(), Some("T1556.006"));
    }

    #[test]
    fn test_detect_rbcd_abuse() {
        let config = default_config();
        let mut event = make_event(5136);
        event.attribute_ldap_display_name =
            Some("msDS-AllowedToActOnBehalfOfOtherIdentity".to_string());
        event.subject_user_name = Some("attacker".to_string());
        event.object_dn = Some("CN=server,OU=Servers,DC=test".to_string());

        let events: Vec<&EventRecord> = vec![&event];
        let alerts = detect_rbcd_abuse(&events, &config);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].attack_type, AttackType::RbcdAbuse);
        assert_eq!(alerts[0].mitre_ref.as_deref(), Some("T1134.001"));
    }

    #[test]
    fn test_detect_adminsd_holder_tamper() {
        let config = default_config();
        let mut event = make_event(5136);
        event.object_dn = Some("CN=AdminSDHolder,CN=System,DC=test,DC=com".to_string());
        event.subject_user_name = Some("attacker".to_string());

        let events: Vec<&EventRecord> = vec![&event];
        let alerts = detect_adminsd_holder_tamper(&events, &config);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].attack_type, AttackType::AdminSdHolderTamper);
        assert_eq!(alerts[0].severity, AlertSeverity::Critical);
        assert_eq!(alerts[0].mitre_ref.as_deref(), Some("T1222.001"));
    }

    #[test]
    fn test_detect_suspicious_account_creation() {
        let config = default_config();
        let mut event = make_event(4720);
        event.subject_user_name = Some("admin".to_string());
        event.target_user_name = Some("newuser".to_string());

        let events: Vec<&EventRecord> = vec![&event];
        let alerts = detect_suspicious_account_activity(&events, &config);
        assert_eq!(alerts.len(), 1);
        assert_eq!(
            alerts[0].attack_type,
            AttackType::SuspiciousAccountActivity
        );
        assert_eq!(alerts[0].severity, AlertSeverity::Medium);
        assert_eq!(alerts[0].mitre_ref.as_deref(), Some("T1136.001"));
    }

    #[test]
    fn test_detect_suspicious_account_modification() {
        let config = default_config();
        let mut event = make_event(4738);
        event.subject_user_name = Some("admin".to_string());
        event.target_user_name = Some("target".to_string());

        let events: Vec<&EventRecord> = vec![&event];
        let alerts = detect_suspicious_account_activity(&events, &config);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].mitre_ref.as_deref(), Some("T1098"));
    }

    #[test]
    fn test_detect_priv_group_change() {
        let config = default_config();
        let mut event = make_event(4728);
        event.subject_user_name = Some("admin".to_string());
        event.target_user_name = Some("newmember".to_string());

        let events: Vec<&EventRecord> = vec![&event];
        let alerts = detect_priv_group_change(&events, &config);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].attack_type, AttackType::PrivGroupChange);
        assert!(alerts[0].description.contains("global"));
    }

    #[test]
    fn test_excluded_account_filtering() {
        let mut config = default_config();
        config.excluded_accounts = vec!["svc_backup".to_string()];

        let mut event = make_event(4768);
        event.ticket_encryption_type = Some("0x17".to_string());
        event.target_user_name = Some("svc_backup".to_string());

        let events: Vec<&EventRecord> = vec![&event];
        let alerts = detect_golden_ticket(&events, &config);
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_event_record_deserialization() {
        let json = r#"{
            "TimeCreated": "2026-03-23T10:00:00+00:00",
            "Id": 4662,
            "IpAddress": "10.0.0.1",
            "TargetUserName": "admin",
            "TicketEncryptionType": null,
            "ServiceName": null,
            "Status": null,
            "SubStatus": null,
            "LogonType": null,
            "AuthenticationPackageName": null,
            "KeyLength": null,
            "ObjectType": "1131f6ad-9c07-11d1-f79f-00c04fc2dcd2",
            "AccessMask": "0x100",
            "SubjectUserName": "attacker",
            "AttributeLDAPDisplayName": null,
            "ObjectDN": null
        }"#;
        let record: EventRecord = serde_json::from_str(json).unwrap();
        assert_eq!(record.id, Some(4662));
        assert_eq!(record.ip_address.as_deref(), Some("10.0.0.1"));
        assert_eq!(record.subject_user_name.as_deref(), Some("attacker"));
    }
}
