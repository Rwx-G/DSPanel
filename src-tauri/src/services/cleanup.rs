use std::sync::Arc;

use chrono::{NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::models::DirectoryEntry;
use crate::services::directory::DirectoryProvider;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/// Condition type for matching stale accounts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CleanupCondition {
    /// Account has not logged on in X days (based on lastLogonTimestamp).
    InactiveDays,
    /// Account has never logged on AND was created more than Y days ago.
    NeverLoggedOnCreatedDays,
    /// Account has been disabled for more than Z days (UAC flag + whenChanged).
    DisabledDays,
}

/// Action to take on matching accounts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CleanupAction {
    /// Disable the account (set ACCOUNTDISABLE flag).
    Disable,
    /// Move the account to a designated cleanup OU.
    Move,
    /// Delete the account permanently.
    Delete,
}

/// A cleanup rule definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupRule {
    /// Human-readable rule name.
    pub name: String,
    /// Condition to evaluate.
    pub condition: CleanupCondition,
    /// Threshold in days for the condition.
    pub threshold_days: u32,
    /// Action to take on matching accounts.
    pub action: CleanupAction,
    /// Target OU for Move action (required when action = Move).
    pub target_ou: Option<String>,
    /// SAM account name patterns to exclude (e.g., "svc_*", "admin*"). Case-insensitive glob matching.
    #[serde(default)]
    pub exclude_patterns: Option<Vec<String>>,
    /// OUs to exclude - any account whose DN contains one of these is skipped.
    #[serde(default)]
    pub exclude_ous: Option<Vec<String>>,
}

/// A single match from dry-run evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupMatch {
    /// DN of the matched object.
    pub dn: String,
    /// Display name or sAMAccountName.
    pub display_name: String,
    /// sAMAccountName.
    pub sam_account_name: String,
    /// Current state description (e.g., "Inactive 200 days").
    pub current_state: String,
    /// Proposed action description.
    pub proposed_action: String,
    /// The action type for this match.
    pub action: CleanupAction,
    /// Target OU (for Move actions).
    pub target_ou: Option<String>,
    /// Whether this match is selected for execution (default true).
    pub selected: bool,
}

/// Result of executing a cleanup action on a single object.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupExecutionResult {
    pub dn: String,
    pub display_name: String,
    pub action: CleanupAction,
    pub success: bool,
    pub error: Option<String>,
}

/// Full dry-run result for a cleanup rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupDryRunResult {
    pub rule_name: String,
    pub matches: Vec<CleanupMatch>,
    pub total_count: usize,
}

// ---------------------------------------------------------------------------
// Built-in account exclusion
// ---------------------------------------------------------------------------

/// Well-known accounts that must never be cleaned up.
const PROTECTED_SAMS: &[&str] = &["administrator", "guest", "krbtgt", "defaultaccount"];

fn is_protected(entry: &DirectoryEntry) -> bool {
    let sam = entry
        .sam_account_name
        .as_deref()
        .unwrap_or("")
        .to_lowercase();
    PROTECTED_SAMS.contains(&sam.as_str())
}

/// Checks if an entry should be excluded based on rule exclusion patterns.
fn is_excluded(entry: &DirectoryEntry, rule: &CleanupRule) -> bool {
    let sam = entry
        .sam_account_name
        .as_deref()
        .unwrap_or("")
        .to_lowercase();
    let dn = entry.distinguished_name.to_lowercase();

    // Check SAM name patterns (glob: * matches any chars)
    if let Some(patterns) = &rule.exclude_patterns {
        for pattern in patterns {
            let p = pattern.to_lowercase();
            if glob_match(&p, &sam) {
                return true;
            }
        }
    }

    // Check OU exclusions (DN contains the OU string)
    if let Some(ous) = &rule.exclude_ous {
        for ou in ous {
            if dn.contains(&ou.to_lowercase()) {
                return true;
            }
        }
    }

    false
}

