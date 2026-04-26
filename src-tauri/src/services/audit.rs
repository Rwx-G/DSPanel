use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs, UdpSocket};
use std::path::PathBuf;
use std::sync::Mutex;

/// Severity dimension on an audit entry. Independent of the success flag:
/// a Critical event can be either a successful Critical action (e.g. an
/// admin disabled unconstrained delegation) or a failed one. SOC consumers
/// filter on this field to surface the small set of Critical actions
/// without needing to maintain a regex over action-name strings.
///
/// Defaults to Info so existing call sites and pre-migration database rows
/// land on the safe lowest-severity bucket.
#[derive(Default, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuditSeverity {
    #[default]
    Info,
    Warning,
    Critical,
}

impl AuditSeverity {
    /// Stable lowercase string used for SQLite persistence and the syslog
    /// structured-data field. Round-trips with `from_db_str`.
    pub fn as_str(&self) -> &'static str {
        match self {
            AuditSeverity::Info => "info",
            AuditSeverity::Warning => "warning",
            AuditSeverity::Critical => "critical",
        }
    }

    /// Parses the SQLite TEXT column. Unknown / NULL values fall back to
    /// `Info` so a corrupted row does not poison the read path.
    pub fn from_db_str(s: &str) -> Self {
        match s {
            "warning" => AuditSeverity::Warning,
            "critical" => AuditSeverity::Critical,
            _ => AuditSeverity::Info,
        }
    }
}

/// Represents a single audit log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub timestamp: String,
    pub operator: String,
    pub action: String,
    pub target_dn: String,
    pub details: String,
    pub success: bool,
    /// Severity classification. Defaults to `Info` so existing call sites
    /// that use `log_success` / `log_failure` (without `_with_severity`)
    /// continue to compile and produce non-Critical entries. Pre-migration
    /// database rows also resolve to `Info` via `serde(default)` and the
    /// `from_db_str` fallback.
    #[serde(default)]
    pub severity: AuditSeverity,
}

/// Result of hash chain verification.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainVerification {
    pub valid: bool,
    pub total_entries: usize,
    pub verified_entries: usize,
    /// ID of the first tampered entry, if any.
    pub first_invalid_id: Option<i64>,
}

/// Transport used by the remote syslog forwarder.
///
/// UDP (RFC 5426) is the historical default - low overhead but silently
/// drops messages on packet loss. TCP (RFC 6587, octet-counting framing) is
/// reliable but requires a long-lived connection and a syslog daemon that
/// accepts TCP (rsyslog, syslog-ng, Splunk, Datadog Agent, etc.). Operators
/// who route audit entries to a SIEM should pick TCP so a missed message
/// becomes a logged write error rather than a silent gap.
#[derive(Default, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyslogTransport {
    #[default]
    Udp,
    Tcp,
}

/// Remote syslog forwarding configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyslogSettings {
    /// Enable remote syslog forwarding.
    #[serde(default)]
    pub enabled: bool,
    /// Syslog server hostname or IP address.
    #[serde(default)]
    pub host: String,
    /// Syslog server port (default: 514).
    #[serde(default = "default_syslog_port")]
    pub port: u16,
    /// Transport (default: udp - kept for backward compatibility).
    #[serde(default)]
    pub transport: SyslogTransport,
}

fn default_syslog_port() -> u16 {
    514
}

impl Default for SyslogSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            host: String::new(),
            port: 514,
            transport: SyslogTransport::Udp,
        }
    }
}

/// Service for recording audit trail of sensitive operations.
///
/// Every write operation (password reset, account enable/disable, flag changes)
/// must be logged through this service. Password values are never recorded.
/// Entries are stored in a SQLite database with hash-chain integrity.
/// Optionally forwards entries to a remote syslog server (RFC 5424 UDP).
pub struct AuditService {
    conn: Mutex<Connection>,
    operator: Mutex<String>,
    syslog: Mutex<Option<SyslogForwarder>>,
}

/// Lightweight syslog forwarder for RFC 5424 messages over UDP or TCP.
struct SyslogForwarder {
    transport: SyslogChannel,
    addr: String,
}

enum SyslogChannel {
    Udp(UdpSocket),
    /// TCP connection wrapped in a Mutex because `TcpStream::write_all`
    /// needs `&mut self` while `SyslogForwarder::send` is `&self`. The outer
    /// `Mutex<Option<SyslogForwarder>>` already serializes access; this
    /// inner Mutex is only there to satisfy the type system.
    Tcp(std::sync::Mutex<TcpStream>),
}

impl Default for AuditService {
    fn default() -> Self {
        Self::new()
    }
}

impl SyslogForwarder {
    fn new(settings: &SyslogSettings) -> Option<Self> {
        if !settings.enabled || settings.host.is_empty() {
            return None;
        }
        let addr = format!("{}:{}", settings.host, settings.port);
        match settings.transport {
            SyslogTransport::Udp => match UdpSocket::bind("0.0.0.0:0") {
                Ok(socket) => {
                    tracing::info!(addr = %addr, transport = "udp", "Syslog forwarder initialized");
                    Some(Self {
                        transport: SyslogChannel::Udp(socket),
                        addr,
                    })
                }
                Err(e) => {
                    tracing::warn!("Failed to create syslog UDP socket: {}", e);
                    None
                }
            },
            SyslogTransport::Tcp => {
                let resolved: Option<std::net::SocketAddr> =
                    addr.to_socket_addrs().ok().and_then(|mut it| it.next());
                let socket_addr = match resolved {
                    Some(a) => a,
                    None => {
                        tracing::warn!(addr = %addr, "Syslog TCP: address resolution failed");
                        return None;
                    }
                };
                match TcpStream::connect_timeout(&socket_addr, std::time::Duration::from_secs(5)) {
                    Ok(stream) => {
                        // Disable Nagle so audit entries reach the SIEM without
                        // being held in the TCP coalesce buffer.
                        let _ = stream.set_nodelay(true);
                        tracing::info!(addr = %addr, transport = "tcp", "Syslog forwarder initialized");
                        Some(Self {
                            transport: SyslogChannel::Tcp(std::sync::Mutex::new(stream)),
                            addr,
                        })
                    }
                    Err(e) => {
                        tracing::warn!(addr = %addr, error = %e, "Syslog TCP connect failed");
                        None
                    }
                }
            }
        }
    }

