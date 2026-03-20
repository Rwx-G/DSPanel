use serde::{Deserialize, Serialize};

/// Health severity level for account flags.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum HealthLevel {
    Healthy,
    Info,
    Warning,
    Critical,
}

/// A single health flag detected on a user account.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthFlag {
    pub name: String,
    pub severity: HealthLevel,
    pub description: String,
}

/// Result of evaluating a user account's health.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountHealthStatus {
    pub level: HealthLevel,
    pub active_flags: Vec<HealthFlag>,
}

/// Input data needed to evaluate account health.
///
/// This mirrors the relevant fields from the frontend `DirectoryUser` type.
/// The Tauri command receives this from the frontend rather than performing
/// a separate LDAP lookup.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthInput {
    pub enabled: bool,
    pub locked_out: bool,
    pub account_expires: Option<String>,
    pub password_last_set: Option<String>,
    pub password_expired: bool,
    pub password_never_expires: bool,
    pub last_logon: Option<String>,
    pub when_created: Option<String>,
}

const MS_PER_DAY: i64 = 86_400_000;

/// Evaluates the health status of a user account by checking a set of flags
/// derived from account properties.
///
/// `now_ms` is the current time as milliseconds since Unix epoch, allowing
/// deterministic testing.
pub fn evaluate_health(input: &HealthInput, now_ms: i64) -> AccountHealthStatus {
    let mut flags: Vec<HealthFlag> = Vec::new();

    if !input.enabled {
        flags.push(HealthFlag {
            name: "Disabled".to_string(),
            severity: HealthLevel::Critical,
            description: "Account is disabled".to_string(),
        });
    }

    if input.locked_out {
        flags.push(HealthFlag {
            name: "Locked".to_string(),
            severity: HealthLevel::Critical,
            description: "Account is locked out".to_string(),
        });
    }

    if let Some(ref expires) = input.account_expires {
        if let Ok(expiry_ms) = parse_date_to_ms(expires) {
            if expiry_ms <= now_ms {
                flags.push(HealthFlag {
                    name: "Expired".to_string(),
                    severity: HealthLevel::Critical,
                    description: "Account has expired".to_string(),
                });
            }
        }
    }

    if input.password_expired {
        flags.push(HealthFlag {
            name: "PasswordExpired".to_string(),
            severity: HealthLevel::Critical,
            description: "Password has expired".to_string(),
        });
    }

    if input.password_never_expires {
        flags.push(HealthFlag {
            name: "PasswordNeverExpires".to_string(),
            severity: HealthLevel::Warning,
            description: "Password is set to never expire".to_string(),
        });
    }

    if let Some(ref last_logon) = input.last_logon {
        if let Ok(logon_ms) = parse_date_to_ms(last_logon) {
            let days_since = (now_ms - logon_ms) / MS_PER_DAY;
            if days_since >= 90 {
                flags.push(HealthFlag {
                    name: "Inactive90Days".to_string(),
                    severity: HealthLevel::Critical,
                    description: "No logon in over 90 days".to_string(),
                });
            } else if days_since >= 30 {
                flags.push(HealthFlag {
                    name: "Inactive30Days".to_string(),
                    severity: HealthLevel::Warning,
                    description: "No logon in over 30 days".to_string(),
                });
            }
        }
    } else if let Some(ref when_created) = input.when_created {
        if let Ok(created_ms) = parse_date_to_ms(when_created) {
            let days_since = (now_ms - created_ms) / MS_PER_DAY;
            if days_since >= 1 {
                flags.push(HealthFlag {
                    name: "NeverLoggedOn".to_string(),
                    severity: HealthLevel::Info,
                    description: "Account has never been used".to_string(),
                });
            }
        }
    }

    if let (Some(ref pwd_set), Some(ref created)) = (&input.password_last_set, &input.when_created)
    {
        if let (Ok(pwd_ms), Ok(created_ms)) = (parse_date_to_ms(pwd_set), parse_date_to_ms(created))
        {
            let diff = (pwd_ms - created_ms).unsigned_abs();
            if diff <= 60_000 {
                flags.push(HealthFlag {
                    name: "PasswordNeverChanged".to_string(),
                    severity: HealthLevel::Warning,
                    description: "Password has never been changed since account creation"
                        .to_string(),
                });
            }
        }
    }

    let level = flags
        .iter()
        .map(|f| &f.severity)
        .max()
        .cloned()
        .unwrap_or(HealthLevel::Healthy);

    AccountHealthStatus {
        level,
        active_flags: flags,
    }
}

