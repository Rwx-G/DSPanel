use anyhow::Result;
use std::sync::Arc;

use crate::models::replication_status::{
    compute_replication_status, ReplicationPartnership, ReplicationStatus,
};
use crate::services::DirectoryProvider;

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

        partnerships.push(ReplicationPartnership {
            source_dc,
            target_dc,
            naming_context,
            last_sync_time,
            last_sync_result,
            consecutive_failures,
            last_sync_message,
            status,
        });
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
    // Try repadmin first (available if RSAT is installed)
    let repadmin_result = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        tokio::process::Command::new("repadmin")
            .args(["/replicate", target_dc, source_dc, naming_context])
            .output(),
    )
    .await;

    match repadmin_result {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if output.status.success() {
                return Ok(format!(
                    "Replication triggered successfully. {}",
                    stdout.trim()
                ));
            }
            anyhow::bail!(
                "Replication failed: {}",
                if stderr.is_empty() { &stdout } else { &stderr }
            );
        }
        Ok(Err(_)) => {
            // repadmin not found - fall back to PowerShell
            tracing::info!("repadmin not found, falling back to PowerShell");
        }
        Err(_) => {
            anyhow::bail!("Replication command timed out (30s)");
        }
    }

    // Fallback: PowerShell with AD module
    let ps_script = format!(
        "Import-Module ActiveDirectory -ErrorAction Stop; \
         Sync-ADObject -Source '{}' -Destination '{}' -Object '{}' -ErrorAction Stop",
        source_dc, target_dc, naming_context
    );

    let ps_output = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        tokio::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
            .output(),
    )
    .await
    .map_err(|_| anyhow::anyhow!("PowerShell replication command timed out (30s)"))?
    .map_err(|e| anyhow::anyhow!("Failed to run PowerShell: {}", e))?;

    let stdout = String::from_utf8_lossy(&ps_output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&ps_output.stderr).to_string();

    if ps_output.status.success() {
        Ok(format!(
            "Replication triggered successfully (via PowerShell). {}",
            stdout.trim()
        ))
    } else {
        anyhow::bail!(
            "Replication failed: {}. Ensure RSAT AD tools are installed.",
            if stderr.is_empty() { &stdout } else { &stderr }
        )
    }
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
}
