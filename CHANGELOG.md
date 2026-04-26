# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `AuditSeverity` enum (Info / Warning / Critical) and matching `severity` field on `AuditEntry`. New `log_success_with_severity` and `log_failure_with_severity` methods on `AuditService` let critical write operations opt in to the highest severity bucket; existing `log_success` / `log_failure` keep working and produce `Info` entries. SQLite migration adds a nullable-by-default `severity` column with index. Syslog forwarder maps `Critical` to RFC 5424 priority 2 and emits the value in the structured-data field. Story 14.6 (`disable_unconstrained_delegation`) is the first consumer and now records both success and failure entries as `Critical`. Severity is intentionally excluded from the SHA-256 chain hash so the upgrade does not invalidate existing chains. Frontend `AuditEntry` interface gains an optional `severity` field. Closes QA-14.6-001.
- `AcknowledgeQuickFixDialog` shared React component encapsulating the Story 14.4 + 14.6 dialog shape (title + multi-paragraph body + acknowledgement checkbox + MFA-gated Tauri invoke). `ClearPasswordNotRequiredDialog` and `DisableUnconstrainedDelegationDialog` collapse to thin wrappers that supply their i18n base key and Tauri command. The exported `AcknowledgeQuickFixI18nKeys` interface documents the 8-key contract translators must honour for any future quick-fix that consumes the component. Story 14.5 (`ManageSpns`) keeps its own dialog because the per-SPN selection list shape does not fit the acknowledge pattern. Closes QA-14.4-003.
- E2E success-path tests for the three Epic 14 quick-fix flows: click Fix button -> dialog opens -> tick acknowledgement / select SPN -> Confirm -> Tauri invoke -> success notification -> `onRefresh` callback. `UserDetail.test.tsx` wraps the test providers with `NotificationHost` so toast messages appear in the DOM and can be asserted via `getByText`; `ComputerDetail.test.tsx` promotes its previously local notify mock to a hoisted spy. Closes QA-14.4-002.

### Changed

- Skip snapshot capture on idempotent quick-fix no-ops in Stories 14.4 (`clear_password_not_required`) and 14.6 (`disable_unconstrained_delegation`). Both commands now peek `userAccountControl` via the new `DirectoryProvider::get_user_account_control(dn)` trait method before calling `capture_snapshot`, returning early when the target bit is already clear. Matches the no-op-before-snapshot pattern Story 14.5 already had via its explicit `get_user_spns` read phase. Read-phase failures continue to log a `<command>Failed` audit entry with a `get_user_account_control:` prefix in the details for forensic granularity. Closes QA-14.5-003.

### Security

- Pin `rustls-webpki` to `>=0.103.13` via `Cargo.lock` to patch RUSTSEC-2026-0098 / 0099 / 0104 (transitive dependency through `tonic` / `tauri`).
- Bump `vite` 7.3.1 -> 8.0.10, `@vitejs/plugin-react` 5.2.0 -> 6.0.1, `typescript` 5.9.3 -> 6.0.3 (with `typescript-eslint` -> 8.59.0 and `tsconfig` `baseUrl` removal for TS 7 forward-compatibility) to clear 4 NPM advisories.
- Add `pnpm` overrides for `postcss@<8.5.12` and `@joshwooding/vite-plugin-react-docgen-typescript@<0.7.0` to patch transitive Storybook dependencies.

## [1.1.0] - 2026-04-26

### Added

- **Epic 14 - Security-Aware Admin**. DSPanel now signals Active Directory security risk inline at the moment the operator manipulates an object, plus three 1-click remediation actions for the most common misconfigurations. Differentiates DSPanel from read-only audit tools (PingCastle, BloodHound CE) by combining detection with safe in-place remediation.
- **Per-object security indicator badges (Stories 14.1, 14.2, 14.3)**. New `services/security_indicators.rs` Rust evaluator detects 8 indicators from already-fetched LDAP attributes - 5 user-side (`Kerberoastable`, `PasswordNotRequired`, `PasswordNeverExpires`, `ReversibleEncryption`, `AsRepRoastable`) and 3 computer-side (`UnconstrainedDelegation`, `ConstrainedDelegation`, `Rbcd`). Severity escalates from Warning to Critical for `Kerberoastable` and `PasswordNeverExpires` when the user is also AdminSDHolder-protected (`adminCount=1`). Pure-function design with zero LDAP dependency, exposed via 4 batch-aware Tauri commands.
- **Security indicator rendering in UserDetail and ComputerDetail (Stories 14.2, 14.3)**. `StatusBadge` row next to existing health/enabled/locked badges, severity-driven variant via `severityToBadgeVariant(indicator.severity)` so AdminSDHolder escalation surfaces correctly. ConstrainedDelegation tooltip lists the actual `msDS-AllowedToDelegateTo` SPN list; RBCD tooltip lists the parsed `msDS-AllowedToActOnBehalfOfOtherIdentity` principal SIDs (server-side parsing via the new `extract_dacl_principals` helper in `services/dacl.rs`).
- **Security indicator dot in UserLookup and ComputerLookup (Stories 14.2, 14.3)**. New `<SecurityIndicatorDot>` common component renders a compact aggregate dot (Shield / ShieldAlert icon colored by `highestSeverity`) per row with a portal-tooltip popover listing every indicator. Hidden for clean rows. Mirrors the HealthBadge keyboard-accessible interaction pattern (Enter/Space toggle, Escape close, focus/blur).
- **Quick-Fix: Clear PasswordNotRequired (Story 14.4)**. New AccountOperator-gated Tauri command `clear_password_not_required(user_dn)` clears the `userAccountControl` PASSWORD_NOT_REQUIRED bit (0x0020). New `clear_user_account_control_bits(dn, mask)` generic trait method on `DirectoryProvider` - introduced for 14.4 and reused by 14.6. Inline "Fix" button on the badge row in UserDetail with confirmation dialog (acknowledgement checkbox + multi-paragraph body explaining the policy implication). Defense in depth at 4 gates (frontend canEdit + `require_fresh_permission` backend + `useMfaGate` hook + `mfa_service.check_mfa_for_action` backend).
- **Quick-Fix: Remove Unused SPN (Story 14.5)**. New AccountOperator-gated Tauri command `remove_user_spns(user_dn, spns_to_remove)` rewrites the multi-valued `servicePrincipalName` attribute via `Mod::Replace` with the new set. New `services/spn.rs` module with `is_system_spn` guard (12 prefixes: `host`, `RestrictedKrbHost`, `cifs`, `ldap`, `GC`, `kadmin`, `krbtgt`, `wsman`, `TERMSRV`, `MSServerClusterMgmtAPI`, `MSServerCluster`, `DNS`) - system SPNs cannot be removed even by an Admin to prevent service outage. Cross-language guard mirrored at `src/utils/spn.ts` with verbatim-port tests (19 Rust + 21 TS) ensuring drift detection. New `<ManageSpnsDialog>` lists removable + system-protected SPNs in two visual sections; result reports `removed`, `kept`, `blockedSystem` lists sorted alphabetically for deterministic SHA-256 audit chain hash. Defense in depth at 5 gates (4 standard + system-SPN policy filter on both client + server).
- **Quick-Fix: Disable Unconstrained Delegation (Story 14.6)**. New Admin-gated Tauri command `disable_unconstrained_delegation(computer_dn)` clears the `userAccountControl` TRUSTED_FOR_DELEGATION bit (0x80000) via reuse of Story 14.4's generic trait method. Higher permission bar than user-side fixes because computer delegation changes can break production Kerberos services (SQL Server linked servers, IIS impersonation, SharePoint with Kerberos delegation). Inline "Fix" button on the badge row in ComputerDetail with confirmation dialog (acknowledgement checkbox: "I have verified no production service requires this", multi-paragraph body explaining the golden-ticket-via-TGT-capture attack vector and recommending migration to constrained delegation).
- All new strings translated for EN/FR/DE/IT/ES (translation completeness suite enforces parity).
- 199 new tests across the epic (70 Rust unit + 108 frontend component + 21 cross-language verbatim port). Full backend suite 1673/1673; full frontend suite 2200/2200; clippy/fmt/lint/tsc all clean.

### Changed