/// Parses an ISO 8601 date string to milliseconds since Unix epoch.
///
/// Supports formats like "2026-03-15T14:30:00.000Z" and "2026-03-15".
fn parse_date_to_ms(date_str: &str) -> Result<i64, ()> {
    // Try parsing as ISO 8601 with time
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(date_str) {
        return Ok(dt.timestamp_millis());
    }
    // Try ISO 8601 without timezone (assume UTC).
    // The `%.f` specifier matches both with and without fractional seconds,
    // so a single parse call handles "T12:00:00" and "T12:00:00.123".
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S%.f") {
        return Ok(dt.and_utc().timestamp_millis());
    }
    // Try date-only
    if let Ok(d) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
        return Ok(d
            .and_hms_opt(0, 0, 0)
            .expect("midnight is always valid")
            .and_utc()
            .timestamp_millis());
    }
    Err(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn make_healthy_input() -> HealthInput {
        HealthInput {
            enabled: true,
            locked_out: false,
            account_expires: None,
            password_last_set: Some("2026-03-01T10:00:00Z".to_string()),
            password_expired: false,
            password_never_expires: false,
            last_logon: Some("2026-03-10T08:00:00Z".to_string()),
            when_created: Some("2026-01-01T00:00:00Z".to_string()),
        }
    }

    fn now_ms() -> i64 {
        chrono::NaiveDate::from_ymd_opt(2026, 3, 13)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis()
    }

    #[test]
    fn healthy_user_returns_no_flags() {
        let result = evaluate_health(&make_healthy_input(), now_ms());
        assert_eq!(result.level, HealthLevel::Healthy);
        assert!(result.active_flags.is_empty());
    }

    #[test]
    fn disabled_account_is_critical() {
        let input = HealthInput {
            enabled: false,
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert_eq!(result.level, HealthLevel::Critical);
        assert_eq!(result.active_flags[0].name, "Disabled");
    }

    #[test]
    fn locked_account_is_critical() {
        let input = HealthInput {
            locked_out: true,
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert_eq!(result.level, HealthLevel::Critical);
        assert_eq!(result.active_flags[0].name, "Locked");
    }

    #[test]
    fn expired_account_is_critical() {
        let input = HealthInput {
            account_expires: Some("2026-03-01T00:00:00Z".to_string()),
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert_eq!(result.level, HealthLevel::Critical);
        assert!(result.active_flags.iter().any(|f| f.name == "Expired"));
    }

    #[test]
    fn future_expiry_is_not_flagged() {
        let input = HealthInput {
            account_expires: Some("2027-01-01T00:00:00Z".to_string()),
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert!(!result.active_flags.iter().any(|f| f.name == "Expired"));
    }

    #[test]
    fn password_expired_is_critical() {
        let input = HealthInput {
            password_expired: true,
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert_eq!(result.level, HealthLevel::Critical);
        assert!(result
            .active_flags
            .iter()
            .any(|f| f.name == "PasswordExpired"));
    }

    #[test]
    fn password_never_expires_is_warning() {
        let input = HealthInput {
            password_never_expires: true,
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert_eq!(result.level, HealthLevel::Warning);
        assert!(result
            .active_flags
            .iter()
            .any(|f| f.name == "PasswordNeverExpires"));
    }

    #[test]
    fn inactive_30_days_is_warning() {
        // Last logon 35 days ago
        let input = HealthInput {
            last_logon: Some("2026-02-06T08:00:00Z".to_string()),
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert_eq!(result.level, HealthLevel::Warning);
        assert!(result
            .active_flags
            .iter()
            .any(|f| f.name == "Inactive30Days"));
    }

    #[test]
    fn inactive_90_days_is_critical() {
        // Last logon 100 days ago
        let input = HealthInput {
            last_logon: Some("2025-12-04T08:00:00Z".to_string()),
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert_eq!(result.level, HealthLevel::Critical);
        assert!(result
            .active_flags
            .iter()
            .any(|f| f.name == "Inactive90Days"));
    }

    #[test]
    fn never_logged_on_is_info() {
        let input = HealthInput {
            last_logon: None,
            when_created: Some("2026-03-01T00:00:00Z".to_string()),
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert_eq!(result.level, HealthLevel::Info);
        assert!(result
            .active_flags
            .iter()
            .any(|f| f.name == "NeverLoggedOn"));
    }

    #[test]
    fn never_logged_on_not_flagged_if_just_created() {
        // Created less than 1 day ago
        let input = HealthInput {
            last_logon: None,
            when_created: Some("2026-03-13T10:00:00Z".to_string()),
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert!(!result
            .active_flags
            .iter()
            .any(|f| f.name == "NeverLoggedOn"));
    }

    #[test]
    fn password_never_changed_is_warning() {
        let input = HealthInput {
            password_last_set: Some("2026-01-01T00:00:30Z".to_string()),
            when_created: Some("2026-01-01T00:00:00Z".to_string()),
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert!(result
            .active_flags
            .iter()
            .any(|f| f.name == "PasswordNeverChanged"));
    }

    #[test]
    fn password_changed_after_creation_not_flagged() {
        let input = HealthInput {
            password_last_set: Some("2026-02-15T10:00:00Z".to_string()),
            when_created: Some("2026-01-01T00:00:00Z".to_string()),
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert!(!result
            .active_flags
            .iter()
            .any(|f| f.name == "PasswordNeverChanged"));
    }

    #[test]
    fn multiple_flags_returns_worst_severity() {
        let input = HealthInput {
            enabled: false,
            password_never_expires: true,
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert_eq!(result.level, HealthLevel::Critical);
        assert_eq!(result.active_flags.len(), 2);
    }

    #[test]
    fn serialization_uses_camel_case() {
        let result = evaluate_health(&make_healthy_input(), now_ms());
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("activeFlags"));
    }

    #[test]
    fn parse_date_naive_datetime_without_timezone() {
        // Covers parse_date_to_ms branch: NaiveDateTime with fractional seconds
        let input = HealthInput {
            last_logon: Some("2026-02-06T08:00:00.123".to_string()),
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert!(result
            .active_flags
            .iter()
            .any(|f| f.name == "Inactive30Days"));
    }

    #[test]
    fn parse_date_naive_datetime_no_fractional() {
        // Verifies %.f format also handles timestamps without fractional seconds
        let input = HealthInput {
            last_logon: Some("2026-02-06T08:00:00".to_string()),
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert!(result
            .active_flags
            .iter()
            .any(|f| f.name == "Inactive30Days"));
    }

    #[test]
    fn parse_date_date_only_format() {
        // Covers parse_date_to_ms branch: date-only "YYYY-MM-DD"
        let input = HealthInput {
            account_expires: Some("2026-03-01".to_string()),
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert!(result.active_flags.iter().any(|f| f.name == "Expired"));
    }

    #[test]
    fn parse_date_invalid_string_is_ignored() {
        // Covers parse_date_to_ms error path: unparseable date string
        let input = HealthInput {
            account_expires: Some("not-a-date".to_string()),
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        // Invalid date should be silently ignored - no Expired flag
        assert!(!result.active_flags.iter().any(|f| f.name == "Expired"));
    }

    #[test]
    fn password_never_changed_with_date_only_format() {
        // Covers parse_date_to_ms date-only branch for password comparison
        let input = HealthInput {
            password_last_set: Some("2026-01-01".to_string()),
            when_created: Some("2026-01-01".to_string()),
            ..make_healthy_input()
        };
        let result = evaluate_health(&input, now_ms());
        assert!(result
            .active_flags
            .iter()
            .any(|f| f.name == "PasswordNeverChanged"));
    }
}
