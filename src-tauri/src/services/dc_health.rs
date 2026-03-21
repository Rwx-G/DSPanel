use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;

use crate::models::dc_health::{
    compute_overall_status, DcHealthCheck, DcHealthLevel, DcHealthResult, DomainControllerInfo,
};
use crate::services::DirectoryProvider;

/// Discovers domain controllers by querying the AD Configuration partition
/// via the directory provider.
///
/// Searches `CN=Sites,CN=Configuration,<base_dn>` for server objects and
/// extracts DC hostnames and site membership.
pub async fn discover_domain_controllers(
    provider: &dyn DirectoryProvider,
) -> Result<Vec<DomainControllerInfo>> {
    let base_dn = provider
        .base_dn()
        .ok_or_else(|| anyhow::anyhow!("Not connected - no base DN"))?;

    let sites_dn = format!("CN=Sites,CN=Configuration,{}", base_dn);

    // Use the provider's raw search to query server objects under Sites
    let entries = provider
        .search_configuration(&sites_dn, "(objectClass=server)")
        .await?;

    let mut dcs = Vec::new();
    for entry in &entries {
        let hostname = entry
            .get_attribute("dNSHostName")
            .unwrap_or_default()
            .to_string();
        if hostname.is_empty() {
            continue;
        }

        // Extract site name from DN: CN=server,CN=Servers,CN=<SiteName>,CN=Sites,...
        let site_name = extract_site_from_dn(&entry.distinguished_name);

        // Check if GC by looking at NTDS Settings options or serverReference
        let is_gc = entry
            .get_attribute("options")
            .and_then(|v| v.parse::<u32>().ok())
            .map(|opts| opts & 1 != 0) // Bit 0 = isGlobalCatalog
            .unwrap_or(false);

        dcs.push(DomainControllerInfo {
            hostname,
            site_name,
            is_global_catalog: is_gc,
            server_dn: entry.distinguished_name.clone(),
        });
    }

    Ok(dcs)
}

/// Extracts the site name from a server DN.
///
/// DN format: `CN=DC1,CN=Servers,CN=SiteName,CN=Sites,CN=Configuration,...`
/// Returns "Unknown" if the site cannot be extracted.
fn extract_site_from_dn(dn: &str) -> String {
    let parts: Vec<&str> = dn.split(',').collect();
    // Looking for CN=<SiteName> after CN=Servers
    for (i, part) in parts.iter().enumerate() {
        if part.trim().eq_ignore_ascii_case("CN=Servers")
            || part.trim().eq_ignore_ascii_case("CN=Sites")
        {
            continue;
        }
        if i >= 2 {
            // The part at index 2 (0-based) after CN=server,CN=Servers should be CN=SiteName
            if let Some(name) = part
                .trim()
                .strip_prefix("CN=")
                .or_else(|| part.trim().strip_prefix("cn="))
            {
                // Verify this is indeed the site by checking next part is CN=Sites
                if i + 1 < parts.len() && parts[i + 1].trim().eq_ignore_ascii_case("CN=Sites") {
                    return name.to_string();
                }
            }
        }
    }
    "Unknown".to_string()
}

/// Runs all health checks on a single domain controller.
///
/// Performs DNS resolution, LDAP connectivity test, and (on Windows)
/// service status and disk space checks.
pub async fn check_dc_health(
    dc: &DomainControllerInfo,
    provider: &dyn DirectoryProvider,
) -> DcHealthResult {
    let mut checks = Vec::new();

    // Check 1: DNS Resolution
    checks.push(check_dns(&dc.hostname).await);

    // Check 2: LDAP Ping (response time)
    checks.push(check_ldap_ping(&dc.hostname, provider).await);

    // Check 3: AD Services (Windows-only via PowerShell)
    checks.push(check_services(&dc.hostname).await);

    // Check 4: Disk Space (Windows-only via PowerShell)
    checks.push(check_disk_space(&dc.hostname).await);

    // Check 5: SYSVOL Accessibility (Windows-only)
    checks.push(check_sysvol(&dc.hostname).await);

    let overall_status = compute_overall_status(&checks);
    let checked_at = chrono::Utc::now().to_rfc3339();

    DcHealthResult {
        dc: dc.clone(),
        overall_status,
        checks,
        checked_at,
    }
}

