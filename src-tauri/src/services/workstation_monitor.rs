use crate::models::system_metrics::{DiskInfo, ServiceInfo, SessionInfo, SystemMetrics};

/// Collects system metrics from a remote workstation.
///
/// On Windows, runs PowerShell remoting commands (`Invoke-Command`) to gather
/// CPU, RAM, disk, services, and session data. Each metric query is independent -
/// if one fails, the others still return data.
///
/// **Authentication**: uses the Windows security context of the DSPanel process
/// (Kerberos token on domain-joined machines, local account otherwise). The LDAP
/// bind credentials (`DSPANEL_LDAP_BIND_DN`) are NOT used for WMI/PowerShell
/// remoting - these are separate authentication mechanisms.
///
/// On non-Windows platforms, returns a `SystemMetrics` with an error message
/// indicating that workstation monitoring requires Windows.
pub async fn get_system_metrics(hostname: &str) -> Result<SystemMetrics, String> {
    let timestamp = chrono::Utc::now().to_rfc3339();

    #[cfg(not(target_os = "windows"))]
    {
        let _ = hostname;
        Ok(SystemMetrics {
            cpu_usage_percent: 0.0,
            total_memory_mb: 0,
            used_memory_mb: 0,
            disks: vec![],
            services: vec![],
            sessions: vec![],
            timestamp,
            error_message: Some("Workstation monitoring requires Windows".to_string()),
        })
    }

    #[cfg(target_os = "windows")]
    {
        collect_metrics_windows(hostname, &timestamp).await
    }
}

/// Timeout for each individual PowerShell query (5 seconds).
#[cfg(target_os = "windows")]
const QUERY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Runs a PowerShell command against a remote host and returns stdout as a String.
#[cfg(target_os = "windows")]
async fn run_ps_command(hostname: &str, script: &str) -> Result<String, String> {
    use tokio::process::Command;

    let full_script = format!(
        "Invoke-Command -ComputerName '{}' -ScriptBlock {{ {} }} | ConvertTo-Json -Compress",
        hostname.replace('\'', "''"),
        script
    );

    let result = tokio::time::timeout(
        QUERY_TIMEOUT,
        Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &full_script,
            ])
            .output(),
    )
    .await;

    match result {
        Ok(Ok(output)) => {
            if output.status.success() {
                String::from_utf8(output.stdout)
                    .map_err(|e| format!("UTF-8 decode error: {e}"))
                    .map(|s| s.trim().to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("PowerShell error: {stderr}"))
            }
        }
        Ok(Err(e)) => Err(format!("Failed to execute PowerShell: {e}")),
        Err(_) => Err("PowerShell command timed out after 5 seconds".to_string()),
    }
}

/// Collects all metrics from a Windows workstation via PowerShell remoting.
/// Each query is independent - failures are logged but do not prevent other metrics.
#[cfg(target_os = "windows")]
async fn collect_metrics_windows(hostname: &str, timestamp: &str) -> Result<SystemMetrics, String> {
    let (cpu_result, mem_result, disk_result, services_result, sessions_result) = tokio::join!(
        query_cpu(hostname),
        query_memory(hostname),
        query_disks(hostname),
        query_services(hostname),
        query_sessions(hostname),
    );

    let cpu_usage_percent = cpu_result.unwrap_or_else(|e| {
        tracing::warn!(hostname, error = %e, "Failed to query CPU metrics");
        0.0
    });

    let (total_memory_mb, used_memory_mb) = mem_result.unwrap_or_else(|e| {
        tracing::warn!(hostname, error = %e, "Failed to query memory metrics");
        (0, 0)
    });

    let disks = disk_result.unwrap_or_else(|e| {
        tracing::warn!(hostname, error = %e, "Failed to query disk metrics");
        vec![]
    });

    let services = services_result.unwrap_or_else(|e| {
        tracing::warn!(hostname, error = %e, "Failed to query services");
        vec![]
    });

    let sessions = sessions_result.unwrap_or_else(|e| {
        tracing::warn!(hostname, error = %e, "Failed to query sessions");
        vec![]
    });

    Ok(SystemMetrics {
        cpu_usage_percent,
        total_memory_mb,
        used_memory_mb,
        disks,
        services,
        sessions,
        timestamp: timestamp.to_string(),
        error_message: None,
    })
}

