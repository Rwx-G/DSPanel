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
            let kerberoastable = !member.get_attribute_values("servicePrincipalName").is_empty();
            let asrep_roastable = (uac & UAC_DONT_REQUIRE_PREAUTH) != 0;
            let reversible_encryption = (uac & UAC_ENCRYPTED_TEXT_PWD_ALLOWED) != 0;
            let des_only = (uac & UAC_USE_DES_KEY_ONLY) != 0;
            let constrained_delegation_transition =
                (uac & UAC_TRUSTED_TO_AUTH_FOR_DELEGATION) != 0;
            let has_sid_history = !member.get_attribute_values("sIDHistory").is_empty();
            let is_service_account = kerberoastable && password_never_expires;
            let in_protected_users =
                protected_users_members.contains(&member.distinguished_name);
            let admin_count = member
                .get_attribute("adminCount")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);

            let password_age_days = pwd_last_set.as_ref().map(|pwd_set| {
                (Utc::now() - *pwd_set).num_days()
            });

            let last_logon_str = last_logon.as_ref().map(|dt| dt.to_rfc3339());

            // Inactive admin: last logon > 90 days (not just "never logged on")
            let last_logon_age_days = last_logon.map(|dt| (Utc::now() - dt).num_days());

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
                admin_count_orphaned: admin_count == 1
                    && !enabled, // Simplified: disabled with adminCount=1
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
        b_max.cmp(&a_max).then_with(|| b.alerts.len().cmp(&a.alerts.len()))
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
                message: format!("Password not changed for {} days (threshold: {})", age, PASSWORD_AGE_THRESHOLD_DAYS),
                alert_type: "password_age".to_string(),
            });
        }
    }

    // Reversible encryption enabled
    if account.reversible_encryption {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::Critical,
            message: "Reversible encryption enabled - password recoverable in plaintext".to_string(),
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
            message: "Constrained delegation with protocol transition enabled - can impersonate any user".to_string(),
            alert_type: "constrained_delegation_transition".to_string(),
        });
    }

    // SIDHistory present on admin account
    if account.has_sid_history {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::High,
            message: "SIDHistory attribute present - potential cross-domain escalation vector".to_string(),
            alert_type: "sid_history".to_string(),
        });
    }

    // Service account in Domain Admins (SPN + password never expires + privileged)
    if account.is_service_account {
        alerts.push(SecurityAlert {
            severity: AlertSeverity::High,
            message: "Service account in privileged group (has SPN + password never expires)".to_string(),
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
            message: "adminCount=1 on disabled account - orphaned AdminSDHolder protection".to_string(),
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

    // Collect domain findings once for reuse across factors
    let domain_findings = get_domain_security_findings(provider.clone()).await;

    // Factor 1: Privileged Account Hygiene (enriched with kerberoastable, protected users)
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

    // Factor 4: Kerberos Security (NEW - uses domain findings)
    let kerb_score = compute_kerberos_security_factor(provider.clone(), &domain_findings).await;
    factors.push(RiskFactor {
        id: "kerberos_security".to_string(),
        name: "Kerberos Security".to_string(),
        score: kerb_score.0,
        weight: weights.kerberos_security,
        explanation: kerb_score.1,
        recommendations: kerb_score.2,
    });

    // Factor 5: Dangerous Configurations
    let danger_score = compute_dangerous_configs_factor(provider.clone()).await;
    factors.push(RiskFactor {
        id: "dangerous_configs".to_string(),
        name: "Dangerous Configurations".to_string(),
        score: danger_score.0,
        weight: weights.dangerous_configs,
        explanation: danger_score.1,
        recommendations: danger_score.2,
    });

    // Factor 6: Infrastructure Hardening (NEW - uses domain findings)
    let infra_score = compute_infrastructure_hardening_factor(&domain_findings);
    factors.push(RiskFactor {
        id: "infrastructure_hardening".to_string(),
        name: "Infrastructure Hardening".to_string(),
        score: infra_score.0,
        weight: weights.infrastructure_hardening,
        explanation: infra_score.1,
        recommendations: infra_score.2,
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

    // Worst factor (PingCastle-style "weakest link" indicator)
    let worst = factors
        .iter()
        .min_by(|a, b| a.score.partial_cmp(&b.score).unwrap_or(std::cmp::Ordering::Equal));
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
                format!("{}/{} privileged accounts have security alerts", with_alerts as usize, total as usize),
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
                    let last_logon = parse_ad_timestamp(u.get_attribute("lastLogonTimestamp"))
                        .or_else(|| parse_ad_timestamp(u.get_attribute("lastLogon")));
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
            let unconstrained = uac_flags.iter().filter(|&&f| f & UAC_TRUSTED_FOR_DELEGATION != 0).count();
            if unconstrained > 0 {
                let penalty = (unconstrained as f64 / total as f64 * 100.0).min(30.0);
                score -= penalty;
                issues.push(format!("{} unconstrained delegation", unconstrained));
                recommendations.push(format!("Remove unconstrained delegation from {} account(s)", unconstrained));
            }

            // Constrained delegation with protocol transition
            let constrained_transition = uac_flags.iter().filter(|&&f| f & UAC_TRUSTED_TO_AUTH_FOR_DELEGATION != 0).count();
            if constrained_transition > 0 {
                score -= 10.0;
                issues.push(format!("{} constrained delegation with protocol transition", constrained_transition));
                recommendations.push("Review constrained delegation with protocol transition - can impersonate any user".to_string());
            }

            // Password never expires on regular accounts (>10%)
            let never_expires = uac_flags.iter().filter(|&&f| f & UAC_DONT_EXPIRE_PASSWORD != 0).count();
            let never_expires_ratio = never_expires as f64 / total as f64;
            if never_expires_ratio > 0.1 {
                score -= 15.0;
                issues.push(format!("{}% passwords never expire", (never_expires_ratio * 100.0) as u32));
                recommendations.push("Reduce accounts with non-expiring passwords".to_string());
            }

            // Reversible encryption
            let reversible = uac_flags.iter().filter(|&&f| f & UAC_ENCRYPTED_TEXT_PWD_ALLOWED != 0).count();
            if reversible > 0 {
                score -= 15.0;
                issues.push(format!("{} with reversible encryption", reversible));
                recommendations.push("Disable reversible encryption on all accounts".to_string());
            }

            // DES-only Kerberos
            let des_only = uac_flags.iter().filter(|&&f| f & UAC_USE_DES_KEY_ONLY != 0).count();
            if des_only > 0 {
                score -= 10.0;
                issues.push(format!("{} with DES-only Kerberos", des_only));
                recommendations.push("Disable DES encryption and migrate to AES".to_string());
            }

            // AS-REP Roastable
            let asrep = uac_flags.iter().filter(|&&f| f & UAC_DONT_REQUIRE_PREAUTH != 0).count();
            if asrep > 0 {
                score -= 15.0;
                issues.push(format!("{} AS-REP Roastable", asrep));
                recommendations.push("Enable Kerberos pre-authentication on all accounts".to_string());
            }

            // RBCD configured
            let rbcd = users
                .iter()
                .filter(|u| u.get_attribute("msDS-AllowedToActOnBehalfOfOtherIdentity").is_some())
                .count();
            if rbcd > 0 {
                score -= 10.0;
                issues.push(format!("{} with RBCD", rbcd));
                recommendations.push("Audit Resource-Based Constrained Delegation configurations".to_string());
            }

            // Domain functional level check
            if let Ok(Some(root_dse)) = provider.read_entry("").await {
                if let Some(level_str) = root_dse.get_attribute("domainFunctionality") {
                    if let Ok(level) = level_str.parse::<u32>() {
                        if level < 6 {
                            score -= 10.0;
                            issues.push(format!("Domain functional level < 2012 R2 (level {})", level));
                            recommendations.push("Upgrade domain functional level for modern security features".to_string());
                        }
                    }
                }
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

/// Scores Kerberos security posture (0-100).
///
/// Evaluates: KRBTGT password age, Kerberoastable privileged accounts,
/// AS-REP Roastable accounts, Protected Users group adoption.
async fn compute_kerberos_security_factor(
    provider: Arc<dyn DirectoryProvider>,
    domain_findings: &DomainSecurityFindings,
) -> (f64, String, Vec<String>) {
    let mut score = 100.0_f64;
    let mut issues = Vec::new();
    let mut recommendations = Vec::new();

    // KRBTGT password age (from domain findings)
    if let Some(age) = domain_findings.krbtgt_password_age_days {
        if age > KRBTGT_PASSWORD_AGE_THRESHOLD_DAYS {
            score -= 30.0;
            issues.push(format!("KRBTGT password {} days old", age));
            recommendations.push("Reset KRBTGT password twice with 12-hour interval".to_string());
        } else if age > 90 {
            score -= 10.0;
            issues.push(format!("KRBTGT password {} days old (consider resetting)", age));
        }
    }

    // Check privileged accounts for Kerberos weaknesses
    let report = get_privileged_accounts_report(provider, &[]).await;
    if let Ok(report) = report {
        let total = report.accounts.len().max(1) as f64;

        // Kerberoastable privileged accounts (proportional)
        let kerberoastable = report.accounts.iter().filter(|a| a.kerberoastable).count();
        if kerberoastable > 0 {
            let penalty = (kerberoastable as f64 / total * 30.0).min(25.0);
            score -= penalty;
            issues.push(format!("{}/{} privileged accounts Kerberoastable", kerberoastable, total as usize));
            recommendations.push("Remove SPNs from privileged user accounts or use gMSA".to_string());
        }

        // AS-REP Roastable (proportional)
        let asrep = report.accounts.iter().filter(|a| a.asrep_roastable).count();
        if asrep > 0 {
            let penalty = (asrep as f64 / total * 30.0).min(25.0);
            score -= penalty;
            issues.push(format!("{} AS-REP Roastable account(s)", asrep));
            recommendations.push("Enable Kerberos pre-authentication on all accounts".to_string());
        }

        // Protected Users adoption (proportional)
        let enabled_accounts: Vec<_> = report.accounts.iter().filter(|a| a.enabled).collect();
        let not_protected = enabled_accounts.iter().filter(|a| !a.in_protected_users).count();
        if !enabled_accounts.is_empty() && not_protected > 0 {
            let ratio = not_protected as f64 / enabled_accounts.len() as f64;
            let penalty = (ratio * 20.0).min(20.0);
            score -= penalty;
            issues.push(format!("{}/{} enabled admins not in Protected Users", not_protected, enabled_accounts.len()));
            recommendations.push("Add all privileged accounts to the Protected Users group".to_string());
        }
    }

    let explanation = if issues.is_empty() {
        "Kerberos configuration meets security best practices".to_string()
    } else {
        format!("Issues: {}", issues.join("; "))
    };

    (score.clamp(0.0, 100.0), explanation, recommendations)
}

/// Scores infrastructure hardening posture (0-100).
///
/// Evaluates: LAPS coverage, Recycle Bin, Fine-Grained Password Policies,
/// domain functional level, LDAP signing.
fn compute_infrastructure_hardening_factor(
    domain_findings: &DomainSecurityFindings,
) -> (f64, String, Vec<String>) {
    let mut score = 100.0_f64;
    let mut issues = Vec::new();
    let mut recommendations = Vec::new();

    // LAPS coverage (proportional)
    if let Some(pct) = domain_findings.laps_coverage_percent {
        if pct < 50.0 {
            score -= 30.0;
            issues.push(format!("LAPS coverage {:.0}%", pct));
            recommendations.push("Deploy LAPS to all workstations and servers".to_string());
        } else if pct < 80.0 {
            score -= 15.0;
            issues.push(format!("LAPS coverage {:.0}% (target: 80%+)", pct));
            recommendations.push("Extend LAPS deployment to remaining computers".to_string());
        }
    } else if domain_findings.total_computer_count > 0 {
        score -= 30.0;
        issues.push("LAPS not deployed".to_string());
        recommendations.push("Deploy LAPS for local admin password management".to_string());
    }

    // Recycle Bin
    if domain_findings.recycle_bin_enabled == Some(false) {
        score -= 15.0;
        issues.push("AD Recycle Bin disabled".to_string());
        recommendations.push("Enable AD Recycle Bin for object recovery capability".to_string());
    }

    // Fine-Grained Password Policies
    if domain_findings.pso_count == 0 {
        score -= 10.0;
        issues.push("No Fine-Grained Password Policies".to_string());
        recommendations.push("Create PSOs for privileged accounts with stronger password requirements".to_string());
    }

    // Domain functional level
    if let Some(ref level) = domain_findings.domain_functional_level {
        if level.contains("2008") || level.contains("2003") || level.contains("2000") {
            score -= 20.0;
            issues.push(format!("Domain functional level: {}", level));
            recommendations.push("Upgrade domain functional level to Windows Server 2016+".to_string());
        } else if level.contains("2012") && !level.contains("R2") {
            score -= 10.0;
            issues.push(format!("Domain functional level: {} (consider upgrading)", level));
        }
    }

    // RBCD count as infrastructure concern
    if domain_findings.rbcd_configured_count > 0 {
        let penalty = (domain_findings.rbcd_configured_count as f64 * 5.0).min(15.0);
        score -= penalty;
        issues.push(format!("{} RBCD delegation(s)", domain_findings.rbcd_configured_count));
        recommendations.push("Audit Resource-Based Constrained Delegation configurations".to_string());
    }

    let explanation = if issues.is_empty() {
        "Infrastructure hardening meets security best practices".to_string()
    } else {
        format!("Issues: {}", issues.join("; "))
    };

    (score.clamp(0.0, 100.0), explanation, recommendations)
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
        (4769, AttackType::AbnormalKerberos, "Abnormal Kerberos TGS request pattern"),
        (4771, AttackType::PasswordSpray, "Kerberos pre-authentication failures (potential password spray)"),
        (4728, AttackType::PrivGroupChange, "Member added to security-enabled global group"),
        (4732, AttackType::PrivGroupChange, "Member added to security-enabled local group"),
        (4756, AttackType::PrivGroupChange, "Member added to security-enabled universal group"),
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
                            AttackType::PasswordSpray => AlertSeverity::High,
                            AttackType::PrivGroupChange => AlertSeverity::High,
                            AttackType::AbnormalKerberos => AlertSeverity::Medium,
                        };

                        let recommendation = match attack_type {
                            AttackType::GoldenTicket => "Reset KRBTGT password twice with a 12-hour interval".to_string(),
                            AttackType::DCSync => "Review replication permissions - ensure only DCs have DS-Replication-Get-Changes rights".to_string(),
                            AttackType::DCShadow => "Audit computer account changes and verify no rogue DCs registered".to_string(),
                            AttackType::AbnormalKerberos => "Review Kerberos ticket requests for unusual encryption types or sources".to_string(),
                            AttackType::PasswordSpray => "Check for compromised accounts - review failed logon sources and lock affected accounts".to_string(),
                            AttackType::PrivGroupChange => "Verify the group membership change was authorized - review who was added and by whom".to_string(),
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
            krbtgt_password_age_days: None, laps_coverage_percent: None,
            laps_deployed_count: 0, total_computer_count: 0, pso_count: 0,
            domain_functional_level: None, forest_functional_level: None,
            ldap_signing_enforced: None, recycle_bin_enabled: None, rbcd_configured_count: 0,
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
        let asrep = alerts.iter().find(|a| a.alert_type == "asrep_roastable").unwrap();
        assert_eq!(asrep.severity, AlertSeverity::Critical);
    }

    #[test]
    fn test_compute_alerts_reversible_encryption() {
        let mut account = make_account(true, false, Some(10), Some("2026-03-20T00:00:00Z"));
        account.reversible_encryption = true;
        let alerts = compute_alerts(&account, None);
        let types: Vec<&str> = alerts.iter().map(|a| a.alert_type.as_str()).collect();
        assert!(types.contains(&"reversible_encryption"));
        let rev = alerts.iter().find(|a| a.alert_type == "reversible_encryption").unwrap();
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
}