- `DirectoryComputer` TypeScript type now includes `rawAttributes: Record<string, string[]>` to mirror `DirectoryUser`. Required for the indicator service to read raw UAC + delegation attributes. `mapEntryToComputer` populates the field from `entry.attributes`.
- `SecurityIndicator` Rust struct serializes with `#[serde(rename_all = "camelCase")]` for consistent camelCase wire shape (was a mixed snake/camel inconsistency before).
- `ComputerDetail` accepts a new optional `onRefresh?: () => void` prop for quick-fix success callbacks (mirrors `UserDetail`).
- `COMPUTER_ATTRS` in `services/ldap_directory.rs` extended with `msDS-AllowedToDelegateTo` and `msDS-AllowedToActOnBehalfOfOtherIdentity`. New `BINARY_ATTRS_TO_SURFACE` mechanism base64-encodes the binary RBCD security descriptor blob into the standard `attributes` map so the frontend can forward it without a separate LDAP read.

### Fixed

- Anonymized a doc-comment example in `services/ldap_directory.rs` (`fqdn_from_logonserver`) and the matching test that referenced a real-world deployment domain. Replaced with generic placeholders (`subsite.corp.example` + `AD2-SUBSITE`) preserving the three-label-domain property the test exercises. No behavior change.

## [1.0.5] - 2026-04-26

### Added

- New common React component `<TruncatedBanner>` rendered at the top of the User, Computer, Group, Contact and Printer lookup pages whenever the underlying directory browse returned partial results. Translations added for en/fr/de/it/es.
- `BrowseResult.truncated` field on the IPC contract (omitted as `false` by default) and `DirectoryProvider::last_search_was_truncated()` trait method backing it.
- Foreign Security Principal detection: members coming from trusted external domains (stored under `CN=ForeignSecurityPrincipals,...` with their literal SID as RDN) are now flagged with a "Foreign" badge in the group member list, with the SID shown on hover. New `extractForeignSidFromDn` util on both Rust (`extract_foreign_sid_from_dn`) and TypeScript sides. Translations for en/fr/de/it/es.
- Read-Only Domain Controller (RODC) detection: when the connected DC advertises `LDAP_CAP_ACTIVE_DIRECTORY_PARTIAL_SECRETS_OID` (1.2.840.113556.1.4.1920) in its rootDSE `supportedCapabilities`, the dashboard renders a localized warning banner explaining that write operations may be referred to a writable DC or rejected. New trait method `is_connected_to_rodc()` (default false), surfaced via `DomainInfo.dc_is_rodc` (omitted from the wire payload when false).
- AdminSDHolder protection badge on `UserDetail` when an account has `adminCount=1`, with a tooltip explaining that the SDProp process on the PDC emulator runs every ~60 minutes and will overwrite any DACL change with the AdminSDHolder template. Backend additionally emits a `WARN` log before performing DACL modifications on protected objects so the audit trail records the attempted-but-soon-to-be-reverted change.
- Channel binding defensive instrumentation: `INFO` log when GSSAPI is bound over TLS (CBT `tls-server-end-point` flows automatically thanks to ldap3 v0.12 + cross-krb5), `WARN` log when GSSAPI is attempted without TLS against a DC that may enforce `LdapEnforceChannelBinding=2`. New `channel_binding_required` error classification matching `SEC_E_BAD_BINDINGS` (0x80090346) and the localized variants for FR/DE/IT/ES; UI hint added to the kerberosHint i18n table.
- Syslog TCP transport (RFC 6587 octet-counting framing) selectable via the new `transport` field on `SyslogSettings` (default `udp` for backward compatibility). TCP path retries are not attempted; failures surface at WARN level so a SIEM gap is observable rather than silent.

### Fixed

- Read `nTSecurityDescriptor` with the `SD_FLAGS` LDAP control (OID 1.2.840.113556.1.4.801, value=`OWNER|GROUP|DACL=7`). Without this control, AD strips the descriptor or refuses the read entirely for callers that lack `SeSecurityPrivilege`, so the "User Cannot Change Password" check could return a false negative for HelpDesk and AccountOperator operators.
- Fall back to a client-side breadth-first walk of `memberOf` when the server rejects `LDAP_MATCHING_RULE_IN_CHAIN` (OID 1.2.840.113556.1.4.1941) with `criticalExtensionUnavailable` (rc=12) or `unwillingToPerform` (rc=53). Affects non-Microsoft directories such as Samba 4 (older builds) and OpenLDAP appliances emulating AD; on real AD the matching rule is still used in a single round-trip.
- Surface `sizeLimitExceeded` (LDAP rc=4) and the internal `MAX_BROWSE` cap as a `truncated` flag on `BrowseResult`. Previously the partial list was returned silently, so an operator browsing a domain larger than 5000 entries could conclude that a missing user "did not exist". The flag is cached alongside the entries so subsequent calls within the cache TTL stay consistent.
- `extract_cn` (used to match permission-mapping group names) now uses an RFC 4514 DN parser that handles backslash escapes (`\,`, `\\`, `\=`, etc.). The previous split-on-comma implementation returned wrong values for CNs containing escaped commas (e.g. `CN=Doe\, John,OU=Users`) and could cause a permission-mapping false negative.
- `create_user` rolls back partial state when `reset_password` or `enable_account` fails after the initial `add`. Previously a failed password reset (e.g. password policy mismatch) left the operator with a half-created disabled user requiring manual cleanup. The user object is now deleted on failure and the original error is propagated; if the cleanup itself fails, both the original error and the cleanup error are logged at ERROR level so the operator knows manual deletion is required.
- The `services::dpapi` module is now gated `#[cfg(target_os = "windows")]` at the parent module level. The previous non-Windows `protect`/`unprotect` was a misleading base64 fallback (no actual encryption) - it was dead code on the only supported call sites (the MFA service uses the `keyring` crate path on non-Windows) but its presence implied that DPAPI protection was somehow available outside Windows. SECURITY.md updated to clarify the situation.
- `ShowDeletedControl` (OID 1.2.840.113556.1.4.417) construction extracted into a `show_deleted_control()` helper for symmetry with `sd_flags_control()`; behavior unchanged.

## [1.0.4] - 2026-04-26

### Fixed

