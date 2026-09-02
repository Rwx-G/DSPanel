//! Integration tests for the forest topology parser exposed by
//! `dspanel_lib::services::forest`, driven through the public crate surface
//! with fixture entries shaped like the `crossRef` objects a domain
//! controller returns under `CN=Partitions,CN=Configuration,<forest root>`.
//!
//! No directory is contacted: the fixtures stand in for the output of
//! `DirectoryProvider::search_configuration`.

use std::collections::HashMap;

use dspanel_lib::models::DirectoryEntry;
use dspanel_lib::services::forest::{
    FLAG_CR_NTDS_DOMAIN, ForestTopology, NTDS_DOMAIN_CROSSREF_FILTER, dns_domain_from_dn,
    parse_partitions_from_entries,
};

fn crossref_entry(
    nc_name: &str,
    dns_root: &str,
    netbios: &str,
    system_flags: i64,
) -> DirectoryEntry {
    let mut attributes: HashMap<String, Vec<String>> = HashMap::new();
    attributes.insert(
        "objectClass".to_string(),
        vec!["top".into(), "crossRef".into()],
    );
    attributes.insert("nCName".to_string(), vec![nc_name.to_string()]);
    attributes.insert("systemFlags".to_string(), vec![system_flags.to_string()]);
    if !dns_root.is_empty() {
        attributes.insert("dnsRoot".to_string(), vec![dns_root.to_string()]);
    }
    if !netbios.is_empty() {
        attributes.insert("nETBIOSName".to_string(), vec![netbios.to_string()]);
    }
    DirectoryEntry {
        distinguished_name: format!(
            "CN={},CN=Partitions,CN=Configuration,DC=corp,DC=example,DC=com",
            if netbios.is_empty() {
                "Enterprise Configuration"
            } else {
                netbios
            }
        ),
        sam_account_name: None,
        display_name: None,
        object_class: Some("crossRef".to_string()),
        attributes,
        partition_dns_name: None,
    }
}

/// The fixture from the story Dev Notes: two domain partitions plus the
/// Schema, Configuration and DNS application partitions a real forest lists.
fn forest_fixture() -> Vec<DirectoryEntry> {
    vec![
        crossref_entry("DC=corp,DC=example,DC=com", "corp.example.com", "CORP", 3),
        crossref_entry(
            "DC=eu,DC=corp,DC=example,DC=com",
            "eu.corp.example.com",
            "CORPEU",
            3,
        ),
        crossref_entry(
            "CN=Schema,CN=Configuration,DC=corp,DC=example,DC=com",
            "",
            "",
            1,
        ),
        crossref_entry("CN=Configuration,DC=corp,DC=example,DC=com", "", "", 1),
        crossref_entry("DC=ForestDnsZones,DC=corp,DC=example,DC=com", "", "", 5),
        crossref_entry("DC=DomainDnsZones,DC=corp,DC=example,DC=com", "", "", 5),
    ]
}

#[test]
fn parses_story_fixture_into_two_domain_partitions() {
    let parsed = parse_partitions_from_entries(&forest_fixture()).expect("fixture parses");
    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].dns_name, "corp.example.com");
    assert_eq!(parsed[0].distinguished_name, "DC=corp,DC=example,DC=com");
    assert_eq!(parsed[0].netbios_name.as_deref(), Some("CORP"));
    assert_eq!(parsed[1].dns_name, "eu.corp.example.com");
    assert_eq!(parsed[1].netbios_name.as_deref(), Some("CORPEU"));
}

#[test]
fn topology_from_fixture_is_multi_domain() {
    let partitions = parse_partitions_from_entries(&forest_fixture()).expect("fixture parses");
    let topology = ForestTopology { partitions };
    assert!(!topology.is_single_domain());
    assert!(
        topology
            .find_by_dn("dc=eu,dc=corp,dc=example,dc=com")
            .is_some()
    );
    assert!(topology.find_by_dns_name("EU.CORP.EXAMPLE.COM").is_some());
    assert!(topology.find_by_dns_name("apac.corp.example.com").is_none());
}

#[test]
fn server_side_filter_and_local_bit_test_agree() {
    // The LDAP filter asks the DC for the same bit the parser re-checks.
    assert!(NTDS_DOMAIN_CROSSREF_FILTER.contains(&format!(":={}", FLAG_CR_NTDS_DOMAIN)));
    let mut only_apps = forest_fixture();
    only_apps.retain(|e| {
        e.get_attribute("systemFlags")
            .and_then(|f| f.parse::<i64>().ok())
            .is_some_and(|flags| flags & FLAG_CR_NTDS_DOMAIN == 0)
    });
    assert_eq!(only_apps.len(), 4);
    assert!(parse_partitions_from_entries(&only_apps).is_err());
}

#[test]
fn dns_name_falls_back_to_nc_name_components() {
    let entry = crossref_entry("DC=apac,DC=corp,DC=example,DC=com", "", "APAC", 2);
    let parsed = parse_partitions_from_entries(&[entry]).expect("nCName fallback");
    assert_eq!(parsed[0].dns_name, "apac.corp.example.com");
    assert_eq!(
        dns_domain_from_dn("OU=Sales,DC=apac,DC=corp,DC=example,DC=com").as_deref(),
        Some("apac.corp.example.com")
    );
}
