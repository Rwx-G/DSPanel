use std::net::IpAddr;
use std::sync::Arc;

use anyhow::Result;
use hickory_resolver::config::{NameServerConfigGroup, ResolverConfig, ResolverOpts};
use hickory_resolver::TokioResolver;

use crate::models::dns_validation::{
    compare_dns_hosts, evaluate_clock_skew, ClockSkewResult, ClockSkewStatus, DnsKerberosReport,
    DnsValidationResult,
};
use crate::services::dc_health::{discover_domain_controllers, resolve_fallback_ip};
use crate::services::DirectoryProvider;

/// SRV record prefixes to validate for AD DNS.
const SRV_RECORD_PREFIXES: &[&str] = &["_ldap._tcp", "_kerberos._tcp", "_gc._tcp", "_kpasswd._tcp"];

/// Default Kerberos clock skew threshold in seconds.
pub const DEFAULT_THRESHOLD_SECONDS: u32 = 300;

/// Extracts the DNS domain name from a base DN.
///
/// Converts "DC=example,DC=com" to "example.com".
fn base_dn_to_domain(base_dn: &str) -> String {
    base_dn
        .split(',')
        .filter_map(|part| {
            let trimmed = part.trim();
            trimmed
                .strip_prefix("DC=")
                .or_else(|| trimmed.strip_prefix("dc="))
        })
        .collect::<Vec<&str>>()
        .join(".")
}

/// Creates a DNS resolver targeting the AD DC's DNS server.
///
/// Uses the LDAP server IP (from `DSPANEL_LDAP_SERVER`) as the DNS server.
/// Falls back to the system resolver if no LDAP server is configured.
fn create_ad_resolver() -> TokioResolver {
    if let Some(dc_ip_str) = resolve_fallback_ip() {
        if let Ok(ip) = dc_ip_str.parse::<IpAddr>() {
            let ns_group = NameServerConfigGroup::from_ips_clear(&[ip], 53, true);
            let config = ResolverConfig::from_parts(None, vec![], ns_group);
            let mut opts = ResolverOpts::default();
            opts.timeout = std::time::Duration::from_secs(5);
            opts.attempts = 2;
            tracing::info!(dns_server = %ip, "Using AD DC as DNS server for SRV lookups");
            return TokioResolver::builder_with_config(config, Default::default())
                .with_options(opts)
                .build();
        }
    }

    tracing::info!("No LDAP server configured, using system DNS resolver");
    TokioResolver::builder_tokio()
        .map(|b| b.build())
        .unwrap_or_else(|_| {
            TokioResolver::builder_with_config(ResolverConfig::default(), Default::default())
                .build()
        })
}

/// Resolves a DNS SRV record and returns the target hostnames.
///
/// Queries the AD DC's DNS server directly (via `hickory-resolver`)
/// for proper SRV record resolution, even when the client machine
/// does not use AD DNS as its system resolver.
async fn resolve_srv_hosts(srv_name: &str, resolver: &TokioResolver) -> Vec<String> {
    // Append trailing dot for FQDN
    let fqdn = if srv_name.ends_with('.') {
        srv_name.to_string()
    } else {
        format!("{}.", srv_name)
    };

    match resolver.srv_lookup(&fqdn).await {
        Ok(lookup) => {
            let mut hosts: Vec<String> = lookup
                .iter()
                .map(|srv| {
                    let target = srv.target().to_string();
                    // Remove trailing dot from FQDN
                    target.trim_end_matches('.').to_lowercase()
                })
                .collect();
            hosts.sort();
            hosts.dedup();
            hosts
        }
        Err(e) => {
            tracing::warn!(record = %srv_name, error = %e, "DNS SRV lookup failed");
            Vec::new()
        }
    }
}

