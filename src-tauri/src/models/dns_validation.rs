use serde::{Deserialize, Serialize};

/// Status of a single DNS record validation check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DnsRecordStatus {
    Pass,
    Fail,
    Warning,
}

/// Result of validating a single DNS SRV record against known DCs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsValidationResult {
    /// The SRV record name queried (e.g., "_ldap._tcp.example.com").
    pub record_name: String,
    /// Hostnames expected to appear (known DCs).
    pub expected_hosts: Vec<String>,
    /// Hostnames actually resolved from DNS.
    pub actual_hosts: Vec<String>,
    /// Overall status of this record check.
    pub status: DnsRecordStatus,
    /// Hosts that were expected but not found in DNS.
    pub missing_hosts: Vec<String>,
    /// Hosts found in DNS that were not expected.
    pub extra_hosts: Vec<String>,
}

/// Status of a clock skew check for a single DC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClockSkewStatus {
    Ok,
    Warning,
    Critical,
}

/// Result of checking the clock skew between a DC and the local machine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockSkewResult {
    /// The DNS hostname of the domain controller.
    pub dc_hostname: String,
    /// The time reported by the DC (ISO 8601).
    pub dc_time: String,
    /// The local time when the check was performed (ISO 8601).
    pub local_time: String,
    /// The absolute difference in seconds between DC time and local time.
    pub skew_seconds: i64,
    /// Status based on the configured threshold.
    pub status: ClockSkewStatus,
}

/// Full DNS and Kerberos validation report combining DNS record checks
/// and clock skew analysis for all domain controllers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsKerberosReport {
    /// Results of DNS SRV record validation.
    pub dns_results: Vec<DnsValidationResult>,
    /// Clock skew results for each DC.
    pub clock_skew_results: Vec<ClockSkewResult>,
    /// Timestamp when the report was generated (ISO 8601).
    pub checked_at: String,
}

/// Compares expected and actual hosts, returning the validation result.
pub fn compare_dns_hosts(
    record_name: &str,
    expected: &[String],
    actual: &[String],
) -> DnsValidationResult {
    let expected_lower: Vec<String> = expected.iter().map(|h| h.to_lowercase()).collect();
    let actual_lower: Vec<String> = actual.iter().map(|h| h.to_lowercase()).collect();

    let missing: Vec<String> = expected_lower
        .iter()
        .filter(|h| !actual_lower.contains(h))
        .cloned()
        .collect();

    let extra: Vec<String> = actual_lower
        .iter()
        .filter(|h| !expected_lower.contains(h))
        .cloned()
        .collect();

    let status = if missing.is_empty() && extra.is_empty() {
        DnsRecordStatus::Pass
    } else if missing.is_empty() && !extra.is_empty() {
        DnsRecordStatus::Warning
    } else {
        DnsRecordStatus::Fail
    };

    DnsValidationResult {
        record_name: record_name.to_string(),
        expected_hosts: expected.to_vec(),
        actual_hosts: actual.to_vec(),
        status,
        missing_hosts: missing,
        extra_hosts: extra,
    }
}

