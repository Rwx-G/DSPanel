# Technical Backlog

Items deferred from QA reviews. None are blocking - all stories are PASS.

The Epic 14 backlog is now empty. Visual rendering verification before each
release is documented in [`docs/release-smoke-test.md`](release-smoke-test.md)
as a recurring checklist rather than a one-shot backlog item.

### Recently resolved

- **`tooltipParamsFor` factor + SecurityIndicatorDot popover metadata enrichment** (QA-14.3-002 + QA-14.3-003) - resolved 2026-04-26 in commit `6b13e0e`. Moved `tooltipParamsFor` from `ComputerDetail` to `src/types/securityIndicators.ts` so `SecurityIndicatorDot` can share it. Enriched the dot popover with per-indicator metadata previews: ConstrainedDelegation lists the first 3 target SPNs, Rbcd lists the first 3 allowed-principal SIDs, with a `+N more` truncation suffix backed by the new `dot.metadataMore` i18n key (translated to en/fr/de/it/es). 5 new tests cover preview rendering, truncation, no-metadata fallback, and empty-array fallback.
- **Manual cross-theme smoke test** (Epic 14 finalization) - resolved 2026-04-26 in commit `6b13e0e`. Replaced the ad-hoc one-shot backlog item with `docs/release-smoke-test.md`, a reusable visual checklist for every release. Notes that DSPanel ships only `light` / `dark` themes (no accent variants) and walks through every Epic 14 surface (UserLookup / ComputerLookup dot + popover, UserDetail / ComputerDetail badges + Fix buttons, the 3 quick-fix dialogs, AuditLog, notification toasts).
- **AuditSeverity::Critical structural field on AuditEntry** (QA-14.6-001) - resolved 2026-04-26 in commit `d416b22`. Added `AuditSeverity` enum + `severity` field on `AuditEntry`, SQLite migration with `severity` TEXT column + index, new `log_success_with_severity` / `log_failure_with_severity` methods, syslog forwarder severity mapping (Critical→2, Warning→4, Info→6/4), Story 14.6 now records both success and failure entries as Critical. Severity is excluded from the SHA-256 chain hash to preserve backward compatibility on existing chains. Frontend `AuditEntry` interface gains optional `severity` field.
- **Snapshot-on-no-op optimization for Stories 14.4 and 14.6** (QA-14.5-003) - resolved 2026-04-26 in commit `07d4eed`. Promoted the previously-private `get_user_account_control` LDAP helper to a `DirectoryProvider` trait method so the command layer peeks before snapshotting. Both `clear_password_not_required_inner` and `disable_unconstrained_delegation_inner` short-circuit on the no-op path before calling `capture_snapshot`. Read-phase failures log a `<command>Failed` audit entry with a `get_user_account_control:` prefix in the details. Allowlist updated for `ClearPasswordNotRequiredFailed` and `DisableUnconstrainedDelegationFailed` (same shape as `RemoveUserSpnsFailed` for QA-14.5-001).
- **i18n schema deduplication for the 3 quick-fix dialogs** (QA-14.4-003) - resolved 2026-04-26 in commit `02e36a8`. Extracted `AcknowledgeQuickFixDialog` shared React component plus `AcknowledgeQuickFixI18nKeys` TypeScript interface documenting the 8-key contract. `ClearPasswordNotRequiredDialog` and `DisableUnconstrainedDelegationDialog` collapsed to thin wrappers that supply their i18n base key, Tauri command, and MFA action name. Story 14.5 (`ManageSpns`) keeps its own dialog because the per-SPN selection list shape does not fit the acknowledge pattern.
- **End-to-end success-path frontend integration tests** (QA-14.4-002) - resolved 2026-04-26 in commit `638c58e`. Three new E2E tests cover the full quick-fix flow for Stories 14.4, 14.5, and 14.6: click Fix button → dialog opens → tick acknowledgement / select SPN → Confirm → Tauri invoke → success notification → `onRefresh` callback. `UserDetail.test.tsx` wraps providers with `NotificationHost` so toasts appear in the DOM; `ComputerDetail.test.tsx` promotes its notify mock to a hoisted spy.
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
