use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};

/// Metadata about a single attribute from AD replication data.
///
/// Parsed from the `msDS-ReplAttributeMetaData` operational attribute.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttributeMetadata {
    pub attribute_name: String,
    pub version: u64,
    pub last_originating_change_time: String,
    pub last_originating_dsa_dn: String,
    pub local_usn: u64,
    pub originating_usn: u64,
}

/// Result of querying replication metadata for an object.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicationMetadataResult {
    pub object_dn: String,
    pub attributes: Vec<AttributeMetadata>,
    pub is_available: bool,
    pub message: Option<String>,
}

/// Diff between two time points showing which attributes changed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttributeChangeDiff {
    pub attribute_name: String,
    pub version_before: u64,
    pub version_after: u64,
    pub change_time: String,
}

/// Parses `msDS-ReplAttributeMetaData` XML fragments into structured metadata.
///
/// The input is the raw string value of the operational attribute, which
/// contains multiple `<DS_REPL_ATTR_META_DATA>` XML elements. Uses `quick-xml`
/// for robust parsing that handles whitespace variations, XML attributes,
/// and namespace prefixes.
pub fn parse_replication_metadata(raw_xml: &str) -> Vec<AttributeMetadata> {
    let mut results = Vec::new();

    // Wrap in a root element to form valid XML for the parser
    let wrapped = format!("<root>{}</root>", raw_xml);
    let mut reader = Reader::from_str(&wrapped);

    let mut in_entry = false;
    let mut current_tag = String::new();
    let mut attr_name = String::new();
    let mut version: u64 = 0;
    let mut change_time = String::new();
    let mut dsa_dn = String::new();
    let mut local_usn: u64 = 0;
    let mut originating_usn: u64 = 0;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if tag == "DS_REPL_ATTR_META_DATA" {
                    in_entry = true;
                    attr_name.clear();
                    version = 0;
                    change_time.clear();
                    dsa_dn.clear();
                    local_usn = 0;
                    originating_usn = 0;
                } else if in_entry {
                    current_tag = tag;
                }
            }
            Ok(Event::Text(e)) => {
                if in_entry && !current_tag.is_empty() {
                    let text = e.unescape().unwrap_or_default().trim().to_string();
                    match current_tag.as_str() {
                        "pszAttributeName" => attr_name = text,
                        "dwVersion" => version = text.parse().unwrap_or(0),
                        "ftimeLastOriginatingChange" => change_time = text,
                        "pszLastOriginatingDsaDN" => dsa_dn = text,
                        "usnLocalChange" => local_usn = text.parse().unwrap_or(0),
                        "usnOriginatingChange" => originating_usn = text.parse().unwrap_or(0),
                        _ => {}
                    }
                }
            }
            Ok(Event::End(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if tag == "DS_REPL_ATTR_META_DATA" {
                    in_entry = false;
                    if !attr_name.is_empty() {
                        results.push(AttributeMetadata {
                            attribute_name: attr_name.clone(),
                            version,
                            last_originating_change_time: change_time.clone(),
                            last_originating_dsa_dn: dsa_dn.clone(),
                            local_usn,
                            originating_usn,
                        });
                    }
                }
                current_tag.clear();
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                tracing::warn!("XML parse error in replication metadata: {}", e);
                break;
            }
            _ => {}
        }
    }

    // Sort by change time descending (most recent first)
    results.sort_by(|a, b| {
        b.last_originating_change_time
            .cmp(&a.last_originating_change_time)
    });

    results
}

/// Computes which attributes changed between two timestamps.
///
/// Returns attributes whose `last_originating_change_time` falls between
/// `from_time` and `to_time` (inclusive).
pub fn compute_attribute_diff(
    metadata: &[AttributeMetadata],
    from_time: &str,
    to_time: &str,
) -> Vec<AttributeChangeDiff> {
    metadata
        .iter()
        .filter(|m| {
            m.last_originating_change_time.as_str() >= from_time
                && m.last_originating_change_time.as_str() <= to_time
        })
        .map(|m| AttributeChangeDiff {
            attribute_name: m.attribute_name.clone(),
            version_before: m.version.saturating_sub(1),
            version_after: m.version,
            change_time: m.last_originating_change_time.clone(),
        })
        .collect()
}