    /// Sends one audit entry as an RFC 5424 syslog message
    /// (facility=local0, severity=critical/warning/info per AuditSeverity).
    ///
    /// UDP path emits a single datagram. TCP path uses RFC 6587 octet-counting
    /// framing (`<length> <SP> <message>`) which is the modern reliable framing
    /// supported by rsyslog/syslog-ng/Splunk/Datadog. No retry/reconnect is
    /// attempted on TCP write error - the next entry will surface the failure
    /// and the operator will see the WARN log.
    ///
    /// Severity mapping (RFC 5424 numeric):
    /// - `Critical` → 2 (overrides success/failure - SOC alerting tier)
    /// - `Warning`  → 4
    /// - `Info`     → 6 on success, 4 on failure (matches the pre-severity
    ///   default so existing collectors keep parsing the same priority)
    fn send(&self, entry: &AuditEntry) {
        let severity: u8 = match entry.severity {
            AuditSeverity::Critical => 2,
            AuditSeverity::Warning => 4,
            AuditSeverity::Info => {
                if entry.success {
                    6
                } else {
                    4
                }
            }
        };
        let priority = 16 * 8 + severity;
        let hostname = gethostname();
        let msg = format!(
            "<{}>1 {} {} DSPanel - - [operator=\"{}\" action=\"{}\" target=\"{}\" success={} severity=\"{}\"] {}",
            priority,
            entry.timestamp,
            hostname,
            entry.operator,
            entry.action,
            entry.target_dn,
            entry.success,
            entry.severity.as_str(),
            entry.details,
        );
        match &self.transport {
            SyslogChannel::Udp(socket) => {
                if let Err(e) = socket.send_to(msg.as_bytes(), &self.addr) {
                    tracing::debug!("Syslog UDP send failed: {}", e);
                }
            }
            SyslogChannel::Tcp(stream) => {
                let framed = format!("{} {}", msg.len(), msg);
                let mut guard = match stream.lock() {
                    Ok(g) => g,
                    Err(poisoned) => poisoned.into_inner(),
                };
                if let Err(e) = guard.write_all(framed.as_bytes()) {
                    tracing::warn!(
                        addr = %self.addr,
                        error = %e,
                        "Syslog TCP send failed - SIEM may be missing audit entries"
                    );
                }
            }
        }
    }
}

fn gethostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown".to_string())
}

impl AuditService {
    pub fn new() -> Self {
        let operator = std::env::var("USERNAME").unwrap_or_else(|_| "Unknown".to_string());
        let persist_path = Self::resolve_persist_path();

        let conn = match &persist_path {
            Some(path) => Connection::open(path).unwrap_or_else(|e| {
                tracing::warn!(
                    "Failed to open audit DB at {}: {}, using in-memory",
                    path.display(),
                    e
                );
                Connection::open_in_memory().expect("Failed to open in-memory SQLite")
            }),
            None => Connection::open_in_memory().expect("Failed to open in-memory SQLite"),
        };

        let svc = Self {
            conn: Mutex::new(conn),
            operator: Mutex::new(operator),
            syslog: Mutex::new(None),
        };
        svc.init_schema();
        svc
    }

    /// Configures remote syslog forwarding. Call after settings are loaded.
    pub fn configure_syslog(&self, settings: &SyslogSettings) {
        *self.syslog.lock().expect("lock poisoned") = SyslogForwarder::new(settings);
    }

    /// Updates the operator identity (called after WhoAmI resolves the
    /// authenticated user, which may differ from the Windows USERNAME).
    pub fn set_operator(&self, operator: String) {
        *self.operator.lock().expect("lock poisoned") = operator;
    }

    /// Creates an AuditService with an in-memory database (for testing).
    #[allow(clippy::unwrap_used)]
    #[cfg(test)]
    pub fn new_in_memory() -> Self {
        let conn = Connection::open_in_memory().expect("Failed to open in-memory SQLite");
        let svc = Self {
            conn: Mutex::new(conn),
            operator: Mutex::new(std::env::var("USERNAME").unwrap_or_else(|_| "Test".to_string())),
            syslog: Mutex::new(None),
        };
        svc.init_schema();
        svc
    }

    fn resolve_persist_path() -> Option<PathBuf> {
        let base = std::env::var("LOCALAPPDATA")
            .or_else(|_| std::env::var("HOME"))
            .ok()?;
        let dir = PathBuf::from(base).join("DSPanel");
        if !dir.exists() {
            fs::create_dir_all(&dir).ok()?;
        }
        Some(dir.join("audit.db"))
    }

