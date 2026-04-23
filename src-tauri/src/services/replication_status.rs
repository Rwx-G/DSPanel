use anyhow::Result;
use std::sync::Arc;

use crate::models::replication_status::{
    ReplicationPartnership, ReplicationStatus, compute_replication_status,
};
use crate::services::DirectoryProvider;

/// Parsed data from a single DS_REPL_NEIGHBORW XML element.
#[derive(Debug, Default)]
struct ReplNeighborXml {
    naming_context: String,
    source_dsa_address: String,
    replica_flags: u32,
    last_sync_success: Option<String>,
    last_sync_attempt: Option<String>,
    last_sync_result: u32,
    consecutive_failures: u32,
    usn_last_obj_change_synced: i64,
    transport_dn: String,
}

/// Discovers replication partnerships by querying NTDS Connection objects
/// in the AD Configuration partition.
pub async fn get_replication_partnerships(
    provider: Arc<dyn DirectoryProvider>,
) -> Result<Vec<ReplicationPartnership>> {
    let base_dn = provider
        .base_dn()
        .ok_or_else(|| anyhow::anyhow!("Not connected - no base DN"))?;

    let sites_dn = format!("CN=Sites,CN=Configuration,{}", base_dn);

    // Query NTDS Connection objects (represent replication links)
    let connections = provider
        .search_configuration(&sites_dn, "(objectClass=nTDSConnection)")
        .await?;

    // Also get server objects to map DNs to hostnames
    let servers = provider
        .search_configuration(&sites_dn, "(objectClass=server)")
        .await?;

    // Build server DN -> hostname map
    let server_map: std::collections::HashMap<String, String> = servers
        .iter()
        .filter_map(|s| {
            let hostname = s.get_attribute("dNSHostName")?.to_string();
            // Map the NTDS Settings DN to hostname
            // Server DN: CN=DC1,CN=Servers,CN=Site,... -> NTDS Settings: CN=NTDS Settings,CN=DC1,...
            let ntds_dn = format!("CN=NTDS Settings,{}", s.distinguished_name);
            Some((ntds_dn, hostname))
        })
        .collect();

    // Try to enrich with msDS-ReplAllInboundNeighbors from rootDSE (XML format)
    let repl_neighbors = match provider.read_entry("").await {
        Ok(Some(root_dse)) => {
            if let Some(xml_values) = root_dse.attributes.get("msDS-ReplAllInboundNeighbors") {
                parse_repl_neighbors_xml(xml_values)
            } else {
                Vec::new()
            }
        }
        _ => Vec::new(),
    };

    let now_ms = chrono::Utc::now().timestamp_millis();
    let mut partnerships = Vec::new();

    for conn in &connections {
        // fromServer attribute contains the source DC's NTDS Settings DN
        let source_ntds_dn = conn
            .get_attribute("fromServer")
            .unwrap_or_default()
            .to_string();

        // The connection object's parent is the target DC's NTDS Settings
        // DN: CN=<guid>,CN=NTDS Settings,CN=TargetDC,CN=Servers,...
        let target_ntds_dn = extract_parent_ntds_dn(&conn.distinguished_name);

        let source_dc = server_map
            .get(&source_ntds_dn)
            .cloned()
            .unwrap_or_else(|| extract_dc_name_from_ntds_dn(&source_ntds_dn));

        let target_dc = server_map
            .get(&target_ntds_dn)
            .cloned()
            .unwrap_or_else(|| extract_dc_name_from_ntds_dn(&target_ntds_dn));

        // Parse replication status from connection attributes
        let last_sync_result = conn
            .get_attribute("msDS-ReplLastSyncResult")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        let last_sync_time = conn
            .get_attribute("msDS-ReplLastSyncTime")
            .or_else(|| conn.get_attribute("whenChanged"))
            .map(|s| s.to_string());

        let consecutive_failures = conn
            .get_attribute("msDS-ReplConsecutiveSyncFailures")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        let last_sync_message = conn
            .get_attribute("msDS-ReplLastSyncMessage")
            .map(|s| s.to_string());

        let status =
            compute_replication_status(last_sync_result, last_sync_time.as_deref(), now_ms);

        // Naming context from the connection's transport options
        let naming_context = conn
            .get_attribute("msDS-ReplRootNamingContext")
            .unwrap_or(base_dn.as_str())
            .to_string();

        // Try to find matching msDS-ReplNeighbor data for enrichment
        let neighbor = repl_neighbors.iter().find(|n| {
            let src_match = source_dc.to_lowercase().starts_with(
                &n.source_dsa_address
                    .split('.')
                    .next()
                    .unwrap_or("")
                    .to_lowercase(),
            ) || n
                .source_dsa_address
                .to_lowercase()
                .contains(&source_dc.to_lowercase());
            let nc_match = n.naming_context.eq_ignore_ascii_case(&naming_context);
            src_match && nc_match
        });

        partnerships.push(ReplicationPartnership {
            source_dc,
            target_dc,
            naming_context,
            last_sync_time,
            last_sync_result,
            consecutive_failures,
            last_sync_message,
            status,
            usn_last_obj_change_synced: neighbor.map(|n| n.usn_last_obj_change_synced),
            last_sync_attempt: neighbor.and_then(|n| n.last_sync_attempt.clone()),
            transport: neighbor.map(|n| {
                if n.transport_dn.is_empty() || n.transport_dn.contains("IP") {
                    "RPC".to_string()
                } else {
                    "SMTP".to_string()
                }
            }),
            replica_flags: neighbor.map(|n| n.replica_flags),
        });
    }

    // Add any msDS-ReplNeighbor entries that don't match an nTDSConnection.
    // These represent active replication neighbors without a static connection object.
    for neighbor in &repl_neighbors {
        if neighbor.source_dsa_address.is_empty() {
            continue;
        }
        let source_host = neighbor
            .source_dsa_address
            .split('.')
            .next()
            .unwrap_or(&neighbor.source_dsa_address)
            .to_string();
        let already_exists = partnerships.iter().any(|p| {
            p.source_dc.eq_ignore_ascii_case(&source_host)
                && p.naming_context
                    .eq_ignore_ascii_case(&neighbor.naming_context)
        });
        if !already_exists {
            let status = compute_replication_status(
                neighbor.last_sync_result,
                neighbor.last_sync_success.as_deref(),
                now_ms,
            );
            partnerships.push(ReplicationPartnership {
                source_dc: source_host,
                target_dc: "(local)".to_string(),
                naming_context: neighbor.naming_context.clone(),
                last_sync_time: neighbor.last_sync_success.clone(),
                last_sync_result: neighbor.last_sync_result,
                consecutive_failures: neighbor.consecutive_failures,
                last_sync_message: None,
                status,
                usn_last_obj_change_synced: Some(neighbor.usn_last_obj_change_synced),
                last_sync_attempt: neighbor.last_sync_attempt.clone(),
                transport: Some(
                    if neighbor.transport_dn.is_empty() || neighbor.transport_dn.contains("IP") {
                        "RPC".to_string()
                    } else {
                        "SMTP".to_string()
                    },
                ),
                replica_flags: Some(neighbor.replica_flags),
            });
        }
    }

    // Sort: failed first, then by source DC
    partnerships.sort_by(|a, b| {
        let status_ord = |s: &ReplicationStatus| match s {
            ReplicationStatus::Failed => 0,
            ReplicationStatus::Warning => 1,
            ReplicationStatus::Unknown => 2,
            ReplicationStatus::Healthy => 3,
        };
        status_ord(&a.status)
            .cmp(&status_ord(&b.status))
            .then_with(|| a.source_dc.cmp(&b.source_dc))
    });

    Ok(partnerships)
}

