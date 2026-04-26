# Technical Backlog

Items deferred from QA reviews. None are blocking - all stories are PASS.

## Priority: Medium

| Source | Item | Refs |
| ------ | ---- | ---- |
| Epic 14 QA | AuditSeverity::Critical structural field on AuditEntry. Critical-severity dimension is currently encoded in the unique action name `DisabledUnconstrainedDelegation` for Story 14.6. Adding a typed `Option<AuditSeverity>` field would let SIEM dashboards / severity-filtered queries treat 14.6 events as Critical without action-name regex. Requires SQLite schema migration + log_success/log_failure signature change + syslog forwarder severity mapping + all existing call sites or default-to-Info. Land as a future Epic 11 amendment. | Story 14.6, QA-14.6-001 |

## Priority: Low

| Source | Item | Refs |
| ------ | ---- | ---- |
| Epic 14 QA | Snapshot-on-no-op optimization for Stories 14.4 and 14.6. Both currently capture the snapshot before the trait call even on idempotent no-op paths. Story 14.5 has the no-op-before-snapshot optimization. Retro-apply the pattern - requires either splitting the trait method (read + write phases) or adding a peek helper. | Stories 14.4 + 14.6, QA-14.5-003 |
| Epic 14 QA | i18n schema deduplication for the 3 quick-fix dialogs. The structure (title/body/checkboxLabel/confirmButton/fixButton/fixButtonAriaLabel/successNotification/failureNotification) is identical across Stories 14.4 / 14.5 / 14.6 - factor into a shared schema or helper. | Stories 14.4 / 14.5 / 14.6, QA-14.4-003 |
| Epic 14 QA | End-to-end success-path frontend integration tests. Currently the click-Fix → check-checkbox → confirm → invoke → notification → handleRefresh flow is split across UserDetail/ComputerDetail tests (button + dialog open) and Dialog tests (confirm calls invoke + onSuccess). End-to-end is implicit. | Stories 14.4 / 14.5 / 14.6, QA-14.4-002 |
| Epic 14 QA | `tooltipParamsFor` factor when needed. Currently local to ComputerDetail. If a future story needs the same metadata extraction logic, factor to `src/types/securityIndicators.ts` or `src/lib/`. | Story 14.3, QA-14.3-002 |
| Epic 14 QA | SecurityIndicatorDot popover metadata enrichment. Currently shows kind labels only. Could show first-N principal SIDs / target SPNs in the popover so the operator does not need to open ComputerDetail to see what the configuration permits. | Story 14.3, QA-14.3-003 |
| Epic 14 QA | Manual browser smoke test for all UI changes across the 4 themes (light/dark + 2 accent variants) before tagging the v1.1.0 release. Component-level tests cover correctness but visual rendering should be human-verified. | Epic 14 finalization |

### Recently resolved

- **Audit-failure logging on backend READ errors** (QA-14.5-001) - resolved 2026-04-26 in commit `bcf0202`. `remove_user_spns_inner` now calls `log_failure("RemoveUserSpnsFailed", dn, "get_user_spns: <error>")` on read-phase failures before returning Err. Stories 14.4 / 14.6 already had read-failure coverage via the `clear_user_account_control_bits` trait method's Err arm.
- **Dedicated unit tests for `extract_dacl_principals`** (QA-14.1-001) - resolved 2026-04-26 in commit `ac9ee55`. Added 7 dedicated tests: deny-ACE skip, mixed Allow+Deny order, ACCESS_ALLOWED_OBJECT_ACE with ObjectType GUID flag, ACCESS_ALLOWED_OBJECT_ACE with both GUID flags, truncated SD returns Err, identical SIDs deduped, audit ACE skipped.
- **Symmetric Rbcd missing-metadata fallback test** (QA-14.3-001) - resolved 2026-04-26 in commit `ab4e2e3`.
- **Action-name uniqueness CI check** (QA-14.6-002) - resolved 2026-04-26 in commit `7736aa3`. New `scripts/check-audit-action-names.sh` wired into the Build & Test workflow on Linux runners. Allowlist for intentional duplicates at `scripts/audit-action-names.allowlist`.
- **Cross-language SPN list CI diff** (QA-14.5-002) - resolved 2026-04-26 in commit `7736aa3`. New `scripts/check-spn-list-parity.sh` wired into the Build & Test workflow.
- **Per-test mock helper `withPermission(level)`** (QA-14.6-003) - resolved 2026-04-26 in commit `7bb6746`. New `src/test-utils/permissions.ts::mockPermissionLevel(level, options?)`. Refactored 10 sites across UserDetail.test.tsx + ComputerDetail.test.tsx.

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