    fn init_schema(&self) {
        let conn = self.conn.lock().expect("lock poisoned");
        if let Err(e) = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS audit_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                operator TEXT NOT NULL,
                action TEXT NOT NULL,
                target_dn TEXT NOT NULL,
                details TEXT NOT NULL,
                success INTEGER NOT NULL,
                hash TEXT NOT NULL DEFAULT '',
                prev_hash TEXT NOT NULL DEFAULT '',
                severity TEXT NOT NULL DEFAULT 'info'
            );
            CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_entries(timestamp);
            CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_entries(action);
            CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_entries(severity);",
        ) {
            tracing::error!("Failed to initialize audit schema: {}", e);
        }
        // Migrate existing databases that lack the hash columns
        let _ = conn.execute_batch(
            "ALTER TABLE audit_entries ADD COLUMN hash TEXT NOT NULL DEFAULT '';
             ALTER TABLE audit_entries ADD COLUMN prev_hash TEXT NOT NULL DEFAULT '';",
        );
        // Migrate existing databases that lack the severity column. Pre-existing
        // rows default to 'info' which is the same value the new code writes
        // for every call site that does not opt in to AuditSeverity::Critical.
        let _ = conn.execute_batch(
            "ALTER TABLE audit_entries ADD COLUMN severity TEXT NOT NULL DEFAULT 'info';",
        );
    }

    /// Computes the SHA-256 hash for an audit entry given the previous hash.
    ///
    /// Severity is intentionally NOT included in the hash so adding the
    /// severity column does not invalidate any existing chain on upgrade.
    /// The audit-truth fields the chain protects (operator, action,
    /// target, success) cover what the operator did and whether it
    /// succeeded; severity is a SOC categorisation hint that callers can
    /// adjust without rewriting history.
    fn compute_hash(prev_hash: &str, entry: &AuditEntry) -> String {
        let mut hasher = Sha256::new();
        hasher.update(prev_hash.as_bytes());
        hasher.update(entry.timestamp.as_bytes());
        hasher.update(entry.operator.as_bytes());
        hasher.update(entry.action.as_bytes());
        hasher.update(entry.target_dn.as_bytes());
        hasher.update(entry.details.as_bytes());
        hasher.update(if entry.success { b"1" } else { b"0" });
        format!("{:x}", hasher.finalize())
    }

    fn insert_entry(&self, entry: &AuditEntry) {
        let conn = self.conn.lock().expect("lock poisoned");

        // Fetch the hash of the last entry to chain
        let prev_hash: String = conn
            .query_row(
                "SELECT hash FROM audit_entries ORDER BY id DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();

        let hash = Self::compute_hash(&prev_hash, entry);

        if let Err(e) = conn.execute(
            "INSERT INTO audit_entries (timestamp, operator, action, target_dn, details, success, hash, prev_hash, severity)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                entry.timestamp,
                entry.operator,
                entry.action,
                entry.target_dn,
                entry.details,
                entry.success as i32,
                hash,
                prev_hash,
                entry.severity.as_str(),
            ],
        ) {
            tracing::error!("Failed to insert audit entry: {}", e);
        }

        // Forward to syslog if configured
        if let Some(ref fwd) = *self.syslog.lock().expect("lock poisoned") {
            fwd.send(entry);
        }
    }

    /// Logs a successful operation at the default `Info` severity.
    pub fn log_success(&self, action: &str, target_dn: &str, details: &str) {
        self.log_success_with_severity(action, target_dn, details, AuditSeverity::Info);
    }

    /// Logs a successful operation with an explicit severity. Use
    /// `AuditSeverity::Critical` for high-blast-radius write operations
    /// (e.g. disable unconstrained delegation, demote a Domain Admin)
    /// so SOC dashboards can filter by severity instead of grepping
    /// action-name strings.
    pub fn log_success_with_severity(
        &self,
        action: &str,
        target_dn: &str,
        details: &str,
        severity: AuditSeverity,
    ) {
        let entry = AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            operator: self.operator.lock().expect("lock poisoned").clone(),
            action: action.to_string(),
            target_dn: target_dn.to_string(),
            details: details.to_string(),
            success: true,
            severity,
        };
        tracing::info!(
            action = %entry.action,
            target = %entry.target_dn,
            operator = %entry.operator,
            severity = entry.severity.as_str(),
            "Audit: {}",
            details
        );
        self.insert_entry(&entry);
    }

    /// Logs a failed operation at the default `Info` severity.
    pub fn log_failure(&self, action: &str, target_dn: &str, error: &str) {
        self.log_failure_with_severity(action, target_dn, error, AuditSeverity::Info);
    }

    /// Logs a failed operation with an explicit severity. The Critical
    /// flavour is the right choice when the failure itself is a security
    /// concern (e.g. an Admin-gated quick-fix rejected because the
    /// caller lacked the permission level).
    pub fn log_failure_with_severity(
        &self,
        action: &str,
        target_dn: &str,
        error: &str,
        severity: AuditSeverity,
    ) {
        let entry = AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            operator: self.operator.lock().expect("lock poisoned").clone(),
            action: action.to_string(),
            target_dn: target_dn.to_string(),
            details: error.to_string(),
            success: false,
            severity,
        };
        tracing::warn!(
            action = %entry.action,
            target = %entry.target_dn,
            operator = %entry.operator,
            severity = entry.severity.as_str(),
            "Audit FAILED: {}",
            error
        );
        self.insert_entry(&entry);
    }

    /// Returns all audit entries (most recent first).
    pub fn get_entries(&self) -> Vec<AuditEntry> {
        let conn = self.conn.lock().expect("lock poisoned");
        let mut stmt = match conn.prepare(
            "SELECT timestamp, operator, action, target_dn, details, success, severity
             FROM audit_entries ORDER BY id DESC",
        ) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("Failed to prepare audit query: {}", e);
                return Vec::new();
            }
        };

        let result: Vec<AuditEntry> = match stmt.query_map([], |row| {
            let severity_str: String = row.get(6)?;
            Ok(AuditEntry {
                timestamp: row.get(0)?,
                operator: row.get(1)?,
                action: row.get(2)?,
                target_dn: row.get(3)?,
                details: row.get(4)?,
                success: row.get::<_, i32>(5)? != 0,
                severity: AuditSeverity::from_db_str(&severity_str),
            })
        }) {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                tracing::error!("Failed to query audit entries: {}", e);
                Vec::new()
            }
        };
        result
    }

    /// Returns the total number of audit entries.
    pub fn count(&self) -> usize {
        let conn = self.conn.lock().expect("lock poisoned");
        conn.query_row("SELECT COUNT(*) FROM audit_entries", [], |row| {
            row.get::<_, i64>(0).map(|n| n as usize)
        })
        .unwrap_or(0)
    }

    /// Queries audit entries with optional filters and pagination.
    /// Returns matching entries and total count (for pagination).
    pub fn query_filtered(&self, filter: &AuditFilter) -> AuditQueryResult {
        let conn = self.conn.lock().expect("lock poisoned");

        let mut where_clauses: Vec<String> = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(ref from) = filter.date_from {
            where_clauses.push(format!("timestamp >= ?{}", params.len() + 1));
            params.push(Box::new(from.clone()));
        }
        if let Some(ref to) = filter.date_to {
            where_clauses.push(format!("timestamp <= ?{}", params.len() + 1));
            params.push(Box::new(to.clone()));
        }
        if let Some(ref user) = filter.operator
            && !user.is_empty()
        {
            where_clauses.push(format!("operator LIKE ?{}", params.len() + 1));
            params.push(Box::new(format!("%{}%", user)));
        }
        if let Some(ref action) = filter.action
            && !action.is_empty()
        {
            where_clauses.push(format!("action = ?{}", params.len() + 1));
            params.push(Box::new(action.clone()));
        }
        if let Some(ref target) = filter.target_dn
            && !target.is_empty()
        {
            where_clauses.push(format!("target_dn LIKE ?{}", params.len() + 1));
            params.push(Box::new(format!("%{}%", target)));
        }
        if let Some(success) = filter.success {
            where_clauses.push(format!("success = ?{}", params.len() + 1));
            params.push(Box::new(success as i32));
        }

        let where_sql = if where_clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_clauses.join(" AND "))
        };

        // Count total matching
        let count_sql = format!("SELECT COUNT(*) FROM audit_entries {}", where_sql);
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| &**p).collect();
        let total_count = conn
            .query_row(&count_sql, param_refs.as_slice(), |row| {
                row.get::<_, i64>(0).map(|n| n as usize)
            })
            .unwrap_or(0);

        // Fetch page
        let offset = filter.page * filter.page_size;
        let order = if filter.sort_ascending { "ASC" } else { "DESC" };
        let query_sql = format!(
            "SELECT timestamp, operator, action, target_dn, details, success, severity
             FROM audit_entries {} ORDER BY id {} LIMIT ?{} OFFSET ?{}",
            where_sql,
            order,
            params.len() + 1,
            params.len() + 2,
        );
        params.push(Box::new(filter.page_size as i64));
        params.push(Box::new(offset as i64));

        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| &**p).collect();
        let mut stmt = match conn.prepare(&query_sql) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("Failed to prepare filtered audit query: {}", e);
                return AuditQueryResult {
                    entries: Vec::new(),
                    total_count: 0,
                };
            }
        };

        let entries = match stmt.query_map(param_refs.as_slice(), |row| {
            let severity_str: String = row.get(6)?;
            Ok(AuditEntry {
                timestamp: row.get(0)?,
                operator: row.get(1)?,
                action: row.get(2)?,
                target_dn: row.get(3)?,
                details: row.get(4)?,
                success: row.get::<_, i32>(5)? != 0,
                severity: AuditSeverity::from_db_str(&severity_str),
            })
        }) {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                tracing::error!("Failed to query filtered audit entries: {}", e);
                Vec::new()
            }
        };

        AuditQueryResult {
            entries,
            total_count,
        }
    }

    /// Returns distinct action types from the audit log.
    pub fn distinct_actions(&self) -> Vec<String> {
        let conn = self.conn.lock().expect("lock poisoned");
        let mut stmt =
            match conn.prepare("SELECT DISTINCT action FROM audit_entries ORDER BY action") {
                Ok(s) => s,
                Err(e) => {
                    tracing::error!("Failed to prepare distinct actions query: {}", e);
                    return Vec::new();
                }
            };

        let result: Vec<String> = match stmt.query_map([], |row| row.get(0)) {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                tracing::error!("Failed to query distinct actions: {}", e);
                Vec::new()
            }
        };
        result
    }

    /// Deletes audit entries older than the specified number of days.
    /// Returns the number of deleted entries.
    pub fn purge_older_than(&self, retention_days: i64) -> usize {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days);
        let cutoff_str = cutoff.to_rfc3339();
        let conn = self.conn.lock().expect("lock poisoned");
        conn.execute(
            "DELETE FROM audit_entries WHERE timestamp < ?1",
            rusqlite::params![cutoff_str],
        )
        .unwrap_or(0)
    }

    /// Verifies the hash chain integrity of the audit log.
    ///
    /// Walks all entries from oldest to newest and recomputes each hash.
    /// Returns a report indicating whether the chain is intact and, if not,
    /// the ID of the first tampered entry.
    pub fn verify_chain(&self) -> ChainVerification {
        let conn = self.conn.lock().expect("lock poisoned");
        let mut stmt = match conn.prepare(
            "SELECT id, timestamp, operator, action, target_dn, details, success, hash, prev_hash, severity
             FROM audit_entries ORDER BY id ASC",
        ) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("Failed to prepare chain verification query: {}", e);
                return ChainVerification {
                    valid: false,
                    total_entries: 0,
                    verified_entries: 0,
                    first_invalid_id: None,
                };
            }
        };

        struct Row {
            id: i64,
            entry: AuditEntry,
            hash: String,
            prev_hash: String,
        }

        let rows: Vec<Row> = match stmt.query_map([], |row| {
            let severity_str: String = row.get(9)?;
            Ok(Row {
                id: row.get(0)?,
                entry: AuditEntry {
                    timestamp: row.get(1)?,
                    operator: row.get(2)?,
                    action: row.get(3)?,
                    target_dn: row.get(4)?,
                    details: row.get(5)?,
                    success: row.get::<_, i32>(6)? != 0,
                    severity: AuditSeverity::from_db_str(&severity_str),
                },
                hash: row.get(7)?,
                prev_hash: row.get(8)?,
            })
        }) {
            Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                tracing::error!("Failed to query for chain verification: {}", e);
                return ChainVerification {
                    valid: false,
                    total_entries: 0,
                    verified_entries: 0,
                    first_invalid_id: None,
                };
            }
        };

        let total = rows.len();
        let mut expected_prev = String::new();
        let mut verified = 0usize;

        for row in &rows {
            // Skip legacy entries that predate the hash chain (empty hash)
            if row.hash.is_empty() {
                expected_prev = String::new();
                verified += 1;
                continue;
            }

            if row.prev_hash != expected_prev {
                return ChainVerification {
                    valid: false,
                    total_entries: total,
                    verified_entries: verified,
                    first_invalid_id: Some(row.id),
                };
            }

            let recomputed = Self::compute_hash(&row.prev_hash, &row.entry);
            if recomputed != row.hash {
                return ChainVerification {
                    valid: false,
                    total_entries: total,
                    verified_entries: verified,
                    first_invalid_id: Some(row.id),
                };
            }

            expected_prev = row.hash.clone();
            verified += 1;
        }

        ChainVerification {
            valid: true,
            total_entries: total,
            verified_entries: verified,
            first_invalid_id: None,
        }
    }
}

