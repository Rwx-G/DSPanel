# Technical Backlog

Items deferred from QA reviews. None are blocking - all stories are PASS.

## Priority: Medium

| Source | Item | Refs |
| ------ | ---- | ---- |
| ~~Epic 4 QA~~ | ~~Settings UI for custom permission group mapping~~ | **DONE** in Story 12.1 |
| Epic 5 | Settings UI for `disabledOu` default (used by Offboarding workflow) | `AppSettingsService`, Settings.tsx |
| ~~Epic 6 (6.2)~~ | ~~`GraphSettings` component embedded in Settings page~~ | **DONE** in Story 12.2 |
| ~~Epic 11 QA~~ | ~~Retention period configuration in Settings UI~~ | **DONE** in Story 12.2 |
| Epic 12 QA | Full window state save/restore with Tauri window API | `lib.rs`, `tauri.conf.json`, Story 12.4 |

## Priority: Low

| Source | Item | Refs |
| ------ | ---- | ---- |
| Epic 6 QA | Interactive Browser auth (device code flow) as alternative to client secret for Graph API | `graph_exchange.rs`, Epic 12 (Story 12.2) |
| Epic 9 QA | Add weight configuration UI in settings for risk score factors (backend RiskWeights exists) | Epic 12, `RiskScore.tsx`, Story 9.2 |
| Epic 9 QA | Add UI for attack detection thresholds and exclusion lists (backend AttackDetectionConfig exists) | Epic 12, `AttackDetection.tsx`, Story 9.3 |
| Epic 8 QA | Add click-to-detail interaction on topology nodes/edges | `TopologyView.tsx`, Story 8.5 |
| Epic 8 QA | LDAP msDS-ReplNeighbor for richer replication status data | `replication_status.rs`, Story 8.2 |
| Epic 8 QA | Service list filtering (auto-start only) for workstation monitoring | `WorkstationMonitoringPanel.tsx`, Story 8.4 |
| Epic 8 QA | Group DC cards by site in health dashboard for multi-site environments | `InfrastructureHealth.tsx`, Story 8.1 |
| Epic 7 QA | Export snapshot history (CSV/JSON) | `SnapshotHistory.tsx`, Story 7.5 |
| Epic 7 QA | Server-side pagination for large Recycle Bin contents | `ldap_directory.rs`, Story 7.2 |
| Epic 12 QA | "Reset to Defaults" button per settings section | `Settings.tsx` |
| Epic 12 QA | Batch-validate all mapped groups on component mount | `PermissionMappingSettings.tsx` |
| Epic 12 QA | Keyboard shortcut hints in button tooltips | `AppShell.tsx` |
| Epic 12 QA | Release notes preview in update notification bar | `UpdateNotificationBar.tsx` |
| Epic 12 QA | Directory existence validation for export path | `Settings.tsx` |

## Dependencies (checked 2026-03-23)

All direct dependencies up to date within compatibility constraints.

### Rust (Cargo.toml)

| Crate | Current | Latest | Breaking | Notes |
| ----- | ------- | ------ | -------- | ----- |
| *(none)* | - | - | - | All Rust dependencies up to date (2026-03-23) |

### NPM (package.json)

| Package | Current | Latest | Breaking | Notes |
| ------- | ------- | ------ | -------- | ----- |
| `vite` | 7.3.1 | 8.0.2 | Yes | Blocked by `@tailwindcss/vite` and `@storybook/react-vite` peer deps (no vite 8 support yet). 7.3.1 is latest 7.x. |
| `@vitejs/plugin-react` | 5.2.0 | 6.0.1 | Yes | Blocked - v6 requires vite 8 as peer. 5.2.0 is latest compatible with vite 7. |
| `typescript` | 5.9.3 | 6.0.2 | Yes | Blocked by `typescript-eslint` peer dep (requires < 6.0.0). 5.9.3 is latest 5.x. |
