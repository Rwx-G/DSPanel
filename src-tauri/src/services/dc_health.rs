use std::net::IpAddr;
use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use hickory_resolver::config::{NameServerConfigGroup, ResolverConfig, ResolverOpts};
use hickory_resolver::TokioResolver;

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

    // Extract domain name from base DN for FQDN construction fallback
    let domain_suffix = base_dn
        .split(',')
        .filter_map(|p| {
            p.trim()
                .strip_prefix("DC=")
                .or_else(|| p.trim().strip_prefix("dc="))
        })
        .collect::<Vec<&str>>()
        .join(".");

    let mut dcs = Vec::new();
    for entry in &entries {
        // dNSHostName may be empty on newly promoted DCs - fall back to CN + domain
        let hostname = entry
            .get_attribute("dNSHostName")
            .filter(|h| !h.is_empty())
            .map(|h| h.to_string())
            .unwrap_or_else(|| {
                let cn = entry
                    .distinguished_name
                    .split(',')
                    .next()
                    .and_then(|p| p.strip_prefix("CN=").or_else(|| p.strip_prefix("cn=")))
                    .unwrap_or("");
                if cn.is_empty() || domain_suffix.is_empty() {
                    String::new()
                } else {
                    format!("{}.{}", cn, domain_suffix)
                }
            });
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
            fsmo_roles: Vec::new(),
            functional_level: None,
        });
    }

    // Enrich with FSMO roles
    let fsmo_roles = discover_fsmo_roles(provider, &base_dn).await;
    for dc in &mut dcs {
        let ntds_dn = format!("CN=NTDS Settings,{}", dc.server_dn);
        let ntds_lower = ntds_dn.to_lowercase();
        for (role, owner_dn) in &fsmo_roles {
            if owner_dn.to_lowercase() == ntds_lower {
                dc.fsmo_roles.push(role.to_string());
            }
        }
    }

    // Enrich with functional level from rootDSE
    if let Ok(Some(rootdse)) = provider.read_entry("").await {
        let level = rootdse
            .get_attribute("domainControllerFunctionality")
            .or_else(|| rootdse.get_attribute("domainFunctionality"))
            .and_then(|v| v.parse::<u32>().ok())
            .map(functional_level_label);
        for dc in &mut dcs {
            dc.functional_level = level.clone();
        }
    }

    Ok(dcs)
}

/// Discovers FSMO role holders by reading `fSMORoleOwner` from the 5 well-known objects.
/// Returns a list of (role_name, owner_ntds_settings_dn).
pub async fn discover_fsmo_roles(
    provider: &dyn DirectoryProvider,
    base_dn: &str,
) -> Vec<(&'static str, String)> {
    let mut roles = Vec::new();

    let config_dn = format!("CN=Configuration,{}", base_dn);

    let fsmo_objects: &[(&str, String)] = &[
        ("PDC", base_dn.to_string()),
        ("RID", format!("CN=RID Manager$,CN=System,{}", base_dn)),
        ("Infrastructure", format!("CN=Infrastructure,{}", base_dn)),
        ("Schema", format!("CN=Schema,{}", config_dn)),
        ("Naming", format!("CN=Partitions,{}", config_dn)),
    ];

    for (role, dn) in fsmo_objects {
        if let Ok(Some(entry)) = provider.read_entry(dn).await {
            if let Some(owner) = entry.get_attribute("fSMORoleOwner") {
                roles.push((*role, owner.to_string()));
            }
        }
    }

    roles
}