- GSSAPI bind would fail with `SEC_E_TARGET_UNKNOWN` (`unknown_principal`) on AD domains with three or more DNS labels (e.g. `subsite.corp.example`). `resolve_dc_fqdn_for_gssapi` previously short-circuited the DNS SRV lookup whenever `host` had more than two dots, treating multi-level domain names as if they were already DC FQDNs. The check is removed; `_ldap._tcp.<host>` is now always queried first, with the existing `LOGONSERVER`-based fallback retained for environments where SRV is blocked. The fallback path is extracted into a pure helper so it can be unit-tested.
- Application logs were being written to whatever directory the app happened to be launched from (commonly `Downloads/` after install, since Windows shortcuts inherit the launcher's working directory). `init_logging` now resolves an OS-standard absolute path via `default_log_dir()` - `%LOCALAPPDATA%\DSPanel\logs` on Windows, `~/Library/Logs/DSPanel` on macOS, `$XDG_STATE_HOME/DSPanel/logs` (or `~/.local/state/DSPanel/logs`) on Linux - and prints the resolved path to stderr at startup.

## [1.0.3] - 2026-04-23

### Added

- Surface the cause of failed directory connections on the dashboard: when `Active Directory` shows `Disconnected`, the card now renders a localized hint explaining why (clock skew, missing Kerberos ticket, DNS SRV failure, LDAP signing requirement, TLS handshake error, authentication refused, network unreachable, etc.). Full technical error chain is written to the log at ERROR level; the UI intentionally shows only the category so support copy-paste stays manageable.
- `DomainInfo` now carries a `connection_error` field (stable classification key, omitted when connected). A new `last_connection_error()` method on `DirectoryProvider` backs it.

### Changed

- GSSAPI bind logs are promoted from DEBUG to INFO: `original_host`, `gssapi_host`, computed `spn` (`ldap/<fqdn>`) and `LOGONSERVER` are now visible in the default application log, making Kerberos diagnostics possible without toggling `RUST_LOG=debug`. On failure, the full `anyhow::Error` chain is logged at ERROR level.
- `classify_bind_error` now recognizes the Microsoft-localized SSPI error strings for French, German, Italian and Spanish in addition to English, so the UI hint stays precise on non-English Windows hosts (where `FormatMessageW(LANG_NEUTRAL)` returns text in the OS UI language). Accent folding is applied before matching so ASCII patterns hit accented text.

### Fixed

- Satisfy clippy lints promoted to errors in Rust 1.95 (`unnecessary_sort_by`, `collapsible_match`) in pre-existing code touched by the CI pipeline. Semantically equivalent refactors in `ldap_directory.rs`, `preset.rs`, `replication.rs`, `replication_status.rs`.
- `evaluate_health_cmd` tests now generate input dates relative to `Utc::now()` so the healthy-user case no longer drifts into `Inactive30Days` warning territory as real time advances past the hard-coded 2026-03 timestamps.



### Security

- Use OS keychain (macOS Keychain / Linux Secret Service) for MFA secret storage on non-Windows platforms instead of unencrypted base64 file
- Add SHA-256 hash chain to audit log entries for tamper detection
- Add remote syslog forwarding (RFC 5424 UDP) for audit entries with configurable host/port
- Add `verify_audit_chain` IPC command (DomainAdmin) to verify audit log integrity
- Replace `base32` crate with `data-encoding` (higher maintainer bus factor, actively maintained)
- Add `cargo audit` + `pnpm audit` CI workflow (weekly schedule + on every PR)
- Fix vulnerable npm transitive dependencies (flatted, picomatch, brace-expansion)
- Replace `std::env::temp_dir()` with `tempfile::tempdir()` in tests to prevent symlink race conditions
- Add weekly dependency health check for critical single-maintainer crates (ldap3, qrcode)
- Enforce `pnpm install --frozen-lockfile` in all CI workflows to prevent dependency drift
- Upgrade `printpdf` 0.3 to 0.9 to resolve 4 unmaintained transitive dependency warnings (adler, lzw, rusttype, stb_truetype)
- Migrate LDAP TLS from `native-tls` (platform-specific) to `rustls` (pure Rust, audited, memory-safe)
- Lower infrastructure, security monitoring, and recycle bin pages from DomainAdmin to Admin permission level
- Fix frontend/backend permission mismatch in GroupHygiene and BulkOperations (used "Admin" instead of "AccountOperator")
- Filter sidebar navigation based on user permission level (hide inaccessible pages)

## [1.0.1] - 2026-03-27

### Fixed

- Fix GSSAPI/Kerberos authentication failing when only domain name is known: `sasl_gssapi_bind` was receiving the domain name (e.g., `DSPANEL.LOCAL`) instead of the DC FQDN (e.g., `dc01.dspanel.local`), causing SPN mismatch. Now resolves DC FQDN via DNS SRV lookup (`_ldap._tcp.<domain>`) with LOGONSERVER fallback.
- Fix snapshots only capturing 27 predefined attributes: `capture_snapshot()` now fetches all attributes via base-scope LDAP search with `["*"]` wildcard, ensuring Advanced Attributes edits are fully recorded for diff and restore (#15).
- Replace PowerShell `Get-WinEvent` with `wevtutil` for attack detection event log queries. Supports `/r:` `/u:` `/p:` `/a:Negotiate` for authenticated remote access from non-domain machines (#16).
- Add Windows-only platform check for Attack Detection page (disabled with message on macOS/Linux).

## [1.0.0] - 2026-03-27

### Security

- Add DomainAdmin permission check on `purge_audit_entries` command
- Fix MFA bypass: IPC errors in `useMfaGate` now deny access instead of allowing
- Add startup warning when MFA is configured on non-Windows (no DPAPI encryption)
- Document non-Windows MFA secret storage limitations in SECURITY.md
- Add `zeroize` crate to clear LDAP passwords and TOTP secrets from memory on drop
- Remove `audit_log` IPC command (audit writes are now backend-internal only)
- Add TOTP replay protection with 60-second code reuse cache

### Added

- i18n infrastructure with i18next and react-i18next (namespace-based, 37 namespaces)
- Complete translations for 5 languages: English, French, German, Italian, Spanish (1709 keys each)
- Language selector in Settings > Appearance with runtime hot-switching
- Locale-aware date, number, and percentage formatting via `Intl` APIs
- Language persistence via AppSettings + localStorage cache for instant reload
- Translated UI elements: health badges, alert badges, status badges, DC health messages, risk score factors/explanations/recommendations, compliance check titles, security disclaimers, tab titles
- Bidirectional translation completeness tests (172 tests: key parity, orphan detection, empty values, interpolation, pluralization, dates)
- Developer documentation for localization (`docs/architecture/localization.md`)
- Risk score weight configuration UI in Settings > Security
- Attack detection threshold and exclusion list configuration in Settings > Security
- Attack detection: remote DC event log access via `-ComputerName` with simple bind credentials
- DC FQDN resolution from rootDSE `dnsHostName` attribute
- Login prompt when `DSPANEL_LDAP_BIND_PASSWORD` is not set (server and bind DN from env vars, password prompted at startup)
- Splash screen with spinner on startup (theme-aware, shown before React mounts)
- Click-to-detail expandable panels on topology DC nodes
- Auto-start service filter toggle in workstation monitoring
- DC health cards grouped by AD site in Infrastructure Health
- Snapshot history export (CSV/Excel/PDF/HTML) via ExportToolbar
- Replication status enriched with msDS-ReplAllInboundNeighbors data (USN, transport, replica flags)

### Changed

- CI now generates coverage reports (Rust + Frontend) with GitHub Actions Summary and LCOV artifacts
- Test suite expanded to 3654 tests: 2089 frontend, 1520 Rust unit, 45 AD integration
- Coverage: 82% Rust lines, 87% frontend lines
- Integration tests expanded to 45 scenarios against real AD with 2-DC replication
- Directory provider is now swappable at runtime via `RwLock` (enables post-startup login)
- PropertyGrid label column widened to `min-w-[220px]` for longer translated labels
- UserLookup sidebar widened to `w-80` (320px) for translated badge text
- GPO Viewer inputs resized to match app-wide compact style (`h-[28px]`, `text-caption`)
- Recycle bin deletion date formatted as `YYYY/mm/dd HH:MM:SS` (was raw LDAP generalized time)
- Recycle bin restore audit entry cleaned of `\0ADEL:<guid>` suffix

### Fixed

- Fix language not loading at startup (was calling non-existent `get_settings` Tauri command, now uses `get_app_settings`)
- Fix audit operator showing Windows username instead of authenticated AD identity in simple bind mode
- Fix cleanup unit tests writing to production `audit.db` (9 tests used `AuditService::new()` instead of `new_in_memory()`)
- Fix sidebar `bulkOperations` key mismatch causing raw key display in menu
- Fix `openTab` labels hardcoded in English across 6 pages (UserLookup, UserDetail, GroupDetail, GroupHygiene, NtfsAnalyzer, PresetManagement)
- Add missing `validate_search_input` to `search_computers_inner`
- Replace `.expect()` panics in `audit.rs` SQLite operations with graceful error logging
- Re-detect AD permissions before each critical write operation (password reset, account enable/disable, flag changes)

## [0.12.0] - 2026-03-25

### Added

#### AD Group-Based Permission Mapping (12.1)
- Custom permission mappings: map AD security groups to DSPanel permission levels
- PermissionMappings model with level-to-groups mapping stored as JSON in preset share
- Multiple groups per level, highest level wins when user belongs to multiple
- Fallback to default RID-based and DSPanel-* group detection when no custom mappings
- DomainAdmin-gated UI with group search autocomplete and validation
- Audit logging of all permission mapping changes

#### Application Settings (12.2)
- Centralized Settings page accessible from sidebar navigation
- Six category tabs: Connection, Presets, Permissions, Security, Reports, Appearance
- Connection settings: domain override, preferred DC, Microsoft Graph configuration
- Security settings: audit log retention period with validation (minimum 30 days)
- Reports settings: default export format (CSV/PDF/HTML/XLSX) and export directory
- Appearance settings: theme selector (Light, Dark, System) with live preview
- All settings persisted locally as JSON with backward compatibility

#### Auto-Update Notification (12.3)
- GitHub Releases API check at startup for newer versions
- Non-blocking notification bar with Download, Skip This Version, and Remind Me Later
- Semantic version comparison (handles v-prefix, pre-release suffixes)
- Configurable check frequency: every startup, daily, weekly, or never
- Skipped version persistence - won't show again for that version
- Silent failure on network errors - no impact on application

#### UX Polish (12.4)
- Extended keyboard shortcuts: Ctrl+F (search), Ctrl+R/F5 (refresh), Ctrl+E (export), Ctrl+S (save), Escape (close/clear)
- Custom event dispatch pattern for view-specific shortcut handling
- About dialog with version, license (Apache-2.0), author (Romain G.), and GitHub links
- Title bar branding: "DSPanel - Active Directory Management"

### Fixed
- Flaky PresetManagement test: wrapped async assertions in waitFor to prevent race conditions

## [0.11.0] - 2026-03-25

### Added

#### Activity Journal (11.1)
- Activity Journal page with searchable, filterable table of all write operations
- Filtered audit queries: date range, operator, action type, target DN, success/failure
- Pagination support for large audit logs (50 entries per page)
- Export audit log to CSV, Excel, PDF, HTML via ExportToolbar
- Action type dropdown populated from distinct audit actions
- Configurable audit retention period in app settings (default: 365 days)
- Automatic audit log cleanup at application startup
- Purge audit entries command for manual retention management

#### AD Change History Timeline (11.2)
- Attribute name filter on StateInTimeView replication history component
- Replication History section added to GroupDetail page (was only on User and Computer)

#### GPO Viewer (11.3)
- GPO Viewer page with two tabs: GPO Links and Scope Report
- gPLink attribute parser with full flag support (enabled, disabled, enforced)
- GPO inheritance resolver respecting block inheritance and enforcement rules
- GPO Links: autocomplete search for users/computers + OU tree picker, auto-fetch on selection
- Scope Report: GPO dropdown with auto-fetch, text badges for Enforced/Active/Disabled status
- WMI filter display from gPCWMIFilter attribute
- GPO name cache in AppState (5-minute TTL)
- DomainAdmin permission gating on all GPO operations
- Export GPO reports to CSV, Excel, PDF, HTML

#### LDAP Connection Resilience
- 3-layer error classification: IO type check, permanent error exclusion, broad string matching
- Connection age tracking with proactive invalidation at 14 minutes (under AD's 15-min idle timeout)
- Forced retry after proactive reconnect regardless of error type
- Concurrent stale detection prevention (atomic timestamp reset)
- Circuit breaker tuned: 3 failures (was 5), 30s recovery (was 60s)
- Retry jitter (+/-50%) and max delay cap (10s) for desktop responsiveness

#### Infrastructure Health Improvements
- DC hostname resolution via AD DNS (hickory-resolver) when system DNS fails
- DNS check shows Healthy (green) in simple bind mode when resolved via AD DNS
- Skip connectivity checks (Services, Replication, SYSVOL, Clock, Account) for unreachable DCs instead of showing misleading data from the active DC

#### Previous unreleased changes
- Epic 11 scope audit: reduced from 6 to 3 stories - removed trigger automation, script execution, and webhook notifications (incompatible with desktop architecture, security risk)
- PDF export: page numbers in footer ("Page 1", "Page 2", etc.)
- Cleanup rules: exclusion patterns for service accounts by SAM name (glob: svc_*, admin*) and by OU
- Compliance: 5 new frameworks (ISO 27001, NIST 800-53, CIS v8, NIS2, ANSSI) - total 9
- Compliance: 3 new checks (PASSWD_NOTREQD, reversible encryption, stale passwords >90d)
- Compliance: compliance score (0-100) with per-framework breakdown
- Compliance: severity badges (Critical/High/Medium/Low) per check
- Compliance: PowerShell remediation commands in all reports
- Compliance: per-framework HTML report export for auditors

### Changed

- Activity Journal moved from Tools to Settings sidebar group
- Audit log: sort direction toggle (newest/oldest first)
- Change History: snapshot attribute values shown in timeline when snapshots exist
- Compliance: refactored from template-per-framework (Model A) to check-first with multi-framework mapping (Model B)
- Compliance: corrected control references (GDPR Art.25->32, SOX Section 302->ITGC APD, PCI-DSS v3.2.1->v4.0)
- Compliance: single scan runs 7 checks once, computes 9 framework scores simultaneously
- Export: replaced single-format buttons with ExportToolbar on SecurityDashboard, RiskScore, DnsKerberos
- Export: added ExportToolbar to UserComparison, GroupDetail, InfrastructureHealth
- GroupHygiene: export includes all 7 categories, button visible from start

### Fixed

- LDAP: "socket receive error" (TCP RST) now detected as transient error and triggers automatic reconnect
- LDAP: all code paths (Health Check, Contacts, Printers, Replication, DNS/Kerberos) now benefit from the same reconnection resilience as User/Group/Computer lookups
- LDAP: no more duplicate reconnects when multiple concurrent operations detect a stale connection
- Infrastructure Health: offline DCs no longer show misleading "0ms LDAP" or "0s skew" from the active DC
- Infrastructure Health: DC hostnames resolved via AD DNS when system DNS does not know the AD domain
- GPO Viewer: OU chain traversal correctly includes OUs below the domain root
- Compliance: use authenticated LDAP user instead of OS username for report generator
- Compliance: format raw AD timestamps to human-readable dates
- Compliance: friendly column headers instead of raw attribute names
- RiskScore: round pointsDeducted to 2 decimals in export
- InfrastructureHealth: group export rows by DC (empty DC column for subsequent checks)
- UserComparison: show user names in export title and category column

## [0.10.0] - 2026-03-24

Epic 10 - Reports, Export and Compliance. Multi-format export from any
table view, automated stale account cleanup, and compliance report
templates with framework control mapping.

### Added

#### Multi-Format Export (10.1)
- Export any table view to CSV, PDF, XLSX, or HTML via reusable ExportToolbar dropdown
- CSV: UTF-8 BOM, configurable delimiter (comma, semicolon, tab)
- PDF: printpdf with built-in Helvetica, A4 landscape, auto-pagination
- XLSX: rust_xlsxwriter with bold headers, auto-filters, auto-fit widths, numeric detection
- HTML: self-contained with inline CSS, striped rows, timestamp, row count
- ExportToolbar integrated in UserDetail, ComputerDetail, GroupHygiene, ReplicationStatus
- Tauri `export_table` command with format selection and save dialog
- New dependencies: printpdf 0.3, rust_xlsxwriter 0.82

#### Automated Cleanup (10.3)
- Cleanup rule engine with 3 condition types: inactive days, never logged on + created days, disabled days
- 3 action types: disable account, move to OU, delete
- Mandatory dry-run with selectable matches table before execution
- Double confirmation for delete actions
- Protected account exclusion (Administrator, krbtgt, Guest, DefaultAccount)
- All actions audit-logged via AuditService
- Rules persist in app-settings.json
- DomainAdmin permission gating (backend + sidebar)

#### Compliance Reports (10.4)
- 4 built-in compliance templates: GDPR, HIPAA, SOX, PCI-DSS
- Each template section maps to specific framework control references
- Report generation engine with 4 query scopes (privilegedAccounts, inactiveAccounts, disabledAccounts, passwordNeverExpires)
- Professional HTML report export with cover page, table of contents, and control reference badges
- Custom template editor with data and static section types
- Custom templates persist in app-settings.json
- DomainAdmin permission gating

### Fixed

- Attack Detection: detect when Security Event Log is inaccessible (missing Event Log Readers membership) and display a warning banner with N/A badges instead of false "Clear" results
- Attack Detection: use language-independent probe (Get-WinEvent -MaxEvents 1) instead of parsing localized error messages

## [0.9.0] - 2026-03-24

Epic 9 - Security, Risk Scoring and Attack Detection. Security monitoring
suite for DomainAdmin users: privileged account audit, domain-wide risk
scoring (~70 checks, 9 factors), AD attack detection (14 attack types),
and privilege escalation path analysis (8 edge types, Dijkstra).

### Added

#### Privileged Accounts (9.1)
- Privileged account audit page with RID-based group resolution (works on all AD locales)
- Recursive nested group member resolution (handles groups-in-groups up to 5 levels)
- 12 per-account checks: Kerberoastable, AS-REP Roastable, reversible encryption, DES-only, constrained delegation with protocol transition, SIDHistory, service account in admin group, Protected Users membership, inactive admin, adminCount orphan, password age, password never expires
- Domain-level findings: KRBTGT password age, LAPS coverage, Fine-Grained Password Policies, domain functional level, RBCD count, Recycle Bin status
- AlertBadge component with DSPanel tooltip pattern (portal, hover, keyboard accessible)
- CSV and HTML report export
- DomainAdmin permission gating

#### Domain Risk Score (9.2)
- Risk Score page with SVG semi-circle gauge visualization (0-100, red/orange/green zones)
- 9 weighted risk factors (~70 individual checks): Privileged Hygiene (15%), Password Policy (10%), Stale Accounts (10%), Kerberos Security (20%), Dangerous Configs (10%), Infrastructure Hardening (10%), GPO Security (10%), Trust Security (10%), Certificate Security (5%)
- Per-finding granularity: severity, remediation complexity (Easy/Medium/Hard), impact score ("Potential gain: +N points"), CIS Benchmark and MITRE ATT&CK references
- Worst factor badge (PingCastle-style "weakest link" indicator)
- SVG radar/spider chart showing all factor scores
- 30-day trend sparkline with score labels, versioned SQLite storage (schema v2)
- HTML report export with factor table, findings by severity, recommendations by impact
- SecurityDisclaimer "i" button with coverage estimate vs specialized tools

#### AD Attack Detection (9.3)
- 14 attack types with structured XML event parsing: Golden Ticket, DCSync, DCShadow, Kerberoasting, AS-REP Roasting, Brute Force, Pass-the-Hash, Password Spray, Shadow Credentials, RBCD Abuse, AdminSDHolder Tampering, Abnormal Kerberos, Privileged Group Changes, Suspicious Account Activity
- 6 batched PowerShell queries extracting 16 structured fields per event (replaces naive event counting)
- Per-attack detection logic with false-positive filtering (replication GUIDs for DCSync, RC4 encryption for Golden Ticket/Kerberoasting, threshold-based for brute force)
- Configurable thresholds and exclusion lists (AttackDetectionConfig)
- MITRE ATT&CK technique reference on every alert
- 14-check grid always visible showing Clear/Alert status per check type
- Configurable time window: 6h to 7 days (default 3 days)
- All detection functions are pure Rust, testable without PowerShell

#### Privilege Escalation Path Visualization (9.4)
- 5 node types: User, Group, Computer, GPO, CertTemplate
- 8 edge types: Membership, Ownership (managedBy), Delegation (constrained to DC services), Unconstrained Delegation (non-DC computers), RBCD, SIDHistory, GPLink, CertESC (ADCS ESC1 templates)
- Weighted Dijkstra path-finding (SIDHistory=0.5 to GPLink=3.0) replacing simple BFS
- Risk score per path (lower = more dangerous), edge type labels on each hop
- Compact horizontal stats bar with node/edge counts

### Changed
- "Security" group added to sidebar navigation with 4 modules (DomainAdmin only)
- `privileged_groups` field added to AppSettings for configurable group monitoring
- `resolve_group_by_rid()` method added to DirectoryProvider trait for locale-independent group resolution
- `lastLogonTimestamp`, `servicePrincipalName`, `sIDHistory`, `adminCount`, `msDS-AllowedToActOnBehalfOfOtherIdentity` added to LDAP USER_ATTRS

### Security
- All security endpoints require DomainAdmin permission level
- PowerShell event log queries use -NoProfile and -NonInteractive flags
- All operations are read-only against Active Directory
- No sensitive data (passwords, tokens) exposed in responses

## [0.8.0] - 2026-03-23

Epic 8 - Infrastructure Health and Monitoring. Centralized view of AD
infrastructure health for DomainAdmin users: DC status, replication
monitoring, DNS/Kerberos validation, remote workstation metrics, and
visual topology mapping.

### Added

#### Domain Controller Health Checks (8.1)
- Infrastructure Health page with DC status cards and 7 cross-platform checks (no PowerShell dependency)
- DNS resolution with fallback IP from LDAP server when hostname unresolvable
- LDAP ping with response time thresholds (< 100ms / 100-500ms / > 500ms)
- AD service detection via SPN validation (Host, DNS, GC, LDAP, Kerberos, Replication)
- Replication health via NTDS Connection objects
- SYSVOL health via DFSR member validation (migration state, enabled status) + SMB port probe
- Clock skew detection via rootDSE currentTime (Kerberos 5-minute threshold)
- Machine account health (userAccountControl flags + password age)
- FSMO roles display (PDC, RID, Infrastructure, Schema, Naming) per DC
- Domain functional level display from rootDSE
- Color-coded status: green (healthy), yellow (warning), red (critical)
- Auto-refresh with configurable interval (1min/5min default/15min/Off)
- Cards expanded by default with fixed-width columns
- DomainAdmin permission gating

#### AD Replication Status (8.2)
- Replication Status page with partnership table sorted by status (failed first)
- Failed replications highlighted with red background and error count
- Latency display with AD generalized time parsing and color coding
- Force Replication button with confirmation dialog (via repadmin)
- Auto-refresh with configurable interval (60s/120s/300s/Off)

#### DNS and Kerberos Validation (8.3)
- DNS & Kerberos validation page with auto-run on page load
- DNS SRV record validation via hickory-resolver targeting the DC's DNS server directly (cross-platform, works without domain-joined machine)
- SRV records checked: _ldap._tcp, _kerberos._tcp, _gc._tcp, _kpasswd._tcp
- Expected vs actual host comparison with missing/extra host detection
- Kerberos clock skew detection between DCs via rootDSE currentTime (fixed 5-minute default threshold)
- CSV export of validation results

#### Remote Workstation Monitoring (8.4)
- WorkstationMonitoringPanel component for computer detail views
- CPU and RAM usage with progress bars and color-coded thresholds
- Disk space bars per volume with used/total display
- Running services list with state indicators
- Active sessions list with usernames
- 5-second auto-refresh with pause/resume toggle
- Graceful degradation when workstation unreachable or WMI access denied

#### AD Topology Visualization (8.5)
- AD Topology page with structured card view (sites, DCs, replication links, site links)
- Per-DC details: hostname, IP (resolved via AD DNS), OS version, FSMO roles, GC/PDC badges, online/offline status
- Per-site details: subnets, DC count, location
- Replication links section with status indicators (healthy/warning/failed)
- Site links section with cost and replication interval
- Summary footer with counts (sites, DCs, replication links, site links)

### Changed
- Added Infrastructure group to sidebar navigation
- Added search_configuration and read_entry methods to DirectoryProvider trait
- Added hickory-resolver dependency for cross-platform DNS SRV resolution

### Fixed
- Enabled Content Security Policy in Tauri configuration
- Added circuit breaker to Graph API service (3 failures -> 60s open)
- Added server-side photo size validation (100KB max before LDAP write)
- Removed dead legacy graph client secret migration code
- Split commands/mod.rs (6860 lines) into 6 focused submodules
- Fixed backend error JSON display in frontend (use extractErrorMessage utility)
- Handle missing dNSHostName on newly promoted DCs (fallback to CN + domain)
- Handle ldap3 range-suffixed attribute keys for multi-valued attributes

### Security
- CSP enabled: default-src 'self', script-src 'self' 'wasm-unsafe-eval', style-src 'self' 'unsafe-inline', img-src 'self' data: blob:
- Graph API circuit breaker prevents cascade failures
- TLS_SKIP_VERIFY documented as dev-only with MITM warning

## [0.7.0] - 2026-03-21

Epic 7 - Administration and Object Management. Administrative tools for
DomainAdmin/AccountOperator users: moving objects between OUs, AD Recycle Bin
access, contact and printer management, user photos, and object backup/restore.

### Added

#### Move Objects Between OUs (7.1)
- "Move to OU" context menu on users, computers, groups, contacts, and printers (AccountOperator+)
- MoveObjectDialog with OU picker, dry-run preview, and pre-selected current OU with auto-expand
- Bulk move support via `bulk_move_objects` command with per-object result reporting
- Audit logging for all move operations (success and failure)

#### AD Recycle Bin (7.2)
- Recycle Bin page listing deleted AD objects with name, type, deletion date, original OU
- Search by name and filter by object type (User, Computer, Group, Contact, Printer) with color-coded badges
- Restore dialog with OU picker for target selection (pre-selects original OU)
- AD Recycle Bin feature detection (case-insensitive, DN name + GUID matching) with warning UI
- DomainAdmin permission gating on sidebar and all operations

#### Contact and Printer Management (7.3)
- Contact lookup page with auto-loaded list, search, PropertyGrid detail view, and inline editing
- Printer lookup page with auto-loaded list, search, and inline editing for all fields
- Contact CRUD gated to AccountOperator+, printer edit/delete to AccountOperator+
- Sidebar entries for both pages in Directory group
- Audit logging and snapshot capture on all write operations

#### User Thumbnail Photo (7.4)
- User thumbnail photo display in user detail view (64px with border frame, or placeholder)
- Upload photo button with file picker (JPG/PNG) and client-side Canvas center-crop resize to 96x96
- Remove photo button to clear thumbnailPhoto attribute
- AccountOperator+ permission for photo modifications
- Audit trail for photo set/remove operations

#### Object Backup and Restore (7.5)
- SQLite-backed ObjectSnapshotService for capturing full AD attribute state before every write operation
- Snapshot history, diff comparison, and restore-from-snapshot capabilities
- SnapshotHistory component in user detail view with expandable diff viewer
- Auto-refresh snapshot list after save, delete consumed snapshot after restore
- Restore skips read-only attributes and clears attributes absent from snapshot
- Configurable snapshot retention with automatic cleanup
- DomainAdmin permission for restore operations, authenticated LDAP user as operator

#### General
- Delete button on user, group, and computer detail views (AccountOperator+)
- Generic `delete_ad_object` command with snapshot capture and audit logging
- `useBrowse.refresh()` reloads all pages when preloadAll is active
- TreeView auto-expands and auto-scrolls to pre-selected node
- Confirmation dialogs (ConfirmationDialog) for all destructive actions
- AD test data script: `scripts/populate-ad-epic7.ps1` (100 contacts, 20 printers, Recycle Bin)

## [0.6.0] - 2026-03-20

Epic 6 - Exchange Diagnostics. Read-only Exchange mailbox diagnostics for both
on-premises (via LDAP msExch* attributes) and Exchange Online (via Microsoft
Graph API). LDAP TLS improvements (StartTLS, custom CA). Preset integrity
checksums for security.

### Added

#### Exchange On-Prem Attributes (6.1)
- Exchange mailbox panel in user detail view, auto-detected from msExch* LDAP attributes
- Displays mailbox GUID, recipient type, primary SMTP, email aliases, forwarding target, delegates
- Panel hidden when user has no Exchange attributes (graceful degradation)
- proxyAddresses parsing (SMTP:/smtp: convention) and msExchRecipientTypeDetails mapping
- Rust model (`ExchangeMailboxInfo`) with 16 unit tests, TypeScript extraction with 10 tests
- Collapsible `ExchangePanel` component with 7 component tests

#### LDAP TLS Improvements
- StartTLS on port 389 as alternative to LDAPS (port 636) via `DSPANEL_LDAP_STARTTLS=true`
- Custom CA certificate loading via `DSPANEL_LDAP_CA_CERT=/path/to/ca.pem` (PEM or DER)
- LDAPS takes precedence over StartTLS if both are set
- CA cert works with both LDAPS and StartTLS modes
- New dependency: `native-tls` (direct) for custom TLS connector building

#### Exchange Online Diagnostics (6.2)
- Microsoft Graph API integration for Exchange Online mailbox diagnostics
- OAuth2 client credentials flow with token caching and auto-expiry
- Settings UI (`GraphSettings` component) for Azure AD tenant ID, client ID, and client secret
- "Test Connection" button to validate Graph API connectivity
- Exchange Online panel with mailbox quota usage bar (color-coded: green/yellow/red)
- Displays primary SMTP, aliases, forwarding, auto-reply status, delegates
- Panel hidden when Graph is not configured or user has no Exchange Online mailbox
- `AppSettings` extended with Graph config fields (backwards-compatible)
- Graph config synced from persisted settings at startup
- Real mailbox quota via `Reports.Read.All` (getMailboxUsageDetail CSV), fallback to 50 GB default
- Rust `GraphExchangeService` with 29 unit tests (10 sync + 19 async/mockito), TypeScript types with 10 tests
- `ExchangeOnlinePanel` component with 8 tests, `GraphSettings` component with 7 tests
- New dependencies: reqwest `json` feature for Graph API response parsing, `csv` crate for report parsing

### Security

- SHA-256 integrity checksums for preset JSON files stored in local app data
- Warning displayed when a preset file is modified outside DSPanel (checksum mismatch)
- User must explicitly accept externally modified presets before use
- Checksum registry persisted in `preset-checksums.json` (LOCALAPPDATA/DSPanel)
- New dependency: `sha2` crate for SHA-256 hashing

## [0.5.0] - 2026-03-20

Epic 5 - Presets, Onboarding and Offboarding Workflows. Role-based presets,
guided onboarding/offboarding wizards, and inline attribute editing. Validated
against a real AD (Windows Server 2022 + BadBlood).

### Added

#### Preset Storage & Configuration (5.1)
- PresetService with JSON file storage on configurable network share path
- Debounced file watcher (notify crate) for auto-reload on external changes
- Preset model with validation (name, targetOU, groups/attributes)
- Settings UI for preset path configuration with Browse (native folder picker), Test, and Save buttons
- Preset path persisted to `app-settings.json` and auto-restored at startup
- Cross-platform data directory: `%LOCALAPPDATA%/DSPanel` (Windows), `~/Library/Application Support/DSPanel` (macOS), `$XDG_DATA_HOME/DSPanel` (Linux)
- Tauri commands: get/set/test preset path, list/save/delete presets, pick_folder_dialog

#### Preset Editor UI (5.2)
- Preset management page with list/editor split view
- Full CRUD: create, edit, delete presets with confirmation dialog
- Reuses GroupPicker for AD group selection and OUPicker for target OU
- Custom attributes editor (key/value pairs)
- Name uniqueness validation, permission gating (AccountOperator+)
- Inline storage path configuration shown when path is not yet set

#### Onboarding Wizard (5.3)
- 4-step wizard: User Details, Preset Selection, Preview, Execute
- Auto-generated login from first/last name (configurable pattern)
- UPN derived from AD base DN (e.g. `user@dspanel.local`), not server IP
- Secure password auto-generation with regenerate button
- Preview diff showing all planned changes before execution
- Rollback on partial failure: offers to delete partially created user if group additions fail
- Copyable output summary (login, password, OU, groups)
- Full audit logging of onboarding operations

#### Offboarding Workflow (5.4)
- 4-step workflow: Search User, Select Actions, Preview, Execute
- Toggleable actions: disable account, remove groups, set random password, move to Disabled OU
- OUPicker for Disabled OU selection (replaces text input), pre-filled from app settings
- "Start Offboarding" context menu entry in User Lookup results (auto-searches user)
- Dry-run preview before execution with detailed action list in confirmation dialog
- Per-action progress and error tracking
- Copyable output summary for ticket documentation

#### Modify User Attributes (5.5)
- Inline edit (pencil icon on hover) for Identity fields: Display Name, First Name, Last Name, Email, Department, Title
- Inline edit for Advanced Attributes (any LDAP attribute)
- Pending changes bar next to user action buttons (Reset Password, Disable)
- Floating indicator with Save button when action bar is scrolled out of view
- Confirmation dialog with old->new value diff; warning box for advanced attribute changes
- Backend `modify_attribute` Tauri command with LDAP Mod::Replace
- `create_user` Tauri command for onboarding (LDAP add + password + enable)
- Snapshot capture before every modification
- Audit logging on every attribute modification

#### Infrastructure
- `AppSettingsService` for persisted app-wide settings (`app-settings.json`)
- `disabledOu` setting for offboarding default OU (configurable in future Settings page)

## [0.4.0] - 2026-03-20

Epic 4 - Group Management & Bulk Operations. Complete group lifecycle with
browse, member management, bulk operations, and hygiene detection. Validated
against a real AD (Windows Server 2022 + [BadBlood](https://github.com/davidprowe/BadBlood)).

### Added

#### Group Management (4.1-4.3)
- Group browser with flat search and OU tree, preloaded at mount
- Group member management with add/remove, dry-run preview, and audit logging
- Bulk operations redesigned with 4 categories (Members, Groups, Properties, Export) and 10 operations:
  Add/Remove/Transfer members, Copy user groups, Import CSV, Create/Clone/Merge/Move groups, Set ManagedBy, Export CSV
- Dry-run preview, progress indicator, and rollback on failure for all bulk ops
- Cross-module deep-link from User Lookup to Group Management

#### Group Hygiene (4.4)
- 7 hygiene detections: empty, circular nesting, single-member, stale (180d), undescribed, deep nesting (>3 levels), duplicate member sets
- Bulk delete with re-check before deletion (race condition protection)
- One-click navigation to problematic group
- Hygiene scan audit event logging

#### LDAP & Authentication (4.5-4.6)
- Simple bind authentication via `DSPANEL_LDAP_SERVER`, `DSPANEL_LDAP_BIND_DN`, `DSPANEL_LDAP_BIND_PASSWORD`
- LDAPS (TLS) support on port 636 via `ldaps://` URL scheme or `DSPANEL_LDAP_USE_TLS`
- Self-signed cert support via `DSPANEL_LDAP_TLS_SKIP_VERIFY`
- LDAP paged results for fetching >1000 objects
- Connection keepalive (5-minute background ping)
- 22 integration tests against real AD over LDAPS

#### Permission System
- 5 permission levels: ReadOnly, HelpDesk, AccountOperator, Admin, DomainAdmin
- Language-independent detection via well-known SID RIDs (works in any AD locale)
- Probe-based detection via `allowedAttributesEffective` on all OUs for delegated permissions
- LDAP WhoAmI for authenticated identity (supports "Run as" and simple bind)
- Custom groups: `DSPanel-HelpDesk`, `DSPanel-AccountOps`, `DSPanel-Admin`, `DSPanel-DomainAdmin`

#### UI/UX Improvements
- Health filter buttons (Healthy/Warning/Critical) with live counts
- GroupBadge with category icon (Shield/Mail) + scope (G/DL/U) + tooltip
- Category/Status/OS filters for Group Management and Computer Lookup
- Advanced Attributes "Show empty" toggle with AD schema discovery
- Visible-but-disabled actions with permission tooltips (replaces hidden)
- "Authenticated as" display in Home page
- Windows FILETIME and AD generalized time date formatting
- Consistent error display via `extractErrorMessage`

### Changed

- Preload all users/groups/computers at mount (replaces paginated scroll)
- Bulk health evaluation in single IPC call (replaces per-user sequential)
- Audit log operator set from WhoAmI identity (not Windows USERNAME)
- LDAP retry only on connection errors, not business logic errors

### Fixed

- LDAP paged results controls leaking into shared connection pool
- `get_schema_attributes` race condition corrupting shared `base_dn`
- Password flags "User Cannot Change Password" not re-saveable after toggle
- `nTSecurityDescriptor` read failure shows info message for ReadOnly users
- `sizeLimitExceeded` (rc=4) treated as fatal instead of partial success
- Raw JSON error objects in toaster notifications
- Health badge tooltip icon alignment and missing Healthy checkmark

## [0.3.0] - 2026-03-15

Epic 3 - Comparison & Permissions Audit. Side-by-side user comparison, NTFS permissions
analysis with ACL cross-referencing, and AD replication metadata timeline.

### Added

- Side-by-side user comparison with group membership delta (shared/only-A/only-B) and color-coded display (3.1)
- Group diff algorithm with case-insensitive DN comparison and sorted output (3.1)
- User comparison page with dual search, filter, sort, OU/lastLogon/status in user cards (3.1)
- Right-click context menu on groups: "View group members" and "Add user to group" (3.1)
- Cross-tab compare: right-click in User Lookup to compare two users directly (3.1)
- Nested group resolution via LDAP_MATCHING_RULE_IN_CHAIN for transitive membership in user comparison (3.1)
- UNC path permissions audit with NTFS ACL reading via Windows API (3.2)
- ACE cross-reference with user group SIDs showing access indicators (allowed/denied/no-match) (3.2)
- Access Summary with per-user breakdown and differences explanation (3.2)
- Color-coded ACE rows with legend (green=both, red=A only, blue=B only) (3.2)
- Contextual tooltips on access indicators showing user name and matched trustee (3.2)
- CSV export via native save file dialog (rfd crate) (3.2)
- Standalone NTFS Permissions Analyzer page with recursive depth scanning (3.3)
- Allow/deny conflict detection across parent/child paths (3.3)
- Inherited vs explicit ACE filtering toggle (3.3)
- Group chain tree with recursive expansion and circular reference detection (3.3)
- Session-level cache for group member queries in GroupChainTree to avoid redundant LDAP calls (3.3)
- Right-click "View group members" on ACE trustees (3.3)
- State-in-time replication metadata viewer parsing msDS-ReplAttributeMetaData XML (3.4)
- `msDS-ReplValueMetaData` parser for linked-attribute replication (member, memberOf) with Active/Removed status (3.4)
- Linked Attribute Changes section in StateInTimeView displaying value-level replication history (3.4)
- Attribute timeline sorted by last change time with version and originating DC (3.4)
- Attribute diff between two timestamps showing version changes (3.4)
- Replication History section in user and computer detail views (3.4)
- Tauri `search_groups` command wired to GroupPicker component with `useGroupSearch` hook
- Tauri `get_ou_tree` command wired to OUPicker component with `useOUTree` hook
- `DirectoryProvider::get_ou_tree()` trait method with LDAP and demo implementations
- CSV export via context menu in DataTable with `csvFilename` prop and `exportTableToCsv` utility (1.7)
- `aria-describedby` linking error messages to form inputs in FormField (1.8)
- Highlight matching search text in ComboBox dropdown options (1.8)
- Keyboard accessibility on HealthBadge tooltip: Escape to close, Enter/Space to toggle (1.11)
- DNS resolution timeout indicator after 10s in ComputerDetail (1.12)
- Storybook setup with Vite builder, theme switcher (light/dark), and a11y addon
- Stories for 15 components: TextInput, PasswordInput, FormField, ComboBox, OUPicker, GroupPicker, StatusBadge, TagChip, LoadingSpinner, EmptyState, CopyButton, HealthBadge, DataTable, PropertyGrid, TreeView, FilterBar, DialogShell
- Tab state persistence across switches (components stay mounted)
- Toast notifications with severity-colored progress bar
- Technical backlog document (docs/backlog.md)
- New sidebar entries: User Comparison (Directory group), NTFS Analyzer (Tools group)
- New Tauri commands: compare_users, add_user_to_group, audit_ntfs_permissions, cross_reference_ntfs, analyze_ntfs, get_replication_metadata, compute_attribute_diff, save_file_dialog
- 1691 tests (616 Rust + 1075 frontend), 62% Rust line coverage, 89% frontend line coverage

### Changed

- Audit service migrated from JSON file to SQLite for durability and performance under high-volume support workflows
- LDAP connection pooling: reuse a single multiplexed connection instead of connect/bind per operation
- Automatic reconnect on stale LDAP connection with one retry before propagating errors
- Replace fragile string-split XML parsing in replication metadata with `quick-xml` crate (3.4)
- Context menu onClick deferred to microtask for async-safe handling
- Demo provider: search_users and get_user_by_identity use full 26-user dataset
- useBrowse: removed auto-select on single search result for better UX

### Fixed

- Resolve NTFS ACE trustee SIDs to DOMAIN\Username via LookupAccountSidW instead of showing raw SIDs (3.2)
- Array sort mutation in useComparison: spread before sort to prevent source mutation (3.1)
- Reject path traversal (`..` segments) in UNC path validation (3.2)
- Search input validation: trim, max 256 chars, reject control characters (defense-in-depth)
- Notification notify() argument order (message, severity) was inverted causing NotificationHost crash
- Async context menu actions no longer trigger ErrorBoundary via unhandled rejections

## [0.2.0] - 2026-03-14

Epic 2 - Support Actions and Account Management. Password reset, secure password generator,
account unlock/enable/disable, password flag management, and MFA gate for sensitive operations.

### Added

- User browse mode: UserLookup page loads users on mount without requiring a search query
- VirtualizedList infinite scroll with onEndReached and loadingMore support
- Browse users command with server-side caching (60s TTL) and pagination for directory listing
- Get group members Tauri command to list members of a group by DN
- 26 sample users in demo mode for scroll/browse testing
- ContextMenu component (portal-rendered, keyboard accessible)
- GroupMembersDialog to view members of a group from the user detail view
- Right-click context menu on group membership rows to explore group members
- Password reset with manual/auto-generate modes via PasswordResetDialog (2.1)
- Secure password generator with configurable criteria and HIBP k-anonymity breach checking (2.2)
- Standalone Password Generator page accessible to all permission levels (2.2)
- Account unlock, enable, and disable actions with confirmation dialogs (2.3)
- Password flag management (Password Never Expires, User Cannot Change Password) with dry-run preview (2.4)
- DACL-based "User Cannot Change Password" flag via binary security descriptor manipulation (2.4)
- MFA gate service with RFC 6238 TOTP, backup codes, and per-action configuration (2.5)
- MFA verification dialog for sensitive operations (2.5)
- MFA setup wizard with QR code display, verification step, and backup codes (2.5)
- MFA enforcement at command level with 5-minute session window (2.5)
- Rate limiting on MFA verification (5 failed attempts before lockout) (2.5)
- Audit service logging all sensitive operations with file-based persistence (2.5)
- UserActions component integrating password reset, unlock, enable/disable buttons
- PasswordFlagsEditor component with dirty tracking and AccountOperator gating
- useMfaGate hook for reusable MFA verification across components
- New Tauri commands: reset_password, unlock_account, enable_account, disable_account, set_password_flags, generate_password, check_password_hibp, get_audit_entries, get_cannot_change_password, mfa_setup, mfa_verify, mfa_is_configured, mfa_revoke, mfa_get_config, mfa_set_config, mfa_requires
- DirectoryProvider trait extended with write operations (reset_password, unlock_account, enable_account, disable_account, set_password_flags)
- ResilientDirectoryProvider wraps all new write operations with retry and circuit breaker
- 135 new tests (34 Rust + 54 frontend + 47 coverage hardening) covering Epic 2 features

### Changed

- UserLookup page: removed blank initial state, users visible on open
- Action buttons (UserActions, PasswordFlagsEditor) use btn-sm for compact sizing
- UserDetail sections separated with visible borders for better visual hierarchy
- PropertyGrid categories separated with subtle borders

## [0.1.0] - 2026-03-13

Epic 1 - Foundation and Core Lookup. Full rewrite from C#/WPF to Rust/Tauri v2 + React/TypeScript.
Cross-platform (Windows, macOS, Linux), lightweight native binary (~8.5 MB).

Code quality pass across Rust backend and React frontend: accessibility (WCAG focus traps,
ARIA live regions, skip-to-main link), error resilience (per-user health checks, stale request
cancellation, explicit error logging), performance (React.memo, concurrency-limited batch ops),
and maintainability (shared hooks and components to eliminate duplication).

### Added

- Project skeleton: Tauri v2 + React/TS, tracing logging, panic hook (1.1)
- DirectoryProvider trait with LDAP implementation, Kerberos auth (1.2)
- Permission detection from AD groups: ReadOnly/HelpDesk/AccountOperator/DomainAdmin (1.3)
- Theme system with design tokens, dark/light modes, CSS architecture (1.4)
- Application shell: sidebar, tab bar (drag, context menu, scroll), breadcrumbs, status bar, keyboard shortcuts (1.5)
- Common controls: SearchBar, PermissionGate, StatusBadge, Avatar, TagChip, LoadingSpinner, EmptyState, InfoCard, CopyButton (1.6)
- Data display: DataTable, FilterBar, Pagination, PropertyGrid, TreeView, DiffViewer, VirtualizedList, CSV export (1.7)
- Form controls: FormField, TextInput, PasswordInput, ComboBox, OUPicker, GroupPicker, DateTimePicker, ValidationSummary, useFormValidation, useChangeTracker (1.8)
- Dialogs and notifications: ConfirmationDialog, DryRunPreviewDialog, ProgressDialog, DialogContext, NotificationContext, InlineProgress (1.9)
- User account lookup: search, detail panel, group memberships, DN parsing (1.10)
- Healthcheck badge: 9 account flags with severity levels, Rust backend evaluate_health (1.11)
- Computer account lookup: search, detail, ping, DNS resolution (1.12)
- Error handling: DirectoryError, retry with backoff, circuit breaker, ResilientDirectoryProvider, ErrorBoundary, useErrorHandler (1.13)
- ARIA accessibility across all components
- All documentation migrated to Rust/Tauri v2 stack (~45 files)
- CI workflows for cargo/pnpm/tauri
- 840 tests (632 frontend + 208 Rust), 78% Rust line coverage

### Removed

- All C#/WPF source code (tagged as `v0.1.0-csharp` for reference)

## [0.1.0-csharp] - 2026-03-11 (archived, see tag `v0.1.0-csharp`)

### Added

- Epic 1 implementation: Foundation and Core Lookup (Stories 1.1-1.12)
- Project skeleton with GenericHost DI, Serilog logging, MVVM architecture (1.1)
- IDirectoryProvider abstraction with LDAP implementation and Kerberos auth (1.2)
- Permission level detection from AD group memberships (ReadOnly/HelpDesk/AccountOperator/DomainAdmin) (1.3)
- Theme system with 31 design tokens, dark/light modes, runtime switching (1.4)
- Application shell with collapsible sidebar, tab navigation with context menu (close-all/close-others), middle-click to close tab, breadcrumb bar, keyboard shortcuts (Ctrl+W/Tab/Shift+Tab/B/1-9), window state persistence, responsive auto-collapse (1.5)
- Reusable UI controls: SearchBar, PermissionGate, StatusBadge, Avatar (initials fallback, deterministic color), TagChip (removable), LoadingSpinner, EmptyState, InfoCard (collapsible, icon) (1.6)
- Data display components: FilterBar, Pagination, DiffViewer, TreeView styling, DataGrid styling, CsvExportService, CopyButton, PropertyGrid (1.7)
- Form controls: FormField, PasswordInput with show/hide toggle, searchable ComboBox, OUPicker (TreeView), GroupPicker (debounced multi-select with chips), DateTimePicker (calendar + spinners), ValidationSummary, dirty tracking via IChangeTracker (1.8)
- Custom validation attributes: ValidSamAccountName, ValidDistinguishedName (1.8)
- Dialog service with styled ConfirmationDialog, ProgressDialog (determinate/indeterminate, cancellation, completion state), InlineProgress control (1.9)
- Toast notification system with auto-dismiss, countdown bar animation, 4 severity levels (1.9)
- User lookup with debounced search, property grid detail, group membership list (1.10)
- Health check badge evaluating 9 account flags with severity levels (1.11)
- Computer lookup with search, detail view, and ping/DNS commands (1.12)
- Application settings service (IAppSettingsService) with JSON persistence in LocalAppData
- Diff-specific theme brushes (BrushDiffAdded/Removed/AddedText/RemovedText) for light and dark modes
- LdapFilterHelper with RFC 4515 escaping and input validation (defense-in-depth against LDAP injection)
- XamlBindingValidator for static XAML binding verification against ViewModels via reflection
- Stryker.NET mutation testing setup (tool + config ready, blocked by Buildalyzer/WPF/.NET 10 upstream)
- 668 unit tests covering all services, ViewModels, controls, security, and XAML bindings (99.7% line coverage)

### Changed

- GitHub Actions CI enhanced: format check, Coverlet/Cobertura coverage, vulnerability check, self-contained publish (128 MB exe)
- User and Computer lookup ViewModels hardened with LdapFilterHelper input validation

## [0.0.2] - 2026-03-10

### Added

- 60 BMAD story files covering all 12 epics (`docs/stories/`)
- Epic 1 Base UI foundation stories (1.4-1.9): theme system, application shell, common controls, data display components, form controls and validation, dialogs and notifications
- Story template follows BMAD v2 format with Dev Notes, Tasks/Subtasks, and Testing sections

### Changed

- Epic 1 expanded from 6 to 12 stories to include comprehensive Base UI foundations
- Epic list updated with story counts and summary table

## [0.0.1] - 2026-03-07

### Added

- Project documentation: brainstorming results, project brief, PRD, architecture
- Repository initialization with GitHub best practices