/// Checks DNS resolution for a DC hostname.
async fn check_dns(hostname: &str) -> DcHealthCheck {
    let addr = format!("{}:389", hostname);
    let result = tokio::net::lookup_host(&addr).await;
    match result {
        Ok(mut addrs) => {
            if let Some(resolved) = addrs.next() {
                DcHealthCheck {
                    name: "DNS".to_string(),
                    status: DcHealthLevel::Healthy,
                    message: format!("Resolved to {}", resolved.ip()),
                    value: Some(resolved.ip().to_string()),
                }
            } else {
                DcHealthCheck {
                    name: "DNS".to_string(),
                    status: DcHealthLevel::Critical,
                    message: "DNS lookup returned no addresses".to_string(),
                    value: None,
                }
            }
        }
        Err(e) => DcHealthCheck {
            name: "DNS".to_string(),
            status: DcHealthLevel::Critical,
            message: format!("DNS resolution failed: {}", e),
            value: None,
        },
    }
}

/// Measures LDAP response time by performing a simple connection test.
async fn check_ldap_ping(hostname: &str, _provider: &dyn DirectoryProvider) -> DcHealthCheck {
    let start = Instant::now();
    let addr = format!("{}:389", hostname);

    match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::net::TcpStream::connect(&addr),
    )
    .await
    {
        Ok(Ok(_)) => {
            let elapsed_ms = start.elapsed().as_millis();
            let (status, message) = if elapsed_ms < 100 {
                (
                    DcHealthLevel::Healthy,
                    format!("LDAP response: {}ms", elapsed_ms),
                )
            } else if elapsed_ms < 500 {
                (
                    DcHealthLevel::Warning,
                    format!("LDAP response slow: {}ms", elapsed_ms),
                )
            } else {
                (
                    DcHealthLevel::Critical,
                    format!("LDAP response very slow: {}ms", elapsed_ms),
                )
            };
            DcHealthCheck {
                name: "LDAP".to_string(),
                status,
                message,
                value: Some(format!("{}ms", elapsed_ms)),
            }
        }
        Ok(Err(e)) => DcHealthCheck {
            name: "LDAP".to_string(),
            status: DcHealthLevel::Critical,
            message: format!("LDAP connection failed: {}", e),
            value: None,
        },
        Err(_) => DcHealthCheck {
            name: "LDAP".to_string(),
            status: DcHealthLevel::Critical,
            message: "LDAP connection timed out (5s)".to_string(),
            value: None,
        },
    }
}

/// Checks AD services status via PowerShell (Windows-only).
///
/// On non-Windows platforms, returns Unknown status.
async fn check_services(hostname: &str) -> DcHealthCheck {
    #[cfg(target_os = "windows")]
    {
        check_services_windows(hostname).await
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = hostname;
        DcHealthCheck {
            name: "Services".to_string(),
            status: DcHealthLevel::Unknown,
            message: "Service checks require Windows".to_string(),
            value: None,
        }
    }
}

/// Windows implementation of service checks via PowerShell.
#[cfg(target_os = "windows")]
async fn check_services_windows(hostname: &str) -> DcHealthCheck {
    let script = format!(
        "Get-Service -ComputerName '{}' -Name NTDS,DNS,Netlogon,KDC -ErrorAction SilentlyContinue | Select-Object Name,Status | ConvertTo-Json -Compress",
        hostname.replace('\'', "''")
    );

    match tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output(),
    )
    .await
    {
        Ok(Ok(output)) => {
            if !output.status.success() {
                return DcHealthCheck {
                    name: "Services".to_string(),
                    status: DcHealthLevel::Critical,
                    message: "Failed to query services".to_string(),
                    value: None,
                };
            }

            let stdout = String::from_utf8_lossy(&output.stdout);
            parse_service_results(&stdout)
        }
        Ok(Err(e)) => DcHealthCheck {
            name: "Services".to_string(),
            status: DcHealthLevel::Critical,
            message: format!("Failed to run PowerShell: {}", e),
            value: None,
        },
        Err(_) => DcHealthCheck {
            name: "Services".to_string(),
            status: DcHealthLevel::Critical,
            message: "Service check timed out (10s)".to_string(),
            value: None,
        },
    }
}

