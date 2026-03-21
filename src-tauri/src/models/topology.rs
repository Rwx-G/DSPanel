use serde::{Deserialize, Serialize};

/// Complete topology data for the AD forest, combining sites, DCs,
/// replication connections, and inter-site transport links.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyData {
    /// AD sites with their member domain controllers.
    pub sites: Vec<SiteNode>,
    /// Replication connections between domain controllers.
    pub replication_links: Vec<TopologyReplicationLink>,
    /// Inter-site transport links connecting sites.
    pub site_links: Vec<TopologySiteLink>,
}

/// Represents an AD site and the domain controllers it contains.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteNode {
    /// Site name (CN value).
    pub name: String,
    /// Physical location description, if set on the site object.
    pub location: Option<String>,
    /// Domain controllers registered in this site.
    pub dcs: Vec<TopologyDcNode>,
}

/// A domain controller within a site.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyDcNode {
    /// Fully qualified hostname of the DC.
    pub hostname: String,
    /// Name of the site this DC belongs to.
    pub site_name: String,
    /// Whether this DC is a Global Catalog server.
    pub is_gc: bool,
    /// Whether this DC holds the PDC Emulator FSMO role.
    pub is_pdc: bool,
}

/// A replication connection between two domain controllers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyReplicationLink {
    /// Hostname of the source (sending) DC.
    pub source_dc: String,
    /// Hostname of the target (receiving) DC.
    pub target_dc: String,
    /// Current status of the replication link (e.g., "Healthy", "Failed").
    pub status: String,
    /// Last successful synchronization time (ISO 8601), if known.
    pub last_sync_time: Option<String>,
    /// Number of consecutive replication errors on this link.
    pub error_count: u32,
}

/// An inter-site transport link connecting two or more AD sites.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologySiteLink {
    /// Name of the site link object.
    pub name: String,
    /// Sites connected by this link.
    pub sites: Vec<String>,
    /// Cost metric assigned to this link (lower = preferred).
    pub cost: u32,
    /// Replication interval in minutes.
    pub repl_interval: u32,
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_topology_data_serialization_roundtrip() {
        let data = TopologyData {
            sites: vec![SiteNode {
                name: "Default-First-Site-Name".to_string(),
                location: Some("HQ".to_string()),
                dcs: vec![TopologyDcNode {
                    hostname: "DC1.example.com".to_string(),
                    site_name: "Default-First-Site-Name".to_string(),
                    is_gc: true,
                    is_pdc: true,
                }],
            }],
            replication_links: vec![TopologyReplicationLink {
                source_dc: "DC1.example.com".to_string(),
                target_dc: "DC2.example.com".to_string(),
                status: "Healthy".to_string(),
                last_sync_time: Some("2026-03-21T10:00:00Z".to_string()),
                error_count: 0,
            }],
            site_links: vec![TopologySiteLink {
                name: "DEFAULTIPSITELINK".to_string(),
                sites: vec![
                    "Default-First-Site-Name".to_string(),
                    "Branch-Site".to_string(),
                ],
                cost: 100,
                repl_interval: 180,
            }],
        };

        let json = serde_json::to_string(&data).unwrap();
        let deserialized: TopologyData = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.sites.len(), 1);
        assert_eq!(deserialized.sites[0].name, "Default-First-Site-Name");
        assert_eq!(deserialized.sites[0].location, Some("HQ".to_string()));
        assert_eq!(deserialized.sites[0].dcs.len(), 1);
        assert!(deserialized.sites[0].dcs[0].is_gc);
        assert!(deserialized.sites[0].dcs[0].is_pdc);

        assert_eq!(deserialized.replication_links.len(), 1);
        assert_eq!(deserialized.replication_links[0].status, "Healthy");
        assert_eq!(deserialized.replication_links[0].error_count, 0);

        assert_eq!(deserialized.site_links.len(), 1);
        assert_eq!(deserialized.site_links[0].cost, 100);
        assert_eq!(deserialized.site_links[0].repl_interval, 180);
        assert_eq!(deserialized.site_links[0].sites.len(), 2);
    }

    #[test]
    fn test_camel_case_field_names() {
        let dc = TopologyDcNode {
            hostname: "DC1.example.com".to_string(),
            site_name: "Site1".to_string(),
            is_gc: true,
            is_pdc: false,
        };

        let json = serde_json::to_string(&dc).unwrap();
        assert!(json.contains("\"hostname\""));
        assert!(json.contains("\"siteName\""));
        assert!(json.contains("\"isGc\""));
        assert!(json.contains("\"isPdc\""));
    }

    #[test]
    fn test_optional_fields_absent() {
        let link = TopologyReplicationLink {
            source_dc: "DC1".to_string(),
            target_dc: "DC2".to_string(),
            status: "Unknown".to_string(),
            last_sync_time: None,
            error_count: 0,
        };

        let json = serde_json::to_string(&link).unwrap();
        assert!(json.contains("\"lastSyncTime\":null"));
    }

    #[test]
    fn test_site_node_no_location() {
        let site = SiteNode {
            name: "RemoteSite".to_string(),
            location: None,
            dcs: vec![],
        };

        let json = serde_json::to_string(&site).unwrap();
        assert!(json.contains("\"location\":null"));
        assert!(json.contains("\"dcs\":[]"));
    }

    #[test]
    fn test_empty_topology() {
        let data = TopologyData {
            sites: vec![],
            replication_links: vec![],
            site_links: vec![],
        };

        let json = serde_json::to_string(&data).unwrap();
        let deserialized: TopologyData = serde_json::from_str(&json).unwrap();

        assert!(deserialized.sites.is_empty());
        assert!(deserialized.replication_links.is_empty());
        assert!(deserialized.site_links.is_empty());
    }
}
