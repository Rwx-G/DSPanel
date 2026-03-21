use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;

use crate::models::topology::{
    SiteNode, TopologyData, TopologyDcNode, TopologyReplicationLink, TopologySiteLink,
};
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

    // Assemble topology from raw entries
    assemble_topology(
        &base_dn,
        &site_entries,
        &server_entries,
        &connection_entries,
        &site_link_entries,
    )
}

/// Assembles a `TopologyData` structure from raw directory entries.
///
/// Separated from the provider calls to allow unit testing of the
/// assembly logic with mock data.
fn assemble_topology(
    _base_dn: &str,
    site_entries: &[crate::models::DirectoryEntry],
    server_entries: &[crate::models::DirectoryEntry],
    connection_entries: &[crate::models::DirectoryEntry],
    site_link_entries: &[crate::models::DirectoryEntry],
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

    // Detect PDC Emulator: check if any server has the fSMORoleOwner attribute
    // pointing to itself (simplified heuristic - in production this is resolved
    // from the domain head object, but the topology service receives server
    // entries that may carry this attribute).
    let pdc_hostname: Option<String> = server_entries
        .iter()
        .find(|s| s.get_attribute("fSMORoleOwner").is_some())
        .and_then(|s| s.get_attribute("dNSHostName").map(|h| h.to_string()));

    // Group DCs by site
    let mut site_dcs: HashMap<String, Vec<TopologyDcNode>> = HashMap::new();
    for server in server_entries {
        let hostname = server
            .get_attribute("dNSHostName")
            .unwrap_or_default()
            .to_string();
        if hostname.is_empty() {
            continue;
        }

        let site_name = extract_site_from_server_dn(&server.distinguished_name);

        let is_gc = server
            .get_attribute("options")
            .and_then(|v| v.parse::<u32>().ok())
            .map(|opts| opts & 1 != 0)
            .unwrap_or(false);

        let is_pdc = pdc_hostname
            .as_ref()
            .map(|pdc| pdc == &hostname)
            .unwrap_or(false);

        site_dcs
            .entry(site_name.clone())
            .or_default()
            .push(TopologyDcNode {
                hostname,
                site_name,
                is_gc,
                is_pdc,
            });
    }

    // Assemble site nodes
    let sites: Vec<SiteNode> = site_entries
        .iter()
        .map(|entry| {
            let name = extract_cn_from_dn(&entry.distinguished_name);
            let location = entry.get_attribute("location").map(|s| s.to_string());
            let dcs = site_dcs.remove(&name).unwrap_or_default();

            SiteNode {
                name,
                location,
                dcs,
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
            let site_dns = entry.get_attribute_values("siteList");
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

        let result = assemble_topology("DC=example,DC=com", &sites, &servers, &[], &[]).unwrap();

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

        let result = assemble_topology("DC=example,DC=com", &sites, &servers, &[], &[]).unwrap();

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

        let result =
            assemble_topology("DC=example,DC=com", &[], &servers, &connections, &[]).unwrap();

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

        let result = assemble_topology("DC=example,DC=com", &[], &[], &connections, &[]).unwrap();

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

        let result = assemble_topology("DC=example,DC=com", &[], &[], &connections, &[]).unwrap();

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

        let result =
            assemble_topology("DC=example,DC=com", &[], &[], &[], &site_link_entries).unwrap();

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

        let result =
            assemble_topology("DC=example,DC=com", &[], &[], &[], &site_link_entries).unwrap();

        assert_eq!(result.site_links[0].cost, 100);
        assert_eq!(result.site_links[0].repl_interval, 180);
        assert!(result.site_links[0].sites.is_empty());
    }

    #[test]
    fn test_assemble_empty_topology() {
        let result = assemble_topology("DC=example,DC=com", &[], &[], &[], &[]).unwrap();

        assert!(result.sites.is_empty());
        assert!(result.replication_links.is_empty());
        assert!(result.site_links.is_empty());
    }

    #[test]
    fn test_assemble_server_without_hostname_skipped() {
        let sites = vec![make_entry(
            "CN=Site1,CN=Sites,CN=Configuration,DC=example,DC=com",
            vec![],
        )];

        let servers = vec![make_entry(
            "CN=DC1,CN=Servers,CN=Site1,CN=Sites,CN=Configuration,DC=example,DC=com",
            vec![], // No dNSHostName
        )];

        let result = assemble_topology("DC=example,DC=com", &sites, &servers, &[], &[]).unwrap();

        assert!(result.sites[0].dcs.is_empty());
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