/// Evaluates clock skew status based on the given threshold in seconds.
///
/// - `Ok` if skew is within half the threshold
/// - `Warning` if skew is between half and the full threshold
/// - `Critical` if skew exceeds the threshold
pub fn evaluate_clock_skew(skew_seconds: i64, threshold_seconds: u32) -> ClockSkewStatus {
    let abs_skew = skew_seconds.unsigned_abs();
    let threshold = u64::from(threshold_seconds);
    if abs_skew <= threshold / 2 {
        ClockSkewStatus::Ok
    } else if abs_skew <= threshold {
        ClockSkewStatus::Warning
    } else {
        ClockSkewStatus::Critical
    }
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // DnsValidationResult tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_compare_dns_hosts_all_match() {
        let expected = vec!["DC1.example.com".to_string(), "DC2.example.com".to_string()];
        let actual = vec!["dc1.example.com".to_string(), "dc2.example.com".to_string()];
        let result = compare_dns_hosts("_ldap._tcp.example.com", &expected, &actual);

        assert_eq!(result.status, DnsRecordStatus::Pass);
        assert!(result.missing_hosts.is_empty());
        assert!(result.extra_hosts.is_empty());
    }

    #[test]
    fn test_compare_dns_hosts_missing_dc() {
        let expected = vec!["DC1.example.com".to_string(), "DC2.example.com".to_string()];
        let actual = vec!["dc1.example.com".to_string()];
        let result = compare_dns_hosts("_ldap._tcp.example.com", &expected, &actual);

        assert_eq!(result.status, DnsRecordStatus::Fail);
        assert_eq!(result.missing_hosts, vec!["dc2.example.com"]);
        assert!(result.extra_hosts.is_empty());
    }

    #[test]
    fn test_compare_dns_hosts_extra_dc() {
        let expected = vec!["DC1.example.com".to_string()];
        let actual = vec!["dc1.example.com".to_string(), "dc3.example.com".to_string()];
        let result = compare_dns_hosts("_ldap._tcp.example.com", &expected, &actual);

        assert_eq!(result.status, DnsRecordStatus::Warning);
        assert!(result.missing_hosts.is_empty());
        assert_eq!(result.extra_hosts, vec!["dc3.example.com"]);
    }

    #[test]
    fn test_compare_dns_hosts_missing_and_extra() {
        let expected = vec!["DC1.example.com".to_string(), "DC2.example.com".to_string()];
        let actual = vec!["dc1.example.com".to_string(), "dc3.example.com".to_string()];
        let result = compare_dns_hosts("_kerberos._tcp.example.com", &expected, &actual);

        assert_eq!(result.status, DnsRecordStatus::Fail);
        assert_eq!(result.missing_hosts, vec!["dc2.example.com"]);
        assert_eq!(result.extra_hosts, vec!["dc3.example.com"]);
    }

    #[test]
    fn test_compare_dns_hosts_empty_expected() {
        let expected: Vec<String> = vec![];
        let actual = vec!["dc1.example.com".to_string()];
        let result = compare_dns_hosts("_ldap._tcp.example.com", &expected, &actual);

        assert_eq!(result.status, DnsRecordStatus::Warning);
        assert!(result.missing_hosts.is_empty());
        assert_eq!(result.extra_hosts, vec!["dc1.example.com"]);
    }

    #[test]
    fn test_compare_dns_hosts_empty_actual() {
        let expected = vec!["DC1.example.com".to_string()];
        let actual: Vec<String> = vec![];
        let result = compare_dns_hosts("_ldap._tcp.example.com", &expected, &actual);

        assert_eq!(result.status, DnsRecordStatus::Fail);
        assert_eq!(result.missing_hosts, vec!["dc1.example.com"]);
        assert!(result.extra_hosts.is_empty());
    }

    #[test]
    fn test_compare_dns_hosts_both_empty() {
        let expected: Vec<String> = vec![];
        let actual: Vec<String> = vec![];
        let result = compare_dns_hosts("_ldap._tcp.example.com", &expected, &actual);

        assert_eq!(result.status, DnsRecordStatus::Pass);
        assert!(result.missing_hosts.is_empty());
        assert!(result.extra_hosts.is_empty());
    }

    #[test]
    fn test_compare_dns_hosts_case_insensitive() {
        let expected = vec!["DC1.EXAMPLE.COM".to_string()];
        let actual = vec!["dc1.example.com".to_string()];
        let result = compare_dns_hosts("_ldap._tcp.example.com", &expected, &actual);

        assert_eq!(result.status, DnsRecordStatus::Pass);
    }

    #[test]
    fn test_dns_validation_result_record_name_preserved() {
        let result = compare_dns_hosts("_gc._tcp.example.com", &[], &[]);
        assert_eq!(result.record_name, "_gc._tcp.example.com");
    }

    // -----------------------------------------------------------------------
    // ClockSkew tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_evaluate_clock_skew_ok() {
        // Threshold 300s, half = 150s. Skew of 100s should be Ok.
        assert_eq!(evaluate_clock_skew(100, 300), ClockSkewStatus::Ok);
    }

    #[test]
    fn test_evaluate_clock_skew_ok_zero() {
        assert_eq!(evaluate_clock_skew(0, 300), ClockSkewStatus::Ok);
    }

    #[test]
    fn test_evaluate_clock_skew_ok_at_half_boundary() {
        // Exactly at half threshold (150) should be Ok.
        assert_eq!(evaluate_clock_skew(150, 300), ClockSkewStatus::Ok);
    }

    #[test]
    fn test_evaluate_clock_skew_warning() {
        // 200s skew with 300s threshold: above half (150) but within threshold.
        assert_eq!(evaluate_clock_skew(200, 300), ClockSkewStatus::Warning);
    }

    #[test]
    fn test_evaluate_clock_skew_warning_at_threshold() {
        // Exactly at threshold should be Warning.
        assert_eq!(evaluate_clock_skew(300, 300), ClockSkewStatus::Warning);
    }

    #[test]
    fn test_evaluate_clock_skew_critical() {
        // 400s skew with 300s threshold should be Critical.
        assert_eq!(evaluate_clock_skew(400, 300), ClockSkewStatus::Critical);
    }

    #[test]
    fn test_evaluate_clock_skew_negative_skew() {
        // Negative skew (DC ahead) should use absolute value.
        assert_eq!(evaluate_clock_skew(-200, 300), ClockSkewStatus::Warning);
    }

    #[test]
    fn test_evaluate_clock_skew_negative_critical() {
        assert_eq!(evaluate_clock_skew(-500, 300), ClockSkewStatus::Critical);
    }

    #[test]
    fn test_evaluate_clock_skew_small_threshold() {
        // Threshold of 10s: half = 5s
        assert_eq!(evaluate_clock_skew(3, 10), ClockSkewStatus::Ok);
        assert_eq!(evaluate_clock_skew(7, 10), ClockSkewStatus::Warning);
        assert_eq!(evaluate_clock_skew(15, 10), ClockSkewStatus::Critical);
    }

    // -----------------------------------------------------------------------
    // Serialization tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_dns_validation_result_serialization() {
        let result = DnsValidationResult {
            record_name: "_ldap._tcp.example.com".to_string(),
            expected_hosts: vec!["DC1.example.com".to_string()],
            actual_hosts: vec!["DC1.example.com".to_string()],
            status: DnsRecordStatus::Pass,
            missing_hosts: vec![],
            extra_hosts: vec![],
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("recordName"));
        assert!(json.contains("expectedHosts"));
        assert!(json.contains("actualHosts"));
        assert!(json.contains("missingHosts"));
        assert!(json.contains("extraHosts"));
        assert!(json.contains("\"Pass\""));
    }

    #[test]
    fn test_clock_skew_result_serialization() {
        let result = ClockSkewResult {
            dc_hostname: "DC1.example.com".to_string(),
            dc_time: "2026-03-21T10:00:00Z".to_string(),
            local_time: "2026-03-21T10:00:05Z".to_string(),
            skew_seconds: 5,
            status: ClockSkewStatus::Ok,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("dcHostname"));
        assert!(json.contains("dcTime"));
        assert!(json.contains("localTime"));
        assert!(json.contains("skewSeconds"));
        assert!(json.contains("\"Ok\""));
    }

    #[test]
    fn test_dns_kerberos_report_serialization() {
        let report = DnsKerberosReport {
            dns_results: vec![],
            clock_skew_results: vec![],
            checked_at: "2026-03-21T10:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&report).unwrap();
        assert!(json.contains("dnsResults"));
        assert!(json.contains("clockSkewResults"));
        assert!(json.contains("checkedAt"));
    }

    #[test]
    fn test_dns_kerberos_report_roundtrip() {
        let report = DnsKerberosReport {
            dns_results: vec![DnsValidationResult {
                record_name: "_ldap._tcp.example.com".to_string(),
                expected_hosts: vec!["DC1.example.com".to_string()],
                actual_hosts: vec!["DC1.example.com".to_string()],
                status: DnsRecordStatus::Pass,
                missing_hosts: vec![],
                extra_hosts: vec![],
            }],
            clock_skew_results: vec![ClockSkewResult {
                dc_hostname: "DC1.example.com".to_string(),
                dc_time: "2026-03-21T10:00:00Z".to_string(),
                local_time: "2026-03-21T10:00:02Z".to_string(),
                skew_seconds: 2,
                status: ClockSkewStatus::Ok,
            }],
            checked_at: "2026-03-21T10:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&report).unwrap();
        let deserialized: DnsKerberosReport = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.dns_results.len(), 1);
        assert_eq!(deserialized.clock_skew_results.len(), 1);
        assert_eq!(deserialized.checked_at, "2026-03-21T10:00:00Z");
    }

    #[test]
    fn test_dns_record_status_variants() {
        let pass_json = serde_json::to_string(&DnsRecordStatus::Pass).unwrap();
        let fail_json = serde_json::to_string(&DnsRecordStatus::Fail).unwrap();
        let warn_json = serde_json::to_string(&DnsRecordStatus::Warning).unwrap();
        assert_eq!(pass_json, "\"Pass\"");
        assert_eq!(fail_json, "\"Fail\"");
        assert_eq!(warn_json, "\"Warning\"");
    }

    #[test]
    fn test_clock_skew_status_variants() {
        let ok_json = serde_json::to_string(&ClockSkewStatus::Ok).unwrap();
        let warn_json = serde_json::to_string(&ClockSkewStatus::Warning).unwrap();
        let crit_json = serde_json::to_string(&ClockSkewStatus::Critical).unwrap();
        assert_eq!(ok_json, "\"Ok\"");
        assert_eq!(warn_json, "\"Warning\"");
        assert_eq!(crit_json, "\"Critical\"");
    }
}