#[cfg(target_os = "windows")]
async fn query_cpu(hostname: &str) -> Result<f64, String> {
    let script =
        "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average";
    let output = run_ps_command(hostname, script).await?;
    parse_cpu(&output)
}

#[cfg(target_os = "windows")]
async fn query_memory(hostname: &str) -> Result<(u64, u64), String> {
    let script = "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory";
    let output = run_ps_command(hostname, script).await?;
    parse_memory(&output)
}

#[cfg(target_os = "windows")]
async fn query_disks(hostname: &str) -> Result<Vec<DiskInfo>, String> {
    let script = "Get-CimInstance Win32_LogicalDisk -Filter \\\"DriveType=3\\\" | Select-Object DeviceID, Size, FreeSpace";
    let output = run_ps_command(hostname, script).await?;
    parse_disks(&output)
}

#[cfg(target_os = "windows")]
async fn query_services(hostname: &str) -> Result<Vec<ServiceInfo>, String> {
    let script = "Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq 'Auto' -or $_.State -eq 'Running' } | Select-Object Name, DisplayName, State, StartMode";
    let output = run_ps_command(hostname, script).await?;
    parse_services(&output)
}

#[cfg(target_os = "windows")]
async fn query_sessions(hostname: &str) -> Result<Vec<SessionInfo>, String> {
    let script = "Get-CimInstance Win32_LogonSession -Filter \\\"LogonType=2 or LogonType=10\\\" | ForEach-Object { $session = $_; $user = Get-CimAssociatedInstance -InputObject $session -ResultClassName Win32_Account -ErrorAction SilentlyContinue; if ($user) { [PSCustomObject]@{ Username = $user.Name; LogonTime = $session.StartTime } } } | Select-Object Username, LogonTime";
    let output = run_ps_command(hostname, script).await?;
    parse_sessions(&output)
}

// ---------------------------------------------------------------------------
// Parse functions - testable independently from PowerShell execution.
// On non-Windows platforms these are only used by tests.
// ---------------------------------------------------------------------------

/// Parses CPU usage from PowerShell JSON output.
/// Expects a plain number (e.g., `42` or `42.5`).
#[allow(dead_code)]
pub(crate) fn parse_cpu(output: &str) -> Result<f64, String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Err("Empty CPU output".to_string());
    }
    trimmed
        .parse::<f64>()
        .map_err(|e| format!("Failed to parse CPU value '{trimmed}': {e}"))
}

/// Parses memory info from PowerShell JSON output.
/// Expects: `{"TotalVisibleMemorySize":..., "FreePhysicalMemory":...}`
/// Values are in kilobytes; returns (total_mb, used_mb).
#[allow(dead_code)]
pub(crate) fn parse_memory(output: &str) -> Result<(u64, u64), String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Err("Empty memory output".to_string());
    }

    let v: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("Failed to parse memory JSON: {e}"))?;

    let total_kb = v
        .get("TotalVisibleMemorySize")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "Missing TotalVisibleMemorySize".to_string())?;

    let free_kb = v
        .get("FreePhysicalMemory")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "Missing FreePhysicalMemory".to_string())?;

    let total_mb = total_kb / 1024;
    let used_mb = total_mb.saturating_sub(free_kb / 1024);

    Ok((total_mb, used_mb))
}