/// Simple glob matching: * matches any sequence of characters.
fn glob_match(pattern: &str, text: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if !pattern.contains('*') {
        return pattern == text;
    }
    let parts: Vec<&str> = pattern.split('*').collect();
    let mut pos = 0;
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        if let Some(found) = text[pos..].find(part) {
            if i == 0 && found != 0 {
                return false; // First part must match at start
            }
            pos += found + part.len();
        } else {
            return false;
        }
    }
    // If pattern ends with *, any trailing text is fine
    if !pattern.ends_with('*') {
        return pos == text.len();
    }
    true
}

// ---------------------------------------------------------------------------
// Rule evaluation (dry-run)
// ---------------------------------------------------------------------------

/// Evaluates a cleanup rule against all user accounts and returns matches.
/// This is the dry-run - no modifications are made.
pub async fn evaluate_rule(
    provider: Arc<dyn DirectoryProvider>,
    rule: &CleanupRule,
) -> Result<CleanupDryRunResult, AppError> {
    // Fetch all users (up to 10000)
    let users = provider
        .browse_users(10000)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to browse users: {e}")))?;

    let now = Utc::now();
    let threshold_secs = i64::from(rule.threshold_days) * 86400;

    let mut matches = Vec::new();

    for user in &users {
        if is_protected(user) || is_excluded(user, rule) {
            continue;
        }

        let matched = match rule.condition {
            CleanupCondition::InactiveDays => evaluate_inactive_days(user, threshold_secs, now),
            CleanupCondition::NeverLoggedOnCreatedDays => {
                evaluate_never_logged_on(user, threshold_secs, now)
            }
            CleanupCondition::DisabledDays => evaluate_disabled_days(user, threshold_secs, now),
        };

        if let Some(state_desc) = matched {
            let display = user
                .display_name
                .as_deref()
                .or(user.sam_account_name.as_deref())
                .unwrap_or("Unknown")
                .to_string();
            let sam = user.sam_account_name.as_deref().unwrap_or("").to_string();

            let proposed = match &rule.action {
                CleanupAction::Disable => "Disable account".to_string(),
                CleanupAction::Move => format!(
                    "Move to {}",
                    rule.target_ou.as_deref().unwrap_or("(not set)")
                ),
                CleanupAction::Delete => "Delete account".to_string(),
            };

            matches.push(CleanupMatch {
                dn: user.distinguished_name.clone(),
                display_name: display,
                sam_account_name: sam,
                current_state: state_desc,
                proposed_action: proposed,
                action: rule.action.clone(),
                target_ou: rule.target_ou.clone(),
                selected: true,
            });
        }
    }

    let total = matches.len();
    Ok(CleanupDryRunResult {
        rule_name: rule.name.clone(),
        matches,
        total_count: total,
    })
}

/// Checks if the account's lastLogonTimestamp exceeds the threshold.
fn evaluate_inactive_days(
    entry: &DirectoryEntry,
    threshold_secs: i64,
    now: chrono::DateTime<Utc>,
) -> Option<String> {
    let last_logon_str = entry.get_attribute("lastLogonTimestamp")?;
    let last_logon_ts = parse_ad_timestamp(last_logon_str)?;
    let age_secs = (now - last_logon_ts).num_seconds();
    if age_secs > threshold_secs {
        let days = age_secs / 86400;
        Some(format!("Inactive {days} days"))
    } else {
        None
    }
}

/// Checks if the account has never logged on and was created more than threshold days ago.
fn evaluate_never_logged_on(
    entry: &DirectoryEntry,
    threshold_secs: i64,
    now: chrono::DateTime<Utc>,
) -> Option<String> {
    // Never logged on: lastLogonTimestamp is missing or zero
    let last_logon = entry.get_attribute("lastLogonTimestamp");
    let never_logged = match last_logon {
        None => true,
        Some("0") => true,
        Some(s) => s.trim().is_empty(),
    };

    if !never_logged {
        return None;
    }

    // Check creation date
    let when_created_str = entry.get_attribute("whenCreated")?;
    let created_ts = parse_ad_generalized_time(when_created_str)?;
    let age_secs = (now - created_ts).num_seconds();
    if age_secs > threshold_secs {
        let days = age_secs / 86400;
        Some(format!("Never logged on, created {days} days ago"))
    } else {
        None
    }
}