/// Validates that a value looks like a valid DC hostname or DN (no injection).
///
/// Allows alphanumeric, dots, hyphens, underscores, equals, commas, and spaces
/// (for DNs like "DC=example,DC=com"). Rejects shell metacharacters.
fn validate_repadmin_arg(value: &str) -> Result<()> {
    if value.is_empty() {
        anyhow::bail!("Empty argument");
    }
    if value.len() > 512 {
        anyhow::bail!("Argument too long");
    }
    if value.chars().any(|c| {
        c.is_control()
            || matches!(
                c,
                '|' | '&'
                    | ';'
                    | '`'
                    | '$'
                    | '!'
                    | '<'
                    | '>'
                    | '"'
                    | '\''
                    | '\\'
                    | '/'
                    | '('
                    | ')'
                    | '{'
                    | '}'
                    | '['
                    | ']'
            )
    }) {
        anyhow::bail!("Argument contains invalid characters");
    }
    Ok(())
}

/// Triggers a force replication using repadmin command (Windows-only).
///
/// Validates all arguments before passing to repadmin to prevent injection.
pub async fn force_replication(
    source_dc: &str,
    target_dc: &str,
    naming_context: &str,
) -> Result<String> {
    validate_repadmin_arg(source_dc)?;
    validate_repadmin_arg(target_dc)?;
    validate_repadmin_arg(naming_context)?;

    #[cfg(target_os = "windows")]
    {
        force_replication_windows(source_dc, target_dc, naming_context).await
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (source_dc, target_dc, naming_context);
        anyhow::bail!("Force replication requires Windows")
    }
}

#[cfg(target_os = "windows")]
async fn force_replication_windows(
    source_dc: &str,
    target_dc: &str,
    naming_context: &str,
) -> Result<String> {
    // Use .NET System.DirectoryServices.ActiveDirectory via PowerShell.
    // This is available on ALL domain-joined Windows machines without RSAT.
    // It calls DsReplicaSync under the hood via the .NET Framework.
    let ps_script = format!(
        "$ErrorActionPreference = 'Stop'; \
         $ctx = New-Object System.DirectoryServices.ActiveDirectory.DirectoryContext('DirectoryServer', '{target}'); \
         $dc = [System.DirectoryServices.ActiveDirectory.DomainController]::GetDomainController($ctx); \
         $dc.SyncReplicaFromServer('{nc}', '{source}'); \
         Write-Output 'Replication triggered successfully from {source} to {target}'",
        target = target_dc,
        source = source_dc,
        nc = naming_context,
    );

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        tokio::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
            .output(),
    )
    .await
    .map_err(|_| anyhow::anyhow!("Replication command timed out (30s)"))?
    .map_err(|e| anyhow::anyhow!("Failed to run PowerShell: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout.trim().to_string())
    } else {
        let raw = if stderr.is_empty() { &stdout } else { &stderr };
        // Extract a readable message from PowerShell exception output.
        // PowerShell errors contain the actual message between quotes after the method name.
        let friendly = extract_powershell_error(raw);
        anyhow::bail!("{}", friendly)
    }
}