/// Maps AD functional level number to a human-readable label.
fn functional_level_label(level: u32) -> String {
    match level {
        0 => "Windows 2000".to_string(),
        2 => "Windows Server 2003".to_string(),
        3 => "Windows Server 2008".to_string(),
        4 => "Windows Server 2008 R2".to_string(),
        5 => "Windows Server 2012".to_string(),
        6 => "Windows Server 2012 R2".to_string(),
        7 => "Windows Server 2016".to_string(),
        10 => "Windows Server 2025".to_string(),
        _ => format!("Level {}", level),
    }
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
/// Performs DNS resolution, LDAP connectivity, AD service detection via
/// rootDSE/SPNs, replication health, and SYSVOL reachability via SMB port.
/// All checks are cross-platform (no PowerShell dependency).
///
/// If DNS resolution fails and a `fallback_ip` is available, the network
/// checks use the fallback IP instead of the unresolvable hostname.
pub async fn check_dc_health(
    dc: &DomainControllerInfo,
    provider: &dyn DirectoryProvider,
    ad_resolver: Option<&TokioResolver>,
) -> DcHealthResult {
    let mut checks = Vec::new();

    // Check 1: DNS Resolution (try system DNS, then AD DNS as fallback)
    let (dns_check, resolved_ip) = check_dns_with_ad_fallback(&dc.hostname, ad_resolver).await;
    checks.push(dns_check);

    // Use the resolved IP for connectivity checks, or fall back to hostname
    let effective_host = resolved_ip.unwrap_or_else(|| dc.hostname.clone());

    // Check 2: LDAP Ping (response time)
    let ldap_check = check_ldap_ping(&effective_host, provider).await;
    let dc_reachable = ldap_check.status != DcHealthLevel::Critical;
    checks.push(ldap_check);

    if dc_reachable {
        // These checks query the DC via the shared provider - only valid if reachable
        // Check 3: AD Services via LDAP rootDSE + SPNs (cross-platform)
        checks.push(check_ad_services(provider, &dc.hostname).await);

        // Check 4: Replication health via rootDSE (cross-platform)
        checks.push(check_replication_health(provider, &dc.hostname).await);

        // Check 5: SYSVOL health via DFSR LDAP + SMB port probe (cross-platform)
        checks.push(check_sysvol_smb(provider, &dc.hostname, &effective_host).await);

        // Check 6: Clock skew vs local time (Kerberos threshold)
        checks.push(check_clock_skew(provider).await);

        // Check 7: Machine account health
        checks.push(check_machine_account(provider, &dc.hostname).await);
    } else {
        // DC is unreachable - mark all connectivity-dependent checks as N/A
        for name in &["Services", "Replication", "SYSVOL", "Clock", "Account"] {
            checks.push(DcHealthCheck {
                name: name.to_string(),
                status: DcHealthLevel::Critical,
                message: "DC unreachable - check skipped".to_string(),
                value: None,
            });
        }
    }

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
///
/// Tries system DNS first. If that fails and an AD DNS resolver is available,
/// falls back to resolving via the AD DC's DNS server. This handles the common
/// case where the client machine is not using AD DNS as its system resolver.
///
/// Returns the check result AND the resolved IP (if any) for use in subsequent
/// connectivity checks.
/// Returns true if the app is using simple bind (explicit credentials).
/// In simple bind mode, AD DNS resolution is sufficient for health checks
/// since the app connects via a direct IP, not via Kerberos/DNS discovery.
fn is_simple_bind_mode() -> bool {
    std::env::var("DSPANEL_LDAP_BIND_DN").is_ok()
}

async fn check_dns_with_ad_fallback(
    hostname: &str,
    ad_resolver: Option<&TokioResolver>,
) -> (DcHealthCheck, Option<String>) {
    // Try system DNS first
    let addr = format!("{}:389", hostname);
    if let Ok(mut addrs) = tokio::net::lookup_host(&addr).await {
        if let Some(resolved) = addrs.next() {
            let ip = resolved.ip().to_string();
            return (
                DcHealthCheck {
                    name: "DNS".to_string(),
                    status: DcHealthLevel::Healthy,
                    message: format!("Resolved to {}", ip),
                    value: Some(ip.clone()),
                },
                Some(ip),
            );
        }
    }

    // System DNS failed - try AD DNS resolver
    if let Some(resolver) = ad_resolver {
        let fqdn = if hostname.ends_with('.') {
            hostname.to_string()
        } else {
            format!("{}.", hostname)
        };
        if let Ok(lookup) = resolver.lookup_ip(&fqdn).await {
            if let Some(ip) = lookup.iter().next() {
                let ip_str = ip.to_string();
                // In simple bind mode, AD DNS resolution is fully sufficient
                // (no Kerberos dependency on system DNS). In GSSAPI mode,
                // system DNS is critical for SRV/KDC discovery -> warn.
                let (status, msg) = if is_simple_bind_mode() {
                    (
                        DcHealthLevel::Healthy,
                        format!("Resolved via AD DNS to {}", ip_str),
                    )
                } else {
                    (
                        DcHealthLevel::Warning,
                        format!(
                            "System DNS failed, resolved via AD DNS to {} (Kerberos may require system DNS)",
                            ip_str
                        ),
                    )
                };
                return (
                    DcHealthCheck {
                        name: "DNS".to_string(),
                        status,
                        message: msg,
                        value: Some(ip_str.clone()),
                    },
                    Some(ip_str),
                );
            }
        }
    }

    // Both failed
    let system_err = tokio::net::lookup_host(&addr)
        .await
        .err()
        .map(|e| e.to_string())
        .unwrap_or_else(|| "no addresses returned".to_string());
    (
        DcHealthCheck {
            name: "DNS".to_string(),
            status: DcHealthLevel::Critical,
            message: format!("DNS resolution failed: {}", system_err),
            value: None,
        },
        None,
    )
}

/// Legacy check_dns kept for test compatibility.
#[allow(dead_code)]
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

/// Checks AD services by querying the DC's rootDSE and SPNs via LDAP.
///
/// If LDAP responds with `currentTime` and `dsServiceName`, AD DS is running.
/// SPNs on the computer object indicate which services are registered
/// (DNS, GC, Kerberos, LDAP).
async fn check_ad_services(provider: &dyn DirectoryProvider, dc_hostname: &str) -> DcHealthCheck {
    let base_dn = match provider.base_dn() {
        Some(dn) => dn,
        None => {
            return DcHealthCheck {
                name: "Services".to_string(),
                status: DcHealthLevel::Critical,
                message: "Not connected - no base DN".to_string(),
                value: None,
            };
        }
    };

    // Query the computer object for SPNs
    let filter = format!("(&(objectClass=computer)(dNSHostName={}))", dc_hostname);
    let entries = provider
        .search_configuration(&base_dn, &filter)
        .await
        .unwrap_or_default();

    // ldap3 may return attribute keys with range suffix (e.g. "servicePrincipalName;range=0-9").
    // Collect SPNs from both the exact key and any range-suffixed keys.
    let spns: Vec<String> = entries
        .first()
        .map(|e| {
            let mut all_spns = e.get_attribute_values("servicePrincipalName").to_vec();
            // Also check for range-suffixed keys
            for (key, values) in &e.attributes {
                if key
                    .to_lowercase()
                    .starts_with("serviceprincipalname;range=")
                {
                    all_spns.extend(values.iter().cloned());
                }
            }
            all_spns
        })
        .unwrap_or_default();

    if spns.is_empty() {
        // No SPNs found - try a simpler check: if we got this far, LDAP works
        return DcHealthCheck {
            name: "Services".to_string(),
            status: DcHealthLevel::Healthy,
            message: "AD DS responding (no SPNs found for detailed check)".to_string(),
            value: Some("LDAP OK".to_string()),
        };
    }

    // Expected SPN prefixes on a healthy DC
    let expected: &[(&str, &str)] = &[
        ("HOST/", "Host"),
        ("DNS/", "DNS"),
        ("GC/", "GC"),
        ("ldap/", "LDAP"),
        ("RestrictedKrbHost/", "Kerberos"),
        ("E3514235-4B06-11D1-AB04-00C04FC2DCD2/", "Replication"),
    ];
    let mut found = Vec::new();
    let mut missing = Vec::new();

    for (prefix, label) in expected {
        if spns
            .iter()
            .any(|s| s.to_lowercase().starts_with(&prefix.to_lowercase()))
        {
            found.push(*label);
        } else {
            missing.push(*label);
        }
    }

    let total = expected.len();
    if missing.is_empty() {
        DcHealthCheck {
            name: "Services".to_string(),
            status: DcHealthLevel::Healthy,
            message: format!("All services registered: {}", found.join(", ")),
            value: Some(format!("{}/{}", found.len(), total)),
        }
    } else if found.len() >= 3 && found.contains(&"Host") {
        // LDAP may return a subset of SPNs due to replication delay or range limits.
        // Core SPNs present but some missing - flag as warning for investigation.
        DcHealthCheck {
            name: "Services".to_string(),
            status: DcHealthLevel::Warning,
            message: format!(
                "Partial SPNs: {}. Missing: {}",
                found.join(", "),
                missing.join(", ")
            ),
            value: Some(format!("{}/{}", found.len(), total)),
        }
    } else {
        DcHealthCheck {
            name: "Services".to_string(),
            status: DcHealthLevel::Warning,
            message: format!(
                "Missing SPNs: {}. Found: {}",
                missing.join(", "),
                found.join(", ")
            ),
            value: Some(format!("{}/{}", found.len(), total)),
        }
    }
}

/// Checks replication health by looking for NTDS Connection objects
/// targeting this DC in the Configuration partition.
///
/// If inbound connection objects exist, the DC is configured for replication.
/// Also checks if the DC has the replication SPN registered.
async fn check_replication_health(
    provider: &dyn DirectoryProvider,
    dc_hostname: &str,
) -> DcHealthCheck {
    let base_dn = match provider.base_dn() {
        Some(dn) => dn,
        None => {
            return DcHealthCheck {
                name: "Replication".to_string(),
                status: DcHealthLevel::Warning,
                message: "Not connected - no base DN".to_string(),
                value: None,
            };
        }
    };

    let sites_dn = format!("CN=Sites,CN=Configuration,{}", base_dn);

    // Look for NTDS Connection objects (replication links) in the config
    let connections = provider
        .search_configuration(&sites_dn, "(objectClass=nTDSConnection)")
        .await
        .unwrap_or_default();

    if connections.is_empty() {
        // Single DC environment - no replication partners expected
        return DcHealthCheck {
            name: "Replication".to_string(),
            status: DcHealthLevel::Healthy,
            message: "Single DC - no replication partners".to_string(),
            value: Some("standalone".to_string()),
        };
    }

    // Count connections involving this DC (by hostname in the DN path)
    let dc_short = dc_hostname.split('.').next().unwrap_or(dc_hostname);
    let inbound = connections
        .iter()
        .filter(|c| {
            c.distinguished_name
                .to_lowercase()
                .contains(&format!("cn={}", dc_short).to_lowercase())
        })
        .count();

    if inbound > 0 {
        DcHealthCheck {
            name: "Replication".to_string(),
            status: DcHealthLevel::Healthy,
            message: format!("{} inbound replication link(s)", inbound),
            value: Some(format!("{} links", inbound)),
        }
    } else {
        DcHealthCheck {
            name: "Replication".to_string(),
            status: DcHealthLevel::Warning,
            message: "No inbound replication links found for this DC".to_string(),
            value: Some("0 links".to_string()),
        }
    }
}

/// Checks SYSVOL health via DFSR membership in LDAP + SMB port probe.
///
/// Two-layer check:
/// 1. LDAP: verifies DFSR member exists and is enabled for this DC,
///    checks DFSR migration state via `msDFSR-Flags`
/// 2. Network: probes TCP port 445 to confirm SMB is reachable
async fn check_sysvol_smb(
    provider: &dyn DirectoryProvider,
    dc_hostname: &str,
    effective_host: &str,
) -> DcHealthCheck {
    let base_dn = match provider.base_dn() {
        Some(dn) => dn,
        None => {
            return DcHealthCheck {
                name: "SYSVOL".to_string(),
                status: DcHealthLevel::Warning,
                message: "Not connected - no base DN".to_string(),
                value: None,
            };
        }
    };

    // --- Layer 1: DFSR health via LDAP ---

    let dfsr_dn = format!("CN=DFSR-GlobalSettings,CN=System,{}", base_dn);

    // Check DFSR migration state
    let dfsr_settings = provider
        .search_configuration(&dfsr_dn, "(objectClass=msDFSR-GlobalSettings)")
        .await
        .unwrap_or_default();

    let migration_flags = dfsr_settings
        .first()
        .and_then(|e| e.get_attribute("msDFSR-Flags"))
        .and_then(|v| v.parse::<u32>().ok());

    let migration_state = match migration_flags {
        Some(48) => "Eliminated (DFSR only)",
        Some(32) => "Redirected (DFSR primary)",
        Some(16) => "Prepared (FRS still active)",
        Some(0) => "Start (FRS active)",
        None => "unknown",
        _ => "unknown",
    };

    // Check DFSR member objects for this DC
    let sysvol_dn = format!(
        "CN=Domain System Volume,CN=DFSR-GlobalSettings,CN=System,{}",
        base_dn
    );
    let dfsr_members = provider
        .search_configuration(&sysvol_dn, "(objectClass=msDFSR-Member)")
        .await
        .unwrap_or_default();

    let dc_short = dc_hostname
        .split('.')
        .next()
        .unwrap_or(dc_hostname)
        .to_lowercase();

    let dc_member = dfsr_members.iter().find(|m| {
        m.get_attribute("msDFSR-ComputerReference")
            .unwrap_or("")
            .to_lowercase()
            .contains(&format!("cn={}", dc_short))
            || m.distinguished_name.to_lowercase().contains(&dc_short)
    });

    let dfsr_enabled = dc_member
        .and_then(|m| m.get_attribute("msDFSR-Enabled"))
        .unwrap_or("unknown");

    // Evaluate DFSR status
    let dfsr_status = if dc_member.is_none() && dfsr_members.is_empty() {
        // No DFSR at all - might be FRS or single DC
        DfsrStatus::NoDfsr
    } else if dc_member.is_none() {
        DfsrStatus::MemberMissing
    } else if dfsr_enabled.eq_ignore_ascii_case("FALSE") {
        DfsrStatus::Disabled
    } else {
        DfsrStatus::Healthy
    };

    // --- Layer 2: SMB port probe ---
    let smb_addr = format!("{}:445", effective_host);
    let smb_ok = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::net::TcpStream::connect(&smb_addr),
    )
    .await
    .map(|r| r.is_ok())
    .unwrap_or(false);

    // --- Combine results ---
    match (dfsr_status, smb_ok) {
        (DfsrStatus::Healthy, true) => DcHealthCheck {
            name: "SYSVOL".to_string(),
            status: DcHealthLevel::Healthy,
            message: format!("DFSR enabled, SMB reachable ({})", migration_state),
            value: Some(format!("\\\\{}\\SYSVOL", dc_hostname)),
        },
        (DfsrStatus::Healthy, false) => DcHealthCheck {
            name: "SYSVOL".to_string(),
            status: DcHealthLevel::Critical,
            message: format!(
                "DFSR enabled but SMB port 445 unreachable ({})",
                migration_state
            ),
            value: None,
        },
        (DfsrStatus::NoDfsr, true) => DcHealthCheck {
            name: "SYSVOL".to_string(),
            status: DcHealthLevel::Healthy,
            message: "No DFSR config (FRS or single DC), SMB reachable".to_string(),
            value: Some(format!("\\\\{}\\SYSVOL", dc_hostname)),
        },
        (DfsrStatus::NoDfsr, false) => DcHealthCheck {
            name: "SYSVOL".to_string(),
            status: DcHealthLevel::Critical,
            message: "No DFSR config, SMB port 445 unreachable".to_string(),
            value: None,
        },
        (DfsrStatus::MemberMissing, _) => DcHealthCheck {
            name: "SYSVOL".to_string(),
            status: DcHealthLevel::Critical,
            message: "DC missing from DFSR membership - SYSVOL may not replicate".to_string(),
            value: None,
        },
        (DfsrStatus::Disabled, _) => DcHealthCheck {
            name: "SYSVOL".to_string(),
            status: DcHealthLevel::Critical,
            message: "DFSR member disabled for this DC".to_string(),
            value: None,
        },
    }
}

/// Internal DFSR health evaluation result.
enum DfsrStatus {
    /// DFSR member exists and is enabled.
    Healthy,
    /// No DFSR configuration found (FRS or single DC).
    NoDfsr,
    /// DFSR members exist but this DC is missing.
    MemberMissing,
    /// DFSR member exists but is disabled.
    Disabled,
}

/// Checks clock skew between the DC and the local machine.
///
/// Reads `currentTime` from the rootDSE via a base-scope search on
/// the Configuration partition root. Kerberos fails beyond 5 minutes.
async fn check_clock_skew(provider: &dyn DirectoryProvider) -> DcHealthCheck {
    // Read rootDSE (Base scope on empty DN) for currentTime
    let rootdse = provider.read_entry("").await.unwrap_or(None);

    let dc_time_str = rootdse
        .as_ref()
        .and_then(|e| e.get_attribute("currentTime"));

    let Some(dc_time_str) = dc_time_str else {
        return DcHealthCheck {
            name: "Clock".to_string(),
            status: DcHealthLevel::Warning,
            message: "Could not read DC time".to_string(),
            value: None,
        };
    };

    // Parse AD generalized time (yyyyMMddHHmmss.0Z)
    let dc_time = parse_ad_time(dc_time_str);
    let Some(dc_time) = dc_time else {
        return DcHealthCheck {
            name: "Clock".to_string(),
            status: DcHealthLevel::Warning,
            message: format!("Could not parse DC time: {}", dc_time_str),
            value: None,
        };
    };

    let local_time = chrono::Utc::now();
    let skew_seconds = (local_time - dc_time).num_seconds().unsigned_abs();

    let (status, message) = if skew_seconds < 120 {
        (DcHealthLevel::Healthy, format!("{}s skew", skew_seconds))
    } else if skew_seconds < 300 {
        (
            DcHealthLevel::Warning,
            format!("{}s skew (Kerberos threshold: 300s)", skew_seconds),
        )
    } else {
        (
            DcHealthLevel::Critical,
            format!(
                "{}s skew - exceeds Kerberos 5-minute threshold",
                skew_seconds
            ),
        )
    };

    DcHealthCheck {
        name: "Clock".to_string(),
        status,
        message,
        value: Some(format!("{}s", skew_seconds)),
    }
}

/// Parses AD generalized time format (yyyyMMddHHmmss.0Z) to DateTime.
fn parse_ad_time(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    // Try RFC3339 first
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&chrono::Utc));
    }
    // AD generalized time: 20260322235000.0Z
    let clean = s.split('.').next().unwrap_or(s);
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(clean, "%Y%m%d%H%M%S") {
        return Some(dt.and_utc());
    }
    // ISO 8601 without timezone
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f") {
        return Some(dt.and_utc());
    }
    None
}

