//! Forest topology discovery and the multi-partition `ForestProvider`.
//!
//! Active Directory forests contain one directory partition per domain. The
//! single-domain `LdapDirectoryProvider` binds to one domain controller and
//! only sees the partition served by that DC. `ForestProvider` is a structural
//! decorator: it holds one `DirectoryProvider` per partition (the seed
//! provider used for the initial bind plus one `LdapDirectoryProvider` per
//! additional partition discovered under `CN=Partitions,CN=Configuration`) and
//! implements `DirectoryProvider` itself so the rest of the application keeps
//! consuming a single `Arc<dyn DirectoryProvider>`.
//!
//! Story 15.1 ships the foundation: discovery, per-partition connection
//! bookkeeping, and a delegating `DirectoryProvider` implementation whose
//! methods all target the seed partition. Later stories (15.2 to 15.5) replace
//! the seed-only bodies with fan-out or DN-based routing; the dispatch rule
//! for every method is recorded inline as a one-line comment.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;

use crate::models::{ContactInfo, DeletedObject, DirectoryEntry, OUNode, PrinterInfo};
use crate::services::directory::DirectoryProvider;
use crate::services::ldap_directory::{LdapAuthMode, LdapDirectoryProvider, LdapTlsConfig};

/// `FLAG_CR_NTDS_DOMAIN` bit of the `systemFlags` attribute on `crossRef`
/// objects. Set only on crossRefs that describe a domain naming context, so it
/// excludes the Schema, Configuration, and DNS application partitions.
pub const FLAG_CR_NTDS_DOMAIN: i64 = 0x0000_0002;

/// LDAP filter selecting domain partition crossRefs. The OID is the
/// `LDAP_MATCHING_RULE_BIT_AND` extensible match, so the server evaluates the
/// `FLAG_CR_NTDS_DOMAIN` bit test itself.
pub const NTDS_DOMAIN_CROSSREF_FILTER: &str =
    "(&(objectClass=crossRef)(systemFlags:1.2.840.113556.1.4.803:=2))";

/// Upper bound on the number of partitions `ForestProvider` binds to. Keeps
/// the seed-login latency bounded regardless of forest size (NFR1).
pub const MAX_PARTITIONS: usize = 50;

/// Default per-partition bind timeout applied during `ForestProvider::connect`.
pub const DEFAULT_PARTITION_BIND_TIMEOUT: Duration = Duration::from_secs(3);

/// Environment variable overriding `DEFAULT_PARTITION_BIND_TIMEOUT`, in seconds.
pub const PARTITION_BIND_TIMEOUT_ENV: &str = "DSPANEL_PARTITION_BIND_TIMEOUT";

/// Tauri event carrying `ForestProvider::partition_status()` as a map keyed by
/// partition DNS name. Emitted once the forest is (re)assembled in the
/// background; the frontend refreshes the topology and the states on it.
pub const FOREST_STATUS_EVENT: &str = "forest-status-changed";

/// One domain naming context of the forest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DomainPartition {
    /// Partition DN (`nCName` of the crossRef), e.g. `DC=corp,DC=example,DC=com`.
    pub distinguished_name: String,
    /// DNS suffix of the domain (`dnsRoot`), lowercase, e.g. `corp.example.com`.
    pub dns_name: String,
    /// NetBIOS name of the domain (`nETBIOSName`), when published.
    pub netbios_name: Option<String>,
    /// FQDN of the DC the partition provider is bound to, when known.
    pub default_dc_fqdn: Option<String>,
}

/// Every domain partition discovered in the forest, seed partition first.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ForestTopology {
    /// Domain partitions in discovery order, seed partition first.
    pub partitions: Vec<DomainPartition>,
}

impl ForestTopology {
    /// Builds a one-partition topology from a provider's own base DN and
    /// identity. Used as the trait default for providers that do not expose
    /// the real forest (demo, mocks) and as the fallback when discovery fails.
    /// Returns an empty topology when the provider has no base DN yet.
    pub fn synthesized_from<P: DirectoryProvider + ?Sized>(provider: &P) -> Self {
        let Some(base_dn) = provider.base_dn() else {
            return Self::default();
        };
        let dns_name = dns_domain_from_dn(&base_dn)
            .or_else(|| provider.domain_name().map(|d| d.to_ascii_lowercase()));
        let Some(dns_name) = dns_name else {
            return Self::default();
        };
        Self {
            partitions: vec![DomainPartition {
                distinguished_name: base_dn,
                dns_name,
                netbios_name: None,
                default_dc_fqdn: provider.connected_host(),
            }],
        }
    }

    /// True when the forest exposes at most one domain partition. Drives the
    /// "hide multi-domain UI affordances" rule shared by stories 15.2 to 15.6.
    pub fn is_single_domain(&self) -> bool {
        self.partitions.len() <= 1
    }

    /// Finds the partition whose DN equals `dn` (case-insensitive).
    pub fn find_by_dn(&self, dn: &str) -> Option<&DomainPartition> {
        self.partitions
            .iter()
            .find(|p| p.distinguished_name.eq_ignore_ascii_case(dn))
    }

    /// Finds the partition whose DNS name equals `dns_name` (case-insensitive).
    pub fn find_by_dns_name(&self, dns_name: &str) -> Option<&DomainPartition> {
        self.partitions
            .iter()
            .find(|p| p.dns_name.eq_ignore_ascii_case(dns_name))
    }
}

/// Connection state of one partition, as reported by `ForestProvider::partition_status`.
///
/// Serialized adjacently tagged (`{"state":"unreachable","reason":"timeout"}`)
/// so the frontend can switch on `state` and read `reason` as a translation key.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "state", content = "reason", rename_all = "camelCase")]
pub enum ConnectionStatus {
    /// The partition provider holds a live bind.
    Connected,
    /// A retry is in progress (Story 15.6 partition retry); not yet produced.
    Reconnecting,
    /// Carries the classification key of the failure (`network`, `auth_denied`,
    /// `timeout`, `unknown`, ...), the same vocabulary as
    /// `DirectoryProvider::last_connection_error`.
    Unreachable(String),
}