/// Validates DNS SRV records for the domain against known DCs.
///
/// Queries `_ldap._tcp`, `_kerberos._tcp`, `_gc._tcp`, and `_kpasswd._tcp`
/// SRV records and compares the results against hostnames from the directory.
pub async fn validate_dns_records(
    provider: &dyn DirectoryProvider,
) -> Result<Vec<DnsValidationResult>> {
    let base_dn = provider
        .base_dn()
        .ok_or_else(|| anyhow::anyhow!("Not connected - no base DN"))?;

    let domain = base_dn_to_domain(&base_dn);
    let dcs = discover_domain_controllers(provider).await?;
    let expected_hosts: Vec<String> = dcs.iter().map(|dc| dc.hostname.clone()).collect();

    let resolver = create_ad_resolver();

    let mut results = Vec::new();
    for prefix in SRV_RECORD_PREFIXES {
        let record_name = format!("{}.{}", prefix, domain);
        let actual_hosts = resolve_srv_hosts(&record_name, &resolver).await;
        let result = compare_dns_hosts(&record_name, &expected_hosts, &actual_hosts);
        results.push(result);
    }

    Ok(results)
}

/// Parses an AD `currentTime` attribute value into a `chrono::DateTime<Utc>`.
///
/// AD returns currentTime in generalized time format: "20260321100000.0Z"
fn parse_ad_time(value: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    // AD generalized time: "20260321100000.0Z" or "20260321100000Z"
    let cleaned = value.replace(".0Z", "Z");
    chrono::NaiveDateTime::parse_from_str(cleaned.trim_end_matches('Z'), "%Y%m%d%H%M%S")
        .ok()
        .map(|naive| naive.and_utc())
}

/// Checks clock skew between each DC and the local machine.
///
/// Reads the `currentTime` attribute from each DC's RootDSE via
/// `search_configuration` and computes the time difference.
pub async fn check_clock_skew(
    provider: &dyn DirectoryProvider,
    threshold_seconds: u32,
) -> Result<Vec<ClockSkewResult>> {
    let dcs = discover_domain_controllers(provider).await?;
    let mut results = Vec::new();

    for dc in &dcs {
        // Read RootDSE (Base scope on empty DN) for currentTime
        let rootdse = provider.read_entry("").await;

        let local_now = chrono::Utc::now();

        match rootdse {
            Ok(entry_opt) => {
                let current_time_str = entry_opt
                    .as_ref()
                    .and_then(|e| e.get_attribute("currentTime").map(|s| s.to_string()));

                match current_time_str {
                    Some(dc_time_str) => {
                        let dc_time = parse_ad_time(&dc_time_str);
                        match dc_time {
                            Some(dc_dt) => {
                                let skew = (dc_dt - local_now).num_seconds();
                                let status = evaluate_clock_skew(skew, threshold_seconds);
                                results.push(ClockSkewResult {
                                    dc_hostname: dc.hostname.clone(),
                                    dc_time: dc_dt.to_rfc3339(),
                                    local_time: local_now.to_rfc3339(),
                                    skew_seconds: skew,
                                    status,
                                });
                            }
                            None => {
                                tracing::warn!(
                                    dc = %dc.hostname,
                                    raw_time = %dc_time_str,
                                    "Failed to parse DC currentTime"
                                );
                                results.push(ClockSkewResult {
                                    dc_hostname: dc.hostname.clone(),
                                    dc_time: dc_time_str,
                                    local_time: local_now.to_rfc3339(),
                                    skew_seconds: 0,
                                    status: ClockSkewStatus::Critical,
                                });
                            }
                        }
                    }
                    None => {
                        tracing::warn!(
                            dc = %dc.hostname,
                            "No currentTime attribute found in RootDSE"
                        );
                        results.push(ClockSkewResult {
                            dc_hostname: dc.hostname.clone(),
                            dc_time: "N/A".to_string(),
                            local_time: local_now.to_rfc3339(),
                            skew_seconds: 0,
                            status: ClockSkewStatus::Critical,
                        });
                    }
                }
            }
            Err(e) => {
                tracing::warn!(
                    dc = %dc.hostname,
                    error = %e,
                    "Failed to query RootDSE for clock skew"
                );
                results.push(ClockSkewResult {
                    dc_hostname: dc.hostname.clone(),
                    dc_time: "N/A".to_string(),
                    local_time: local_now.to_rfc3339(),
                    skew_seconds: 0,
                    status: ClockSkewStatus::Critical,
                });
            }
        }
    }

    Ok(results)
}