/// Checks the DC's machine account health via LDAP.
///
/// Verifies `userAccountControl` contains the expected DC flags
/// (SERVER_TRUST_ACCOUNT + TRUSTED_FOR_DELEGATION = 532480) and
/// that `pwdLastSet` is not older than 60 days.
async fn check_machine_account(
    provider: &dyn DirectoryProvider,
    dc_hostname: &str,
) -> DcHealthCheck {
    let base_dn = match provider.base_dn() {
        Some(dn) => dn,
        None => {
            return DcHealthCheck {
                name: "Account".to_string(),
                status: DcHealthLevel::Warning,
                message: "Not connected".to_string(),
                value: None,
            };
        }
    };

    let filter = format!("(&(objectClass=computer)(dNSHostName={}))", dc_hostname);
    let entries = provider
        .search_configuration(&base_dn, &filter)
        .await
        .unwrap_or_default();

    let entry = match entries.first() {
        Some(e) => e,
        None => {
            return DcHealthCheck {
                name: "Account".to_string(),
                status: DcHealthLevel::Warning,
                message: "Computer object not found".to_string(),
                value: None,
            };
        }
    };

    let mut issues = Vec::new();

    // Check userAccountControl flags
    // SERVER_TRUST_ACCOUNT = 0x2000, TRUSTED_FOR_DELEGATION = 0x80000
    // Expected for a DC: 532480 (0x82000) or similar with those bits set
    let uac = entry
        .get_attribute("userAccountControl")
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(0);

    let has_server_trust = uac & 0x2000 != 0;
    let has_trusted_delegation = uac & 0x80000 != 0;
    let is_disabled = uac & 0x2 != 0;

    if !has_server_trust {
        issues.push("missing SERVER_TRUST_ACCOUNT flag");
    }
    if !has_trusted_delegation {
        issues.push("missing TRUSTED_FOR_DELEGATION flag");
    }
    if is_disabled {
        issues.push("account DISABLED");
    }

    // Check pwdLastSet age
    let pwd_age_warning = entry
        .get_attribute("pwdLastSet")
        .and_then(|v| v.parse::<i64>().ok())
        .map(|filetime| {
            // AD stores pwdLastSet as Windows FILETIME (100ns intervals since 1601-01-01)
            // Convert to Unix epoch: subtract 116444736000000000 (100ns units) then to seconds
            let unix_seconds = (filetime - 116_444_736_000_000_000) / 10_000_000;
            let pwd_time = chrono::DateTime::from_timestamp(unix_seconds, 0)
                .unwrap_or(chrono::DateTime::UNIX_EPOCH);
            (chrono::Utc::now() - pwd_time).num_days()
        });

    let pwd_info = match pwd_age_warning {
        Some(days) if days > 60 => {
            issues.push("password not rotated in 60+ days");
            format!("pwd age: {}d", days)
        }
        Some(days) => format!("pwd age: {}d", days),
        None => "pwd age: unknown".to_string(),
    };

    if issues.is_empty() {
        DcHealthCheck {
            name: "Account".to_string(),
            status: DcHealthLevel::Healthy,
            message: format!("Machine account OK ({})", pwd_info),
            value: Some(format!("UAC:{}", uac)),
        }
    } else if is_disabled {
        DcHealthCheck {
            name: "Account".to_string(),
            status: DcHealthLevel::Critical,
            message: format!("Machine account: {}", issues.join(", ")),
            value: Some(format!("UAC:{}", uac)),
        }
    } else {
        DcHealthCheck {
            name: "Account".to_string(),
            status: DcHealthLevel::Warning,
            message: format!("Machine account: {}", issues.join(", ")),
            value: Some(format!("UAC:{}", uac)),
        }
    }
}