/// Checks if the account is disabled and has been disabled for more than threshold days.
fn evaluate_disabled_days(
    entry: &DirectoryEntry,
    threshold_secs: i64,
    now: chrono::DateTime<Utc>,
) -> Option<String> {
    let uac_str = entry.get_attribute("userAccountControl")?;
    let uac: u32 = uac_str.parse().ok()?;

    // Check ACCOUNTDISABLE flag (0x2)
    if uac & 0x0002 == 0 {
        return None; // Not disabled
    }

    // Use whenChanged as proxy for when it was disabled
    let when_changed_str = entry.get_attribute("whenChanged")?;
    let changed_ts = parse_ad_generalized_time(when_changed_str)?;
    let age_secs = (now - changed_ts).num_seconds();
    if age_secs > threshold_secs {
        let days = age_secs / 86400;
        Some(format!("Disabled for {days} days"))
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

/// Executes cleanup actions on the selected matches.
/// Each action is logged via the AuditService.
pub async fn execute_cleanup(
    provider: Arc<dyn DirectoryProvider>,
    audit: &crate::services::audit::AuditService,
    matches: &[CleanupMatch],
) -> Vec<CleanupExecutionResult> {
    let mut results = Vec::new();

    for m in matches {
        if !m.selected {
            continue;
        }

        let result = match &m.action {
            CleanupAction::Disable => match provider.disable_account(&m.dn).await {
                Ok(()) => {
                    audit.log_success(
                        "CleanupDisable",
                        &m.dn,
                        &format!("Disabled by cleanup rule: {}", m.current_state),
                    );
                    CleanupExecutionResult {
                        dn: m.dn.clone(),
                        display_name: m.display_name.clone(),
                        action: CleanupAction::Disable,
                        success: true,
                        error: None,
                    }
                }
                Err(e) => {
                    audit.log_failure("CleanupDisableFailed", &m.dn, &e.to_string());
                    CleanupExecutionResult {
                        dn: m.dn.clone(),
                        display_name: m.display_name.clone(),
                        action: CleanupAction::Disable,
                        success: false,
                        error: Some(e.to_string()),
                    }
                }
            },
            CleanupAction::Move => {
                let target = m.target_ou.as_deref().unwrap_or("");
                if target.is_empty() {
                    audit.log_failure("CleanupMoveFailed", &m.dn, "Target OU not configured");
                    CleanupExecutionResult {
                        dn: m.dn.clone(),
                        display_name: m.display_name.clone(),
                        action: CleanupAction::Move,
                        success: false,
                        error: Some("Target OU not configured".to_string()),
                    }
                } else {
                    match provider.move_object(&m.dn, target).await {
                        Ok(()) => {
                            audit.log_success(
                                "CleanupMove",
                                &m.dn,
                                &format!("Moved to {target} by cleanup rule"),
                            );
                            CleanupExecutionResult {
                                dn: m.dn.clone(),
                                display_name: m.display_name.clone(),
                                action: CleanupAction::Move,
                                success: true,
                                error: None,
                            }
                        }
                        Err(e) => {
                            audit.log_failure("CleanupMoveFailed", &m.dn, &e.to_string());
                            CleanupExecutionResult {
                                dn: m.dn.clone(),
                                display_name: m.display_name.clone(),
                                action: CleanupAction::Move,
                                success: false,
                                error: Some(e.to_string()),
                            }
                        }
                    }
                }
            }
            CleanupAction::Delete => match provider.delete_object(&m.dn).await {
                Ok(()) => {
                    audit.log_success(
                        "CleanupDelete",
                        &m.dn,
                        &format!("Deleted by cleanup rule: {}", m.current_state),
                    );
                    CleanupExecutionResult {
                        dn: m.dn.clone(),
                        display_name: m.display_name.clone(),
                        action: CleanupAction::Delete,
                        success: true,
                        error: None,
                    }
                }
                Err(e) => {
                    audit.log_failure("CleanupDeleteFailed", &m.dn, &e.to_string());
                    CleanupExecutionResult {
                        dn: m.dn.clone(),
                        display_name: m.display_name.clone(),
                        action: CleanupAction::Delete,
                        success: false,
                        error: Some(e.to_string()),
                    }
                }
            },
        };

        results.push(result);
    }

    results
}

// ---------------------------------------------------------------------------
// AD timestamp parsing helpers
// ---------------------------------------------------------------------------

/// Parses an AD Windows FileTime (100ns intervals since 1601-01-01) to UTC DateTime.
fn parse_ad_timestamp(value: &str) -> Option<chrono::DateTime<Utc>> {
    let ticks: i64 = value.parse().ok()?;
    if ticks <= 0 {
        return None;
    }
    // Windows FileTime epoch: 1601-01-01 00:00:00 UTC
    // Unix epoch offset: 11644473600 seconds
    let unix_secs = ticks / 10_000_000 - 11_644_473_600;
    chrono::DateTime::from_timestamp(unix_secs, 0)
}

/// Parses AD GeneralizedTime format (e.g., "20240315143022.0Z") to UTC DateTime.
fn parse_ad_generalized_time(value: &str) -> Option<chrono::DateTime<Utc>> {
    // Try "yyyyMMddHHmmss.fZ" format first
    let clean = value.replace(".0Z", "").replace("Z", "");
    let naive = NaiveDateTime::parse_from_str(&clean, "%Y%m%d%H%M%S").ok()?;
    Some(naive.and_utc())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    fn make_user(dn: &str, sam: &str, display: &str, attrs: Vec<(&str, &str)>) -> DirectoryEntry {
        let mut entry = DirectoryEntry::new(dn.to_string());
        entry.sam_account_name = Some(sam.to_string());
        entry.display_name = Some(display.to_string());
        entry.object_class = Some("user".to_string());
        for (k, v) in attrs {
            entry.attributes.insert(k.to_string(), vec![v.to_string()]);
        }
        entry
    }

    // -- Protected account tests --

    #[test]
    fn protected_accounts_are_excluded() {
        let admin = make_user(
            "CN=Administrator,DC=test,DC=com",
            "Administrator",
            "Administrator",
            vec![],
        );
        assert!(is_protected(&admin));

        let krbtgt = make_user("CN=krbtgt,DC=test,DC=com", "krbtgt", "krbtgt", vec![]);
        assert!(is_protected(&krbtgt));

        let guest = make_user("CN=Guest,DC=test,DC=com", "Guest", "Guest", vec![]);
        assert!(is_protected(&guest));
    }

    #[test]
    fn normal_account_not_protected() {
        let user = make_user(
            "CN=John,OU=Users,DC=test,DC=com",
            "john",
            "John Doe",
            vec![],
        );
        assert!(!is_protected(&user));
    }

    // -- Timestamp parsing tests --

    #[test]
    fn parse_ad_timestamp_valid() {
        // 2024-01-15 00:00:00 UTC in AD ticks = (2024-01-15 unix_ts + epoch_offset) * 10M
        // unix_ts for 2024-01-15 = 1705276800
        let ticks = (1_705_276_800i64 + 11_644_473_600) * 10_000_000;
        let ts = parse_ad_timestamp(&ticks.to_string());
        assert!(ts.is_some());
        let dt = ts.unwrap();
        assert_eq!(dt.format("%Y-%m-%d").to_string(), "2024-01-15");
    }

    #[test]
    fn parse_ad_timestamp_zero() {
        assert!(parse_ad_timestamp("0").is_none());
    }

    #[test]
    fn parse_ad_timestamp_invalid() {
        assert!(parse_ad_timestamp("not_a_number").is_none());
    }

    #[test]
    fn parse_ad_generalized_time_valid() {
        let ts = parse_ad_generalized_time("20240315143022.0Z");
        assert!(ts.is_some());
        let dt = ts.unwrap();
        assert_eq!(
            dt.format("%Y-%m-%d %H:%M:%S").to_string(),
            "2024-03-15 14:30:22"
        );
    }

    #[test]
    fn parse_ad_generalized_time_invalid() {
        assert!(parse_ad_generalized_time("not_a_date").is_none());
    }

    // -- Rule evaluation tests --

    #[test]
    fn inactive_days_matches_old_logon() {
        let now = Utc::now();
        // lastLogonTimestamp = 200 days ago
        let days_ago = now - chrono::Duration::days(200);
        let ticks = (days_ago.timestamp() + 11_644_473_600) * 10_000_000;

        let user = make_user(
            "CN=Old,DC=test,DC=com",
            "old",
            "Old User",
            vec![("lastLogonTimestamp", &ticks.to_string())],
        );

        let result = evaluate_inactive_days(&user, 180 * 86400, now);
        assert!(result.is_some());
        assert!(result.unwrap().contains("Inactive"));
    }

    #[test]
    fn inactive_days_skips_recent_logon() {
        let now = Utc::now();
        let days_ago = now - chrono::Duration::days(10);
        let ticks = (days_ago.timestamp() + 11_644_473_600) * 10_000_000;

        let user = make_user(
            "CN=Active,DC=test,DC=com",
            "active",
            "Active User",
            vec![("lastLogonTimestamp", &ticks.to_string())],
        );

        let result = evaluate_inactive_days(&user, 180 * 86400, now);
        assert!(result.is_none());
    }

    #[test]
    fn never_logged_on_matches() {
        let now = Utc::now();
        let created = now - chrono::Duration::days(100);
        let when_created = created.format("%Y%m%d%H%M%S.0Z").to_string();

        let user = make_user(
            "CN=Ghost,DC=test,DC=com",
            "ghost",
            "Ghost User",
            vec![("whenCreated", &when_created)],
        );

        let result = evaluate_never_logged_on(&user, 90 * 86400, now);
        assert!(result.is_some());
        assert!(result.unwrap().contains("Never logged on"));
    }

    #[test]
    fn never_logged_on_skips_if_recently_created() {
        let now = Utc::now();
        let created = now - chrono::Duration::days(5);
        let when_created = created.format("%Y%m%d%H%M%S.0Z").to_string();

        let user = make_user(
            "CN=New,DC=test,DC=com",
            "new",
            "New User",
            vec![("whenCreated", &when_created)],
        );

        let result = evaluate_never_logged_on(&user, 90 * 86400, now);
        assert!(result.is_none());
    }

    #[test]
    fn disabled_days_matches() {
        let now = Utc::now();
        let changed = now - chrono::Duration::days(100);
        let when_changed = changed.format("%Y%m%d%H%M%S.0Z").to_string();

        let user = make_user(
            "CN=Disabled,DC=test,DC=com",
            "disabled",
            "Disabled User",
            vec![
                ("userAccountControl", "514"), // 512 (normal) | 2 (disabled) = 514
                ("whenChanged", &when_changed),
            ],
        );

        let result = evaluate_disabled_days(&user, 90 * 86400, now);
        assert!(result.is_some());
        assert!(result.unwrap().contains("Disabled for"));
    }

    #[test]
    fn disabled_days_skips_enabled_account() {
        let now = Utc::now();
        let when_changed = now.format("%Y%m%d%H%M%S.0Z").to_string();

        let user = make_user(
            "CN=Enabled,DC=test,DC=com",
            "enabled",
            "Enabled User",
            vec![
                ("userAccountControl", "512"), // Normal, enabled
                ("whenChanged", &when_changed),
            ],
        );

        let result = evaluate_disabled_days(&user, 90 * 86400, now);
        assert!(result.is_none());
    }

    // -- CleanupRule model tests --

    #[test]
    fn cleanup_rule_serde_roundtrip() {
        let rule = CleanupRule {
            name: "Disable inactive 180 days".to_string(),
            condition: CleanupCondition::InactiveDays,
            threshold_days: 180,
            action: CleanupAction::Disable,
            target_ou: None,
            exclude_patterns: Some(vec!["svc_*".to_string()]),
            exclude_ous: None,
        };

        let json = serde_json::to_string(&rule).unwrap();
        let loaded: CleanupRule = serde_json::from_str(&json).unwrap();
        assert_eq!(loaded.name, "Disable inactive 180 days");
        assert_eq!(loaded.condition, CleanupCondition::InactiveDays);
        assert_eq!(loaded.threshold_days, 180);
        assert_eq!(loaded.action, CleanupAction::Disable);
    }

    #[test]
    fn cleanup_match_serde() {
        let m = CleanupMatch {
            dn: "CN=Test,DC=com".to_string(),
            display_name: "Test".to_string(),
            sam_account_name: "test".to_string(),
            current_state: "Inactive 200 days".to_string(),
            proposed_action: "Disable account".to_string(),
            action: CleanupAction::Disable,
            target_ou: None,
            selected: true,
        };

        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains("\"selected\":true"));
        let loaded: CleanupMatch = serde_json::from_str(&json).unwrap();
        assert_eq!(loaded.dn, "CN=Test,DC=com");
    }

    // -- Glob matching tests --

    #[test]
    fn glob_match_exact() {
        assert!(glob_match("admin", "admin"));
        assert!(!glob_match("admin", "administrator"));
    }

    #[test]
    fn glob_match_wildcard_suffix() {
        assert!(glob_match("svc_*", "svc_sql"));
        assert!(glob_match("svc_*", "svc_"));
        assert!(!glob_match("svc_*", "admin"));
    }

    #[test]
    fn glob_match_wildcard_prefix() {
        assert!(glob_match("*admin", "domainadmin"));
        assert!(glob_match("*admin", "admin"));
        assert!(!glob_match("*admin", "administrator"));
    }

    #[test]
    fn glob_match_wildcard_middle() {
        assert!(glob_match("svc_*_prod", "svc_sql_prod"));
        assert!(!glob_match("svc_*_prod", "svc_sql_dev"));
    }

    #[test]
    fn glob_match_star_only() {
        assert!(glob_match("*", "anything"));
    }

    // -- Exclusion tests --

    #[test]
    fn exclude_by_sam_pattern() {
        let rule = CleanupRule {
            name: "test".to_string(),
            condition: CleanupCondition::InactiveDays,
            threshold_days: 90,
            action: CleanupAction::Disable,
            target_ou: None,
            exclude_patterns: Some(vec!["svc_*".to_string()]),
            exclude_ous: None,
        };
        let svc = make_user("CN=svc_sql,DC=test", "svc_sql", "SQL Service", vec![]);
        assert!(is_excluded(&svc, &rule));

        let normal = make_user("CN=john,DC=test", "john", "John", vec![]);
        assert!(!is_excluded(&normal, &rule));
    }

    #[test]
    fn exclude_by_ou() {
        let rule = CleanupRule {
            name: "test".to_string(),
            condition: CleanupCondition::InactiveDays,
            threshold_days: 90,
            action: CleanupAction::Disable,
            target_ou: None,
            exclude_patterns: None,
            exclude_ous: Some(vec!["OU=ServiceAccounts".to_string()]),
        };
        let svc = make_user(
            "CN=svc_sql,OU=ServiceAccounts,DC=test,DC=com",
            "svc_sql",
            "SQL Service",
            vec![],
        );
        assert!(is_excluded(&svc, &rule));

        let normal = make_user("CN=john,OU=Users,DC=test,DC=com", "john", "John", vec![]);
        assert!(!is_excluded(&normal, &rule));
    }

    #[test]
    fn exclude_is_case_insensitive() {
        let rule = CleanupRule {
            name: "test".to_string(),
            condition: CleanupCondition::InactiveDays,
            threshold_days: 90,
            action: CleanupAction::Disable,
            target_ou: None,
            exclude_patterns: Some(vec!["SVC_*".to_string()]),
            exclude_ous: None,
        };
        let svc = make_user("CN=svc_SQL,DC=test", "svc_SQL", "SQL", vec![]);
        assert!(is_excluded(&svc, &rule));
    }
}
