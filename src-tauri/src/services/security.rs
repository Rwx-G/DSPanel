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
}