/// Gets unique timestamps from metadata for timeline display.
pub fn get_timeline_timestamps(metadata: &[AttributeMetadata]) -> Vec<String> {
    let mut timestamps: Vec<String> = metadata
        .iter()
        .map(|m| m.last_originating_change_time.clone())
        .collect();
    timestamps.sort();
    timestamps.dedup();
    timestamps.reverse(); // Most recent first
    timestamps
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_XML: &str = r#"
<DS_REPL_ATTR_META_DATA>
    <pszAttributeName>displayName</pszAttributeName>
    <dwVersion>3</dwVersion>
    <ftimeLastOriginatingChange>2026-02-15T14:30:00Z</ftimeLastOriginatingChange>
    <pszLastOriginatingDsaDN>CN=DC1,OU=Domain Controllers,DC=example,DC=com</pszLastOriginatingDsaDN>
    <usnOriginatingChange>12345</usnOriginatingChange>
    <usnLocalChange>67890</usnLocalChange>
</DS_REPL_ATTR_META_DATA>
<DS_REPL_ATTR_META_DATA>
    <pszAttributeName>department</pszAttributeName>
    <dwVersion>1</dwVersion>
    <ftimeLastOriginatingChange>2026-01-10T09:00:00Z</ftimeLastOriginatingChange>
    <pszLastOriginatingDsaDN>CN=DC2,OU=Domain Controllers,DC=example,DC=com</pszLastOriginatingDsaDN>
    <usnOriginatingChange>11111</usnOriginatingChange>
    <usnLocalChange>22222</usnLocalChange>
</DS_REPL_ATTR_META_DATA>
<DS_REPL_ATTR_META_DATA>
    <pszAttributeName>title</pszAttributeName>
    <dwVersion>5</dwVersion>
    <ftimeLastOriginatingChange>2026-03-01T08:00:00Z</ftimeLastOriginatingChange>
    <pszLastOriginatingDsaDN>CN=DC1,OU=Domain Controllers,DC=example,DC=com</pszLastOriginatingDsaDN>
    <usnOriginatingChange>33333</usnOriginatingChange>
    <usnLocalChange>44444</usnLocalChange>
</DS_REPL_ATTR_META_DATA>
"#;

    #[test]
    fn test_parse_replication_metadata() {
        let result = parse_replication_metadata(SAMPLE_XML);
        assert_eq!(result.len(), 3);
        // Sorted by change time descending
        assert_eq!(result[0].attribute_name, "title");
        assert_eq!(result[1].attribute_name, "displayName");
        assert_eq!(result[2].attribute_name, "department");
    }

    #[test]
    fn test_parse_attribute_values() {
        let result = parse_replication_metadata(SAMPLE_XML);
        let display_name = result
            .iter()
            .find(|m| m.attribute_name == "displayName")
            .unwrap();
        assert_eq!(display_name.version, 3);
        assert_eq!(
            display_name.last_originating_change_time,
            "2026-02-15T14:30:00Z"
        );
        assert!(display_name.last_originating_dsa_dn.contains("DC1"));
        assert_eq!(display_name.originating_usn, 12345);
        assert_eq!(display_name.local_usn, 67890);
    }

    #[test]
    fn test_parse_empty_input() {
        let result = parse_replication_metadata("");
        assert!(result.is_empty());
    }

    #[test]
    fn test_parse_malformed_xml() {
        let malformed = "<DS_REPL_ATTR_META_DATA><broken>data</DS_REPL_ATTR_META_DATA>";
        let result = parse_replication_metadata(malformed);
        assert!(result.is_empty()); // No pszAttributeName, so skipped
    }

    #[test]
    fn test_parse_partial_fragment() {
        let partial = r#"
<DS_REPL_ATTR_META_DATA>
    <pszAttributeName>sn</pszAttributeName>
    <dwVersion>2</dwVersion>
</DS_REPL_ATTR_META_DATA>
"#;
        let result = parse_replication_metadata(partial);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].attribute_name, "sn");
        assert_eq!(result[0].version, 2);
        // Missing fields default to empty/zero
        assert!(result[0].last_originating_change_time.is_empty());
        assert_eq!(result[0].local_usn, 0);
    }

    #[test]
    fn test_parse_xml_with_extra_whitespace() {
        let xml = r#"
<DS_REPL_ATTR_META_DATA>
    <pszAttributeName>  cn  </pszAttributeName>
    <dwVersion>  7  </dwVersion>
    <ftimeLastOriginatingChange>  2026-03-10T12:00:00Z  </ftimeLastOriginatingChange>
    <pszLastOriginatingDsaDN></pszLastOriginatingDsaDN>
    <usnOriginatingChange>100</usnOriginatingChange>
    <usnLocalChange>200</usnLocalChange>
</DS_REPL_ATTR_META_DATA>
"#;
        let result = parse_replication_metadata(xml);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].attribute_name, "cn");
        assert_eq!(result[0].version, 7);
        assert_eq!(
            result[0].last_originating_change_time,
            "2026-03-10T12:00:00Z"
        );
    }

    #[test]
    fn test_parse_xml_with_unknown_extra_tags() {
        let xml = r#"
<DS_REPL_ATTR_META_DATA>
    <pszAttributeName>mail</pszAttributeName>
    <dwVersion>1</dwVersion>
    <ftimeLastOriginatingChange>2026-01-01T00:00:00Z</ftimeLastOriginatingChange>
    <pszLastOriginatingDsaDN>CN=DC1</pszLastOriginatingDsaDN>
    <usnOriginatingChange>50</usnOriginatingChange>
    <usnLocalChange>60</usnLocalChange>
    <someUnknownTag>ignored</someUnknownTag>
</DS_REPL_ATTR_META_DATA>
"#;
        let result = parse_replication_metadata(xml);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].attribute_name, "mail");
    }

    #[test]
    fn test_compute_attribute_diff() {
        let metadata = parse_replication_metadata(SAMPLE_XML);
        let diff =
            compute_attribute_diff(&metadata, "2026-02-01T00:00:00Z", "2026-02-28T23:59:59Z");
        assert_eq!(diff.len(), 1);
        assert_eq!(diff[0].attribute_name, "displayName");
        assert_eq!(diff[0].version_before, 2);
        assert_eq!(diff[0].version_after, 3);
    }

    #[test]
    fn test_compute_attribute_diff_full_range() {
        let metadata = parse_replication_metadata(SAMPLE_XML);
        let diff =
            compute_attribute_diff(&metadata, "2025-01-01T00:00:00Z", "2027-01-01T00:00:00Z");
        assert_eq!(diff.len(), 3);
    }

    #[test]
    fn test_compute_attribute_diff_empty_range() {
        let metadata = parse_replication_metadata(SAMPLE_XML);
        let diff =
            compute_attribute_diff(&metadata, "2020-01-01T00:00:00Z", "2020-12-31T23:59:59Z");
        assert!(diff.is_empty());
    }

    #[test]
    fn test_get_timeline_timestamps() {
        let metadata = parse_replication_metadata(SAMPLE_XML);
        let timestamps = get_timeline_timestamps(&metadata);
        assert_eq!(timestamps.len(), 3);
        // Most recent first
        assert_eq!(timestamps[0], "2026-03-01T08:00:00Z");
        assert_eq!(timestamps[2], "2026-01-10T09:00:00Z");
    }

    #[test]
    fn test_get_timeline_timestamps_dedup() {
        let metadata = vec![
            AttributeMetadata {
                attribute_name: "a".to_string(),
                version: 1,
                last_originating_change_time: "2026-01-01T00:00:00Z".to_string(),
                last_originating_dsa_dn: String::new(),
                local_usn: 0,
                originating_usn: 0,
            },
            AttributeMetadata {
                attribute_name: "b".to_string(),
                version: 1,
                last_originating_change_time: "2026-01-01T00:00:00Z".to_string(),
                last_originating_dsa_dn: String::new(),
                local_usn: 0,
                originating_usn: 0,
            },
        ];
        let timestamps = get_timeline_timestamps(&metadata);
        assert_eq!(timestamps.len(), 1);
    }

    #[test]
    fn test_metadata_serialization() {
        let meta = AttributeMetadata {
            attribute_name: "displayName".to_string(),
            version: 3,
            last_originating_change_time: "2026-02-15T14:30:00Z".to_string(),
            last_originating_dsa_dn: "CN=DC1".to_string(),
            local_usn: 67890,
            originating_usn: 12345,
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("attributeName"));
        assert!(json.contains("lastOriginatingChangeTime"));
        assert!(json.contains("lastOriginatingDsaDn"));
        assert!(json.contains("localUsn"));
        assert!(json.contains("originatingUsn"));
    }

    #[test]
    fn test_replication_result_serialization() {
        let result = ReplicationMetadataResult {
            object_dn: "CN=Test,DC=example,DC=com".to_string(),
            attributes: vec![],
            is_available: true,
            message: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("objectDn"));
        assert!(json.contains("isAvailable"));
    }

    #[test]
    fn test_replication_result_not_available() {
        let result = ReplicationMetadataResult {
            object_dn: "CN=Test,DC=example,DC=com".to_string(),
            attributes: vec![],
            is_available: false,
            message: Some("Metadata not available for this object".to_string()),
        };
        assert!(!result.is_available);
        assert!(result.message.is_some());
    }

    #[test]
    fn test_diff_serialization() {
        let diff = AttributeChangeDiff {
            attribute_name: "title".to_string(),
            version_before: 4,
            version_after: 5,
            change_time: "2026-03-01T08:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&diff).unwrap();
        assert!(json.contains("attributeName"));
        assert!(json.contains("versionBefore"));
        assert!(json.contains("versionAfter"));
        assert!(json.contains("changeTime"));
    }
}