/// Resolves the fallback IP from the LDAP server environment variable.
///
/// Strips protocol prefixes and port suffixes to get the raw host/IP.
pub fn resolve_fallback_ip() -> Option<String> {
    let server = std::env::var("DSPANEL_LDAP_SERVER").ok()?;
    let host = server
        .strip_prefix("ldaps://")
        .or_else(|| server.strip_prefix("ldap://"))
        .unwrap_or(&server);
    let host = host.split(':').next().unwrap_or(host);
    if host.is_empty() {
        None
    } else {
        Some(host.to_string())
    }
}

/// Runs health checks on all discovered domain controllers.
pub async fn check_all_dc_health(
    provider: Arc<dyn DirectoryProvider>,
) -> Result<Vec<DcHealthResult>> {
    let dcs = discover_domain_controllers(&*provider).await?;

    // Create an AD DNS resolver (uses the LDAP server as DNS) so we can
    // resolve DC hostnames even when the client's system DNS doesn't know
    // about the AD domain. Each DC is resolved individually - an offline DC
    // will fail DNS (correct) while the active DC resolves (correct).
    let ad_resolver = create_ad_dns_resolver();

    let mut results = Vec::new();
    for dc in &dcs {
        let result = check_dc_health(dc, &*provider, ad_resolver.as_ref()).await;
        results.push(result);
    }

    Ok(results)
}