/// Parses PowerShell Get-Service JSON output into a health check result.
fn parse_service_results(json_output: &str) -> DcHealthCheck {
    let trimmed = json_output.trim();
    if trimmed.is_empty() {
        return DcHealthCheck {
            name: "Services".to_string(),
            status: DcHealthLevel::Critical,
            message: "No service data returned".to_string(),
            value: None,
        };
    }

    // PowerShell may return a single object or array
    let services: Vec<serde_json::Value> = if trimmed.starts_with('[') {
        serde_json::from_str(trimmed).unwrap_or_default()
    } else {
        serde_json::from_str::<serde_json::Value>(trimmed)
            .map(|v| vec![v])
            .unwrap_or_default()
    };

    if services.is_empty() {
        return DcHealthCheck {
            name: "Services".to_string(),
            status: DcHealthLevel::Critical,
            message: "Could not parse service data".to_string(),
            value: None,
        };
    }

    let mut stopped = Vec::new();
    let mut running_count = 0;

    for svc in &services {
        let name = svc["Name"].as_str().unwrap_or("Unknown");
        let status = svc["Status"].as_u64().unwrap_or(0);
        // PowerShell Status enum: 4 = Running, 1 = Stopped
        if status == 4 {
            running_count += 1;
        } else {
            stopped.push(name.to_string());
        }
    }

    if stopped.is_empty() {
        DcHealthCheck {
            name: "Services".to_string(),
            status: DcHealthLevel::Healthy,
            message: format!("All {} services running", running_count),
            value: Some(format!("{}/{}", running_count, services.len())),
        }
    } else {
        DcHealthCheck {
            name: "Services".to_string(),
            status: DcHealthLevel::Critical,
            message: format!("Stopped: {}", stopped.join(", ")),
            value: Some(format!("{}/{}", running_count, services.len())),
        }
    }
}

/// Checks disk space on the system drive via PowerShell (Windows-only).
async fn check_disk_space(hostname: &str) -> DcHealthCheck {
    #[cfg(target_os = "windows")]
    {
        check_disk_space_windows(hostname).await
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = hostname;
        DcHealthCheck {
            name: "Disk".to_string(),
            status: DcHealthLevel::Unknown,
            message: "Disk checks require Windows".to_string(),
            value: None,
        }
    }
}

/// Windows implementation of disk space check via PowerShell.
#[cfg(target_os = "windows")]
async fn check_disk_space_windows(hostname: &str) -> DcHealthCheck {
    let script = format!(
        "Get-WmiObject Win32_LogicalDisk -ComputerName '{}' -Filter \"DeviceID='C:'\" | Select-Object FreeSpace,Size | ConvertTo-Json -Compress",
        hostname.replace('\'', "''")
    );

    match tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output(),
    )
    .await
    {
        Ok(Ok(output)) => {
            if !output.status.success() {
                return DcHealthCheck {
                    name: "Disk".to_string(),
                    status: DcHealthLevel::Critical,
                    message: "Failed to query disk space".to_string(),
                    value: None,
                };
            }
            let stdout = String::from_utf8_lossy(&output.stdout);
            parse_disk_results(&stdout)
        }
        Ok(Err(e)) => DcHealthCheck {
            name: "Disk".to_string(),
            status: DcHealthLevel::Critical,
            message: format!("Failed to run PowerShell: {}", e),
            value: None,
        },
        Err(_) => DcHealthCheck {
            name: "Disk".to_string(),
            status: DcHealthLevel::Critical,
            message: "Disk check timed out (10s)".to_string(),
            value: None,
        },
    }
}

