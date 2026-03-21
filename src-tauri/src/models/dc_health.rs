use serde::{Deserialize, Serialize};

/// Information about a domain controller discovered from AD Sites and Services.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainControllerInfo {
    /// The DNS hostname of the DC (from dNSHostName attribute).
    pub hostname: String,
    /// The site this DC belongs to.
    pub site_name: String,
    /// Whether this DC is a Global Catalog server.
    pub is_global_catalog: bool,
    /// The distinguished name of the server object.
    pub server_dn: String,
}

/// The overall health status level for a DC.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum DcHealthLevel {
    Healthy,
    Warning,
    Critical,
    Unknown,
}

/// Result of a single health check on a DC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DcHealthCheck {
    /// Name of the check (e.g., "DNS", "LDAP", "Services").
    pub name: String,
    /// Status of this check.
    pub status: DcHealthLevel,
    /// Human-readable message with details.
    pub message: String,
    /// Optional raw value (e.g., response time in ms, free disk %).
    pub value: Option<String>,
}

/// Full health status for a single domain controller.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DcHealthResult {
    /// The DC information.
    pub dc: DomainControllerInfo,
    /// Overall health level (worst of all checks).
    pub overall_status: DcHealthLevel,
    /// Individual check results.
    pub checks: Vec<DcHealthCheck>,
    /// Timestamp of when these checks were performed (ISO 8601).
    pub checked_at: String,
}

/// Computes the overall health level from a set of individual checks.
pub fn compute_overall_status(checks: &[DcHealthCheck]) -> DcHealthLevel {
    checks
        .iter()
        .map(|c| &c.status)
        .max()
        .cloned()
        .unwrap_or(DcHealthLevel::Unknown)
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_overall_status_all_healthy() {
        let checks = vec![
            DcHealthCheck {
                name: "DNS".to_string(),
                status: DcHealthLevel::Healthy,
                message: "OK".to_string(),
                value: None,
            },
            DcHealthCheck {
                name: "LDAP".to_string(),
                status: DcHealthLevel::Healthy,
                message: "OK".to_string(),
                value: None,
            },
        ];
        assert_eq!(compute_overall_status(&checks), DcHealthLevel::Healthy);
    }

    #[test]
    fn test_compute_overall_status_mixed() {
        let checks = vec![
            DcHealthCheck {
                name: "DNS".to_string(),
                status: DcHealthLevel::Healthy,
                message: "OK".to_string(),
                value: None,
            },
            DcHealthCheck {
                name: "Disk".to_string(),
                status: DcHealthLevel::Warning,
                message: "Low".to_string(),
                value: Some("15%".to_string()),
            },
        ];
        assert_eq!(compute_overall_status(&checks), DcHealthLevel::Warning);
    }

    #[test]
    fn test_compute_overall_status_critical() {
        let checks = vec![
            DcHealthCheck {
                name: "DNS".to_string(),
                status: DcHealthLevel::Healthy,
                message: "OK".to_string(),
                value: None,
            },
            DcHealthCheck {
                name: "LDAP".to_string(),
                status: DcHealthLevel::Critical,
                message: "Unreachable".to_string(),
                value: None,
            },
            DcHealthCheck {
                name: "Disk".to_string(),
                status: DcHealthLevel::Warning,
                message: "Low".to_string(),
                value: None,
            },
        ];
        assert_eq!(compute_overall_status(&checks), DcHealthLevel::Critical);
    }

    #[test]
    fn test_compute_overall_status_empty() {
        assert_eq!(compute_overall_status(&[]), DcHealthLevel::Unknown);
    }

    #[test]
    fn test_dc_health_result_serialization() {
        let result = DcHealthResult {
            dc: DomainControllerInfo {
                hostname: "DC1.example.com".to_string(),
                site_name: "Default-First-Site".to_string(),
                is_global_catalog: true,
                server_dn: "CN=DC1,CN=Servers,CN=Default-First-Site,CN=Sites,CN=Configuration,DC=example,DC=com".to_string(),
            },
            overall_status: DcHealthLevel::Healthy,
            checks: vec![DcHealthCheck {
                name: "DNS".to_string(),
                status: DcHealthLevel::Healthy,
                message: "Resolved to 10.0.0.1".to_string(),
                value: None,
            }],
            checked_at: "2026-03-21T10:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("overallStatus"));
        assert!(json.contains("checkedAt"));
        assert!(json.contains("siteName"));
        assert!(json.contains("isGlobalCatalog"));
    }

    #[test]
    fn test_dc_health_level_ordering() {
        assert!(DcHealthLevel::Critical > DcHealthLevel::Warning);
        assert!(DcHealthLevel::Warning > DcHealthLevel::Healthy);
        assert!(DcHealthLevel::Unknown > DcHealthLevel::Critical);
    }
}
