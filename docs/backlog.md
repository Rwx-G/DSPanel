# Technical Backlog

Items deferred from QA reviews. None are blocking - all stories are PASS.

## Priority: Medium

| Source | Item | Refs |
| ------ | ---- | ---- |
| Epic 14 QA | AuditSeverity::Critical structural field on AuditEntry. Critical-severity dimension is currently encoded in the unique action name `DisabledUnconstrainedDelegation` for Story 14.6. Adding a typed `Option<AuditSeverity>` field would let SIEM dashboards / severity-filtered queries treat 14.6 events as Critical without action-name regex. Requires SQLite schema migration + log_success/log_failure signature change + syslog forwarder severity mapping + all existing call sites or default-to-Info. Land as a future Epic 11 amendment. | Story 14.6, QA-14.6-001 |
| Epic 14 QA | Audit-failure logging on backend READ errors. Currently `log_failure` only fires on the write path. Read failures (`get_user_account_control`, `get_user_spns`) return `AppError::Directory` but no audit entry is recorded. Extend across all 3 quick-fix commands so transient AD outages are visible in the audit trail. | Stories 14.4 + 14.5, QA-14.5-001 |

## Priority: Low

| Source | Item | Refs |
| ------ | ---- | ---- |
| Epic 14 QA | Snapshot-on-no-op optimization for Stories 14.4 and 14.6. Both currently capture the snapshot before the trait call even on idempotent no-op paths. Story 14.5 has the no-op-before-snapshot optimization. Retro-apply the pattern - requires either splitting the trait method (read + write phases) or adding a peek helper. | Stories 14.4 + 14.6, QA-14.5-003 |
| Epic 14 QA | Action-name uniqueness CI check. Build-time script grepping for duplicate string literals in `log_success` / `log_failure` call sites in `commands/*.rs`. Prevents future stories from accidentally introducing a collision with `DisabledUnconstrainedDelegation` (Critical-severity proxy). | Story 14.6, QA-14.6-002 |
| Epic 14 QA | Cross-language SPN list CI diff. Add a CI check that diffs `SYSTEM_SPN_PREFIXES` between `src-tauri/src/services/spn.rs` and `src/utils/spn.ts`. Currently relies on the verbatim-port test suites (19 Rust + 21 TS) as a tripwire. | Story 14.5, QA-14.5-002 |
| Epic 14 QA | Dedicated unit tests for `extract_dacl_principals` in `src-tauri/src/services/dacl.rs::tests`. The DACL parser is exercised end-to-end via Story 14.1's RBCD test but has no targeted unit tests covering deny-ACE skip, mixed Allow+Deny DACL, ACCESS_ALLOWED_OBJECT_ACE with object_flags variants, or malformed truncation. | Story 14.1, QA-14.1-001 |
| Epic 14 QA | i18n schema deduplication for the 3 quick-fix dialogs. The structure (title/body/checkboxLabel/confirmButton/fixButton/fixButtonAriaLabel/successNotification/failureNotification) is identical across Stories 14.4 / 14.5 / 14.6 - factor into a shared schema or helper. | Stories 14.4 / 14.5 / 14.6, QA-14.4-003 |
| Epic 14 QA | End-to-end success-path frontend integration tests. Currently the click-Fix → check-checkbox → confirm → invoke → notification → handleRefresh flow is split across UserDetail/ComputerDetail tests (button + dialog open) and Dialog tests (confirm calls invoke + onSuccess). End-to-end is implicit. | Stories 14.4 / 14.5 / 14.6, QA-14.4-002 |
| Epic 14 QA | Symmetric Rbcd missing-metadata fallback test in ComputerDetail.test.tsx. ConstrainedDelegation has the test; Rbcd doesn't. Same code path in `tooltipParamsFor` but parity catches future asymmetric refactors. | Story 14.3, QA-14.3-001 |
| Epic 14 QA | `tooltipParamsFor` factor when needed. Currently local to ComputerDetail. If a future story needs the same metadata extraction logic, factor to `src/types/securityIndicators.ts` or `src/lib/`. | Story 14.3, QA-14.3-002 |
| Epic 14 QA | SecurityIndicatorDot popover metadata enrichment. Currently shows kind labels only. Could show first-N principal SIDs / target SPNs in the popover so the operator does not need to open ComputerDetail to see what the configuration permits. | Story 14.3, QA-14.3-003 |
| Epic 14 QA | Per-test mock helper `withPermission(level)` to factor the per-test `vi.spyOn(permMod, 'usePermissions')` boilerplate in `ComputerDetail.test.tsx`. Trivial cleanup, no functional impact. | Story 14.6, QA-14.6-003 |
| Epic 14 QA | Manual browser smoke test for all UI changes across the 4 themes (light/dark + 2 accent variants) before tagging the v1.1.0 release. Component-level tests cover correctness but visual rendering should be human-verified. | Epic 14 finalization |

## Dependencies (checked 2026-04-26)

All direct dependencies up to date.

### Rust (Cargo.toml)

| Crate | Current | Latest | Breaking | Notes |
| ----- | ------- | ------ | -------- | ----- |
| *(none)* | - | - | - | All Rust dependencies up to date. `rustls-webpki` pinned to >=0.103.13 via Cargo.lock to patch RUSTSEC-2026-0098/0099/0104 (2026-04-26). |

### NPM (package.json)

| Package | Current | Latest | Breaking | Notes |
| ------- | ------- | ------ | -------- | ----- |
| *(none)* | - | - | - | All direct dependencies on latest. Major bumps applied 2026-04-26: vite 7.3.1 -> 8.0.10, @vitejs/plugin-react 5.2.0 -> 6.0.1, typescript 5.9.3 -> 6.0.3 (with typescript-eslint -> 8.59.0 + tsconfig baseUrl removal for TS 7 forward-compat). pnpm overrides on `postcss@<8.5.12` and `@joshwooding/vite-plugin-react-docgen-typescript@<0.7.0` to patch transitive Storybook deps. |