/// Runs a full DNS and Kerberos validation, combining SRV record checks
/// and clock skew analysis into a single report.
pub async fn run_full_validation(
    provider: Arc<dyn DirectoryProvider>,
    threshold_seconds: u32,
) -> Result<DnsKerberosReport> {
    let dns_results = validate_dns_records(&*provider).await?;
    let clock_skew_results = check_clock_skew(&*provider, threshold_seconds).await?;
    let checked_at = chrono::Utc::now().to_rfc3339();

    Ok(DnsKerberosReport {
        dns_results,
        clock_skew_results,
        checked_at,
    })
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // base_dn_to_domain tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_base_dn_to_domain_standard() {
        assert_eq!(base_dn_to_domain("DC=example,DC=com"), "example.com");
    }

    #[test]
    fn test_base_dn_to_domain_multi_level() {
        assert_eq!(
            base_dn_to_domain("DC=corp,DC=example,DC=com"),
            "corp.example.com"
        );
    }

    #[test]
    fn test_base_dn_to_domain_lowercase() {
        assert_eq!(base_dn_to_domain("dc=test,dc=local"), "test.local");
    }

    #[test]
    fn test_base_dn_to_domain_with_spaces() {
        assert_eq!(base_dn_to_domain("DC=example, DC=com"), "example.com");
    }

    #[test]
    fn test_base_dn_to_domain_empty() {
        assert_eq!(base_dn_to_domain(""), "");
    }

    #[test]
    fn test_base_dn_to_domain_no_dc_components() {
        assert_eq!(base_dn_to_domain("OU=Users,CN=test"), "");
    }

    // -----------------------------------------------------------------------
    // parse_ad_time tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_ad_time_standard() {
        let result = parse_ad_time("20260321100000.0Z");
        assert!(result.is_some());
        let dt = result.unwrap();
        assert_eq!(
            dt.format("%Y-%m-%d %H:%M:%S").to_string(),
            "2026-03-21 10:00:00"
        );
    }

    #[test]
    fn test_parse_ad_time_without_fractional() {
        let result = parse_ad_time("20260321100000Z");
        assert!(result.is_some());
        let dt = result.unwrap();
        assert_eq!(
            dt.format("%Y-%m-%d %H:%M:%S").to_string(),
            "2026-03-21 10:00:00"
        );
    }

    #[test]
    fn test_parse_ad_time_invalid() {
        assert!(parse_ad_time("not-a-date").is_none());
    }

    #[test]
    fn test_parse_ad_time_empty() {
        assert!(parse_ad_time("").is_none());
    }

    #[test]
    fn test_parse_ad_time_midnight() {
        let result = parse_ad_time("20260101000000.0Z");
        assert!(result.is_some());
        let dt = result.unwrap();
        assert_eq!(
            dt.format("%Y-%m-%d %H:%M:%S").to_string(),
            "2026-01-01 00:00:00"
        );
    }

    // -----------------------------------------------------------------------
    // SRV record prefix tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_srv_record_prefixes_count() {
        assert_eq!(SRV_RECORD_PREFIXES.len(), 4);
    }

    #[test]
    fn test_srv_record_prefixes_content() {
        assert!(SRV_RECORD_PREFIXES.contains(&"_ldap._tcp"));
        assert!(SRV_RECORD_PREFIXES.contains(&"_kerberos._tcp"));
        assert!(SRV_RECORD_PREFIXES.contains(&"_gc._tcp"));
        assert!(SRV_RECORD_PREFIXES.contains(&"_kpasswd._tcp"));
    }

    // -----------------------------------------------------------------------
    // Integration-style tests (using pure logic, no network)
    // -----------------------------------------------------------------------

    #[test]
    fn test_default_threshold() {
        assert_eq!(DEFAULT_THRESHOLD_SECONDS, 300);
    }
}