/// Creates a DNS resolver that queries the AD DC directly.
///
/// Uses `DSPANEL_LDAP_SERVER` as the DNS server, since AD DCs are also
/// DNS servers for the domain. Returns None if no LDAP server is configured.
fn create_ad_dns_resolver() -> Option<TokioResolver> {
    let dc_ip_str = resolve_fallback_ip()?;
    let ip = dc_ip_str.parse::<IpAddr>().ok()?;
    let ns_group = NameServerConfigGroup::from_ips_clear(&[ip], 53, true);
    let config = ResolverConfig::from_parts(None, vec![], ns_group);
    let mut opts = ResolverOpts::default();
    opts.timeout = std::time::Duration::from_secs(3);
    opts.attempts = 1;
    Some(
        TokioResolver::builder_with_config(config, Default::default())
            .with_options(opts)
            .build(),
    )
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

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
    #[serial]
    fn test_resolve_fallback_ip_plain() {
        unsafe { std::env::set_var("DSPANEL_LDAP_SERVER", "10.0.0.1"); }
        assert_eq!(resolve_fallback_ip(), Some("10.0.0.1".to_string()));
        unsafe { std::env::remove_var("DSPANEL_LDAP_SERVER"); }
    }

    #[test]
    #[serial]
    fn test_resolve_fallback_ip_with_ldaps_prefix() {
        unsafe { std::env::set_var("DSPANEL_LDAP_SERVER", "ldaps://10.0.0.1:636"); }
        assert_eq!(resolve_fallback_ip(), Some("10.0.0.1".to_string()));
        unsafe { std::env::remove_var("DSPANEL_LDAP_SERVER"); }
    }

    #[test]
    #[serial]
    fn test_resolve_fallback_ip_not_set() {
        unsafe { std::env::remove_var("DSPANEL_LDAP_SERVER"); }
        assert_eq!(resolve_fallback_ip(), None);
    }
}
