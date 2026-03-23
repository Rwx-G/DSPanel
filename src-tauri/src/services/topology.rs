use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;

use crate::models::topology::{
    SiteNode, TopologyData, TopologyDcNode, TopologyReplicationLink, TopologySiteLink,
};
use crate::services::dc_health::{discover_fsmo_roles, resolve_fallback_ip};
use crate::services::DirectoryProvider;

/// Queries the AD Configuration partition and assembles a complete topology
/// view including sites, domain controllers, replication connections, and
/// inter-site transport links.
pub async fn get_topology(provider: Arc<dyn DirectoryProvider>) -> Result<TopologyData> {
    let base_dn = provider
        .base_dn()
        .ok_or_else(|| anyhow::anyhow!("Not connected - no base DN"))?;

    let sites_dn = format!("CN=Sites,CN=Configuration,{}", base_dn);

    // 1. Query AD sites
    let site_entries = provider
        .search_configuration(&sites_dn, "(objectClass=site)")
        .await?;

    // 2. Query server objects to map DCs to sites
    let server_entries = provider
        .search_configuration(&sites_dn, "(objectClass=server)")
        .await?;

    // 3. Query NTDS Connection objects for replication links
    let connection_entries = provider
        .search_configuration(&sites_dn, "(objectClass=nTDSConnection)")
        .await?;

    // 4. Query site link objects from inter-site transports
    let site_link_dn = format!(
        "CN=IP,CN=Inter-Site Transports,CN=Sites,CN=Configuration,{}",
        base_dn
    );
    let site_link_entries = provider
        .search_configuration(&site_link_dn, "(objectClass=siteLink)")
        .await?;

    // 5. Query subnets
    let subnets_dn = format!("CN=Subnets,CN=Sites,CN=Configuration,{}", base_dn);
    let subnet_entries = provider
        .search_configuration(&subnets_dn, "(objectClass=subnet)")
        .await
        .unwrap_or_default();

    // 6. Query DC computer objects for OS version and IP
    let dc_computer_entries = provider
        .search_configuration(
            &base_dn,
            "(&(objectClass=computer)(userAccountControl:1.2.840.113556.1.4.803:=8192))",
        )
        .await
        .unwrap_or_default();

    // 7. Query FSMO role holders
    let fsmo_roles = discover_fsmo_roles(&*provider, &base_dn).await;

    // Assemble topology from raw entries
    let mut topology = assemble_topology(
        &base_dn,
        &site_entries,
        &server_entries,
        &connection_entries,
        &site_link_entries,
        &subnet_entries,
        &dc_computer_entries,
        &fsmo_roles,
    )?;

    // 8. Resolve missing IPs via AD DNS
    if let Some(ref fallback_ip_str) = resolve_fallback_ip() {
        if let Ok(dns_ip) = fallback_ip_str.parse::<std::net::IpAddr>() {
            let ns = hickory_resolver::config::NameServerConfigGroup::from_ips_clear(
                &[dns_ip],
                53,
                true,
            );
            let config = hickory_resolver::config::ResolverConfig::from_parts(None, vec![], ns);
            let resolver =
                hickory_resolver::TokioResolver::builder_with_config(config, Default::default())
                    .build();

            for site in &mut topology.sites {
                for dc in &mut site.dcs {
                    if dc.ip_address.is_none() {
                        if let Ok(lookup) = resolver.lookup_ip(dc.hostname.as_str()).await {
                            if let Some(addr) = lookup.iter().next() {
                                dc.ip_address = Some(addr.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    // 9. Probe online status for each DC
    let fallback_ip = resolve_fallback_ip();
    for site in &mut topology.sites {
        for dc in &mut site.dcs {
            let host = dc
                .ip_address
                .as_deref()
                .or(fallback_ip.as_deref())
                .unwrap_or(&dc.hostname);
            let addr = format!("{}:389", host);
            dc.is_online = tokio::time::timeout(
                std::time::Duration::from_secs(3),
                tokio::net::TcpStream::connect(&addr),
            )
            .await
            .map(|r| r.is_ok())
            .unwrap_or(false);
        }
    }

    Ok(topology)
}

/// Assembles a `TopologyData` structure from raw directory entries.
///
/// Separated from the provider calls to allow unit testing of the
/// assembly logic with mock data.
#[allow(clippy::too_many_arguments)]
fn assemble_topology(
    _base_dn: &str,
    site_entries: &[crate::models::DirectoryEntry],
    server_entries: &[crate::models::DirectoryEntry],
    connection_entries: &[crate::models::DirectoryEntry],
    site_link_entries: &[crate::models::DirectoryEntry],
    subnet_entries: &[crate::models::DirectoryEntry],
    dc_computer_entries: &[crate::models::DirectoryEntry],
    fsmo_roles: &[(&str, String)],
) -> Result<TopologyData> {
    // Build server DN -> hostname map for resolving replication links
    let server_map: HashMap<String, String> = server_entries
        .iter()
        .filter_map(|s| {
            let hostname = s.get_attribute("dNSHostName")?.to_string();
            let ntds_dn = format!("CN=NTDS Settings,{}", s.distinguished_name);
            Some((ntds_dn, hostname))
        })
        .collect();

    // PDC is determined from FSMO roles (passed in from discover_fsmo_roles)

    // Build computer info lookup: hostname -> (IP, OS, is_gc)
    let dc_info: HashMap<String, (Option<String>, Option<String>, bool)> = dc_computer_entries
        .iter()
        .filter_map(|c| {
            let hostname = c.get_attribute("dNSHostName")?.to_lowercase();
            let ip = c
                .get_attribute("IPv4Address")
                .or_else(|| c.get_attribute("ipHostNumber"))
                .map(|s| s.to_string());
            let os = c
                .get_attribute("operatingSystem")
                .map(|s| s.to_string())
                .map(|os| {
                    let ver = c.get_attribute("operatingSystemVersion").unwrap_or("");
                    if ver.is_empty() {
                        os
                    } else {
                        format!("{} ({})", os, ver)
                    }
                });
            // Collect SPNs from exact key and range-suffixed keys
            let mut spns_all: Vec<&str> = c
                .get_attribute_values("servicePrincipalName")
                .iter()
                .map(|s| s.as_str())
                .collect();
            for (key, values) in &c.attributes {
                if key
                    .to_lowercase()
                    .starts_with("serviceprincipalname;range=")
                {
                    spns_all.extend(values.iter().map(|s| s.as_str()));
                }
            }
            let has_gc = spns_all.iter().any(|s| s.to_lowercase().starts_with("gc/"));
            Some((hostname, (ip, os, has_gc)))
        })
        .collect();

    // Build FSMO role lookup: NTDS Settings DN -> Vec<role>
    let mut fsmo_map: HashMap<String, Vec<String>> = HashMap::new();
    for (role, owner_dn) in fsmo_roles {
        fsmo_map
            .entry(owner_dn.to_lowercase())
            .or_default()
            .push(role.to_string());
    }

    // Extract domain name from base DN for FQDN fallback
    let domain_suffix: String = _base_dn
        .split(',')
        .filter_map(|p| {
            p.trim()
                .strip_prefix("DC=")
                .or_else(|| p.trim().strip_prefix("dc="))
        })
        .collect::<Vec<&str>>()
        .join(".");

    // Group DCs by site
    let mut site_dcs: HashMap<String, Vec<TopologyDcNode>> = HashMap::new();
    for server in server_entries {
        // dNSHostName may be empty on newly promoted DCs - fall back to CN + domain
        let hostname = server
            .get_attribute("dNSHostName")
            .filter(|h| !h.is_empty())
            .map(|h| h.to_string())
            .unwrap_or_else(|| {
                let cn = server
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

        let site_name = extract_site_from_server_dn(&server.distinguished_name);

        // Lookup enriched info from computer object
        let (ip_address, os_version, is_gc_from_spn) = dc_info
            .get(&hostname.to_lowercase())
            .cloned()
            .unwrap_or((None, None, false));

        // GC: prefer SPN-based detection, fall back to server options bit
        let is_gc = is_gc_from_spn
            || server
                .get_attribute("options")
                .and_then(|v| v.parse::<u32>().ok())
                .map(|opts| opts & 1 != 0)
                .unwrap_or(false);

        // IP resolution is done after assembly in get_topology()

        let ntds_dn = format!("CN=NTDS Settings,{}", server.distinguished_name).to_lowercase();
        let roles = fsmo_map.get(&ntds_dn).cloned().unwrap_or_default();
        let is_pdc = roles.iter().any(|r| r == "PDC");

        site_dcs
            .entry(site_name.clone())
            .or_default()
            .push(TopologyDcNode {
                hostname,
                site_name,
                is_gc,
                is_pdc,
                ip_address,
                os_version,
                fsmo_roles: roles,
                is_online: false, // Updated after assembly by probing LDAP port
            });
    }

    // Build subnet-to-site mapping
    let mut site_subnets: HashMap<String, Vec<String>> = HashMap::new();
    for subnet in subnet_entries {
        let subnet_name = extract_cn_from_dn(&subnet.distinguished_name);
        // siteObject attribute contains the DN of the associated site
        let site_name = subnet
            .get_attribute("siteObject")
            .map(extract_cn_from_dn)
            .unwrap_or_default();
        if !site_name.is_empty() && !subnet_name.is_empty() {
            site_subnets.entry(site_name).or_default().push(subnet_name);
        }
    }

    // Assemble site nodes
    let sites: Vec<SiteNode> = site_entries
        .iter()
        .map(|entry| {
            let name = extract_cn_from_dn(&entry.distinguished_name);
            let location = entry.get_attribute("location").map(|s| s.to_string());
            let dcs = site_dcs.remove(&name).unwrap_or_default();
            let subnets = site_subnets.remove(&name).unwrap_or_default();

            SiteNode {
                name,
                location,
                dcs,
                subnets,
            }
        })
        .collect();

    // Assemble replication links
    let replication_links: Vec<TopologyReplicationLink> = connection_entries
        .iter()
        .map(|conn| {
            let source_ntds_dn = conn
                .get_attribute("fromServer")
                .unwrap_or_default()
                .to_string();

            let target_ntds_dn = extract_parent_ntds_dn(&conn.distinguished_name);

            let source_dc = server_map
                .get(&source_ntds_dn)
                .cloned()
                .unwrap_or_else(|| extract_dc_name_from_ntds_dn(&source_ntds_dn));

            let target_dc = server_map
                .get(&target_ntds_dn)
                .cloned()
                .unwrap_or_else(|| extract_dc_name_from_ntds_dn(&target_ntds_dn));

            let error_count = conn
                .get_attribute("msDS-ReplConsecutiveSyncFailures")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);

            let last_sync_time = conn
                .get_attribute("msDS-ReplLastSyncTime")
                .or_else(|| conn.get_attribute("whenChanged"))
                .map(|s| s.to_string());

            let last_sync_result = conn
                .get_attribute("msDS-ReplLastSyncResult")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);

            let status = if last_sync_result != 0 || error_count > 0 {
                "Failed".to_string()
            } else if last_sync_time.is_some() {
                "Healthy".to_string()
            } else {
                "Unknown".to_string()
            };

            TopologyReplicationLink {
                source_dc,
                target_dc,
                status,
                last_sync_time,
                error_count,
            }
        })
        .collect();

    // Assemble site links
    let site_links: Vec<TopologySiteLink> = site_link_entries
        .iter()
        .map(|entry| {
            let name = extract_cn_from_dn(&entry.distinguished_name);

            let cost = entry
                .get_attribute("cost")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(100);

            let repl_interval = entry
                .get_attribute("replInterval")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(180);

            // siteList attribute contains DNs of connected sites
            // Check both exact key and range-suffixed keys (ldap3 range retrieval)
            let mut site_dns_owned: Vec<String> = entry
                .get_attribute_values("siteList")
                .iter()
                .map(|s| s.to_string())
                .collect();
            for (key, values) in &entry.attributes {
                if key.to_lowercase().starts_with("sitelist;range=") {
                    site_dns_owned.extend(values.iter().cloned());
                }
            }
            let site_dns = &site_dns_owned;
            let sites: Vec<String> = site_dns
                .iter()
                .filter_map(|dn| {
                    let cn = extract_cn_from_dn(dn);
                    if cn.is_empty() {
                        None
                    } else {
                        Some(cn)
                    }
                })
                .collect();

            TopologySiteLink {
                name,
                sites,
                cost,
                repl_interval,
            }
        })
        .collect();

    Ok(TopologyData {
        sites,
        replication_links,
        site_links,
    })
}

/// Extracts the CN value from the first RDN component of a DN.
///
/// Example: `CN=HQ-Site,CN=Sites,...` returns `"HQ-Site"`.
fn extract_cn_from_dn(dn: &str) -> String {
    dn.split(',')
        .next()
        .and_then(|p| p.strip_prefix("CN=").or_else(|| p.strip_prefix("cn=")))
        .unwrap_or("")
        .to_string()
}

/// Extracts the site name from a server DN.
///
/// DN format: `CN=DC1,CN=Servers,CN=SiteName,CN=Sites,CN=Configuration,...`
fn extract_site_from_server_dn(dn: &str) -> String {
    let parts: Vec<&str> = dn.split(',').collect();
    // Index 0 = CN=DC1, 1 = CN=Servers, 2 = CN=SiteName
    if parts.len() >= 3 {
        parts[2]
            .trim()
            .strip_prefix("CN=")
            .or_else(|| parts[2].trim().strip_prefix("cn="))
            .unwrap_or("Unknown")
            .to_string()
    } else {
        "Unknown".to_string()
    }
}

/// Extracts the parent NTDS Settings DN from a connection DN.
///
/// Connection DN: `CN=<guid>,CN=NTDS Settings,CN=DC1,CN=Servers,...`
/// Returns: `CN=NTDS Settings,CN=DC1,CN=Servers,...`
fn extract_parent_ntds_dn(connection_dn: &str) -> String {
    if let Some(idx) = connection_dn.find(',') {
        connection_dn[idx + 1..].to_string()
    } else {
        connection_dn.to_string()
    }
}

/// Extracts a readable DC name from an NTDS Settings DN.
///
/// NTDS Settings DN: `CN=NTDS Settings,CN=DC1,CN=Servers,...`
/// Returns: `"DC1"`
fn extract_dc_name_from_ntds_dn(ntds_dn: &str) -> String {
    let parts: Vec<&str> = ntds_dn.split(',').collect();
    if parts.len() >= 2 {
        parts[1]
            .trim()
            .strip_prefix("CN=")
            .or_else(|| parts[1].trim().strip_prefix("cn="))
            .unwrap_or(parts[1].trim())
            .to_string()
    } else {
        ntds_dn.to_string()
    }
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DirectoryEntry;
    use crate::services::directory::tests::MockDirectoryProvider;
    use std::collections::HashMap;

    fn make_entry(dn: &str, attrs: Vec<(&str, Vec<&str>)>) -> DirectoryEntry {
        let mut attributes = HashMap::new();
        for (key, values) in attrs {
            attributes.insert(
                key.to_string(),
                values.iter().map(|v| v.to_string()).collect(),
            );
        }
        DirectoryEntry {
            distinguished_name: dn.to_string(),
            sam_account_name: None,
            display_name: None,
            object_class: None,
            attributes,
        }
    }

    // -----------------------------------------------------------------------
    // Helper function tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_extract_cn_from_dn() {
        assert_eq!(
            extract_cn_from_dn("CN=HQ-Site,CN=Sites,CN=Configuration,DC=example,DC=com"),
            "HQ-Site"
        );
    }

    #[test]
    fn test_extract_cn_from_dn_lowercase() {
        assert_eq!(extract_cn_from_dn("cn=test,cn=other"), "test");
    }

    #[test]
    fn test_extract_cn_from_dn_empty() {
        assert_eq!(extract_cn_from_dn(""), "");
    }

    #[test]
    fn test_extract_site_from_server_dn() {
        let dn = "CN=DC1,CN=Servers,CN=Default-First-Site-Name,CN=Sites,CN=Configuration,DC=example,DC=com";
        assert_eq!(extract_site_from_server_dn(dn), "Default-First-Site-Name");
    }

    #[test]
    fn test_extract_site_from_server_dn_short() {
        assert_eq!(extract_site_from_server_dn("CN=DC1"), "Unknown");
    }

    #[test]
    fn test_extract_parent_ntds_dn() {
        let conn_dn = "CN=abc-guid,CN=NTDS Settings,CN=DC1,CN=Servers,CN=Site,CN=Sites,CN=Configuration,DC=example,DC=com";
        let result = extract_parent_ntds_dn(conn_dn);
        assert!(result.starts_with("CN=NTDS Settings,CN=DC1"));
    }

    #[test]
    fn test_extract_parent_ntds_dn_no_comma() {
        assert_eq!(extract_parent_ntds_dn("CN=only"), "CN=only");
    }

    #[test]
    fn test_extract_dc_name_from_ntds_dn() {
        let ntds_dn = "CN=NTDS Settings,CN=DC1,CN=Servers,CN=Default-First-Site-Name,CN=Sites,CN=Configuration,DC=example,DC=com";
        assert_eq!(extract_dc_name_from_ntds_dn(ntds_dn), "DC1");
    }

    #[test]
    fn test_extract_dc_name_from_ntds_dn_short() {
        assert_eq!(
            extract_dc_name_from_ntds_dn("CN=NTDS Settings"),
            "CN=NTDS Settings"
        );
    }

    // -----------------------------------------------------------------------
    // Assembly logic tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_assemble_sites_with_dcs() {
        let sites = vec![make_entry(
            "CN=HQ-Site,CN=Sites,CN=Configuration,DC=example,DC=com",
            vec![("location", vec!["Headquarters"])],
        )];

        let servers = vec![make_entry(
            "CN=DC1,CN=Servers,CN=HQ-Site,CN=Sites,CN=Configuration,DC=example,DC=com",
            vec![
                ("dNSHostName", vec!["DC1.example.com"]),
                ("options", vec!["1"]),
            ],
        )];

        let result = assemble_topology(
            "DC=example,DC=com",
            &sites,
            &servers,
            &[],
            &[],
            &[],
            &[],
            &[],
        )
        .unwrap();

        assert_eq!(result.sites.len(), 1);
        assert_eq!(result.sites[0].name, "HQ-Site");
        assert_eq!(result.sites[0].location, Some("Headquarters".to_string()));
        assert_eq!(result.sites[0].dcs.len(), 1);
        assert_eq!(result.sites[0].dcs[0].hostname, "DC1.example.com");
        assert_eq!(result.sites[0].dcs[0].site_name, "HQ-Site");
        assert!(result.sites[0].dcs[0].is_gc);
    }

    #[test]
    fn test_assemble_pdc_detection() {
        let sites = vec![make_entry(
            "CN=Site1,CN=Sites,CN=Configuration,DC=example,DC=com",
            vec![],
        )];

        let servers = vec![
            make_entry(
                "CN=DC1,CN=Servers,CN=Site1,CN=Sites,CN=Configuration,DC=example,DC=com",
                vec![
                    ("dNSHostName", vec!["DC1.example.com"]),
                    ("fSMORoleOwner", vec!["CN=NTDS Settings,CN=DC1,..."]),
                ],
            ),
            make_entry(
                "CN=DC2,CN=Servers,CN=Site1,CN=Sites,CN=Configuration,DC=example,DC=com",
                vec![("dNSHostName", vec!["DC2.example.com"])],
            ),
        ];

        let fsmo_roles: Vec<(&str, String)> = vec![
            ("PDC", "cn=ntds settings,cn=dc1,cn=servers,cn=site1,cn=sites,cn=configuration,dc=example,dc=com".to_string()),
        ];

        let result = assemble_topology(
            "DC=example,DC=com",
            &sites,
            &servers,
            &[],
            &[],
            &[],
            &[],
            &fsmo_roles,
        )
        .unwrap();

        assert!(result.sites[0].dcs[0].is_pdc);
        assert!(!result.sites[0].dcs[1].is_pdc);
    }

    #[test]
    fn test_assemble_replication_links_healthy() {
        let servers = vec![
            make_entry(
                "CN=DC1,CN=Servers,CN=Site1,CN=Sites,CN=Configuration,DC=example,DC=com",
                vec![("dNSHostName", vec!["DC1.example.com"])],
            ),
            make_entry(
                "CN=DC2,CN=Servers,CN=Site1,CN=Sites,CN=Configuration,DC=example,DC=com",
                vec![("dNSHostName", vec!["DC2.example.com"])],
            ),
        ];

        let connections = vec![make_entry(
            "CN=abc-guid,CN=NTDS Settings,CN=DC2,CN=Servers,CN=Site1,CN=Sites,CN=Configuration,DC=example,DC=com",
            vec![
                ("fromServer", vec!["CN=NTDS Settings,CN=DC1,CN=Servers,CN=Site1,CN=Sites,CN=Configuration,DC=example,DC=com"]),
                ("whenChanged", vec!["2026-03-21T10:00:00Z"]),
            ],
        )];

        let result = assemble_topology(
            "DC=example,DC=com",
            &[],
            &servers,
            &connections,
            &[],
            &[],
            &[],
            &[],
        )
        .unwrap();

        assert_eq!(result.replication_links.len(), 1);
        assert_eq!(result.replication_links[0].source_dc, "DC1.example.com");
        assert_eq!(result.replication_links[0].target_dc, "DC2.example.com");
        assert_eq!(result.replication_links[0].status, "Healthy");
        assert_eq!(result.replication_links[0].error_count, 0);
    }

    #[test]
    fn test_assemble_replication_links_failed() {
        let connections = vec![make_entry(
            "CN=abc-guid,CN=NTDS Settings,CN=DC2,CN=Servers,CN=Site1,CN=Sites,CN=Configuration,DC=example,DC=com",
            vec![
                ("fromServer", vec!["CN=NTDS Settings,CN=DC1,CN=Servers,CN=Site1,CN=Sites,CN=Configuration,DC=example,DC=com"]),
                ("msDS-ReplLastSyncResult", vec!["8453"]),
                ("msDS-ReplConsecutiveSyncFailures", vec!["3"]),
            ],
        )];

        let result = assemble_topology(
            "DC=example,DC=com",
            &[],
            &[],
            &connections,
            &[],
            &[],
            &[],
            &[],
        )
        .unwrap();

        assert_eq!(result.replication_links[0].status, "Failed");
        assert_eq!(result.replication_links[0].error_count, 3);
        // Source/target fall back to DC name extraction since no server map
        assert_eq!(result.replication_links[0].source_dc, "DC1");
        assert_eq!(result.replication_links[0].target_dc, "DC2");
    }

    #[test]
    fn test_assemble_replication_links_unknown_status() {
        let connections = vec![make_entry(
            "CN=abc-guid,CN=NTDS Settings,CN=DC2,CN=Servers,CN=Site1,CN=Sites,CN=Configuration,DC=example,DC=com",
            vec![("fromServer", vec!["CN=NTDS Settings,CN=DC1,CN=Servers,CN=Site1,CN=Sites,CN=Configuration,DC=example,DC=com"])],
        )];

        let result = assemble_topology(
            "DC=example,DC=com",
            &[],
            &[],
            &connections,
            &[],
            &[],
            &[],
            &[],
        )
        .unwrap();

        assert_eq!(result.replication_links[0].status, "Unknown");
    }

    #[test]
    fn test_assemble_site_links() {
        let site_link_entries = vec![make_entry(
            "CN=DEFAULTIPSITELINK,CN=IP,CN=Inter-Site Transports,CN=Sites,CN=Configuration,DC=example,DC=com",
            vec![
                ("cost", vec!["100"]),
                ("replInterval", vec!["180"]),
                ("siteList", vec![
                    "CN=Site1,CN=Sites,CN=Configuration,DC=example,DC=com",
                    "CN=Site2,CN=Sites,CN=Configuration,DC=example,DC=com",
                ]),
            ],
        )];

        let result = assemble_topology(
            "DC=example,DC=com",
            &[],
            &[],
            &[],
            &site_link_entries,
            &[],
            &[],
            &[],
        )
        .unwrap();

        assert_eq!(result.site_links.len(), 1);
        assert_eq!(result.site_links[0].name, "DEFAULTIPSITELINK");
        assert_eq!(result.site_links[0].cost, 100);
        assert_eq!(result.site_links[0].repl_interval, 180);
        assert_eq!(result.site_links[0].sites, vec!["Site1", "Site2"]);
    }

    #[test]
    fn test_assemble_site_links_defaults() {
        let site_link_entries = vec![make_entry(
            "CN=CustomLink,CN=IP,CN=Inter-Site Transports,CN=Sites,CN=Configuration,DC=example,DC=com",
            vec![],
        )];

        let result = assemble_topology(
            "DC=example,DC=com",
            &[],
            &[],
            &[],
            &site_link_entries,
            &[],
            &[],
            &[],
        )
        .unwrap();

        assert_eq!(result.site_links[0].cost, 100);
        assert_eq!(result.site_links[0].repl_interval, 180);
        assert!(result.site_links[0].sites.is_empty());
    }

    #[test]
    fn test_assemble_empty_topology() {
        let result =
            assemble_topology("DC=example,DC=com", &[], &[], &[], &[], &[], &[], &[]).unwrap();

        assert!(result.sites.is_empty());
        assert!(result.replication_links.is_empty());
        assert!(result.site_links.is_empty());
    }

    #[test]
    fn test_assemble_server_without_hostname_uses_cn_fallback() {
        let sites = vec![make_entry(
            "CN=Site1,CN=Sites,CN=Configuration,DC=example,DC=com",
            vec![],
        )];

        let servers = vec![make_entry(
            "CN=DC1,CN=Servers,CN=Site1,CN=Sites,CN=Configuration,DC=example,DC=com",
            vec![], // No dNSHostName - falls back to CN + domain
        )];

        let result = assemble_topology(
            "DC=example,DC=com",
            &sites,
            &servers,
            &[],
            &[],
            &[],
            &[],
            &[],
        )
        .unwrap();

        assert_eq!(result.sites[0].dcs.len(), 1);
        assert_eq!(result.sites[0].dcs[0].hostname, "DC1.example.com");
    }

    // -----------------------------------------------------------------------
    // Integration test with MockDirectoryProvider
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_get_topology_empty_provider() {
        let provider = Arc::new(MockDirectoryProvider::new());
        let result = get_topology(provider).await.unwrap();

        assert!(result.sites.is_empty());
        assert!(result.replication_links.is_empty());
        assert!(result.site_links.is_empty());
    }

    #[tokio::test]
    async fn test_get_topology_disconnected_provider() {
        let provider = Arc::new(MockDirectoryProvider::disconnected());
        let result = get_topology(provider).await;
        assert!(result.is_err());
    }
}