/// Parses disk space JSON output and applies thresholds.
fn parse_disk_results(json_output: &str) -> DcHealthCheck {
    let trimmed = json_output.trim();
    if trimmed.is_empty() {
        return DcHealthCheck {
            name: "Disk".to_string(),
            status: DcHealthLevel::Critical,
            message: "No disk data returned".to_string(),
            value: None,
        };
    }

    let disk: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => {
            return DcHealthCheck {
                name: "Disk".to_string(),
                status: DcHealthLevel::Critical,
                message: "Could not parse disk data".to_string(),
                value: None,
            };
        }
    };

    let free = disk["FreeSpace"].as_u64().unwrap_or(0);
    let size = disk["Size"].as_u64().unwrap_or(1); // avoid division by zero

    if size == 0 {
        return DcHealthCheck {
            name: "Disk".to_string(),
            status: DcHealthLevel::Unknown,
            message: "Disk size reported as 0".to_string(),
            value: None,
        };
    }

    let free_percent = (free as f64 / size as f64 * 100.0) as u32;
    let free_gb = free / (1024 * 1024 * 1024);

    let (status, message) = if free_percent > 20 {
        (
            DcHealthLevel::Healthy,
            format!("{}% free ({}GB)", free_percent, free_gb),
        )
    } else if free_percent >= 10 {
        (
            DcHealthLevel::Warning,
            format!("Low disk: {}% free ({}GB)", free_percent, free_gb),
        )
    } else {
        (
            DcHealthLevel::Critical,
            format!("Critical disk: {}% free ({}GB)", free_percent, free_gb),
        )
    };

    DcHealthCheck {
        name: "Disk".to_string(),
        status,
        message,
        value: Some(format!("{}%", free_percent)),
    }
}

/// Checks SYSVOL accessibility (Windows-only).
async fn check_sysvol(hostname: &str) -> DcHealthCheck {
    #[cfg(target_os = "windows")]
    {
        check_sysvol_windows(hostname).await
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = hostname;
        DcHealthCheck {
            name: "SYSVOL".to_string(),
            status: DcHealthLevel::Unknown,
            message: "SYSVOL checks require Windows".to_string(),
            value: None,
        }
    }
}

/// Windows implementation of SYSVOL accessibility check.
#[cfg(target_os = "windows")]
async fn check_sysvol_windows(hostname: &str) -> DcHealthCheck {
    let sysvol_path = format!("\\\\{}\\SYSVOL", hostname);

    let script = format!("Test-Path '{}'", sysvol_path.replace('\'', "''"));

    match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output(),
    )
    .await
    {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if stdout.eq_ignore_ascii_case("true") {
                DcHealthCheck {
                    name: "SYSVOL".to_string(),
                    status: DcHealthLevel::Healthy,
                    message: "SYSVOL accessible".to_string(),
                    value: Some(sysvol_path),
                }
            } else {
                DcHealthCheck {
                    name: "SYSVOL".to_string(),
                    status: DcHealthLevel::Critical,
                    message: "SYSVOL inaccessible".to_string(),
                    value: Some(sysvol_path),
                }
            }
        }
        Ok(Err(e)) => DcHealthCheck {
            name: "SYSVOL".to_string(),
            status: DcHealthLevel::Critical,
            message: format!("Failed to check SYSVOL: {}", e),
            value: None,
        },
        Err(_) => DcHealthCheck {
            name: "SYSVOL".to_string(),
            status: DcHealthLevel::Critical,
            message: "SYSVOL check timed out (5s)".to_string(),
            value: None,
        },
    }
}