/// Parses disk info from PowerShell JSON output.
/// Expects an array of `{"DeviceID":"C:", "Size":..., "FreeSpace":...}`.
/// A single object (not wrapped in an array) is also accepted.
#[allow(dead_code)]
pub(crate) fn parse_disks(output: &str) -> Result<Vec<DiskInfo>, String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let v: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("Failed to parse disk JSON: {e}"))?;

    let items = match &v {
        serde_json::Value::Array(arr) => arr.clone(),
        serde_json::Value::Object(_) => vec![v],
        _ => return Err("Unexpected disk JSON format".to_string()),
    };

    let mut disks = Vec::new();
    for item in &items {
        let device_id = item
            .get("DeviceID")
            .and_then(|v| v.as_str())
            .unwrap_or("?")
            .to_string();

        let size = item.get("Size").and_then(|v| v.as_u64()).unwrap_or(0);
        let free = item.get("FreeSpace").and_then(|v| v.as_u64()).unwrap_or(0);

        let total_gb = size as f64 / 1_073_741_824.0;
        let free_gb = free as f64 / 1_073_741_824.0;
        let used_percent = if total_gb > 0.0 {
            ((total_gb - free_gb) / total_gb) * 100.0
        } else {
            0.0
        };

        disks.push(DiskInfo {
            device_id,
            total_gb,
            free_gb,
            used_percent,
        });
    }

    Ok(disks)
}