#[cfg(target_os = "windows")]
/// Extracts a human-readable error from PowerShell exception output.
///
/// PowerShell errors look like:
/// `Exception calling "Method" with "N" argument(s): "The actual message"`
/// This function tries to extract "The actual message" part.
fn extract_powershell_error(raw: &str) -> String {
    // Try to find the inner quoted message after "argument(s):"
    if let Some(idx) = raw.find("argument(s)") {
        let after = &raw[idx..];
        // Find the first quoted string after that
        if let Some(start) = after.find("\u{ab}") {
            // Unicode left guillemet (French PS)
            if let Some(end) = after[start + 2..].find("\u{bb}") {
                return after[start + 2..start + 2 + end].trim().to_string();
            }
        }
        if let Some(start) = after.find('"')
            && let Some(end) = after[start + 1..].find('"')
        {
            return after[start + 1..start + 1 + end].trim().to_string();
        }
    }
    // Fallback: take just the first line, trimmed
    let first_line = raw.lines().next().unwrap_or(raw).trim();
    if first_line.len() > 200 {
        format!("{}...", &first_line[..200])
    } else {
        first_line.to_string()
    }
}

/// Parses msDS-ReplAllInboundNeighbors XML values into structured data.
///
/// Each value in the attribute is an XML fragment representing one
/// DS_REPL_NEIGHBORW element with fields like oszNamingContext,
/// oszSourceDsaAddress, ftimeLastSyncSuccess, etc.
fn parse_repl_neighbors_xml(xml_values: &[String]) -> Vec<ReplNeighborXml> {
    let mut neighbors = Vec::new();

    for xml_str in xml_values {
        if let Some(neighbor) = parse_single_repl_neighbor_xml(xml_str) {
            neighbors.push(neighbor);
        }
    }

    neighbors
}