/// Runs health checks on all discovered domain controllers.
pub async fn check_all_dc_health(
    provider: Arc<dyn DirectoryProvider>,
) -> Result<Vec<DcHealthResult>> {
    let dcs = discover_domain_controllers(&*provider).await?;

    let mut results = Vec::new();
    for dc in &dcs {
        let result = check_dc_health(dc, &*provider).await;
        results.push(result);
    }

    Ok(results)
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_site_from_dn_standard() {
        let dn = "CN=DC1,CN=Servers,CN=Default-First-Site-Name,CN=Sites,CN=Configuration,DC=example,DC=com";
        assert_eq!(extract_site_from_dn(dn), "Default-First-Site-Name");
    }

    #[test]
    fn test_extract_site_from_dn_custom_site() {
        let dn = "CN=DC2,CN=Servers,CN=Paris,CN=Sites,CN=Configuration,DC=corp,DC=local";
        assert_eq!(extract_site_from_dn(dn), "Paris");
    }

    #[test]
    fn test_extract_site_from_dn_invalid() {
        let dn = "CN=Something,DC=example,DC=com";
        assert_eq!(extract_site_from_dn(dn), "Unknown");
    }

    #[test]
    fn test_parse_service_results_all_running() {
        let json = r#"[{"Name":"NTDS","Status":4},{"Name":"DNS","Status":4},{"Name":"Netlogon","Status":4},{"Name":"KDC","Status":4}]"#;
        let result = parse_service_results(json);
        assert_eq!(result.status, DcHealthLevel::Healthy);
        assert!(result.message.contains("4 services running"));
    }

    #[test]
    fn test_parse_service_results_one_stopped() {
        let json = r#"[{"Name":"NTDS","Status":4},{"Name":"DNS","Status":1},{"Name":"Netlogon","Status":4}]"#;
        let result = parse_service_results(json);
        assert_eq!(result.status, DcHealthLevel::Critical);
        assert!(result.message.contains("DNS"));
    }

    #[test]
    fn test_parse_service_results_single_object() {
        let json = r#"{"Name":"NTDS","Status":4}"#;
        let result = parse_service_results(json);
        assert_eq!(result.status, DcHealthLevel::Healthy);
    }

    #[test]
    fn test_parse_service_results_empty() {
        let result = parse_service_results("");
        assert_eq!(result.status, DcHealthLevel::Critical);
    }

    #[test]
    fn test_parse_service_results_invalid_json() {
        let result = parse_service_results("not json");
        assert_eq!(result.status, DcHealthLevel::Critical);
    }

    #[test]
    fn test_parse_disk_results_healthy() {
        let json = r#"{"FreeSpace":85899345920,"Size":214748364800}"#;
        let result = parse_disk_results(json);
        assert_eq!(result.status, DcHealthLevel::Healthy);
        assert!(result.value.unwrap().contains("40%")); // ~40% free
    }

    #[test]
    fn test_parse_disk_results_warning() {
        let json = r#"{"FreeSpace":32212254720,"Size":214748364800}"#;
        let result = parse_disk_results(json);
        assert_eq!(result.status, DcHealthLevel::Warning);
        // ~15% free
    }

    #[test]
    fn test_parse_disk_results_critical() {
        let json = r#"{"FreeSpace":10737418240,"Size":214748364800}"#;
        let result = parse_disk_results(json);
        assert_eq!(result.status, DcHealthLevel::Critical);
        // ~5% free
    }

    #[test]
    fn test_parse_disk_results_empty() {
        let result = parse_disk_results("");
        assert_eq!(result.status, DcHealthLevel::Critical);
    }

    #[test]
    fn test_parse_disk_results_zero_size() {
        let json = r#"{"FreeSpace":0,"Size":0}"#;
        let result = parse_disk_results(json);
        assert_eq!(result.status, DcHealthLevel::Unknown);
    }

    #[test]
    fn test_parse_disk_results_invalid_json() {
        let result = parse_disk_results("not json");
        assert_eq!(result.status, DcHealthLevel::Critical);
    }
}
