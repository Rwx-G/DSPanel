use serde::{Deserialize, Serialize};

/// System metrics collected from a remote workstation via PowerShell.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMetrics {
    /// CPU usage percentage (0-100).
    pub cpu_usage_percent: f64,
    /// Total physical memory in megabytes.
    pub total_memory_mb: u64,
    /// Used physical memory in megabytes.
    pub used_memory_mb: u64,
    /// Disk information for each logical volume.
    pub disks: Vec<DiskInfo>,
    /// Windows services running on the workstation.
    pub services: Vec<ServiceInfo>,
    /// Active user sessions.
    pub sessions: Vec<SessionInfo>,
    /// ISO 8601 timestamp when metrics were collected.
    pub timestamp: String,
    /// Error message if the overall collection failed or the platform is unsupported.
    pub error_message: Option<String>,
}

/// Information about a single disk volume.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    /// Drive letter or device identifier (e.g., "C:").
    pub device_id: String,
    /// Total capacity in gigabytes.
    pub total_gb: f64,
    /// Free space in gigabytes.
    pub free_gb: f64,
    /// Percentage of space used (0-100).
    pub used_percent: f64,
}

/// Information about a Windows service.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    /// Internal service name.
    pub name: String,
    /// Human-readable display name.
    pub display_name: String,
    /// Current state (e.g., "Running", "Stopped").
    pub state: String,
    /// Startup mode (e.g., "Auto", "Manual", "Disabled").
    pub start_mode: String,
}

/// Information about an active user session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    /// Username of the logged-in user.
    pub username: String,
    /// Logon time as an ISO 8601 string, if available.
    pub logon_time: Option<String>,
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_system_metrics_serialization_roundtrip() {
        let metrics = SystemMetrics {
            cpu_usage_percent: 42.5,
            total_memory_mb: 16384,
            used_memory_mb: 8192,
            disks: vec![DiskInfo {
                device_id: "C:".to_string(),
                total_gb: 500.0,
                free_gb: 250.0,
                used_percent: 50.0,
            }],
            services: vec![ServiceInfo {
                name: "Spooler".to_string(),
                display_name: "Print Spooler".to_string(),
                state: "Running".to_string(),
                start_mode: "Auto".to_string(),
            }],
            sessions: vec![SessionInfo {
                username: "jdoe".to_string(),
                logon_time: Some("2026-03-21T10:00:00Z".to_string()),
            }],
            timestamp: "2026-03-21T12:00:00Z".to_string(),
            error_message: None,
        };

        let json = serde_json::to_string(&metrics).unwrap();
        let deserialized: SystemMetrics = serde_json::from_str(&json).unwrap();

        assert!((deserialized.cpu_usage_percent - 42.5).abs() < f64::EPSILON);
        assert_eq!(deserialized.total_memory_mb, 16384);
        assert_eq!(deserialized.used_memory_mb, 8192);
        assert_eq!(deserialized.disks.len(), 1);
        assert_eq!(deserialized.services.len(), 1);
        assert_eq!(deserialized.sessions.len(), 1);
        assert!(deserialized.error_message.is_none());
    }

    #[test]
    fn test_camel_case_field_names() {
        let metrics = SystemMetrics {
            cpu_usage_percent: 0.0,
            total_memory_mb: 0,
            used_memory_mb: 0,
            disks: vec![],
            services: vec![],
            sessions: vec![],
            timestamp: String::new(),
            error_message: Some("test error".to_string()),
        };

        let json = serde_json::to_string(&metrics).unwrap();
        assert!(json.contains("cpuUsagePercent"));
        assert!(json.contains("totalMemoryMb"));
        assert!(json.contains("usedMemoryMb"));
        assert!(json.contains("errorMessage"));
        assert!(!json.contains("cpu_usage_percent"));
        assert!(!json.contains("total_memory_mb"));
    }

    #[test]
    fn test_disk_info_camel_case() {
        let disk = DiskInfo {
            device_id: "D:".to_string(),
            total_gb: 1000.0,
            free_gb: 600.0,
            used_percent: 40.0,
        };

        let json = serde_json::to_string(&disk).unwrap();
        assert!(json.contains("deviceId"));
        assert!(json.contains("totalGb"));
        assert!(json.contains("freeGb"));
        assert!(json.contains("usedPercent"));
    }

    #[test]
    fn test_service_info_camel_case() {
        let svc = ServiceInfo {
            name: "wuauserv".to_string(),
            display_name: "Windows Update".to_string(),
            state: "Stopped".to_string(),
            start_mode: "Manual".to_string(),
        };

        let json = serde_json::to_string(&svc).unwrap();
        assert!(json.contains("displayName"));
        assert!(json.contains("startMode"));
    }

    #[test]
    fn test_session_info_optional_logon_time() {
        let session_with = SessionInfo {
            username: "admin".to_string(),
            logon_time: Some("2026-03-21T08:00:00Z".to_string()),
        };
        let session_without = SessionInfo {
            username: "guest".to_string(),
            logon_time: None,
        };

        let json_with = serde_json::to_string(&session_with).unwrap();
        let json_without = serde_json::to_string(&session_without).unwrap();

        assert!(json_with.contains("logonTime"));
        let deser_with: SessionInfo = serde_json::from_str(&json_with).unwrap();
        assert!(deser_with.logon_time.is_some());

        let deser_without: SessionInfo = serde_json::from_str(&json_without).unwrap();
        assert!(deser_without.logon_time.is_none());
    }

    #[test]
    fn test_system_metrics_with_error_message() {
        let metrics = SystemMetrics {
            cpu_usage_percent: 0.0,
            total_memory_mb: 0,
            used_memory_mb: 0,
            disks: vec![],
            services: vec![],
            sessions: vec![],
            timestamp: "2026-03-21T12:00:00Z".to_string(),
            error_message: Some("Workstation monitoring requires Windows".to_string()),
        };

        let json = serde_json::to_string(&metrics).unwrap();
        let deserialized: SystemMetrics = serde_json::from_str(&json).unwrap();
        assert_eq!(
            deserialized.error_message.unwrap(),
            "Workstation monitoring requires Windows"
        );
    }

    #[test]
    fn test_system_metrics_empty_collections() {
        let metrics = SystemMetrics {
            cpu_usage_percent: 99.9,
            total_memory_mb: 32768,
            used_memory_mb: 30000,
            disks: vec![],
            services: vec![],
            sessions: vec![],
            timestamp: "2026-03-21T12:00:00Z".to_string(),
            error_message: None,
        };

        let json = serde_json::to_string(&metrics).unwrap();
        let deserialized: SystemMetrics = serde_json::from_str(&json).unwrap();
        assert!(deserialized.disks.is_empty());
        assert!(deserialized.services.is_empty());
        assert!(deserialized.sessions.is_empty());
    }
}
