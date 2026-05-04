# Epic 15: Forest-Aware Directory Access

**Goal**: Lift DSPanel's current single-domain limitation. Today the LDAP layer binds to one DC and uses its `defaultNamingContext` (`DC=corp,DC=local`) as the unique search base. In a multi-domain forest (e.g. `racine.dmi` plus child `sub.racine.dmi`), DSPanel only sees the partition of the DC it happened to bind. The user-visible symptoms reported on 1.1.0:

- A read-only user logged into `sub.racine.dmi` launches DSPanel and sees `noUsersFound` because DSPanel bound to a `racine.dmi` DC by chance and the user has no read rights on root-domain users.
- A Domain Admin on `racine.dmi` browses users, computers, and groups but never sees objects from `sub.racine.dmi` - the subtree search on the root partition does not cross partition boundaries.

This epic introduces forest topology discovery, per-domain connection pooling, DN-based routing for both reads and writes, and a "Domain" column across the lookup pages so the operator always knows which partition an object lives in. Result: 100% of the forest is reachable from a single DSPanel connection, with no degradation for single-domain deployments.

**Positioning rationale**: Most enterprise AD deployments DSPanel targets are forests with at least one child or tree-root domain (resource domains, regional subsidiaries, acquired businesses). Without forest awareness DSPanel is silently broken for these customers and falls back to the same restriction as a stock `ldapsearch` against one DC. Competing admin tools (Quest Active Roles, ManageEngine ADManager, ADUC itself) all enumerate forest partitions; matching that capability is table-stakes for the 1.x line.

**Out of scope**: cross-forest trusts (we cover the *forest* the bound user belongs to, not federated forests). External / SID-history-based foreign-security-principal resolution. Schema or Configuration partition browsing (already a one-shot direct DN query for the topology view, no need to expose them as browseable lists). Per-domain GPO inventory aggregation (Epic 11.3 GPO viewer already addresses single-domain GPOs; cross-domain GPO inventory is its own story if customer demand justifies it).

---

### Story 15.1: Forest topology discovery and ForestProvider scaffold

As a DSPanel developer,
I want a `ForestProvider` that discovers every domain partition in the forest at connect time and holds one pooled LDAP connection per partition,
so that downstream services can fan out read and write operations to the correct partition without each call site re-implementing the discovery and connection bookkeeping.

#### Acceptance Criteria