/// Filter parameters for querying audit entries.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditFilter {
    /// Start of date range (ISO 8601 / RFC 3339).
    pub date_from: Option<String>,
    /// End of date range (ISO 8601 / RFC 3339).
    pub date_to: Option<String>,
    /// Partial match on operator name.
    pub operator: Option<String>,
    /// Exact match on action type.
    pub action: Option<String>,
    /// Partial match on target DN.
    pub target_dn: Option<String>,
    /// Filter by success/failure.
    pub success: Option<bool>,
    /// Page number (0-based).
    #[serde(default)]
    pub page: usize,
    /// Page size (default 50).
    #[serde(default = "default_page_size")]
    pub page_size: usize,
    /// Sort ascending (oldest first) instead of descending (newest first).
    #[serde(default)]
    pub sort_ascending: bool,
}

fn default_page_size() -> usize {
    50
}

impl Default for AuditFilter {
    fn default() -> Self {
        Self {
            date_from: None,
            date_to: None,
            operator: None,
            action: None,
            target_dn: None,
            success: None,
            page: 0,
            page_size: 50,
            sort_ascending: false,
        }
    }
}

/// Result of a filtered audit query with pagination info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditQueryResult {
    pub entries: Vec<AuditEntry>,
    pub total_count: usize,
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_success_records_entry() {
        let svc = AuditService::new_in_memory();
        svc.log_success(
            "PasswordReset",
            "CN=John,DC=example,DC=com",
            "Password reset by operator",
        );
        let entries = svc.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].success);
        assert_eq!(entries[0].action, "PasswordReset");
        assert_eq!(entries[0].target_dn, "CN=John,DC=example,DC=com");
    }

    #[test]
    fn test_log_failure_records_entry() {
        let svc = AuditService::new_in_memory();
        svc.log_failure(
            "PasswordResetFailed",
            "CN=John,DC=example,DC=com",
            "Insufficient rights",
        );
        let entries = svc.get_entries();
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].success);
        assert_eq!(entries[0].action, "PasswordResetFailed");
    }

    #[test]
    fn test_entries_returned_most_recent_first() {
        let svc = AuditService::new_in_memory();
        svc.log_success("Action1", "dn1", "first");
        svc.log_success("Action2", "dn2", "second");
        let entries = svc.get_entries();
        assert_eq!(entries[0].action, "Action2");
        assert_eq!(entries[1].action, "Action1");
    }

    #[test]
    fn test_count_returns_correct_count() {
        let svc = AuditService::new_in_memory();
        assert_eq!(svc.count(), 0);
        svc.log_success("A", "dn", "d");
        svc.log_failure("B", "dn", "e");
        assert_eq!(svc.count(), 2);
    }

    #[test]
    fn test_entry_has_operator() {
        let svc = AuditService::new_in_memory();
        svc.log_success("Test", "dn", "details");
        let entries = svc.get_entries();
        assert!(!entries[0].operator.is_empty());
    }

    #[test]
    fn test_entry_has_timestamp() {
        let svc = AuditService::new_in_memory();
        svc.log_success("Test", "dn", "details");
        let entries = svc.get_entries();
        assert!(!entries[0].timestamp.is_empty());
    }

    #[test]
    fn test_entry_serialization() {
        let entry = AuditEntry {
            timestamp: "2026-03-14T10:00:00Z".to_string(),
            operator: "admin".to_string(),
            action: "PasswordReset".to_string(),
            target_dn: "CN=Test,DC=example,DC=com".to_string(),
            details: "Reset by admin".to_string(),
            success: true,
            severity: AuditSeverity::Info,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("targetDn")); // camelCase
        assert!(json.contains("PasswordReset"));
        assert!(json.contains("\"severity\":\"info\""));
    }

    #[test]
    fn test_entry_deserialization_from_pre_severity_json() {
        // Pre-AuditSeverity callers and any persisted JSON without the
        // severity field must deserialize without error and default to Info.
        let json = r#"{"timestamp":"2026-03-14T10:00:00Z","operator":"admin","action":"PasswordReset","targetDn":"CN=Test,DC=example,DC=com","details":"Reset by admin","success":true}"#;
        let entry: AuditEntry = serde_json::from_str(json).unwrap();
        assert!(matches!(entry.severity, AuditSeverity::Info));
    }

    #[test]
    fn test_severity_db_roundtrip() {
        for &s in &[
            AuditSeverity::Info,
            AuditSeverity::Warning,
            AuditSeverity::Critical,
        ] {
            assert_eq!(AuditSeverity::from_db_str(s.as_str()), s);
        }
        assert_eq!(
            AuditSeverity::from_db_str("unknown-on-disk"),
            AuditSeverity::Info,
            "unknown values must default to Info, not panic"
        );
    }

    #[test]
    fn test_log_success_with_severity_critical_persists_field() {
        let svc = AuditService::new_in_memory();
        svc.log_success_with_severity(
            "DisabledUnconstrainedDelegation",
            "CN=SRV01,OU=Computers,DC=example,DC=com",
            "uac: 0x82020 -> 0x02020",
            AuditSeverity::Critical,
        );
        let entries = svc.get_entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].severity, AuditSeverity::Critical);
        assert!(entries[0].success);
    }

    #[test]
    fn test_log_failure_with_severity_critical_persists_field() {
        let svc = AuditService::new_in_memory();
        svc.log_failure_with_severity(
            "DisableUnconstrainedDelegationFailed",
            "CN=SRV01,OU=Computers,DC=example,DC=com",
            "Permission denied",
            AuditSeverity::Critical,
        );
        let entries = svc.get_entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].severity, AuditSeverity::Critical);
        assert!(!entries[0].success);
    }

    #[test]
    fn test_log_success_default_severity_is_info() {
        let svc = AuditService::new_in_memory();
        svc.log_success("PasswordReset", "CN=Alice,DC=example,DC=com", "Reset");
        let entries = svc.get_entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].severity,
            AuditSeverity::Info,
            "log_success without _with_severity defaults to Info"
        );
    }

    #[test]
    fn test_severity_excluded_from_hash_chain() {
        // The chain protects audit truth (operator/action/target/result/etc.),
        // not the SOC categorisation hint. Two otherwise-identical entries
        // with different severities must produce the same hash so adding
        // the severity column does not invalidate any existing chain on
        // upgrade.
        let entry_info = AuditEntry {
            timestamp: "2026-03-14T10:00:00Z".to_string(),
            operator: "admin".to_string(),
            action: "TestAction".to_string(),
            target_dn: "CN=X,DC=ex,DC=com".to_string(),
            details: "x".to_string(),
            success: true,
            severity: AuditSeverity::Info,
        };
        let mut entry_critical = entry_info.clone();
        entry_critical.severity = AuditSeverity::Critical;

        let h_info = AuditService::compute_hash("", &entry_info);
        let h_critical = AuditService::compute_hash("", &entry_critical);
        assert_eq!(h_info, h_critical);
    }

    #[test]
    fn test_persist_and_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audit-test.db");

        // Write
        {
            let conn = Connection::open(&path).unwrap();
            let svc = AuditService {
                conn: Mutex::new(conn),
                operator: Mutex::new("test".to_string()),
                syslog: Mutex::new(None),
            };
            svc.init_schema();
            svc.log_success("TestAction", "CN=Test", "test details");
            assert_eq!(svc.count(), 1);
        }

        // Reload
        {
            let conn = Connection::open(&path).unwrap();
            let svc = AuditService {
                conn: Mutex::new(conn),
                operator: Mutex::new("test".to_string()),
                syslog: Mutex::new(None),
            };
            svc.init_schema();
            assert_eq!(svc.count(), 1);
            let entries = svc.get_entries();
            assert_eq!(entries[0].action, "TestAction");
        }
    }

    #[test]
    fn test_log_success_details_preserved() {
        let svc = AuditService::new_in_memory();
        svc.log_success(
            "AccountEnabled",
            "CN=Jane,DC=corp,DC=com",
            "Account enabled by operator",
        );
        let entries = svc.get_entries();
        assert_eq!(entries[0].details, "Account enabled by operator");
        assert_eq!(entries[0].target_dn, "CN=Jane,DC=corp,DC=com");
        assert!(entries[0].success);
    }

    #[test]
    fn test_log_failure_details_preserved() {
        let svc = AuditService::new_in_memory();
        svc.log_failure(
            "AccountDisableFailed",
            "CN=Bob,DC=corp,DC=com",
            "LDAP error: insufficient access",
        );
        let entries = svc.get_entries();
        assert_eq!(entries[0].details, "LDAP error: insufficient access");
        assert!(!entries[0].success);
    }

    #[test]
    fn test_multiple_entries_persist() {
        let svc = AuditService::new_in_memory();
        svc.log_success("Action1", "dn1", "first");
        svc.log_failure("Action2", "dn2", "second failed");
        svc.log_success("Action3", "dn3", "third");
        assert_eq!(svc.count(), 3);
        let entries = svc.get_entries();
        assert_eq!(entries[0].action, "Action3");
        assert!(entries[0].success);
        assert_eq!(entries[1].action, "Action2");
        assert!(!entries[1].success);
        assert_eq!(entries[2].action, "Action1");
    }

    #[test]
    fn test_entry_deserialization() {
        let json = r#"{"timestamp":"2026-03-14","operator":"admin","action":"Test","targetDn":"CN=X","details":"d","success":true}"#;
        let entry: AuditEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.action, "Test");
        assert_eq!(entry.target_dn, "CN=X");
        assert!(entry.success);
    }

    #[test]
    fn test_init_schema_idempotent() {
        // Calling init_schema twice must not error
        let conn = Connection::open_in_memory().expect("open in-memory");
        let svc = AuditService {
            conn: Mutex::new(conn),
            operator: Mutex::new("test".to_string()),
            syslog: Mutex::new(None),
        };
        svc.init_schema();
        svc.init_schema(); // second call - should be a no-op
        // Service still works after double init
        svc.log_success("Check", "dn", "idempotent");
        assert_eq!(svc.count(), 1);
    }

    #[test]
    fn test_empty_action_and_details() {
        let svc = AuditService::new_in_memory();
        svc.log_success("", "", "");
        let entries = svc.get_entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].action, "");
        assert_eq!(entries[0].details, "");
        assert_eq!(entries[0].target_dn, "");
    }

    #[test]
    fn test_count_after_mixed_success_and_failure() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn1", "ok");
        svc.log_failure("B", "dn2", "fail");
        svc.log_success("C", "dn3", "ok2");
        svc.log_failure("D", "dn4", "fail2");
        svc.log_failure("E", "dn5", "fail3");
        assert_eq!(svc.count(), 5);

        let entries = svc.get_entries();
        let success_count = entries.iter().filter(|e| e.success).count();
        let failure_count = entries.iter().filter(|e| !e.success).count();
        assert_eq!(success_count, 2);
        assert_eq!(failure_count, 3);
    }

    #[test]
    fn test_resolve_persist_path_returns_some_or_none() {
        // resolve_persist_path depends on env vars; verify it does not panic
        let result = AuditService::resolve_persist_path();
        // On CI or local, either Some or None is valid
        if let Some(path) = &result {
            assert!(path.to_string_lossy().contains("DSPanel"));
            assert!(path.to_string_lossy().contains("audit.db"));
        }
    }

    #[test]
    fn test_default_trait() {
        let svc = AuditService::default();
        // Default uses file-backed DB which may have entries from other tests,
        // just verify it does not panic
        let _ = svc.count();
    }

    #[test]
    fn test_get_entries_empty() {
        let svc = AuditService::new_in_memory();
        let entries = svc.get_entries();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_entry_success_field_false_roundtrip() {
        let svc = AuditService::new_in_memory();
        svc.log_failure("Fail", "dn", "error msg");
        let entries = svc.get_entries();
        assert!(!entries[0].success);
    }

    #[test]
    fn test_unicode_in_fields() {
        let svc = AuditService::new_in_memory();
        svc.log_success(
            "MotDePasseReset",
            "CN=\u{00e9}l\u{00e8}ve,DC=example,DC=com",
            "R\u{00e9}initialisation du mot de passe",
        );
        let entries = svc.get_entries();
        assert!(entries[0].target_dn.contains('\u{00e9}'));
        assert!(entries[0].details.contains('\u{00e9}'));
    }

    #[test]
    fn test_large_batch_entries() {
        let svc = AuditService::new_in_memory();
        for i in 0..100 {
            if i % 2 == 0 {
                svc.log_success(&format!("Action{}", i), "dn", "ok");
            } else {
                svc.log_failure(&format!("Action{}", i), "dn", "err");
            }
        }
        assert_eq!(svc.count(), 100);
        let entries = svc.get_entries();
        assert_eq!(entries.len(), 100);
        // Most recent first
        assert_eq!(entries[0].action, "Action99");
    }

    // -----------------------------------------------------------------------
    // Filtered query tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_query_filtered_no_filters() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn1", "d1");
        svc.log_failure("B", "dn2", "d2");

        let result = svc.query_filtered(&AuditFilter::default());
        assert_eq!(result.total_count, 2);
        assert_eq!(result.entries.len(), 2);
    }

    #[test]
    fn test_query_filtered_by_action() {
        let svc = AuditService::new_in_memory();
        svc.log_success("PasswordReset", "dn1", "d1");
        svc.log_success("AccountEnabled", "dn2", "d2");
        svc.log_success("PasswordReset", "dn3", "d3");

        let filter = AuditFilter {
            action: Some("PasswordReset".to_string()),
            ..Default::default()
        };
        let result = svc.query_filtered(&filter);
        assert_eq!(result.total_count, 2);
        assert!(result.entries.iter().all(|e| e.action == "PasswordReset"));
    }

    #[test]
    fn test_query_filtered_by_operator() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn1", "d1");

        let filter = AuditFilter {
            operator: Some(svc.operator.lock().unwrap().clone()),
            ..Default::default()
        };
        let result = svc.query_filtered(&filter);
        assert_eq!(result.total_count, 1);
    }

    #[test]
    fn test_query_filtered_by_target_partial() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "CN=John,OU=Users,DC=test,DC=com", "d1");
        svc.log_success("B", "CN=Jane,OU=Admins,DC=test,DC=com", "d2");

        let filter = AuditFilter {
            target_dn: Some("OU=Users".to_string()),
            ..Default::default()
        };
        let result = svc.query_filtered(&filter);
        assert_eq!(result.total_count, 1);
        assert_eq!(result.entries[0].action, "A");
    }

    #[test]
    fn test_query_filtered_by_success() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn", "ok");
        svc.log_failure("B", "dn", "err");
        svc.log_success("C", "dn", "ok");

        let filter = AuditFilter {
            success: Some(false),
            ..Default::default()
        };
        let result = svc.query_filtered(&filter);
        assert_eq!(result.total_count, 1);
        assert!(!result.entries[0].success);
    }

    #[test]
    fn test_query_filtered_pagination() {
        let svc = AuditService::new_in_memory();
        for i in 0..25 {
            svc.log_success(&format!("Action{}", i), "dn", "d");
        }

        let filter = AuditFilter {
            page: 0,
            page_size: 10,
            ..Default::default()
        };
        let result = svc.query_filtered(&filter);
        assert_eq!(result.total_count, 25);
        assert_eq!(result.entries.len(), 10);

        let filter2 = AuditFilter {
            page: 2,
            page_size: 10,
            ..Default::default()
        };
        let result2 = svc.query_filtered(&filter2);
        assert_eq!(result2.entries.len(), 5);
    }

    #[test]
    fn test_query_filtered_empty_strings_ignored() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn", "d");

        let filter = AuditFilter {
            operator: Some("".to_string()),
            action: Some("".to_string()),
            target_dn: Some("".to_string()),
            ..Default::default()
        };
        let result = svc.query_filtered(&filter);
        assert_eq!(result.total_count, 1);
    }

    // -----------------------------------------------------------------------
    // Distinct actions tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_distinct_actions() {
        let svc = AuditService::new_in_memory();
        svc.log_success("PasswordReset", "dn", "d");
        svc.log_success("AccountEnabled", "dn", "d");
        svc.log_success("PasswordReset", "dn", "d");

        let actions = svc.distinct_actions();
        assert_eq!(actions.len(), 2);
        assert!(actions.contains(&"AccountEnabled".to_string()));
        assert!(actions.contains(&"PasswordReset".to_string()));
    }

    #[test]
    fn test_distinct_actions_empty() {
        let svc = AuditService::new_in_memory();
        let actions = svc.distinct_actions();
        assert!(actions.is_empty());
    }

    // -----------------------------------------------------------------------
    // Purge tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_purge_older_than() {
        let svc = AuditService::new_in_memory();

        // Insert an entry with an old timestamp directly
        let old_ts = "2020-01-01T00:00:00+00:00";
        {
            let conn = svc.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO audit_entries (timestamp, operator, action, target_dn, details, success)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![old_ts, "test", "OldAction", "dn", "old", 1],
            )
            .unwrap();
        }

        // Insert a recent entry
        svc.log_success("RecentAction", "dn", "recent");

        assert_eq!(svc.count(), 2);

        let deleted = svc.purge_older_than(365);
        assert_eq!(deleted, 1);
        assert_eq!(svc.count(), 1);

        let entries = svc.get_entries();
        assert_eq!(entries[0].action, "RecentAction");
    }

    #[test]
    fn test_purge_nothing_to_delete() {
        let svc = AuditService::new_in_memory();
        svc.log_success("Recent", "dn", "d");
        let deleted = svc.purge_older_than(365);
        assert_eq!(deleted, 0);
        assert_eq!(svc.count(), 1);
    }

    // -----------------------------------------------------------------------
    // Hash chain tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_verify_chain_empty_log() {
        let svc = AuditService::new_in_memory();
        let result = svc.verify_chain();
        assert!(result.valid);
        assert_eq!(result.total_entries, 0);
        assert_eq!(result.verified_entries, 0);
        assert!(result.first_invalid_id.is_none());
    }

    #[test]
    fn test_verify_chain_single_entry() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn", "d");
        let result = svc.verify_chain();
        assert!(result.valid);
        assert_eq!(result.total_entries, 1);
        assert_eq!(result.verified_entries, 1);
    }

    #[test]
    fn test_verify_chain_multiple_entries() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn1", "d1");
        svc.log_failure("B", "dn2", "d2");
        svc.log_success("C", "dn3", "d3");
        let result = svc.verify_chain();
        assert!(result.valid);
        assert_eq!(result.total_entries, 3);
        assert_eq!(result.verified_entries, 3);
    }

    #[test]
    fn test_verify_chain_detects_tampered_hash() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn1", "d1");
        svc.log_success("B", "dn2", "d2");
        svc.log_success("C", "dn3", "d3");

        // Tamper with the hash of the second entry
        {
            let conn = svc.conn.lock().unwrap();
            conn.execute(
                "UPDATE audit_entries SET hash = 'tampered' WHERE id = 2",
                [],
            )
            .unwrap();
        }

        let result = svc.verify_chain();
        assert!(!result.valid);
        assert_eq!(result.first_invalid_id, Some(2));
    }

    #[test]
    fn test_verify_chain_detects_tampered_content() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn1", "original");
        svc.log_success("B", "dn2", "d2");

        // Tamper with content but leave hash intact
        {
            let conn = svc.conn.lock().unwrap();
            conn.execute(
                "UPDATE audit_entries SET details = 'forged' WHERE id = 1",
                [],
            )
            .unwrap();
        }

        let result = svc.verify_chain();
        assert!(!result.valid);
        assert_eq!(result.first_invalid_id, Some(1));
    }

    #[test]
    fn test_verify_chain_detects_broken_prev_hash() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn1", "d1");
        svc.log_success("B", "dn2", "d2");

        // Break the chain by changing prev_hash of second entry
        {
            let conn = svc.conn.lock().unwrap();
            conn.execute(
                "UPDATE audit_entries SET prev_hash = 'wrong' WHERE id = 2",
                [],
            )
            .unwrap();
        }

        let result = svc.verify_chain();
        assert!(!result.valid);
        assert_eq!(result.first_invalid_id, Some(2));
    }

    #[test]
    fn test_hash_chain_entries_have_non_empty_hash() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn", "d");

        let conn = svc.conn.lock().unwrap();
        let hash: String = conn
            .query_row("SELECT hash FROM audit_entries WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert!(!hash.is_empty());
        // SHA-256 hex = 64 chars
        assert_eq!(hash.len(), 64);
    }

    #[test]
    fn test_hash_chain_first_entry_has_empty_prev_hash() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn", "d");

        let conn = svc.conn.lock().unwrap();
        let prev: String = conn
            .query_row(
                "SELECT prev_hash FROM audit_entries WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(prev.is_empty());
    }

    #[test]
    fn test_hash_chain_second_entry_chains_to_first() {
        let svc = AuditService::new_in_memory();
        svc.log_success("A", "dn1", "d1");
        svc.log_success("B", "dn2", "d2");

        let conn = svc.conn.lock().unwrap();
        let first_hash: String = conn
            .query_row("SELECT hash FROM audit_entries WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        let second_prev: String = conn
            .query_row(
                "SELECT prev_hash FROM audit_entries WHERE id = 2",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(first_hash, second_prev);
    }

    #[test]
    fn test_chain_verification_serialization() {
        let v = ChainVerification {
            valid: true,
            total_entries: 5,
            verified_entries: 5,
            first_invalid_id: None,
        };
        let json = serde_json::to_string(&v).unwrap();
        assert!(json.contains("totalEntries"));
        assert!(json.contains("verifiedEntries"));
    }

    // -----------------------------------------------------------------------
    // Syslog settings tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_syslog_settings_default() {
        let s = SyslogSettings::default();
        assert!(!s.enabled);
        assert!(s.host.is_empty());
        assert_eq!(s.port, 514);
        assert_eq!(s.transport, SyslogTransport::Udp);
    }

    #[test]
    fn test_syslog_settings_serialization() {
        let s = SyslogSettings {
            enabled: true,
            host: "192.168.1.10".to_string(),
            port: 1514,
            transport: SyslogTransport::Tcp,
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("192.168.1.10"));
        assert!(json.contains("\"tcp\""));
        let loaded: SyslogSettings = serde_json::from_str(&json).unwrap();
        assert!(loaded.enabled);
        assert_eq!(loaded.port, 1514);
        assert_eq!(loaded.transport, SyslogTransport::Tcp);
    }

    #[test]
    fn test_syslog_settings_backwards_compat() {
        // Old config files (pre-1.0.5) had no `transport` field; missing
        // value must default to UDP so existing deployments keep their
        // current behavior on upgrade.
        let json = "{}";
        let s: SyslogSettings = serde_json::from_str(json).unwrap();
        assert!(!s.enabled);
        assert_eq!(s.port, 514);
        assert_eq!(s.transport, SyslogTransport::Udp);
    }

    #[test]
    fn test_syslog_tcp_emits_octet_counted_frame() {
        // Boot a one-shot TCP listener on a random port, send one entry,
        // verify the framing matches RFC 6587 octet-counting form
        // (`<length> <SP> <message>`).
        use std::io::Read;
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();

        let received = std::sync::Arc::new(std::sync::Mutex::new(Vec::<u8>::new()));
        let received_clone = received.clone();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buf = Vec::new();
            stream.read_to_end(&mut buf).ok();
            *received_clone.lock().unwrap() = buf;
        });

        let settings = SyslogSettings {
            enabled: true,
            host: "127.0.0.1".to_string(),
            port,
            transport: SyslogTransport::Tcp,
        };
        let fwd = SyslogForwarder::new(&settings).expect("forwarder ready");
        let entry = AuditEntry {
            timestamp: "2026-04-26T10:00:00Z".to_string(),
            operator: "test".to_string(),
            action: "test_action".to_string(),
            target_dn: "CN=Test,DC=corp".to_string(),
            details: "ok".to_string(),
            success: true,
            severity: AuditSeverity::Info,
        };
        fwd.send(&entry);
        drop(fwd);

        handle.join().expect("listener joined");
        let buf = received.lock().unwrap();
        let s = String::from_utf8_lossy(&buf);
        // Should look like "  <prefix-length>  <SP>  <PRI>1 ...",
        // i.e. start with ASCII digits then a space.
        let space_idx = s.find(' ').expect("octet counting framing has a space");
        let len_str = &s[..space_idx];
        let len: usize = len_str.parse().expect("framing length is numeric");
        let payload = &s[space_idx + 1..];
        assert_eq!(payload.len(), len, "framing length must match payload");
        assert!(payload.starts_with("<134>1 "), "RFC 5424 PRI=local0+info");
        assert!(payload.contains("test_action"));
    }
}
