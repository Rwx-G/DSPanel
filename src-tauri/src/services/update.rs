use serde::{Deserialize, Serialize};

/// Information about an available update.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// The new version string (e.g., "1.2.0").
    pub version: String,
    /// URL to the GitHub release page.
    pub release_url: String,
    /// Release notes (markdown body from GitHub).
    pub release_notes: String,
    /// ISO-8601 publication date.
    pub published_at: String,
}

/// Result of an update check.
#[derive(Debug)]
pub enum UpdateCheckResult {
    /// A newer version is available.
    Available(UpdateInfo),
    /// The current version is up to date.
    UpToDate,
    /// The latest version was skipped by the user.
    Skipped,
    /// Update checks are disabled in settings.
    CheckDisabled,
    /// Not enough time has elapsed since the last check.
    TooSoon,
}

/// GitHub Releases API response (only the fields we need).
#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    published_at: Option<String>,
}

/// Parses a semantic version string into (major, minor, patch).
///
/// Handles formats: "1.2.3", "v1.2.3", "1.2.3-beta.1" (pre-release suffix ignored).
fn parse_semver(version: &str) -> Option<(u32, u32, u32)> {
    let cleaned = version.strip_prefix('v').unwrap_or(version);
    // Take only the part before any pre-release suffix
    let base = cleaned.split('-').next()?;
    let parts: Vec<&str> = base.split('.').collect();
    if parts.len() < 3 {
        return None;
    }
    let major = parts[0].parse().ok()?;
    let minor = parts[1].parse().ok()?;
    let patch = parts[2].parse().ok()?;
    Some((major, minor, patch))
}

/// Returns true if `remote` is strictly newer than `current`.
pub fn is_newer(current: &str, remote: &str) -> bool {
    match (parse_semver(current), parse_semver(remote)) {
        (Some(cur), Some(rem)) => rem > cur,
        _ => false,
    }
}

/// Checks the GitHub Releases API for the latest version.
///
/// Returns `None` on any error (network, parse, etc.) - fails silently.
pub async fn fetch_latest_release(client: &reqwest::Client) -> Option<UpdateInfo> {
    let url = "https://api.github.com/repos/Rwx-G/DSPanel/releases/latest";
    let response = client.get(url).send().await.ok()?;

    if !response.status().is_success() {
        return None;
    }

    let release: GitHubRelease = response.json().await.ok()?;
    let version = release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name);

    Some(UpdateInfo {
        version: version.to_string(),
        release_url: release.html_url,
        release_notes: release.body.unwrap_or_default(),
        published_at: release.published_at.unwrap_or_default(),
    })
}

/// Determines if enough time has elapsed since the last check.
///
/// `frequency`: "startup" (always), "daily", "weekly", "never"
/// `last_check`: ISO-8601 timestamp of the last successful check
pub fn should_check(frequency: &str, last_check: Option<&str>) -> bool {
    match frequency {
        "never" => false,
        "startup" | "" => true,
        "daily" | "weekly" => {
            let Some(last) = last_check else {
                return true;
            };
            let Ok(last_time) = chrono::DateTime::parse_from_rfc3339(last) else {
                return true;
            };
            let now = chrono::Utc::now();
            let elapsed = now.signed_duration_since(last_time);
            match frequency {
                "daily" => elapsed.num_hours() >= 24,
                "weekly" => elapsed.num_days() >= 7,
                _ => true,
            }
        }
        _ => true,
    }
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    // --- parse_semver tests ---

    #[test]
    fn test_parse_semver_standard() {
        assert_eq!(parse_semver("1.2.3"), Some((1, 2, 3)));
    }

    #[test]
    fn test_parse_semver_with_v_prefix() {
        assert_eq!(parse_semver("v1.2.3"), Some((1, 2, 3)));
    }

    #[test]
    fn test_parse_semver_with_prerelease() {
        assert_eq!(parse_semver("1.2.3-beta.1"), Some((1, 2, 3)));
    }

    #[test]
    fn test_parse_semver_malformed() {
        assert_eq!(parse_semver("abc"), None);
        assert_eq!(parse_semver("1.2"), None);
        assert_eq!(parse_semver(""), None);
    }

    // --- is_newer tests ---

    #[test]
    fn test_is_newer_true() {
        assert!(is_newer("1.0.0", "1.0.1"));
        assert!(is_newer("1.0.0", "1.1.0"));
        assert!(is_newer("1.0.0", "2.0.0"));
        assert!(is_newer("0.11.0", "0.12.0"));
    }

    #[test]
    fn test_is_newer_false_same() {
        assert!(!is_newer("1.0.0", "1.0.0"));
    }

    #[test]
    fn test_is_newer_false_older() {
        assert!(!is_newer("1.1.0", "1.0.0"));
        assert!(!is_newer("2.0.0", "1.9.9"));
    }

    #[test]
    fn test_is_newer_with_v_prefix() {
        assert!(is_newer("v1.0.0", "v1.0.1"));
        assert!(is_newer("1.0.0", "v1.0.1"));
    }

    #[test]
    fn test_is_newer_malformed_returns_false() {
        assert!(!is_newer("1.0.0", "abc"));
        assert!(!is_newer("abc", "1.0.0"));
    }

    #[test]
    fn test_is_newer_with_prerelease() {
        // Pre-release suffix is stripped, so 1.2.3-beta == 1.2.3
        assert!(!is_newer("1.2.3", "1.2.3-beta.1"));
        assert!(is_newer("1.2.2", "1.2.3-beta.1"));
    }

    // --- should_check tests ---

    #[test]
    fn test_should_check_never() {
        assert!(!should_check("never", None));
    }

    #[test]
    fn test_should_check_startup_always() {
        assert!(should_check("startup", None));
        assert!(should_check("startup", Some("2026-03-25T00:00:00Z")));
    }

    #[test]
    fn test_should_check_empty_frequency_is_startup() {
        assert!(should_check("", None));
    }

    #[test]
    fn test_should_check_daily_no_previous() {
        assert!(should_check("daily", None));
    }

    #[test]
    fn test_should_check_daily_recent() {
        let now = chrono::Utc::now().to_rfc3339();
        assert!(!should_check("daily", Some(&now)));
    }

    #[test]
    fn test_should_check_daily_old() {
        let old = (chrono::Utc::now() - chrono::Duration::hours(25)).to_rfc3339();
        assert!(should_check("daily", Some(&old)));
    }

    #[test]
    fn test_should_check_weekly_recent() {
        let recent = (chrono::Utc::now() - chrono::Duration::days(3)).to_rfc3339();
        assert!(!should_check("weekly", Some(&recent)));
    }

    #[test]
    fn test_should_check_weekly_old() {
        let old = (chrono::Utc::now() - chrono::Duration::days(8)).to_rfc3339();
        assert!(should_check("weekly", Some(&old)));
    }

    #[test]
    fn test_should_check_invalid_timestamp_returns_true() {
        assert!(should_check("daily", Some("not-a-date")));
    }
}