1. New service module `src-tauri/src/services/forest.rs` exposes a `ForestTopology { partitions: Vec<DomainPartition> }` and a `DomainPartition { distinguished_name: String, dns_name: String, netbios_name: Option<String>, default_dc_fqdn: Option<String> }`.
2. A new method `DirectoryProvider::discover_forest(&self) -> Result<ForestTopology>` reads `CN=Partitions,CN=Configuration,<base_dn>` with filter `(&(objectClass=crossRef)(systemFlags:1.2.840.113556.1.4.803:=2))` (the `FLAG_CR_NTDS_DOMAIN` bit, which excludes Schema, Configuration, and ForestDnsZones / DomainDnsZones partitions). For each crossRef the service collects `nCName` (partition DN), `dnsRoot` (DNS suffix), and `netbiosName`.
3. New struct `ForestProvider { partitions: HashMap<DnsName, Arc<dyn DirectoryProvider>> }` is returned by a new factory function `ForestProvider::connect(seed_provider, auth_mode, tls_config) -> Result<Self>`. The seed provider is the existing single-domain `LdapDirectoryProvider` already used for the initial bind; it is reused as the connection to the seed domain (typically the user's own domain) and additional `LdapDirectoryProvider` instances are created and bound for every other partition discovered.
4. `ForestProvider` itself implements `DirectoryProvider`. Its method bodies fan out to the per-partition providers as appropriate: for `is_connected`, all partitions must be connected; for `domain_name`, the seed partition is reported (operators identify their session by their own domain); for `base_dn`, the *forest root* partition DN is reported so callers that query `CN=Configuration,<base_dn>` keep working.
5. Each per-partition `LdapDirectoryProvider` keeps its existing single-connection pool. `ForestProvider` does NOT introduce a global mutex; the per-partition pools serialize their own connection state.
6. Connection failures on non-seed partitions are non-fatal at construction time. A partition that fails to bind is recorded with a `last_connection_error` classification (already implemented per partition) and `ForestProvider::partition_status() -> Vec<(DnsName, ConnectionStatus)>` exposes the table to the UI for the partial-failure banner introduced in Story 15.6.
7. The seed partition failing IS fatal: `ForestProvider::connect` returns the error from the seed `LdapDirectoryProvider::test_connection` so the existing connection error UX (Story 1.2) is unchanged.
8. Unit tests cover (a) parsing of a stub `crossRef` entry list to a `ForestTopology`, (b) the `systemFlags` bitwise filter rejects Schema / Configuration / ForestDnsZones / DomainDnsZones, (c) the `partition_status()` reporting after a simulated mid-construction bind failure on a non-seed partition.

---

### Story 15.2: Multi-domain browse with domain column

As an AD operator working in a multi-domain forest,
I want the user / computer / group / contact lookup lists to show objects from every domain in the forest, with a clear indication of which domain each object lives in,
so that I can find an account regardless of which domain it lives in and visually disambiguate two objects that share a name across domains.

#### Acceptance Criteria

1. The four backend `browse_users_inner` / `browse_computers_inner` / `browse_groups_inner` / `browse_contacts_inner` functions in `commands/directory.rs` are rewritten to fan out to every `ForestProvider` partition, concurrently via `tokio::join_all` (or `try_join_all` with relaxed semantics described below), and merge the results.
2. `DirectoryEntry` gains a `partition_dns_name: String` field populated by the partition that returned the entry. Existing serialization paths add this field (camelCase `partitionDnsName`); it is `Option<String>` on the wire to keep deserialization compatible with old persisted snapshots.
3. The merge logic concatenates the per-partition results, sorts by `display_name` case-insensitive (current sort), and applies the existing `BrowseResult` pagination over the merged list. The cache TTL (60s) and `MAX_BROWSE` cap (5000) become *per partition*, not global - a forest with 3 partitions of 5000 users each can browse 15000 total.
4. A partition that fails to respond does NOT abort the browse: its results are absent and the `BrowseResult` carries a new `failed_partitions: Vec<String>` field listing the DNS names of the partitions whose query errored. The seed partition failing is still surfaced as an error to the caller, since the seed represents the operator's own domain.
5. Frontend lookup pages (`UserLookup`, `ComputerLookup`, `GroupManagement`, `ContactLookup`) gain a "Domain" column rendered with the value of `partitionDnsName`. The column is sortable and filterable. In a single-domain forest the column is hidden (the `partitionDnsName` matches the seed domain, no information value).
6. The `useBrowse` hook surfaces `failedPartitions` so the lookup pages can render a non-blocking warning banner ("Could not reach 1 of 3 domains: corp-east.example.com - retry") above the list.
7. Per-partition cache invalidation: the existing `state.browse_cache` (and the three siblings) becomes `HashMap<DnsName, (Instant, Vec<DirectoryEntry>, bool)>` so a partial refresh of one partition does not invalidate the others.
8. Unit tests cover (a) merge ordering, (b) partial-failure path with one partition erroring, (c) per-partition cache hit / miss matrix, (d) the seed-partition-fails error path.

---

### Story 15.3: Multi-domain search

As an AD operator,
I want the search bar in the lookup pages and the deep-link `get_user_by_identity` (used by Epic 3 user comparison, Epic 4 group browsing, etc.) to find objects in any domain of the forest,
so that I can locate an object by sAMAccountName, UPN, or display name without having to know which domain hosts it.

#### Acceptance Criteria

1. The five backend `search_users` / `search_computers` / `search_groups` / `get_user_by_identity` / `get_group_members` functions on `DirectoryProvider` are wrapped at the `ForestProvider` level to fan out to every partition.
2. `search_*` results are merged with the same logic as Story 15.2 (sorted, partition-tagged, partial-failure tolerated).
3. `get_user_by_identity(sAMAccountName)` is documented as ambiguous in a multi-domain forest (the same sAMAccountName can exist in two domains). The new contract: the function returns *the first match* (seed partition wins on ties); a new `find_users_by_identity_across_forest(sAMAccountName)` returns `Vec<DirectoryEntry>` for callers that need disambiguation. The single deep-link callsite in `UserLookup.tsx` (Story 1.10) is updated to consume the disambiguating variant when more than one match is found, and to open a small chooser dialog if the operator needs to pick a domain.
4. `get_group_members` continues to expand only group members that are objects of the same partition; foreign security principals (members from a different domain in a cross-domain group) are returned as their FSP DN in `CN=ForeignSecurityPrincipals,...` and the frontend resolves the SID -> object via a separate cross-partition lookup (existing helper `services::sid_resolution`, extended to consult every partition).
5. Server-side search input validation (`validate_search_input` in `services/ldap_directory.rs`) is unchanged - per-partition queries reuse the same sanitizer.
6. Unit tests cover (a) the multi-match disambiguation path returning a sorted vec, (b) the FSP cross-partition resolution, (c) the partial-failure case where one partition errors and the search still returns the matches from the others.

---

### Story 15.4: DN-based routing for read-detail commands

As an AD operator,
I want `UserDetail`, `ComputerDetail`, `GroupDetail`, and the various `read_entry` consumers (Story 8.x topology, Story 11.3 GPO viewer, etc.) to talk to the partition that hosts the DN they are inspecting,
so that opening a detail page on an object from any domain returns the live attributes, group memberships, security indicators (Epic 14), and snapshots without falling back to a partial picture.

#### Acceptance Criteria

1. New helper `fn dns_domain_from_dn(dn: &str) -> Option<String>` extracts `dc=...` components and joins them with `.` to produce a DNS suffix (e.g. `CN=jdoe,OU=Users,DC=sub,DC=racine,DC=dmi` -> `sub.racine.dmi`).
2. `ForestProvider::route_for_dn(&self, dn: &str) -> Option<&Arc<dyn DirectoryProvider>>` returns the partition provider whose DN suffix is the longest match for the input DN. Partitions registered as `DC=sub,DC=racine,DC=dmi` outrank `DC=racine,DC=dmi` for DNs that live under `sub`. Falls back to the seed partition if no suffix matches (defensive default).
3. Every read-detail Tauri command that takes a DN (`get_user`, `get_user_by_dn`, `get_computer_by_dn`, `get_group_members`, `read_entry`, `get_user_groups`, `get_snapshot_history`, `evaluate_user_security_indicators`, `evaluate_computer_security_indicators`, ...) uses `ForestProvider::route_for_dn` to pick the partition before delegating.
4. The existing `state.provider()` accessor returns the `ForestProvider` (as `Arc<dyn DirectoryProvider>`), keeping all 30+ command call sites working without per-callsite changes. Command handlers continue to call `provider.search_users(...)`, `provider.read_entry(...)`, etc.; the routing happens inside `ForestProvider`.
5. The `UserDetail` and `ComputerDetail` pages display the partition DNS name in the header (small badge under the display name) so the operator confirms which domain they are editing.
6. Unit tests cover (a) `dns_domain_from_dn` against a battery of DN shapes including lowercase / mixed case `dc=` components, leading whitespace, and CNs containing literal commas escaped as `\,`, (b) longest-suffix match for nested partitions, (c) fallback to seed when no suffix matches.

---

### Story 15.5: DN-based routing for write commands

As an AD operator with the right permission level,
I want every write command (password reset, account enable / disable / unlock, group membership add / remove, attribute modify, move, recycle-bin restore, the three Epic 14 quick-fixes, the onboarding and offboarding workflows of Epic 5) to be routed to the partition that owns the target DN,
so that I can administer any object in the forest without DSPanel silently writing to the wrong partition or returning a `referral` it cannot follow.

#### Acceptance Criteria

1. Every write command in `commands/account.rs`, `commands/group.rs`, `commands/cleanup.rs`, `commands/security.rs` (Epic 14 quick-fixes), `commands/onboarding.rs`, `commands/offboarding.rs` is reviewed and uses `ForestProvider::route_for_dn` for the *primary target DN*. Cross-partition write fan-out is NOT supported - each write affects one partition.
2. Group membership across partitions: when adding a user from partition A to a group in partition B, the **group's** partition is the one written to (Microsoft's convention: a group's `member` attribute holds the DN of any forest object). Routing uses the group DN, not the user DN.
3. Move-object across partitions is explicitly rejected with a typed error `AppError::CrossPartitionMoveNotSupported` (cross-domain move requires `ldap_modify_dn` against the source DC with the destination DN, plus `unicodePwd` reset, plus replication wait - well outside scope of this epic). The frontend `MoveObjectDialog` filters the OU picker to the same partition as the source.
4. The audit chain hash (Epic 11) and the snapshot service (Story 7.5) take the partition into account: the audit entry includes a `partition_dns_name` field; the snapshot is stored with the source partition annotated so a restore later routes back to the same partition.
5. Permission gates (`require_permission`, `require_fresh_permission`) are evaluated *per partition* against the operator's group memberships in that partition. A `DomainAdmin` of `corp` is not automatically a `DomainAdmin` of `corp-east`; the existing well-known-RID lookup in `services/permissions.rs` already runs per connection, so this is mostly preserved by routing the gate check through the same `ForestProvider::route_for_dn` path - new tests verify the boundary.
6. Unit tests cover (a) the group-membership routing rule with a user in A added to a group in B, (b) the cross-partition move rejection, (c) the per-partition permission gate (a user with admin rights in only one partition gets `PermissionDenied` when targeting another), (d) audit and snapshot annotation with `partition_dns_name`.

---

### Story 15.6: Partial-failure UI and audit tagging

As an AD operator,
I want a clear, non-blocking signal when one or more domains in the forest are temporarily unreachable, with a per-partition retry control,
so that I know my view is partial, can fix the network or DC issue, and can refresh the affected partition without having to relaunch DSPanel.

#### Acceptance Criteria

1. A new `<ForestStatusBanner>` component lives at the top of the `Sidebar` (or under it, design TBD during Story implementation) and renders only when `ForestProvider::partition_status()` reports at least one partition as `Unreachable` or in `Reconnecting` state. The banner lists the affected partitions with their last classification key (e.g. `network`, `auth_denied`, `kerberos_unknown`) translated to the operator's language.
2. Each affected partition row carries a "Retry" button that invokes a new `forest_retry_partition(dns_name)` Tauri command, which calls `LdapDirectoryProvider::invalidate_connection` plus `test_connection` on the matching partition.
3. The lookup pages' inline `failedPartitions` warning (Story 15.2) is dismissable per session but reappears on the next `browse` or `search` if the partition is still down.
4. Every audit entry written by Epic 14 quick-fixes, Epic 2 password operations, Epic 4 group operations, Epic 5 onboarding/offboarding, Epic 7 object management, etc. carries a new `partition_dns_name` column persisted in the audit SQLite store and serialized into the syslog payload (RFC 5424 SD-PARAM `partition`). The chain hash includes the field.
5. The `AuditLog` page gains a "Domain" filter dropdown alongside the existing operator / action / date filters. The dropdown values are derived from the distinct `partition_dns_name` values present in the table.
6. Existing audit entries (written before 1.2.0) have a NULL `partition_dns_name` and are displayed as `-` with a tooltip "Pre-1.2.0 entry, partition not recorded". The chain hash backward compatibility is preserved by NOT including the new field for entries with NULL partition (matches the precedent of Epic 14's `severity` column - excluded from hash to avoid invalidating chains).
7. Frontend unit tests cover (a) the banner rendering only when at least one partition is degraded, (b) the per-partition retry call, (c) the AuditLog filter dropdown deriving its values from the persisted entries.
8. Backend unit tests cover the audit table migration (adding the nullable column with index), the syslog payload serialization, and the chain-hash backward compatibility (a chain whose tail is pre-1.2.0 stays valid after the column is added).

---

## Dependencies and sequencing

Story 15.1 must complete before every other story (it introduces the `ForestProvider`).

Stories 15.2 and 15.3 can be parallelized (browse vs. search). Both depend on 15.1 only.

Story 15.4 depends on 15.1 (it consumes `route_for_dn`). It can start in parallel with 15.2 / 15.3 as long as the developer is willing to rebase against the merge of 15.2 once it lands (some `commands/directory.rs` lines overlap).

Story 15.5 depends on 15.4 (write routing reuses the read routing helper) and on 15.1.

Story 15.6 depends on 15.1 (banner reads `partition_status`), 15.2 (consumes `failedPartitions`), and 15.5 (audit `partition_dns_name` column). It is the last story in the train.

```
15.1 ─┬─> 15.2 ─┬─> 15.6
      ├─> 15.3 ─┤
      └─> 15.4 ─> 15.5 ┘
```

## Compatibility and rollback

- Single-domain deployments see no behavior change: the `ForestProvider` discovers exactly one partition (the seed), the "Domain" column is hidden, the partial-failure banner never renders.
- The new `partitionDnsName` field on `DirectoryEntry` is `Option<String>` on the wire and ignored by old frontend builds.
- The audit column `partition_dns_name` is a nullable add-only schema migration; existing chain hashes stay valid because the column is excluded from the hash for entries that predate 1.2.0.
- Snapshot schema change for routing: nullable `partition_dns_name` column added by migration; old snapshots restore against the seed partition (legacy fallback).
- Cross-partition move rejection (Story 15.5 AC #3) is a new typed error, not a regression of an existing flow - in 1.1.x, attempting such a move silently failed at the LDAP referral step with an opaque error.
- `cargo deny` and `cargo audit` continue to gate the build; no new dependency is required (everything reuses `ldap3`, `tokio`, `serde`).

## Definition of Done

- All six stories' acceptance criteria are met and verified by automated tests.
- A real multi-domain test forest (root `corp.example.com` + child `eu.corp.example.com`) is exercised end-to-end: browse, search, detail-open, password reset, group membership add across partitions, move-rejection error path, partial-failure banner with one DC offline.
- A single-domain test domain confirms zero regression: the "Domain" column stays hidden, the banner never appears, and the existing 2200+ vitest tests + 1700+ cargo tests pass without modification beyond the migration helpers.
- All translations in EN/FR/DE/IT/ES exist for every new UI string (banner copy, "Domain" column header, retry button label, partial-failure warning, cross-partition-move-rejected error message).
- `cargo audit` clean; `cargo deny check` clean; `pnpm audit` clean.
- `CHANGELOG.md` `[Unreleased]` section has entries under Added (forest topology, "Domain" column, partial-failure banner), Changed (every write command routed by DN, group membership routing rule), Fixed (the two reported 1.1.0 multi-domain symptoms), Security (per-partition permission gating). Moved to `[1.2.0] - YYYY-MM-DD` at release time.
- Version bump to 1.2.0 across the five pinned files (Cargo.toml, tauri.conf.json, package.json, README.md badge, CHANGELOG.md).
- `docs/architecture/components.md` (or the relevant architecture shard) updated to describe `ForestProvider` and DN-based routing.
- `docs/release-smoke-test.md` extended with a multi-domain section.
- Smoke test in a real multi-domain lab forest: every smoke checkpoint passes with both light and dark themes.

## Out of scope (deferred to future epics)

- Cross-forest trusts: forest A trusts forest B, DSPanel bound to A wants to browse B. Requires per-trust connection bookkeeping, foreign-trust auth, and a fundamentally different sid-resolution path. Defer until customer demand surfaces.
- Cross-domain object move (`ldap_modify_dn` to another partition + `unicodePwd` reset + replication wait). Multi-week effort with significant safety implications; out of scope here, explicitly rejected at runtime by Story 15.5 AC #3.
- Per-domain "default OU" presets in `OnboardingWizard` / `Offboarding` (today the OU picker is forest-wide; future story could persist per-partition defaults).
- Cross-partition group nesting integrity audit (group hygiene Story 4.4 already detects single-partition issues; cross-partition nesting requires the foreign security principal walk).
- Forest functional level inspection / migration warnings (Epic 8 topology already shows DC functional level per DC; forest-level summary is a future enhancement).