/// Parses service info from PowerShell JSON output.
/// Expects an array of `{"Name":"...", "DisplayName":"...", "State":"...", "StartMode":"..."}`.
/// A single object is also accepted.
#[allow(dead_code)]
pub(crate) fn parse_services(output: &str) -> Result<Vec<ServiceInfo>, String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let v: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("Failed to parse services JSON: {e}"))?;

    let items = match &v {
        serde_json::Value::Array(arr) => arr.clone(),
        serde_json::Value::Object(_) => vec![v],
        _ => return Err("Unexpected services JSON format".to_string()),
    };

    let mut services = Vec::new();
    for item in &items {
        let name = item
            .get("Name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let display_name = item
            .get("DisplayName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let state = item
            .get("State")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string();
        let start_mode = item
            .get("StartMode")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string();

        services.push(ServiceInfo {
            name,
            display_name,
            state,
            start_mode,
        });
    }

    Ok(services)
}

/// Parses session info from PowerShell JSON output.
/// Expects an array of `{"Username":"...", "LogonTime":"..."}`.
/// A single object is also accepted.
#[allow(dead_code)]
pub(crate) fn parse_sessions(output: &str) -> Result<Vec<SessionInfo>, String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let v: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("Failed to parse sessions JSON: {e}"))?;

    let items = match &v {
        serde_json::Value::Array(arr) => arr.clone(),
        serde_json::Value::Object(_) => vec![v],
        _ => return Err("Unexpected sessions JSON format".to_string()),
    };

    let mut sessions = Vec::new();
    for item in &items {
        let username = item
            .get("Username")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let logon_time = item
            .get("LogonTime")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        if !username.is_empty() {
            sessions.push(SessionInfo {
                username,
                logon_time,
            });
        }
    }

    Ok(sessions)
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // CPU parsing tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_cpu_integer() {
        let result = parse_cpu("42").unwrap();
        assert!((result - 42.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_cpu_float() {
        let result = parse_cpu("75.5").unwrap();
        assert!((result - 75.5).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_cpu_with_whitespace() {
        let result = parse_cpu("  55  \n").unwrap();
        assert!((result - 55.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_cpu_empty() {
        let result = parse_cpu("");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_cpu_invalid() {
        let result = parse_cpu("not-a-number");
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // Memory parsing tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_memory_valid() {
        let json = r#"{"TotalVisibleMemorySize":16777216,"FreePhysicalMemory":8388608}"#;
        let (total, used) = parse_memory(json).unwrap();
        assert_eq!(total, 16384); // 16777216 / 1024
        assert_eq!(used, 8192); // 16384 - 8388608/1024
    }

    #[test]
    fn test_parse_memory_empty() {
        let result = parse_memory("");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_memory_missing_field() {
        let json = r#"{"TotalVisibleMemorySize":16777216}"#;
        let result = parse_memory(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_memory_invalid_json() {
        let result = parse_memory("{invalid}");
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // Disk parsing tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_disks_array() {
        let json = r#"[{"DeviceID":"C:","Size":536870912000,"FreeSpace":268435456000},{"DeviceID":"D:","Size":1073741824000,"FreeSpace":536870912000}]"#;
        let disks = parse_disks(json).unwrap();
        assert_eq!(disks.len(), 2);
        assert_eq!(disks[0].device_id, "C:");
        assert!((disks[0].total_gb - 500.0).abs() < 0.1);
        assert!((disks[0].free_gb - 250.0).abs() < 0.1);
        assert!((disks[0].used_percent - 50.0).abs() < 0.1);
    }

    #[test]
    fn test_parse_disks_single_object() {
        let json = r#"{"DeviceID":"C:","Size":107374182400,"FreeSpace":53687091200}"#;
        let disks = parse_disks(json).unwrap();
        assert_eq!(disks.len(), 1);
        assert_eq!(disks[0].device_id, "C:");
    }

    #[test]
    fn test_parse_disks_empty() {
        let disks = parse_disks("").unwrap();
        assert!(disks.is_empty());
    }

    #[test]
    fn test_parse_disks_zero_size() {
        let json = r#"{"DeviceID":"X:","Size":0,"FreeSpace":0}"#;
        let disks = parse_disks(json).unwrap();
        assert_eq!(disks.len(), 1);
        assert!((disks[0].used_percent - 0.0).abs() < f64::EPSILON);
    }

    // -----------------------------------------------------------------------
    // Services parsing tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_services_array() {
        let json = r#"[{"Name":"Spooler","DisplayName":"Print Spooler","State":"Running","StartMode":"Auto"},{"Name":"wuauserv","DisplayName":"Windows Update","State":"Stopped","StartMode":"Manual"}]"#;
        let services = parse_services(json).unwrap();
        assert_eq!(services.len(), 2);
        assert_eq!(services[0].name, "Spooler");
        assert_eq!(services[0].display_name, "Print Spooler");
        assert_eq!(services[0].state, "Running");
        assert_eq!(services[0].start_mode, "Auto");
    }

    #[test]
    fn test_parse_services_single_object() {
        let json = r#"{"Name":"BITS","DisplayName":"Background Intelligent Transfer Service","State":"Running","StartMode":"Auto"}"#;
        let services = parse_services(json).unwrap();
        assert_eq!(services.len(), 1);
        assert_eq!(services[0].name, "BITS");
    }

    #[test]
    fn test_parse_services_empty() {
        let services = parse_services("").unwrap();
        assert!(services.is_empty());
    }

    #[test]
    fn test_parse_services_missing_fields_uses_defaults() {
        let json = r#"{"Name":"svc1"}"#;
        let services = parse_services(json).unwrap();
        assert_eq!(services.len(), 1);
        assert_eq!(services[0].display_name, "");
        assert_eq!(services[0].state, "Unknown");
        assert_eq!(services[0].start_mode, "Unknown");
    }

    // -----------------------------------------------------------------------
    // Sessions parsing tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_sessions_array() {
        let json = r#"[{"Username":"jdoe","LogonTime":"2026-03-21T08:00:00"},{"Username":"admin","LogonTime":"2026-03-21T09:00:00"}]"#;
        let sessions = parse_sessions(json).unwrap();
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].username, "jdoe");
        assert!(sessions[0].logon_time.is_some());
    }

    #[test]
    fn test_parse_sessions_single_object() {
        let json = r#"{"Username":"jdoe","LogonTime":"2026-03-21T08:00:00"}"#;
        let sessions = parse_sessions(json).unwrap();
        assert_eq!(sessions.len(), 1);
    }

    #[test]
    fn test_parse_sessions_null_logon_time() {
        let json = r#"{"Username":"jdoe","LogonTime":null}"#;
        let sessions = parse_sessions(json).unwrap();
        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].logon_time.is_none());
    }

    #[test]
    fn test_parse_sessions_empty_username_skipped() {
        let json = r#"{"Username":"","LogonTime":null}"#;
        let sessions = parse_sessions(json).unwrap();
        assert!(sessions.is_empty());
    }

    #[test]
    fn test_parse_sessions_empty() {
        let sessions = parse_sessions("").unwrap();
        assert!(sessions.is_empty());
    }

    // -----------------------------------------------------------------------
    // Integration-style test for non-Windows fallback
    // -----------------------------------------------------------------------

    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn test_get_system_metrics_non_windows() {
        let result = get_system_metrics("somehost").await.unwrap();
        assert_eq!(
            result.error_message.as_deref(),
            Some("Workstation monitoring requires Windows")
        );
    }
}