/// Splits a DN on unescaped commas, trimming each component.
pub fn split_dn_components(dn: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut escaped = false;
    for c in dn.chars() {
        if escaped {
            current.push(c);
            escaped = false;
            continue;
        }
        match c {
            '\\' => {
                current.push(c);
                escaped = true;
            }
            ',' => {
                parts.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(c),
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts
}

/// Extracts the `DC=` components of a DN and joins them into a lowercase DNS
/// suffix: `CN=jdoe,OU=Users,DC=Sub,DC=Example,DC=com` -> `sub.example.com`.
/// Returns `None` when the DN carries no `DC=` component.
pub fn dns_domain_from_dn(dn: &str) -> Option<String> {
    let labels: Vec<String> = split_dn_components(dn)
        .into_iter()
        .filter_map(|component| {
            let (key, value) = component.split_once('=')?;
            if key.trim().eq_ignore_ascii_case("dc") {
                let label = value.trim().to_ascii_lowercase();
                (!label.is_empty()).then_some(label)
            } else {
                None
            }
        })
        .collect();
    if labels.is_empty() {
        None
    } else {
        Some(labels.join("."))
    }
}

/// Longest DNS name accepted from the directory (RFC 1035 wire limit).
const MAX_DNS_NAME_LEN: usize = 253;

/// Longest DNS label accepted from the directory (RFC 1035).
const MAX_DNS_LABEL_LEN: usize = 63;

/// Accepts only letters, digits, hyphens and dots (LDH rule) within RFC 1035
/// length limits, with at least two labels and a non-numeric top label.
/// `dnsRoot` comes from the directory, not the operator, and it becomes the
/// authority of an `ldap://` URL and the target of a bind performed as the
/// operator; anything richer than a domain name (single-label hosts, IP
/// literals, ports, paths, userinfo) is rejected.
pub fn is_valid_dns_name(name: &str) -> bool {
    if name.is_empty() || name.len() > MAX_DNS_NAME_LEN {
        return false;
    }
    let labels: Vec<&str> = name.split('.').collect();
    if labels.len() < 2 {
        return false;
    }
    let top_label_is_numeric = labels
        .last()
        .is_some_and(|label| label.bytes().all(|b| b.is_ascii_digit()));
    if top_label_is_numeric {
        return false;
    }
    labels.iter().all(|label| {
        !label.is_empty()
            && label.len() <= MAX_DNS_LABEL_LEN
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    })
}

/// Accepts a DNS SRV target only when it is a valid host name inside `domain`
/// (the domain itself or a host below it). A DNS answer steering a partition
/// bind to a host outside the partition would otherwise choose the name TLS
/// verifies the DC certificate against.
pub fn is_dc_target_within(target: &str, domain: &str) -> bool {
    if !is_valid_dns_name(target) {
        return false;
    }
    let target = target.to_ascii_lowercase();
    let domain = domain.to_ascii_lowercase();
    target == domain || target.ends_with(&format!(".{domain}"))
}

fn has_control_chars(value: &str) -> bool {
    value.chars().any(char::is_control)
}

/// Case-insensitive first-value lookup in a `DirectoryEntry` attribute bag.
/// LDAP attribute names are case-insensitive and servers return them in their
/// schema casing (`nCName`, `nETBIOSName`), so exact-key lookups are brittle.
fn attribute_ci<'a>(entry: &'a DirectoryEntry, name: &str) -> Option<&'a str> {
    entry
        .attributes
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .and_then(|(_, values)| values.first())
        .map(|s| s.as_str())
        .filter(|s| !s.trim().is_empty())
}

/// Turns raw `crossRef` entries into domain partitions.
///
/// Only entries whose `systemFlags` carries `FLAG_CR_NTDS_DOMAIN` are kept,
/// which re-applies the server-side filter defensively so callers that fetch
/// `CN=Partitions` with a broader filter get the same result. `dnsRoot` is the
/// DNS name; when it is absent the name is derived from the `nCName` DN. The
/// values are directory data: entries whose DNS name is not a plain host name
/// or whose DN carries control characters are skipped (see `is_valid_dns_name`).
/// Fails when no domain partition is present, since every forest has at least
/// its root domain.
pub fn parse_partitions_from_entries(entries: &[DirectoryEntry]) -> Result<Vec<DomainPartition>> {
    let mut partitions = Vec::new();
    for entry in entries {
        let flags = attribute_ci(entry, "systemFlags")
            .and_then(|v| v.trim().parse::<i64>().ok())
            .unwrap_or(0);
        if flags & FLAG_CR_NTDS_DOMAIN == 0 {
            continue;
        }
        let Some(nc_name) = attribute_ci(entry, "nCName") else {
            tracing::warn!(dn = ?entry.distinguished_name, "crossRef without nCName skipped");
            continue;
        };
        if has_control_chars(nc_name) {
            tracing::warn!(
                dn = ?entry.distinguished_name,
                "crossRef with control characters in nCName skipped"
            );
            continue;
        }
        let dns_name = attribute_ci(entry, "dnsRoot")
            .map(|v| v.trim().to_ascii_lowercase())
            .or_else(|| dns_domain_from_dn(nc_name));
        let Some(dns_name) = dns_name else {
            tracing::warn!(
                dn = ?entry.distinguished_name,
                nc_name = ?nc_name,
                "crossRef without resolvable DNS name skipped"
            );
            continue;
        };
        if !is_valid_dns_name(&dns_name) {
            tracing::warn!(
                dn = ?entry.distinguished_name,
                dns_root = ?dns_name,
                "crossRef with invalid dnsRoot skipped"
            );
            continue;
        }
        let netbios_name = attribute_ci(entry, "nETBIOSName")
            .map(|v| v.trim().to_string())
            .filter(|v| !has_control_chars(v));
        partitions.push(DomainPartition {
            distinguished_name: nc_name.to_string(),
            dns_name,
            netbios_name,
            default_dc_fqdn: None,
        });
    }
    if partitions.is_empty() {
        bail!(
            "No domain partitions found among {} crossRef entries",
            entries.len()
        );
    }
    Ok(partitions)
}

/// Upper bound accepted for `DSPANEL_PARTITION_BIND_TIMEOUT`, so a stray
/// value cannot stretch a promotion attempt indefinitely.
pub const MAX_PARTITION_BIND_TIMEOUT: Duration = Duration::from_secs(60);

/// Reads the per-partition bind timeout, honoring `DSPANEL_PARTITION_BIND_TIMEOUT`
/// (whole seconds, capped at `MAX_PARTITION_BIND_TIMEOUT`). Invalid or zero
/// values fall back to the default.
pub fn partition_bind_timeout() -> Duration {
    match std::env::var(PARTITION_BIND_TIMEOUT_ENV) {
        Ok(raw) => match raw.trim().parse::<u64>() {
            Ok(secs) if secs > 0 => Duration::from_secs(secs).min(MAX_PARTITION_BIND_TIMEOUT),
            _ => {
                tracing::warn!(
                    value = %raw,
                    "Invalid {} value, using the {}s default",
                    PARTITION_BIND_TIMEOUT_ENV,
                    DEFAULT_PARTITION_BIND_TIMEOUT.as_secs()
                );
                DEFAULT_PARTITION_BIND_TIMEOUT
            }
        },
        Err(_) => DEFAULT_PARTITION_BIND_TIMEOUT,
    }
}

/// Classification recorded when a simple-bind fan-out is refused because the
/// connection would carry the password in clear text.
pub const TLS_REQUIRED: &str = "tls_required";

/// Classification recorded when a simple-bind fan-out is refused because
/// certificate verification is disabled.
pub const TLS_UNVERIFIED: &str = "tls_unverified";

/// Builds the provider bound to one non-seed partition, or declines with a
/// classification key that is recorded as `ConnectionStatus::Unreachable`
/// without any bind attempt.
///
/// Abstracted so tests can inject providers with scripted connection
/// outcomes; production uses `LdapPartitionConnector`.
pub trait PartitionConnector: Send + Sync {
    /// Returns the provider to bind for `partition`, or the classification key
    /// explaining why this partition is not attempted.
    fn build(&self, partition: &DomainPartition) -> Result<Arc<dyn DirectoryProvider>, String>;
}

/// Production connector: one `LdapDirectoryProvider` per partition, reusing
/// the seed's authentication mode and TLS settings. The DC is located through
/// a DNS SRV lookup of `_ldap._tcp.<dns name>` before dialing, so TLS
/// certificate verification runs against the DC FQDN.
pub struct LdapPartitionConnector {
    auth_mode: LdapAuthMode,
    tls_config: LdapTlsConfig,
}

impl LdapPartitionConnector {
    /// Creates a connector reusing the seed's auth mode and TLS settings.
    pub fn new(auth_mode: LdapAuthMode, tls_config: LdapTlsConfig) -> Self {
        Self {
            auth_mode,
            tls_config,
        }
    }
}

impl PartitionConnector for LdapPartitionConnector {
    // Simple-bind credentials only travel to partitions the seed DC named when
    // the transport is TLS-protected and verified: `dnsRoot` is directory data,
    // so a compromised DC could otherwise redirect the operator's password to a
    // host of its choosing in clear text. GSSAPI authenticates the server
    // through Kerberos and fans out regardless of TLS.
    fn build(&self, partition: &DomainPartition) -> Result<Arc<dyn DirectoryProvider>, String> {
        if matches!(self.auth_mode, LdapAuthMode::SimpleBind { .. }) {
            if !(self.tls_config.enabled || self.tls_config.starttls) {
                return Err(TLS_REQUIRED.to_string());
            }
            if self.tls_config.skip_verify {
                return Err(TLS_UNVERIFIED.to_string());
            }
        }
        Ok(Arc::new(LdapDirectoryProvider::new_for_partition(
            partition.dns_name.clone(),
            self.auth_mode.clone(),
            self.tls_config.clone(),
        )))
    }
}

/// Multi-partition directory provider. See the module docs.
///
/// A forest is an immutable snapshot: it starts as a seed-only placeholder
/// (`seed_only` / `single_partition`) and is replaced wholesale by the result
/// of `repromote` once the seed is reachable, so readers never observe a
/// half-assembled partition map.
pub struct ForestProvider {
    /// Every partition provider keyed by lowercase DNS name, seed included.
    partitions: HashMap<String, Arc<dyn DirectoryProvider>>,
    /// The provider used for the initial bind; the operator's own domain.
    seed: Arc<dyn DirectoryProvider>,
    seed_dns_name: String,
    topology: ForestTopology,
    /// Outcome of the assembly-time bind per non-seed partition: the reason a
    /// partition was declined or why its bind failed. Live state is derived in
    /// `partition_status` from the partition provider when one exists.
    recorded_status: HashMap<String, ConnectionStatus>,
    /// How non-seed partitions are built; `None` for forests that can never be
    /// promoted (demo mode, tests).
    connector: Option<Arc<dyn PartitionConnector>>,
    /// True once assembled from a reachable seed; false for placeholders.
    promoted: bool,
}

impl ForestProvider {
    /// Connects to the whole forest starting from an already-configured seed.
    ///
    /// The seed must be reachable: its `test_connection` failure is returned
    /// as an error so the caller keeps the existing single-domain connection
    /// error UX. Discovery failure is not fatal (the seed becomes the only
    /// partition), and neither is a bind failure on any non-seed partition,
    /// which is recorded in `partition_status` instead.
    pub async fn connect(
        seed: Arc<LdapDirectoryProvider>,
        auth_mode: LdapAuthMode,
        tls_config: LdapTlsConfig,
    ) -> Result<Self> {
        Self::connect_with(
            seed,
            Arc::new(LdapPartitionConnector::new(auth_mode, tls_config)),
        )
        .await
    }

    /// `connect` for any seed provider and partition connector. The forest
    /// keeps the connector so `repromote` can rebuild it later.
    pub async fn connect_with(
        seed: Arc<dyn DirectoryProvider>,
        connector: Arc<dyn PartitionConnector>,
    ) -> Result<Self> {
        let reachable = seed
            .test_connection()
            .await
            .context("Seed partition connection test failed")?;
        if !reachable {
            bail!(
                "Seed partition unreachable ({})",
                seed.last_connection_error()
                    .unwrap_or_else(|| "unknown".to_string())
            );
        }
        let bind_timeout = partition_bind_timeout();
        // Discovery only talks to the seed DC, but its answer is unbounded; the
        // same timeout keeps a slow or hostile DC from stalling the promotion.
        let topology = match tokio::time::timeout(bind_timeout, seed.discover_forest()).await {
            Ok(Ok(topology)) => topology,
            Ok(Err(e)) => {
                tracing::warn!(
                    error = %e,
                    "Forest discovery failed, continuing with the seed partition only"
                );
                ForestTopology::synthesized_from(&*seed)
            }
            Err(_elapsed) => {
                tracing::warn!(
                    timeout = ?bind_timeout,
                    "Forest discovery timed out, continuing with the seed partition only"
                );
                ForestTopology::synthesized_from(&*seed)
            }
        };
        Ok(Self::assemble(seed, topology, connector, bind_timeout).await)
    }

    /// Wraps a single provider as a one-partition forest that can never be
    /// promoted. Used for demo mode and tests.
    pub fn single_partition(provider: Arc<dyn DirectoryProvider>) -> Self {
        Self::placeholder(provider, None)
    }

    /// Seed-only placeholder installed before the seed is known to be
    /// reachable; `repromote` turns it into the discovered forest.
    pub fn seed_only(
        provider: Arc<dyn DirectoryProvider>,
        connector: Arc<dyn PartitionConnector>,
    ) -> Self {
        Self::placeholder(provider, Some(connector))
    }

    fn placeholder(
        provider: Arc<dyn DirectoryProvider>,
        connector: Option<Arc<dyn PartitionConnector>>,
    ) -> Self {
        let topology = ForestTopology::synthesized_from(&*provider);
        let seed_dns_name = resolve_seed_dns_name(&*provider, &topology);
        let mut partitions = HashMap::new();
        partitions.insert(seed_dns_name.clone(), provider.clone());
        Self {
            partitions,
            seed: provider,
            seed_dns_name,
            topology,
            recorded_status: HashMap::new(),
            connector,
            promoted: false,
        }
    }

    /// Assembles the forest from a reachable seed and a discovered topology.
    ///
    /// Non-seed partitions are bound concurrently, each bounded by
    /// `bind_timeout`. The topology is truncated to `MAX_PARTITIONS` with the
    /// seed kept first. Exposed publicly so tests can drive the assembly with a
    /// scripted `PartitionConnector`.
    pub async fn assemble(
        seed: Arc<dyn DirectoryProvider>,
        topology: ForestTopology,
        connector: Arc<dyn PartitionConnector>,
        bind_timeout: Duration,
    ) -> Self {
        let seed_dns_name = resolve_seed_dns_name(&*seed, &topology);
        let topology = normalize_topology(&*seed, &seed_dns_name, topology);
        let (mut partitions, recorded_status) =
            bind_partitions(&topology, &seed_dns_name, &*connector, bind_timeout).await;
        partitions.insert(seed_dns_name.clone(), seed.clone());
        Self {
            partitions,
            seed,
            seed_dns_name,
            topology,
            recorded_status,
            connector: Some(connector),
            promoted: true,
        }
    }

    /// True once the forest was assembled from a reachable seed. A `false`
    /// placeholder should be re-promoted when the seed becomes reachable.
    pub fn is_promoted(&self) -> bool {
        self.promoted
    }

    /// Rebuilds the forest from the same seed and connector, re-running
    /// discovery and every partition bind. `None` when the forest was created
    /// without a connector and can only ever hold its seed.
    pub fn repromote(
        &self,
    ) -> Option<impl std::future::Future<Output = Result<Self>> + Send + use<>> {
        let connector = self.connector.clone()?;
        Some(Self::connect_with(self.seed.clone(), connector))
    }

    /// Topology built at connect time, seed partition first.
    pub fn topology(&self) -> &ForestTopology {
        &self.topology
    }

    /// Lowercase DNS name of the operator's own partition.
    pub fn seed_dns_name(&self) -> &str {
        &self.seed_dns_name
    }

    /// The provider bound to the operator's own partition.
    pub fn seed(&self) -> Arc<dyn DirectoryProvider> {
        self.seed.clone()
    }

    /// The provider bound to the partition named `dns_name`, if discovered.
    pub fn partition(&self, dns_name: &str) -> Option<Arc<dyn DirectoryProvider>> {
        self.partitions.get(&dns_name.to_ascii_lowercase()).cloned()
    }

    /// Connection state of every partition in topology order, seed first.
    ///
    /// States are read live from each partition provider so a lazily
    /// reconnected partition reports as connected; the assembly-time record
    /// supplies the reason for partitions that were declined, timed out or
    /// never got a provider.
    pub fn partition_status(&self) -> Vec<(String, ConnectionStatus)> {
        let mut statuses: Vec<(String, ConnectionStatus)> = Vec::new();
        if self
            .topology
            .find_by_dns_name(&self.seed_dns_name)
            .is_none()
        {
            // Placeholder built before the seed connected: no topology yet,
            // but the operator's own partition state is still meaningful.
            statuses.push((
                self.seed_dns_name.clone(),
                self.live_status(&self.seed_dns_name),
            ));
        }
        statuses.extend(self.topology.partitions.iter().map(|partition| {
            let dns_name = partition.dns_name.to_ascii_lowercase();
            let status = self.live_status(&dns_name);
            (dns_name, status)
        }));
        statuses
    }

    fn live_status(&self, dns_name: &str) -> ConnectionStatus {
        let recorded = self.recorded_status.get(dns_name);
        match self.partitions.get(dns_name) {
            Some(provider) if provider.is_connected() => ConnectionStatus::Connected,
            Some(provider) => ConnectionStatus::Unreachable(
                provider
                    .last_connection_error()
                    .or_else(|| recorded.and_then(unreachable_reason))
                    .unwrap_or_else(|| "unknown".to_string()),
            ),
            None => recorded
                .cloned()
                .unwrap_or_else(|| ConnectionStatus::Unreachable("unknown".to_string())),
        }
    }
}

fn unreachable_reason(status: &ConnectionStatus) -> Option<String> {
    match status {
        ConnectionStatus::Unreachable(reason) => Some(reason.clone()),
        ConnectionStatus::Connected | ConnectionStatus::Reconnecting => None,
    }
}

/// Picks the seed partition's DNS name: the topology entry matching the seed
/// base DN, else the DNS suffix derived from that DN, else the seed's reported
/// domain name (which may be a bare host for simple-bind configurations).
fn resolve_seed_dns_name(seed: &dyn DirectoryProvider, topology: &ForestTopology) -> String {
    if let Some(base_dn) = seed.base_dn() {
        if let Some(partition) = topology.find_by_dn(&base_dn) {
            return partition.dns_name.to_ascii_lowercase();
        }
        if let Some(dns_name) = dns_domain_from_dn(&base_dn) {
            return dns_name;
        }
    }
    seed.domain_name()
        .map(|d| d.to_ascii_lowercase())
        .unwrap_or_else(|| "unknown".to_string())
}

/// Puts the seed partition first (inserting a synthesized one when discovery
/// omitted it), fills in its DC FQDN, and truncates to `MAX_PARTITIONS`.
fn normalize_topology(
    seed: &dyn DirectoryProvider,
    seed_dns_name: &str,
    mut topology: ForestTopology,
) -> ForestTopology {
    if topology.find_by_dns_name(seed_dns_name).is_none() {
        let mut synthesized = ForestTopology::synthesized_from(seed).partitions;
        if synthesized.is_empty() {
            synthesized.push(DomainPartition {
                distinguished_name: seed.base_dn().unwrap_or_default(),
                dns_name: seed_dns_name.to_string(),
                netbios_name: None,
                default_dc_fqdn: seed.connected_host(),
            });
        }
        topology.partitions.splice(0..0, synthesized);
    }
    // Stable sort: the seed partition moves to the front, others keep order.
    topology
        .partitions
        .sort_by_key(|p| !p.dns_name.eq_ignore_ascii_case(seed_dns_name));
    if let Some(seed_partition) = topology.partitions.first_mut()
        && seed_partition.default_dc_fqdn.is_none()
    {
        seed_partition.default_dc_fqdn = seed.connected_host();
    }
    if topology.partitions.len() > MAX_PARTITIONS {
        tracing::warn!(
            discovered = topology.partitions.len(),
            cap = MAX_PARTITIONS,
            "Forest exposes more partitions than the safety cap, truncating"
        );
        topology.partitions.truncate(MAX_PARTITIONS);
    }
    topology
}

type PartitionMap = HashMap<String, Arc<dyn DirectoryProvider>>;

/// Binds every non-seed partition concurrently, each attempt bounded by
/// `bind_timeout`, and classifies the outcome per partition. Partitions the
/// connector declines are recorded as unreachable without a bind attempt and
/// get no provider entry.
async fn bind_partitions(
    topology: &ForestTopology,
    seed_dns_name: &str,
    connector: &dyn PartitionConnector,
    bind_timeout: Duration,
) -> (PartitionMap, HashMap<String, ConnectionStatus>) {
    let mut partitions: PartitionMap = HashMap::new();
    let mut statuses: HashMap<String, ConnectionStatus> = HashMap::new();

    let mut binds = JoinSet::new();
    for partition in topology
        .partitions
        .iter()
        .filter(|p| !p.dns_name.eq_ignore_ascii_case(seed_dns_name))
    {
        let dns_name = partition.dns_name.to_ascii_lowercase();
        let provider = match connector.build(partition) {
            Ok(provider) => provider,
            Err(reason) => {
                tracing::warn!(partition = %dns_name, reason = %reason, "Forest partition skipped");
                statuses.insert(dns_name, ConnectionStatus::Unreachable(reason));
                continue;
            }
        };
        binds.spawn(async move {
            let outcome = tokio::time::timeout(bind_timeout, provider.test_connection()).await;
            (dns_name, provider, outcome)
        });
    }
    while let Some(joined) = binds.join_next().await {
        let (dns_name, provider, outcome) = match joined {
            Ok(result) => result,
            Err(e) => {
                tracing::warn!(error = %e, "Partition bind task failed to complete");
                continue;
            }
        };
        let status = match outcome {
            Ok(Ok(true)) => ConnectionStatus::Connected,
            Ok(Ok(false)) => ConnectionStatus::Unreachable(
                provider
                    .last_connection_error()
                    .unwrap_or_else(|| "unknown".to_string()),
            ),
            Ok(Err(e)) => {
                tracing::warn!(partition = %dns_name, error = %e, "Partition bind errored");
                ConnectionStatus::Unreachable("unknown".to_string())
            }
            Err(_elapsed) => ConnectionStatus::Unreachable("timeout".to_string()),
        };
        match &status {
            ConnectionStatus::Connected => {
                tracing::info!(partition = %dns_name, "Forest partition connected");
            }
            other => {
                tracing::warn!(partition = %dns_name, status = ?other, "Forest partition unreachable");
            }
        }
        statuses.insert(dns_name.clone(), status);
        partitions.insert(dns_name, provider);
    }
    (partitions, statuses)
}

#[async_trait]
impl DirectoryProvider for ForestProvider {
    // seed only: the UI connection state tracks the operator's own domain;
    // non-seed states surface through `partition_status()`.
    fn is_connected(&self) -> bool {
        self.seed.is_connected()
    }

    // seed only
    fn domain_name(&self) -> Option<&str> {
        self.seed.domain_name()
    }

    // seed only
    fn connected_host(&self) -> Option<String> {
        self.seed.connected_host()
    }

    // seed only: auth state is per bind, the identity is reused per partition
    fn simple_bind_credentials(&self) -> Option<(String, String)> {
        self.seed.simple_bind_credentials()
    }

    // seed only: `base_dn` is the operator's own naming context. Callers that
    // need the forest-shared Configuration partition use `configuration_dn`;
    // the forest root DN is exposed through `ForestProvider::forest_root_dn`.
    fn base_dn(&self) -> Option<String> {
        self.seed.base_dn()
    }

    // seed only: the Configuration partition is forest-shared and the seed DC
    // reports its DN in the rootDSE, so it resolves correctly from a child domain
    fn configuration_dn(&self) -> Option<String> {
        self.seed.configuration_dn()
    }

    // seed only
    async fn test_connection(&self) -> Result<bool> {
        self.seed.test_connection().await
    }

    // seed only
    fn last_connection_error(&self) -> Option<String> {
        self.seed.last_connection_error()
    }

    // OR across partitions: truncated if any partition truncated
    fn last_search_was_truncated(&self) -> bool {
        self.partitions
            .values()
            .any(|p| p.last_search_was_truncated())
    }

    // seed only: UI hint scoped to the bound DC
    fn is_connected_to_rodc(&self) -> bool {
        self.seed.is_connected_to_rodc()
    }

    // fan-out + merge (Story 15.3); seed only until then
    async fn search_users(&self, filter: &str, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        self.seed.search_users(filter, max_results).await
    }

    // fan-out + merge (Story 15.3); seed only until then
    async fn search_computers(
        &self,
        filter: &str,
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>> {
        self.seed.search_computers(filter, max_results).await
    }

    // fan-out + merge (Story 15.3); seed only until then
    async fn search_groups(&self, filter: &str, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        self.seed.search_groups(filter, max_results).await
    }

    // fan-out, first match wins with the seed first (Story 15.3); seed only until then
    async fn get_user_by_identity(&self, sam_account_name: &str) -> Result<Option<DirectoryEntry>> {
        self.seed.get_user_by_identity(sam_account_name).await
    }

    // route by group DN (Story 15.4); seed only until then
    async fn get_group_members(
        &self,
        group_dn: &str,
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>> {
        self.seed.get_group_members(group_dn, max_results).await
    }

    // fan-out + merge (Story 15.2); seed only until then
    async fn browse_users(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        self.seed.browse_users(max_results).await
    }

    // fan-out + merge (Story 15.2); seed only until then
    async fn browse_computers(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        self.seed.browse_computers(max_results).await
    }

    // seed only: the operator's own session
    async fn get_current_user_groups(&self) -> Result<Vec<String>> {
        self.seed.get_current_user_groups().await
    }

    // route by user DN (Story 15.5); seed only until then
    async fn reset_password(
        &self,
        user_dn: &str,
        new_password: &str,
        must_change_at_next_logon: bool,
    ) -> Result<()> {
        self.seed
            .reset_password(user_dn, new_password, must_change_at_next_logon)
            .await
    }

    // route by user DN (Story 15.5); seed only until then
    async fn unlock_account(&self, user_dn: &str) -> Result<()> {
        self.seed.unlock_account(user_dn).await
    }

    // route by user DN (Story 15.5); seed only until then
    async fn enable_account(&self, user_dn: &str) -> Result<()> {
        self.seed.enable_account(user_dn).await
    }

    // route by user DN (Story 15.5); seed only until then
    async fn disable_account(&self, user_dn: &str) -> Result<()> {
        self.seed.disable_account(user_dn).await
    }

    // route by user DN (Story 15.5); seed only until then
    async fn clear_user_account_control_bits(
        &self,
        user_dn: &str,
        bits_to_clear: u32,
    ) -> Result<(u32, u32)> {
        self.seed
            .clear_user_account_control_bits(user_dn, bits_to_clear)
            .await
    }

    // route by user DN (Story 15.4); seed only until then
    async fn get_user_account_control(&self, user_dn: &str) -> Result<u32> {
        self.seed.get_user_account_control(user_dn).await
    }

    // route by user DN (Story 15.4); seed only until then
    async fn get_user_spns(&self, user_dn: &str) -> Result<Vec<String>> {
        self.seed.get_user_spns(user_dn).await
    }

    // route by user DN (Story 15.4); seed only until then
    async fn get_cannot_change_password(&self, user_dn: &str) -> Result<bool> {
        self.seed.get_cannot_change_password(user_dn).await
    }

    // route by user DN (Story 15.5); seed only until then
    async fn set_password_flags(
        &self,
        user_dn: &str,
        password_never_expires: bool,
        user_cannot_change_password: bool,
    ) -> Result<()> {
        self.seed
            .set_password_flags(user_dn, password_never_expires, user_cannot_change_password)
            .await
    }

    // route by group DN (Story 15.5 group-membership rule); seed only until then
    async fn add_user_to_group(&self, user_dn: &str, group_dn: &str) -> Result<()> {
        self.seed.add_user_to_group(user_dn, group_dn).await
    }

    // route by object DN (Story 15.4); seed only until then
    async fn get_replication_metadata(&self, object_dn: &str) -> Result<Option<String>> {
        self.seed.get_replication_metadata(object_dn).await
    }

    // route by object DN (Story 15.4); seed only until then
    async fn get_replication_value_metadata(&self, object_dn: &str) -> Result<Option<String>> {
        self.seed.get_replication_value_metadata(object_dn).await
    }

    // route by user DN (Story 15.4); seed only until then
    async fn get_nested_groups(&self, user_dn: &str) -> Result<Vec<String>> {
        self.seed.get_nested_groups(user_dn).await
    }

    // fan-out + merge by partition (Story 15.2); seed only until then
    async fn get_ou_tree(&self) -> Result<Vec<OUNode>> {
        self.seed.get_ou_tree().await
    }

    // fan-out + merge (Story 15.2); seed only until then
    async fn browse_groups(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        self.seed.browse_groups(max_results).await
    }

    // route by group DN (Story 15.5); seed only until then
    async fn remove_group_member(&self, group_dn: &str, member_dn: &str) -> Result<()> {
        self.seed.remove_group_member(group_dn, member_dn).await
    }

    // route by object DN (Story 15.5); seed only until then
    async fn delete_object(&self, dn: &str) -> Result<()> {
        self.seed.delete_object(dn).await
    }

    // route by parent OU DN (Story 15.5); seed only until then
    async fn create_group(
        &self,
        name: &str,
        container_dn: &str,
        scope: &str,
        category: &str,
        description: &str,
    ) -> Result<String> {
        self.seed
            .create_group(name, container_dn, scope, category, description)
            .await
    }

    // route by source DN, same partition only (Story 15.5); seed only until then
    async fn move_object(&self, object_dn: &str, target_container_dn: &str) -> Result<()> {
        self.seed.move_object(object_dn, target_container_dn).await
    }

    // route by group DN (Story 15.5); seed only until then
    async fn update_managed_by(&self, group_dn: &str, manager_dn: &str) -> Result<()> {
        self.seed.update_managed_by(group_dn, manager_dn).await
    }

    // route by parent OU DN (Story 15.5); seed only until then
    async fn create_user(
        &self,
        cn: &str,
        container_dn: &str,
        sam_account_name: &str,
        password: &str,
        attributes: &std::collections::HashMap<String, Vec<String>>,
    ) -> Result<String> {
        self.seed
            .create_user(cn, container_dn, sam_account_name, password, attributes)
            .await
    }

    // route by object DN (Story 15.4); seed only until then
    async fn get_all_attributes(
        &self,
        dn: &str,
    ) -> Result<std::collections::HashMap<String, Vec<String>>> {
        self.seed.get_all_attributes(dn).await
    }

    // route by object DN (Story 15.5); seed only until then
    async fn modify_attribute(
        &self,
        dn: &str,
        attribute_name: &str,
        values: &[String],
    ) -> Result<()> {
        self.seed.modify_attribute(dn, attribute_name, values).await
    }

    // seed only
    fn authenticated_user(&self) -> Option<String> {
        self.seed.authenticated_user()
    }

    // per partition (Story 15.5 permission gate); seed only until then
    async fn probe_effective_permissions(&self) -> Result<(bool, bool, bool)> {
        self.seed.probe_effective_permissions().await
    }

    // seed only: the schema partition is forest-shared
    async fn get_schema_attributes(&self) -> Result<Vec<String>> {
        self.seed.get_schema_attributes().await
    }

    // fan-out + merge (Story 15.2); seed only until then
    async fn browse_contacts(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        self.seed.browse_contacts(max_results).await
    }

    // fan-out + merge (Story 15.2); seed only until then
    async fn browse_printers(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        self.seed.browse_printers(max_results).await
    }

    // seed only: forest-level feature flag
    async fn is_recycle_bin_enabled(&self) -> Result<bool> {
        self.seed.is_recycle_bin_enabled().await
    }

    // fan-out + merge (Story 15.2); seed only until then
    async fn get_deleted_objects(&self) -> Result<Vec<DeletedObject>> {
        self.seed.get_deleted_objects().await
    }

    // route by the source partition recorded in the snapshot (Story 15.5); seed only until then
    async fn restore_deleted_object(&self, deleted_dn: &str, target_ou_dn: &str) -> Result<()> {
        self.seed
            .restore_deleted_object(deleted_dn, target_ou_dn)
            .await
    }

    // fan-out + merge (Story 15.3); seed only until then
    async fn search_contacts(&self, filter: &str, max_results: usize) -> Result<Vec<ContactInfo>> {
        self.seed.search_contacts(filter, max_results).await
    }

    // fan-out + merge (Story 15.3); seed only until then
    async fn search_printers(&self, filter: &str, max_results: usize) -> Result<Vec<PrinterInfo>> {
        self.seed.search_printers(filter, max_results).await
    }

    // route by parent OU DN (Story 15.5); seed only until then
    async fn create_contact(
        &self,
        container_dn: &str,
        attrs: &HashMap<String, String>,
    ) -> Result<String> {
        self.seed.create_contact(container_dn, attrs).await
    }

    // route by object DN (Story 15.5); seed only until then
    async fn update_contact(&self, dn: &str, attrs: &HashMap<String, String>) -> Result<()> {
        self.seed.update_contact(dn, attrs).await
    }

    // route by object DN (Story 15.5); seed only until then
    async fn delete_contact(&self, dn: &str) -> Result<()> {
        self.seed.delete_contact(dn).await
    }

    // route by parent OU DN (Story 15.5); seed only until then
    async fn create_printer(
        &self,
        container_dn: &str,
        attrs: &HashMap<String, String>,
    ) -> Result<String> {
        self.seed.create_printer(container_dn, attrs).await
    }

    // route by object DN (Story 15.5); seed only until then
    async fn update_printer(&self, dn: &str, attrs: &HashMap<String, String>) -> Result<()> {
        self.seed.update_printer(dn, attrs).await
    }

    // route by object DN (Story 15.5); seed only until then
    async fn delete_printer(&self, dn: &str) -> Result<()> {
        self.seed.delete_printer(dn).await
    }

    // route by user DN (Story 15.4); seed only until then
    async fn get_thumbnail_photo(&self, user_dn: &str) -> Result<Option<String>> {
        self.seed.get_thumbnail_photo(user_dn).await
    }

    // route by user DN (Story 15.5); seed only until then
    async fn set_thumbnail_photo(&self, user_dn: &str, photo_base64: &str) -> Result<()> {
        self.seed.set_thumbnail_photo(user_dn, photo_base64).await
    }

    // route by user DN (Story 15.5); seed only until then
    async fn remove_thumbnail_photo(&self, user_dn: &str) -> Result<()> {
        self.seed.remove_thumbnail_photo(user_dn).await
    }

    // configuration partition only: forest-shared, reachable through the seed
    async fn search_configuration(
        &self,
        search_base: &str,
        filter: &str,
    ) -> Result<Vec<DirectoryEntry>> {
        self.seed.search_configuration(search_base, filter).await
    }

    // route by object DN (Story 15.4); seed only until then
    async fn read_entry(&self, dn: &str) -> Result<Option<DirectoryEntry>> {
        self.seed.read_entry(dn).await
    }

    // fan-out, first match wins (RID is partition-scoped); seed only until then
    async fn resolve_group_by_rid(&self, rid: u32) -> Result<Option<DirectoryEntry>> {
        self.seed.resolve_group_by_rid(rid).await
    }

    // seed only: the forest root is a rootDSE attribute of the seed DC
    fn forest_root_dn(&self) -> Option<String> {
        self.seed.forest_root_dn()
    }

    // promoted: the topology built at connect time; placeholder: live seed
    // discovery, so callers can still learn the forest before promotion
    async fn discover_forest(&self) -> Result<ForestTopology> {
        if self.promoted {
            Ok(self.topology.clone())
        } else {
            self.seed.discover_forest().await
        }
    }
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::directory::tests::MockDirectoryProvider;
    use std::time::Instant;

    fn crossref_entry(
        nc_name: &str,
        dns_root: &str,
        netbios: &str,
        system_flags: i64,
    ) -> DirectoryEntry {
        let mut entry = DirectoryEntry::new(format!(
            "CN={},CN=Partitions,CN=Configuration,DC=corp,DC=example,DC=com",
            netbios
        ));
        entry
            .attributes
            .insert("nCName".to_string(), vec![nc_name.to_string()]);
        if !dns_root.is_empty() {
            entry
                .attributes
                .insert("dnsRoot".to_string(), vec![dns_root.to_string()]);
        }
        if !netbios.is_empty() {
            entry
                .attributes
                .insert("nETBIOSName".to_string(), vec![netbios.to_string()]);
        }
        entry
            .attributes
            .insert("systemFlags".to_string(), vec![system_flags.to_string()]);
        entry
    }

    fn stub_forest_entries() -> Vec<DirectoryEntry> {
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

    struct StubConnector {
        providers: HashMap<String, Arc<dyn DirectoryProvider>>,
        declined: HashMap<String, String>,
    }

    impl StubConnector {
        fn new() -> Self {
            Self {
                providers: HashMap::new(),
                declined: HashMap::new(),
            }
        }

        fn with(mut self, dns_name: &str, provider: MockDirectoryProvider) -> Self {
            self.providers
                .insert(dns_name.to_string(), Arc::new(provider));
            self
        }

        fn declining(mut self, dns_name: &str, reason: &str) -> Self {
            self.declined
                .insert(dns_name.to_string(), reason.to_string());
            self
        }
    }

    impl PartitionConnector for StubConnector {
        fn build(&self, partition: &DomainPartition) -> Result<Arc<dyn DirectoryProvider>, String> {
            if let Some(reason) = self.declined.get(&partition.dns_name) {
                return Err(reason.clone());
            }
            Ok(self
                .providers
                .get(&partition.dns_name)
                .cloned()
                .unwrap_or_else(|| Arc::new(MockDirectoryProvider::new())))
        }
    }

    fn partition(dns_name: &str) -> DomainPartition {
        DomainPartition {
            distinguished_name: format!(
                "DC={}",
                dns_name.split('.').collect::<Vec<_>>().join(",DC=")
            ),
            dns_name: dns_name.to_string(),
            netbios_name: None,
            default_dc_fqdn: None,
        }
    }

    fn seed_mock() -> Arc<dyn DirectoryProvider> {
        Arc::new(MockDirectoryProvider::new())
    }

    // AC #8a: stub crossRef list parses into the two domain partitions, in order.
    #[test]
    fn parses_domain_partitions_from_crossref_entries() {
        let parsed = parse_partitions_from_entries(&stub_forest_entries()).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].dns_name, "corp.example.com");
        assert_eq!(parsed[0].distinguished_name, "DC=corp,DC=example,DC=com");
        assert_eq!(parsed[0].netbios_name.as_deref(), Some("CORP"));
        assert_eq!(parsed[1].dns_name, "eu.corp.example.com");
        assert_eq!(parsed[1].netbios_name.as_deref(), Some("CORPEU"));
        assert!(parsed.iter().all(|p| p.default_dc_fqdn.is_none()));
    }

    // AC #8b: only entries carrying FLAG_CR_NTDS_DOMAIN survive the bitwise filter.
    #[test]
    fn bitwise_filter_keeps_only_ntds_domain_crossrefs() {
        let entries = vec![
            crossref_entry("DC=none,DC=example,DC=com", "none.example.com", "NONE", 0),
            crossref_entry("DC=ntds,DC=example,DC=com", "ntds.example.com", "NTDS", 2),
            crossref_entry("DC=both,DC=example,DC=com", "both.example.com", "BOTH", 3),
            crossref_entry(
                "DC=writable,DC=example,DC=com",
                "writable.example.com",
                "WRITABLE",
                1,
            ),
        ];
        let parsed = parse_partitions_from_entries(&entries).unwrap();
        let names: Vec<&str> = parsed.iter().map(|p| p.dns_name.as_str()).collect();
        assert_eq!(names, vec!["ntds.example.com", "both.example.com"]);
    }

    #[test]
    fn parser_rejects_entry_sets_without_domain_partitions() {
        let entries = vec![crossref_entry(
            "CN=Schema,CN=Configuration,DC=corp,DC=example,DC=com",
            "",
            "",
            1,
        )];
        let err = parse_partitions_from_entries(&entries).unwrap_err();
        assert!(err.to_string().contains("No domain partitions"));
    }

    #[test]
    fn parser_derives_dns_name_from_nc_name_when_dns_root_missing() {
        let mut entry = crossref_entry("DC=Fallback,DC=Example,DC=Com", "", "FB", 2);
        entry.attributes.remove("dnsRoot");
        let parsed = parse_partitions_from_entries(&[entry]).unwrap();
        assert_eq!(parsed[0].dns_name, "fallback.example.com");
    }

    #[test]
    fn parser_matches_attribute_names_case_insensitively() {
        let mut entry = DirectoryEntry::new("CN=CORP,CN=Partitions".to_string());
        entry
            .attributes
            .insert("ncname".to_string(), vec!["DC=corp,DC=local".to_string()]);
        entry
            .attributes
            .insert("DNSROOT".to_string(), vec!["Corp.Local".to_string()]);
        entry
            .attributes
            .insert("SYSTEMFLAGS".to_string(), vec!["3".to_string()]);
        let parsed = parse_partitions_from_entries(&[entry]).unwrap();
        assert_eq!(parsed[0].dns_name, "corp.local");
        assert_eq!(parsed[0].distinguished_name, "DC=corp,DC=local");
    }

    #[test]
    fn dns_domain_from_dn_handles_case_whitespace_and_escaped_commas() {
        assert_eq!(
            dns_domain_from_dn("CN=jdoe,OU=Users,DC=sub,DC=racine,DC=dmi").as_deref(),
            Some("sub.racine.dmi")
        );
        assert_eq!(
            dns_domain_from_dn(" cn=Doe\\, John , ou=Users , dc=Corp , DC=Example , dc=COM")
                .as_deref(),
            Some("corp.example.com")
        );
        assert_eq!(
            dns_domain_from_dn("CN=Configuration,DC=root,DC=local").as_deref(),
            Some("root.local")
        );
        assert_eq!(dns_domain_from_dn("CN=Schema,CN=Configuration"), None);
        assert_eq!(dns_domain_from_dn(""), None);
        assert_eq!(dns_domain_from_dn("DC=,DC=local").as_deref(), Some("local"));
    }

    #[test]
    fn split_dn_components_keeps_escaped_commas_inside_a_component() {
        let parts = split_dn_components("CN=Doe\\, John,OU=Sales,DC=corp,DC=local");
        assert_eq!(
            parts,
            vec!["CN=Doe\\, John", "OU=Sales", "DC=corp", "DC=local"]
        );
    }

    #[test]
    fn synthesized_topology_uses_provider_base_dn() {
        let mock = MockDirectoryProvider::new();
        let topology = ForestTopology::synthesized_from(&mock);
        assert_eq!(topology.partitions.len(), 1);
        assert_eq!(
            topology.partitions[0].distinguished_name,
            mock.base_dn().unwrap()
        );
        assert_eq!(
            topology.partitions[0].dns_name,
            dns_domain_from_dn(&mock.base_dn().unwrap()).unwrap()
        );
        assert!(topology.is_single_domain());
    }

    #[test]
    fn synthesized_topology_is_empty_without_base_dn() {
        let mock = MockDirectoryProvider::disconnected();
        assert!(
            ForestTopology::synthesized_from(&mock)
                .partitions
                .is_empty()
        );
    }

    #[tokio::test]
    async fn trait_default_discover_forest_synthesizes_single_partition() {
        let mock = MockDirectoryProvider::new();
        let topology = mock.discover_forest().await.unwrap();
        assert_eq!(topology.partitions.len(), 1);
        assert_eq!(topology.partitions[0].dns_name, "example.com");
    }

    #[tokio::test]
    async fn trait_default_discover_forest_fails_without_base_dn() {
        let mock = MockDirectoryProvider::disconnected();
        assert!(mock.discover_forest().await.is_err());
    }

    #[test]
    fn connection_status_serializes_adjacently_tagged() {
        let connected = serde_json::to_value(ConnectionStatus::Connected).unwrap();
        assert_eq!(connected, serde_json::json!({ "state": "connected" }));
        let unreachable =
            serde_json::to_value(ConnectionStatus::Unreachable("timeout".into())).unwrap();
        assert_eq!(
            unreachable,
            serde_json::json!({ "state": "unreachable", "reason": "timeout" })
        );
        let round_trip: ConnectionStatus = serde_json::from_value(unreachable).unwrap();
        assert_eq!(round_trip, ConnectionStatus::Unreachable("timeout".into()));
    }

    #[test]
    fn partition_bind_timeout_defaults_to_three_seconds() {
        // The env override is exercised through `assemble`'s explicit timeout
        // parameter; here only the default path is asserted to avoid mutating
        // process-wide environment in parallel tests.
        if std::env::var(PARTITION_BIND_TIMEOUT_ENV).is_err() {
            assert_eq!(partition_bind_timeout(), DEFAULT_PARTITION_BIND_TIMEOUT);
        }
    }

    // AC #8c: a non-seed partition that fails to bind is recorded as Unreachable
    // with the provider's classification, while healthy partitions connect.
    #[tokio::test]
    async fn partition_status_records_failed_non_seed_bind() {
        let topology = ForestTopology {
            partitions: vec![
                partition("example.com"),
                partition("eu.example.com"),
                partition("apac.example.com"),
            ],
        };
        let connector = StubConnector::new()
            .with("eu.example.com", MockDirectoryProvider::new())
            .with(
                "apac.example.com",
                MockDirectoryProvider::new()
                    .with_connected(false)
                    .with_connection_error("network"),
            );
        let forest = ForestProvider::assemble(
            seed_mock(),
            topology,
            Arc::new(connector),
            Duration::from_secs(1),
        )
        .await;

        let status = forest.partition_status();
        assert_eq!(
            status[0],
            ("example.com".to_string(), ConnectionStatus::Connected)
        );
        assert_eq!(
            status[1],
            ("eu.example.com".to_string(), ConnectionStatus::Connected)
        );
        assert_eq!(
            status[2],
            (
                "apac.example.com".to_string(),
                ConnectionStatus::Unreachable("network".to_string())
            )
        );
        assert!(forest.partition("apac.example.com").is_some());
        assert!(forest.partition("EU.example.com").is_some());
        assert!(forest.partition("missing.example.com").is_none());
        assert!(forest.is_connected());
    }

    #[tokio::test]
    async fn partition_status_records_bind_errors_as_unknown() {
        let topology = ForestTopology {
            partitions: vec![partition("example.com"), partition("eu.example.com")],
        };
        let connector = StubConnector::new().with(
            "eu.example.com",
            MockDirectoryProvider::new()
                .with_failure()
                .with_connected(false),
        );
        let forest = ForestProvider::assemble(
            seed_mock(),
            topology,
            Arc::new(connector),
            Duration::from_secs(1),
        )
        .await;
        assert_eq!(
            forest.partition_status()[1].1,
            ConnectionStatus::Unreachable("unknown".to_string())
        );
    }

    // AC #11: a slow non-seed bind times out without delaying its siblings.
    #[tokio::test]
    async fn slow_partition_bind_times_out_without_blocking_others() {
        let topology = ForestTopology {
            partitions: vec![
                partition("example.com"),
                partition("slow.example.com"),
                partition("fast.example.com"),
            ],
        };
        let connector = StubConnector::new()
            .with(
                "slow.example.com",
                MockDirectoryProvider::new()
                    .with_connect_delay(Duration::from_secs(5))
                    .with_connected(false),
            )
            .with("fast.example.com", MockDirectoryProvider::new());
        let started = Instant::now();
        let forest = ForestProvider::assemble(
            seed_mock(),
            topology,
            Arc::new(connector),
            Duration::from_millis(150),
        )
        .await;
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "assembly must be bounded by the per-partition timeout"
        );
        let status: HashMap<String, ConnectionStatus> =
            forest.partition_status().into_iter().collect();
        assert_eq!(
            status["slow.example.com"],
            ConnectionStatus::Unreachable("timeout".to_string())
        );
        assert_eq!(status["fast.example.com"], ConnectionStatus::Connected);
    }

    // AC #11: discovery output is truncated to MAX_PARTITIONS with the seed first.
    #[tokio::test]
    async fn assembly_truncates_to_partition_cap_with_seed_first() {
        let mut partitions: Vec<DomainPartition> = (0..60)
            .map(|i| partition(&format!("d{i:02}.example.com")))
            .collect();
        partitions.push(partition("example.com"));
        let topology = ForestTopology { partitions };
        let forest = ForestProvider::assemble(
            seed_mock(),
            topology,
            Arc::new(StubConnector::new()),
            Duration::from_secs(1),
        )
        .await;
        assert_eq!(forest.topology().partitions.len(), MAX_PARTITIONS);
        assert_eq!(forest.topology().partitions[0].dns_name, "example.com");
        assert_eq!(forest.topology().partitions[1].dns_name, "d00.example.com");
        assert_eq!(forest.partition_status().len(), MAX_PARTITIONS);
        assert!(forest.partition("d59.example.com").is_none());
    }

    #[tokio::test]
    async fn assembly_inserts_seed_partition_when_discovery_omits_it() {
        let topology = ForestTopology {
            partitions: vec![partition("other.example.com")],
        };
        let forest = ForestProvider::assemble(
            seed_mock(),
            topology,
            Arc::new(StubConnector::new()),
            Duration::from_secs(1),
        )
        .await;
        assert_eq!(forest.seed_dns_name(), "example.com");
        assert_eq!(forest.topology().partitions[0].dns_name, "example.com");
        assert_eq!(
            forest.topology().partitions[1].dns_name,
            "other.example.com"
        );
        assert_eq!(forest.forest_root_dn(), None);
        assert_eq!(forest.base_dn().as_deref(), Some("DC=example,DC=com"));
        assert!(forest.is_promoted());
    }

    #[test]
    fn single_partition_forest_wraps_provider_identity() {
        let forest = ForestProvider::single_partition(seed_mock());
        assert_eq!(forest.seed_dns_name(), "example.com");
        assert!(forest.topology().is_single_domain());
        assert_eq!(forest.partition_status().len(), 1);
        // `domain_name` delegates to the seed verbatim (status bar identity).
        assert_eq!(forest.domain_name(), Some("EXAMPLE.COM"));
        assert_eq!(forest.base_dn().as_deref(), Some("DC=example,DC=com"));
    }

    #[test]
    fn seed_status_reflects_live_seed_connection_state() {
        let seed = MockDirectoryProvider::disconnected();
        let forest = ForestProvider::single_partition(Arc::new(seed));
        assert!(!forest.is_connected());
        assert_eq!(forest.seed_dns_name(), "unknown");
        assert!(matches!(
            forest.partition_status()[0].1,
            ConnectionStatus::Unreachable(_)
        ));
    }

    #[tokio::test]
    async fn delegating_methods_target_the_seed() {
        let user = DirectoryEntry::new("CN=jdoe,DC=example,DC=com".to_string());
        let seed = MockDirectoryProvider::new().with_users(vec![user.clone()]);
        let forest = ForestProvider::single_partition(Arc::new(seed));
        let found = forest.search_users("jdoe", 10).await.unwrap();
        assert_eq!(found, vec![user]);
        assert!(forest.test_connection().await.unwrap());
        assert_eq!(forest.discover_forest().await.unwrap(), *forest.topology());
        assert!(!forest.last_search_was_truncated());
    }

    #[test]
    fn is_valid_dns_name_accepts_host_names_only() {
        assert!(is_valid_dns_name("corp.example.com"));
        assert!(is_valid_dns_name("eu-west.corp.example.com"));
        assert!(is_valid_dns_name("a1.example"));
        assert!(!is_valid_dns_name(""));
        assert!(!is_valid_dns_name("wpad"));
        assert!(!is_valid_dns_name("192.0.2.10"));
        assert!(!is_valid_dns_name("corp.123"));
        assert!(!is_valid_dns_name("dc.evil.tld:9999"));
        assert!(!is_valid_dns_name("evil.tld/path"));
        assert!(!is_valid_dns_name("user@evil.tld"));
        assert!(!is_valid_dns_name("corp..example.com"));
        assert!(!is_valid_dns_name("-corp.example.com"));
        assert!(!is_valid_dns_name("corp-.example.com"));
        assert!(!is_valid_dns_name("corp.example.com\n"));
        assert!(!is_valid_dns_name(&"a".repeat(64)));
        assert!(!is_valid_dns_name(&format!("{}.com", "a.".repeat(130))));
    }

    #[test]
    fn parser_rejects_dns_roots_that_are_not_host_names() {
        let entries = vec![
            crossref_entry("DC=ok,DC=example,DC=com", "ok.example.com", "OK", 2),
            crossref_entry("DC=port,DC=example,DC=com", "dc.evil.tld:9999/#", "PORT", 2),
            crossref_entry("DC=path,DC=example,DC=com", "evil.tld/path", "PATH", 2),
            crossref_entry(
                "DC=ctrl,DC=example,DC=com",
                "ctrl.example.com\u{0}",
                "CTRL",
                2,
            ),
            crossref_entry("DC=long,DC=example,DC=com", &"x".repeat(254), "LONG", 2),
        ];
        let parsed = parse_partitions_from_entries(&entries).unwrap();
        let names: Vec<&str> = parsed.iter().map(|p| p.dns_name.as_str()).collect();
        assert_eq!(names, vec!["ok.example.com"]);
    }

    #[test]
    fn parser_rejects_nc_names_and_drops_netbios_with_control_chars() {
        let bad_dn = crossref_entry("DC=bad\rDC=example,DC=com", "bad.example.com", "BAD", 2);
        let bad_netbios =
            crossref_entry("DC=fine,DC=example,DC=com", "fine.example.com", "FI\nNE", 2);
        let parsed = parse_partitions_from_entries(&[bad_dn, bad_netbios]).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].dns_name, "fine.example.com");
        assert_eq!(parsed[0].netbios_name, None);
    }

    fn simple_bind() -> LdapAuthMode {
        LdapAuthMode::SimpleBind {
            bind_dn: "CN=admin,CN=Users,DC=example,DC=com".to_string(),
            password: "secret".to_string(),
        }
    }

    #[test]
    fn ldap_connector_refuses_simple_bind_fan_out_without_tls() {
        let connector = LdapPartitionConnector::new(simple_bind(), LdapTlsConfig::default());
        let err = connector.build(&partition("eu.example.com")).err().unwrap();
        assert_eq!(err, TLS_REQUIRED);
    }

    #[test]
    fn ldap_connector_refuses_simple_bind_fan_out_with_unverified_tls() {
        let tls = LdapTlsConfig {
            enabled: true,
            starttls: false,
            skip_verify: true,
            ca_cert_file: None,
        };
        let connector = LdapPartitionConnector::new(simple_bind(), tls);
        let err = connector.build(&partition("eu.example.com")).err().unwrap();
        assert_eq!(err, TLS_UNVERIFIED);
    }

    #[test]
    fn ldap_connector_builds_simple_bind_partition_over_verified_tls() {
        let tls = LdapTlsConfig {
            enabled: true,
            starttls: false,
            skip_verify: false,
            ca_cert_file: None,
        };
        let connector = LdapPartitionConnector::new(simple_bind(), tls);
        let provider = connector.build(&partition("eu.example.com")).unwrap();
        assert_eq!(provider.domain_name(), Some("eu.example.com"));
        assert!(!provider.is_connected());
    }

    #[test]
    fn ldap_connector_builds_gssapi_partition_regardless_of_tls() {
        let connector = LdapPartitionConnector::new(LdapAuthMode::Gssapi, LdapTlsConfig::default());
        let provider = connector.build(&partition("eu.example.com")).unwrap();
        assert_eq!(provider.domain_name(), Some("eu.example.com"));
    }

    #[tokio::test]
    async fn declined_partition_is_recorded_unreachable_without_provider() {
        let topology = ForestTopology {
            partitions: vec![partition("example.com"), partition("eu.example.com")],
        };
        let connector = StubConnector::new().declining("eu.example.com", TLS_REQUIRED);
        let forest = ForestProvider::assemble(
            seed_mock(),
            topology,
            Arc::new(connector),
            Duration::from_secs(1),
        )
        .await;
        assert_eq!(
            forest.partition_status()[1],
            (
                "eu.example.com".to_string(),
                ConnectionStatus::Unreachable(TLS_REQUIRED.to_string())
            )
        );
        assert!(forest.partition("eu.example.com").is_none());
        assert_eq!(forest.topology().partitions.len(), 2);
    }

    #[tokio::test]
    async fn placeholder_repromotes_through_its_connector() {
        let seed = MockDirectoryProvider::new().with_configuration_entries(stub_forest_entries());
        let placeholder = ForestProvider::seed_only(Arc::new(seed), Arc::new(StubConnector::new()));
        assert!(!placeholder.is_promoted());
        // A placeholder answers discovery from its seed, not from a frozen topology.
        let live = placeholder.discover_forest().await.unwrap();
        assert_eq!(live.partitions.len(), 1);
        let promoted = placeholder.repromote().unwrap().await.unwrap();
        assert!(promoted.is_promoted());
        assert_eq!(promoted.seed_dns_name(), "example.com");
        assert!(promoted.repromote().is_some());
    }

    #[test]
    fn single_partition_forest_cannot_be_promoted() {
        let forest = ForestProvider::single_partition(seed_mock());
        assert!(!forest.is_promoted());
        assert!(forest.repromote().is_none());
    }

    #[tokio::test]
    async fn connect_with_rejects_unreachable_seed() {
        let seed = Arc::new(
            MockDirectoryProvider::new()
                .with_connected(false)
                .with_connection_error("network"),
        );
        let err = ForestProvider::connect_with(seed, Arc::new(StubConnector::new()))
            .await
            .err()
            .unwrap();
        assert!(err.to_string().contains("network"));
    }

    #[tokio::test]
    async fn partition_status_reads_live_provider_state() {
        let topology = ForestTopology {
            partitions: vec![partition("example.com"), partition("eu.example.com")],
        };
        let flaky = MockDirectoryProvider::new().with_connected(false);
        let connector = StubConnector::new().with("eu.example.com", flaky);
        let forest = ForestProvider::assemble(
            seed_mock(),
            topology,
            Arc::new(connector),
            Duration::from_secs(1),
        )
        .await;
        assert_eq!(
            forest.partition_status()[1].1,
            ConnectionStatus::Unreachable("unknown".to_string())
        );
        // The partition provider reconnects lazily; status must follow it.
        let eu = forest.partition("eu.example.com").unwrap();
        assert!(!eu.is_connected());
    }

    #[test]
    fn dc_target_must_be_a_host_inside_the_partition_domain() {
        assert!(is_dc_target_within("dc01.eu.example.com", "eu.example.com"));
        assert!(is_dc_target_within("DC01.EU.EXAMPLE.COM", "eu.example.com"));
        assert!(is_dc_target_within("eu.example.com", "eu.example.com"));
        assert!(!is_dc_target_within("dc.attacker.tld", "eu.example.com"));
        assert!(!is_dc_target_within("dc01.example.com", "eu.example.com"));
        assert!(!is_dc_target_within(
            "evil-eu.example.com",
            "eu.example.com"
        ));
        assert!(!is_dc_target_within(
            "dc01.eu.example.com:636",
            "eu.example.com"
        ));
        assert!(!is_dc_target_within(
            "user@dc01.eu.example.com",
            "eu.example.com"
        ));
    }
}