/// Parses a single DS_REPL_NEIGHBORW XML fragment.
fn parse_single_repl_neighbor_xml(xml: &str) -> Option<ReplNeighborXml> {
    use quick_xml::Reader;
    use quick_xml::events::Event;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut neighbor = ReplNeighborXml::default();
    let mut current_tag = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                current_tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
            }
            Ok(Event::Text(e)) => {
                let text = String::from_utf8_lossy(&e).trim().to_string();
                match current_tag.as_str() {
                    "oszNamingContext" => neighbor.naming_context = text,
                    "oszSourceDsaAddress" => neighbor.source_dsa_address = text,
                    "oszAsyncIntersiteTransportDN" => neighbor.transport_dn = text,
                    "dwReplicaFlags" => {
                        neighbor.replica_flags = text.parse().unwrap_or(0);
                    }
                    "ftimeLastSyncSuccess" if !text.is_empty() && text != "0" => {
                        neighbor.last_sync_success = Some(text);
                    }
                    "ftimeLastSyncAttempt" if !text.is_empty() && text != "0" => {
                        neighbor.last_sync_attempt = Some(text);
                    }
                    "dwLastSyncResult" => {
                        neighbor.last_sync_result = text.parse().unwrap_or(0);
                    }
                    "cNumConsecutiveSyncFailures" => {
                        neighbor.consecutive_failures = text.parse().unwrap_or(0);
                    }
                    "usnLastObjChangeSynced" => {
                        neighbor.usn_last_obj_change_synced = text.parse().unwrap_or(0);
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }

    if neighbor.naming_context.is_empty() && neighbor.source_dsa_address.is_empty() {
        return None;
    }

    Some(neighbor)
}

/// Extracts the parent NTDS Settings DN from a connection DN.
///
/// Connection DN: CN=<guid>,CN=NTDS Settings,CN=DC1,CN=Servers,...
/// Returns: CN=NTDS Settings,CN=DC1,CN=Servers,...
fn extract_parent_ntds_dn(connection_dn: &str) -> String {
    // Skip the first CN= component (the connection GUID)
    if let Some(idx) = connection_dn.find(',') {
        connection_dn[idx + 1..].to_string()
    } else {
        connection_dn.to_string()
    }
}

/// Extracts a readable DC name from an NTDS Settings DN.
///
/// NTDS Settings DN: CN=NTDS Settings,CN=DC1,CN=Servers,...
/// Returns: "DC1"
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

    #[test]
    fn test_extract_parent_ntds_dn() {
        let conn_dn = "CN=abc-guid,CN=NTDS Settings,CN=DC1,CN=Servers,CN=Site,CN=Sites,CN=Configuration,DC=example,DC=com";
        let result = extract_parent_ntds_dn(conn_dn);
        assert!(result.starts_with("CN=NTDS Settings,CN=DC1"));
    }

    #[test]
    fn test_extract_dc_name_from_ntds_dn() {
        let ntds_dn = "CN=NTDS Settings,CN=DC1,CN=Servers,CN=Default-First-Site-Name,CN=Sites,CN=Configuration,DC=example,DC=com";
        assert_eq!(extract_dc_name_from_ntds_dn(ntds_dn), "DC1");
    }

    #[test]
    fn test_extract_dc_name_from_ntds_dn_short() {
        let ntds_dn = "CN=NTDS Settings";
        assert_eq!(extract_dc_name_from_ntds_dn(ntds_dn), ntds_dn);
    }

    #[test]
    fn test_partnership_sorting() {
        let mut partnerships = [
            ReplicationPartnership {
                source_dc: "DC1".to_string(),
                target_dc: "DC2".to_string(),
                naming_context: "DC=example,DC=com".to_string(),
                last_sync_time: None,
                last_sync_result: 0,
                consecutive_failures: 0,
                last_sync_message: None,
                status: ReplicationStatus::Healthy,
                usn_last_obj_change_synced: None,
                last_sync_attempt: None,
                transport: None,
                replica_flags: None,
            },
            ReplicationPartnership {
                source_dc: "DC2".to_string(),
                target_dc: "DC1".to_string(),
                naming_context: "DC=example,DC=com".to_string(),
                last_sync_time: None,
                last_sync_result: 8453,
                consecutive_failures: 5,
                last_sync_message: Some("Error".to_string()),
                status: ReplicationStatus::Failed,
                usn_last_obj_change_synced: None,
                last_sync_attempt: None,
                transport: None,
                replica_flags: None,
            },
        ];

        partnerships.sort_by(|a: &ReplicationPartnership, b: &ReplicationPartnership| {
            let status_ord = |s: &ReplicationStatus| match s {
                ReplicationStatus::Failed => 0,
                ReplicationStatus::Warning => 1,
                ReplicationStatus::Unknown => 2,
                ReplicationStatus::Healthy => 3,
            };
            status_ord(&a.status)
                .cmp(&status_ord(&b.status))
                .then_with(|| a.source_dc.cmp(&b.source_dc))
        });

        assert_eq!(partnerships[0].status, ReplicationStatus::Failed);
        assert_eq!(partnerships[1].status, ReplicationStatus::Healthy);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_extract_powershell_error_with_french_guillemets() {
        let raw = r#"Exception lors de l'appel de \u{ab}GetDomainController\u{bb} avec \u{ab}1\u{bb} argument(s)\u{a0}: \u{ab}Le DC n'existe pas.\u{bb}"#;
        let result = extract_powershell_error(raw);
        assert!(!result.is_empty());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_extract_powershell_error_with_english_quotes() {
        let raw = r#"Exception calling "GetDomainController" with "1" argument(s): "The domain controller does not exist.""#;
        let result = extract_powershell_error(raw);
        assert_eq!(result, "The domain controller does not exist.");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_extract_powershell_error_fallback_to_first_line() {
        let raw = "Some generic error\nWith more details";
        let result = extract_powershell_error(raw);
        assert_eq!(result, "Some generic error");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_extract_powershell_error_truncates_long_lines() {
        let raw = "A".repeat(300);
        let result = extract_powershell_error(&raw);
        assert!(result.len() <= 204); // 200 + "..."
    }

    #[test]
    fn test_parse_repl_neighbor_xml() {
        let xml = r#"<DS_REPL_NEIGHBORW>
            <oszNamingContext>DC=example,DC=com</oszNamingContext>
            <oszSourceDsaAddress>dc2.example.com</oszSourceDsaAddress>
            <oszAsyncIntersiteTransportDN></oszAsyncIntersiteTransportDN>
            <dwReplicaFlags>117</dwReplicaFlags>
            <ftimeLastSyncSuccess>2026-03-26T10:30:00Z</ftimeLastSyncSuccess>
            <ftimeLastSyncAttempt>2026-03-26T10:30:00Z</ftimeLastSyncAttempt>
            <dwLastSyncResult>0</dwLastSyncResult>
            <cNumConsecutiveSyncFailures>0</cNumConsecutiveSyncFailures>
            <usnLastObjChangeSynced>45678</usnLastObjChangeSynced>
        </DS_REPL_NEIGHBORW>"#;

        let result = parse_single_repl_neighbor_xml(xml);
        assert!(result.is_some());
        let n = result.unwrap();
        assert_eq!(n.naming_context, "DC=example,DC=com");
        assert_eq!(n.source_dsa_address, "dc2.example.com");
        assert_eq!(n.replica_flags, 117);
        assert_eq!(n.last_sync_result, 0);
        assert_eq!(n.consecutive_failures, 0);
        assert_eq!(n.usn_last_obj_change_synced, 45678);
        assert_eq!(
            n.last_sync_success,
            Some("2026-03-26T10:30:00Z".to_string())
        );
    }

    #[test]
    fn test_parse_repl_neighbors_xml_multiple() {
        let values = vec![
            "<DS_REPL_NEIGHBORW><oszNamingContext>DC=a,DC=com</oszNamingContext><oszSourceDsaAddress>dc1.a.com</oszSourceDsaAddress><dwReplicaFlags>0</dwReplicaFlags><dwLastSyncResult>0</dwLastSyncResult><cNumConsecutiveSyncFailures>0</cNumConsecutiveSyncFailures><usnLastObjChangeSynced>100</usnLastObjChangeSynced></DS_REPL_NEIGHBORW>".to_string(),
            "<DS_REPL_NEIGHBORW><oszNamingContext>DC=a,DC=com</oszNamingContext><oszSourceDsaAddress>dc2.a.com</oszSourceDsaAddress><dwReplicaFlags>0</dwReplicaFlags><dwLastSyncResult>8453</dwLastSyncResult><cNumConsecutiveSyncFailures>3</cNumConsecutiveSyncFailures><usnLastObjChangeSynced>50</usnLastObjChangeSynced></DS_REPL_NEIGHBORW>".to_string(),
        ];
        let neighbors = parse_repl_neighbors_xml(&values);
        assert_eq!(neighbors.len(), 2);
        assert_eq!(neighbors[0].source_dsa_address, "dc1.a.com");
        assert_eq!(neighbors[1].last_sync_result, 8453);
        assert_eq!(neighbors[1].consecutive_failures, 3);
    }

    #[test]
    fn test_parse_repl_neighbor_xml_empty_returns_none() {
        let result = parse_single_repl_neighbor_xml("<DS_REPL_NEIGHBORW></DS_REPL_NEIGHBORW>");
        assert!(result.is_none());
    }

    #[test]
    fn test_validate_repadmin_arg_rejects_shell_chars() {
        assert!(validate_repadmin_arg("normal-dc.domain.com").is_ok());
        assert!(validate_repadmin_arg("DC=example,DC=com").is_ok());
        assert!(validate_repadmin_arg("bad|input").is_err());
        assert!(validate_repadmin_arg("bad;input").is_err());
        assert!(validate_repadmin_arg("").is_err());
    }

    // -----------------------------------------------------------------------
    // validate_repadmin_arg - additional edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_validate_repadmin_arg_rejects_backtick() {
        assert!(validate_repadmin_arg("dc`whoami`").is_err());
    }

    #[test]
    fn test_validate_repadmin_arg_rejects_dollar() {
        assert!(validate_repadmin_arg("$env:PATH").is_err());
    }

    #[test]
    fn test_validate_repadmin_arg_rejects_ampersand() {
        assert!(validate_repadmin_arg("dc1 & del *").is_err());
    }

    #[test]
    fn test_validate_repadmin_arg_rejects_angle_brackets() {
        assert!(validate_repadmin_arg("dc1 > output.txt").is_err());
        assert!(validate_repadmin_arg("dc1 < input.txt").is_err());
    }

    #[test]
    fn test_validate_repadmin_arg_rejects_quotes() {
        assert!(validate_repadmin_arg("dc1\"injected").is_err());
        assert!(validate_repadmin_arg("dc1'injected").is_err());
    }

    #[test]
    fn test_validate_repadmin_arg_rejects_backslash() {
        assert!(validate_repadmin_arg("dc1\\..\\secret").is_err());
    }

    #[test]
    fn test_validate_repadmin_arg_rejects_forward_slash() {
        assert!(validate_repadmin_arg("dc1/etc/passwd").is_err());
    }

    #[test]
    fn test_validate_repadmin_arg_rejects_parens_brackets_braces() {
        assert!(validate_repadmin_arg("dc1(injected)").is_err());
        assert!(validate_repadmin_arg("dc1[injected]").is_err());
        assert!(validate_repadmin_arg("dc1{injected}").is_err());
    }

    #[test]
    fn test_validate_repadmin_arg_rejects_exclamation() {
        assert!(validate_repadmin_arg("dc1!important").is_err());
    }

    #[test]
    fn test_validate_repadmin_arg_rejects_control_chars() {
        assert!(validate_repadmin_arg("dc1\nnewline").is_err());
        assert!(validate_repadmin_arg("dc1\ttab").is_err());
        assert!(validate_repadmin_arg("dc1\x00null").is_err());
    }

    #[test]
    fn test_validate_repadmin_arg_rejects_too_long() {
        let long = "A".repeat(513);
        assert!(validate_repadmin_arg(&long).is_err());
    }

    #[test]
    fn test_validate_repadmin_arg_accepts_max_length() {
        let exactly_512 = "A".repeat(512);
        assert!(validate_repadmin_arg(&exactly_512).is_ok());
    }

    #[test]
    fn test_validate_repadmin_arg_accepts_dn_with_spaces() {
        assert!(validate_repadmin_arg("DC=My Domain,DC=com").is_ok());
    }

    #[test]
    fn test_validate_repadmin_arg_accepts_underscores() {
        assert!(validate_repadmin_arg("dc_server_01.domain.com").is_ok());
    }

    // -----------------------------------------------------------------------
    // parse_single_repl_neighbor_xml - edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_repl_neighbor_xml_malformed_xml() {
        let malformed = "<DS_REPL_NEIGHBORW><oszNamingContext>DC=test";
        // Should not panic, may return partial data or None
        let result = parse_single_repl_neighbor_xml(malformed);
        // Either None or a partial result - just ensure no crash
        if let Some(n) = result {
            assert_eq!(n.naming_context, "DC=test");
        }
    }

    #[test]
    fn test_parse_repl_neighbor_xml_completely_invalid() {
        let garbage = "this is not xml at all <<<>>>";
        let result = parse_single_repl_neighbor_xml(garbage);
        // Should return None since no valid fields are populated
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_repl_neighbor_xml_missing_optional_fields() {
        let xml = r#"<DS_REPL_NEIGHBORW>
            <oszNamingContext>DC=test,DC=com</oszNamingContext>
            <oszSourceDsaAddress>dc1.test.com</oszSourceDsaAddress>
        </DS_REPL_NEIGHBORW>"#;

        let result = parse_single_repl_neighbor_xml(xml).unwrap();
        assert_eq!(result.naming_context, "DC=test,DC=com");
        assert_eq!(result.source_dsa_address, "dc1.test.com");
        assert_eq!(result.replica_flags, 0); // default
        assert_eq!(result.last_sync_result, 0); // default
        assert_eq!(result.consecutive_failures, 0); // default
        assert_eq!(result.usn_last_obj_change_synced, 0); // default
        assert!(result.last_sync_success.is_none());
        assert!(result.last_sync_attempt.is_none());
        assert!(result.transport_dn.is_empty());
    }

    #[test]
    fn test_parse_repl_neighbor_xml_zero_time_ignored() {
        let xml = r#"<DS_REPL_NEIGHBORW>
            <oszNamingContext>DC=test,DC=com</oszNamingContext>
            <oszSourceDsaAddress>dc1.test.com</oszSourceDsaAddress>
            <ftimeLastSyncSuccess>0</ftimeLastSyncSuccess>
            <ftimeLastSyncAttempt>0</ftimeLastSyncAttempt>
        </DS_REPL_NEIGHBORW>"#;

        let result = parse_single_repl_neighbor_xml(xml).unwrap();
        assert!(result.last_sync_success.is_none());
        assert!(result.last_sync_attempt.is_none());
    }

    #[test]
    fn test_parse_repl_neighbor_xml_empty_time_ignored() {
        let xml = r#"<DS_REPL_NEIGHBORW>
            <oszNamingContext>DC=test,DC=com</oszNamingContext>
            <oszSourceDsaAddress>dc1.test.com</oszSourceDsaAddress>
            <ftimeLastSyncSuccess></ftimeLastSyncSuccess>
            <ftimeLastSyncAttempt></ftimeLastSyncAttempt>
        </DS_REPL_NEIGHBORW>"#;

        let result = parse_single_repl_neighbor_xml(xml).unwrap();
        assert!(result.last_sync_success.is_none());
        assert!(result.last_sync_attempt.is_none());
    }

    #[test]
    fn test_parse_repl_neighbor_xml_invalid_number_defaults_to_zero() {
        let xml = r#"<DS_REPL_NEIGHBORW>
            <oszNamingContext>DC=test,DC=com</oszNamingContext>
            <oszSourceDsaAddress>dc1.test.com</oszSourceDsaAddress>
            <dwReplicaFlags>not_a_number</dwReplicaFlags>
            <dwLastSyncResult>abc</dwLastSyncResult>
            <cNumConsecutiveSyncFailures>xyz</cNumConsecutiveSyncFailures>
            <usnLastObjChangeSynced>nope</usnLastObjChangeSynced>
        </DS_REPL_NEIGHBORW>"#;

        let result = parse_single_repl_neighbor_xml(xml).unwrap();
        assert_eq!(result.replica_flags, 0);
        assert_eq!(result.last_sync_result, 0);
        assert_eq!(result.consecutive_failures, 0);
        assert_eq!(result.usn_last_obj_change_synced, 0);
    }

    #[test]
    fn test_parse_repl_neighbor_xml_only_naming_context_is_valid() {
        let xml = r#"<DS_REPL_NEIGHBORW>
            <oszNamingContext>DC=test,DC=com</oszNamingContext>
        </DS_REPL_NEIGHBORW>"#;

        let result = parse_single_repl_neighbor_xml(xml);
        assert!(result.is_some());
        assert_eq!(result.unwrap().naming_context, "DC=test,DC=com");
    }

    #[test]
    fn test_parse_repl_neighbor_xml_only_source_address_is_valid() {
        let xml = r#"<DS_REPL_NEIGHBORW>
            <oszSourceDsaAddress>dc1.test.com</oszSourceDsaAddress>
        </DS_REPL_NEIGHBORW>"#;

        let result = parse_single_repl_neighbor_xml(xml);
        assert!(result.is_some());
        assert_eq!(result.unwrap().source_dsa_address, "dc1.test.com");
    }

    // -----------------------------------------------------------------------
    // parse_repl_neighbors_xml - batch edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_repl_neighbors_xml_empty_list() {
        let result = parse_repl_neighbors_xml(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn test_parse_repl_neighbors_xml_skips_invalid_entries() {
        let values = vec![
            // Valid entry
            "<DS_REPL_NEIGHBORW><oszNamingContext>DC=a,DC=com</oszNamingContext><oszSourceDsaAddress>dc1.a.com</oszSourceDsaAddress><dwReplicaFlags>0</dwReplicaFlags><dwLastSyncResult>0</dwLastSyncResult><cNumConsecutiveSyncFailures>0</cNumConsecutiveSyncFailures><usnLastObjChangeSynced>100</usnLastObjChangeSynced></DS_REPL_NEIGHBORW>".to_string(),
            // Invalid entry (empty - should be skipped)
            "<DS_REPL_NEIGHBORW></DS_REPL_NEIGHBORW>".to_string(),
            // Another valid entry
            "<DS_REPL_NEIGHBORW><oszNamingContext>DC=b,DC=com</oszNamingContext><oszSourceDsaAddress>dc2.b.com</oszSourceDsaAddress><dwReplicaFlags>0</dwReplicaFlags><dwLastSyncResult>0</dwLastSyncResult><cNumConsecutiveSyncFailures>0</cNumConsecutiveSyncFailures><usnLastObjChangeSynced>200</usnLastObjChangeSynced></DS_REPL_NEIGHBORW>".to_string(),
        ];

        let result = parse_repl_neighbors_xml(&values);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].naming_context, "DC=a,DC=com");
        assert_eq!(result[1].naming_context, "DC=b,DC=com");
    }

    // -----------------------------------------------------------------------
    // Transport detection logic
    // -----------------------------------------------------------------------

    #[test]
    fn test_transport_detection_empty_dn_is_rpc() {
        let xml = r#"<DS_REPL_NEIGHBORW>
            <oszNamingContext>DC=test,DC=com</oszNamingContext>
            <oszSourceDsaAddress>dc1.test.com</oszSourceDsaAddress>
            <oszAsyncIntersiteTransportDN></oszAsyncIntersiteTransportDN>
        </DS_REPL_NEIGHBORW>"#;

        let neighbor = parse_single_repl_neighbor_xml(xml).unwrap();
        let transport = if neighbor.transport_dn.is_empty() || neighbor.transport_dn.contains("IP")
        {
            "RPC"
        } else {
            "SMTP"
        };
        assert_eq!(transport, "RPC");
    }

    #[test]
    fn test_transport_detection_ip_transport_is_rpc() {
        let xml = r#"<DS_REPL_NEIGHBORW>
            <oszNamingContext>DC=test,DC=com</oszNamingContext>
            <oszSourceDsaAddress>dc1.test.com</oszSourceDsaAddress>
            <oszAsyncIntersiteTransportDN>CN=IP,CN=Inter-Site Transports,CN=Sites,CN=Configuration,DC=test,DC=com</oszAsyncIntersiteTransportDN>
        </DS_REPL_NEIGHBORW>"#;

        let neighbor = parse_single_repl_neighbor_xml(xml).unwrap();
        let transport = if neighbor.transport_dn.is_empty() || neighbor.transport_dn.contains("IP")
        {
            "RPC"
        } else {
            "SMTP"
        };
        assert_eq!(transport, "RPC");
    }

    #[test]
    fn test_transport_detection_smtp_transport() {
        let xml = r#"<DS_REPL_NEIGHBORW>
            <oszNamingContext>DC=test,DC=com</oszNamingContext>
            <oszSourceDsaAddress>dc1.test.com</oszSourceDsaAddress>
            <oszAsyncIntersiteTransportDN>CN=SMTP,CN=Inter-Site Transports,CN=Sites,CN=Configuration,DC=test,DC=com</oszAsyncIntersiteTransportDN>
        </DS_REPL_NEIGHBORW>"#;

        let neighbor = parse_single_repl_neighbor_xml(xml).unwrap();
        let transport = if neighbor.transport_dn.is_empty() || neighbor.transport_dn.contains("IP")
        {
            "RPC"
        } else {
            "SMTP"
        };
        assert_eq!(transport, "SMTP");
    }

    // -----------------------------------------------------------------------
    // extract_parent_ntds_dn - edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_extract_parent_ntds_dn_no_comma() {
        let dn = "CN=single";
        assert_eq!(extract_parent_ntds_dn(dn), "CN=single");
    }

    #[test]
    fn test_extract_parent_ntds_dn_empty() {
        assert_eq!(extract_parent_ntds_dn(""), "");
    }

    // -----------------------------------------------------------------------
    // extract_dc_name_from_ntds_dn - edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_extract_dc_name_lowercase_cn() {
        let ntds_dn = "cn=NTDS Settings,cn=DC2,cn=Servers";
        assert_eq!(extract_dc_name_from_ntds_dn(ntds_dn), "DC2");
    }

    #[test]
    fn test_extract_dc_name_no_cn_prefix() {
        let ntds_dn = "CN=NTDS Settings,DC2,CN=Servers";
        // parts[1] = "DC2" which has no CN= prefix, so it returns "DC2" as-is
        assert_eq!(extract_dc_name_from_ntds_dn(ntds_dn), "DC2");
    }

    #[test]
    fn test_extract_dc_name_empty_string() {
        assert_eq!(extract_dc_name_from_ntds_dn(""), "");
    }

    // -----------------------------------------------------------------------
    // force_replication (non-Windows path)
    // -----------------------------------------------------------------------

    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn test_force_replication_fails_on_non_windows() {
        let result = force_replication("dc1.test.com", "dc2.test.com", "DC=test,DC=com").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("Windows"));
    }

    #[tokio::test]
    async fn test_force_replication_validates_arguments() {
        // Should fail validation before platform check
        let result = force_replication("dc1|bad", "dc2.test.com", "DC=test,DC=com").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("invalid characters"));
    }

    #[tokio::test]
    async fn test_force_replication_validates_empty_args() {
        let result = force_replication("", "dc2.test.com", "DC=test,DC=com").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("Empty"));
    }

    #[tokio::test]
    async fn test_force_replication_validates_all_three_args() {
        // Second arg invalid
        let result = force_replication("dc1.test.com", "dc2;bad", "DC=test,DC=com").await;
        assert!(result.is_err());

        // Third arg invalid
        let result = force_replication("dc1.test.com", "dc2.test.com", "DC=test$bad").await;
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // Partnership sorting - additional cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_partnership_sorting_warning_before_healthy() {
        let mut partnerships = [
            ReplicationPartnership {
                source_dc: "DC1".to_string(),
                target_dc: "DC2".to_string(),
                naming_context: "DC=example,DC=com".to_string(),
                last_sync_time: None,
                last_sync_result: 0,
                consecutive_failures: 0,
                last_sync_message: None,
                status: ReplicationStatus::Healthy,
                usn_last_obj_change_synced: None,
                last_sync_attempt: None,
                transport: None,
                replica_flags: None,
            },
            ReplicationPartnership {
                source_dc: "DC3".to_string(),
                target_dc: "DC1".to_string(),
                naming_context: "DC=example,DC=com".to_string(),
                last_sync_time: None,
                last_sync_result: 0,
                consecutive_failures: 0,
                last_sync_message: None,
                status: ReplicationStatus::Warning,
                usn_last_obj_change_synced: None,
                last_sync_attempt: None,
                transport: None,
                replica_flags: None,
            },
            ReplicationPartnership {
                source_dc: "DC2".to_string(),
                target_dc: "DC1".to_string(),
                naming_context: "DC=example,DC=com".to_string(),
                last_sync_time: None,
                last_sync_result: 0,
                consecutive_failures: 0,
                last_sync_message: None,
                status: ReplicationStatus::Unknown,
                usn_last_obj_change_synced: None,
                last_sync_attempt: None,
                transport: None,
                replica_flags: None,
            },
        ];

        partnerships.sort_by(|a, b| {
            let status_ord = |s: &ReplicationStatus| match s {
                ReplicationStatus::Failed => 0,
                ReplicationStatus::Warning => 1,
                ReplicationStatus::Unknown => 2,
                ReplicationStatus::Healthy => 3,
            };
            status_ord(&a.status)
                .cmp(&status_ord(&b.status))
                .then_with(|| a.source_dc.cmp(&b.source_dc))
        });

        assert_eq!(partnerships[0].status, ReplicationStatus::Warning);
        assert_eq!(partnerships[1].status, ReplicationStatus::Unknown);
        assert_eq!(partnerships[2].status, ReplicationStatus::Healthy);
    }

    #[test]
    fn test_partnership_sorting_same_status_by_source_dc() {
        let mut partnerships = [
            ReplicationPartnership {
                source_dc: "DC-Zebra".to_string(),
                target_dc: "DC2".to_string(),
                naming_context: "DC=example,DC=com".to_string(),
                last_sync_time: None,
                last_sync_result: 0,
                consecutive_failures: 0,
                last_sync_message: None,
                status: ReplicationStatus::Healthy,
                usn_last_obj_change_synced: None,
                last_sync_attempt: None,
                transport: None,
                replica_flags: None,
            },
            ReplicationPartnership {
                source_dc: "DC-Alpha".to_string(),
                target_dc: "DC1".to_string(),
                naming_context: "DC=example,DC=com".to_string(),
                last_sync_time: None,
                last_sync_result: 0,
                consecutive_failures: 0,
                last_sync_message: None,
                status: ReplicationStatus::Healthy,
                usn_last_obj_change_synced: None,
                last_sync_attempt: None,
                transport: None,
                replica_flags: None,
            },
        ];

        partnerships.sort_by(|a, b| {
            let status_ord = |s: &ReplicationStatus| match s {
                ReplicationStatus::Failed => 0,
                ReplicationStatus::Warning => 1,
                ReplicationStatus::Unknown => 2,
                ReplicationStatus::Healthy => 3,
            };
            status_ord(&a.status)
                .cmp(&status_ord(&b.status))
                .then_with(|| a.source_dc.cmp(&b.source_dc))
        });

        assert_eq!(partnerships[0].source_dc, "DC-Alpha");
        assert_eq!(partnerships[1].source_dc, "DC-Zebra");
    }
}
