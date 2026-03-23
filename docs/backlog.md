# Technical Backlog

Items deferred from QA reviews. None are blocking - all stories are PASS.

## Priority: Medium

| Source | Item | Refs |
| ------ | ---- | ---- |
| Epic 4 QA | Settings UI for custom permission group mapping (map any AD group to a DSPanel role) | Epic 12 (Story 12.1) |
| Epic 5 | Settings UI for `disabledOu` default (used by Offboarding workflow, currently persisted in `app-settings.json` but no UI to configure it) | Epic 12 (Story 12.2), `AppSettingsService` |
| Epic 6 (6.2) | `GraphSettings` component created but not yet embedded in a page - wire into centralized Settings view | Epic 12 (Story 12.2 AC#2), `GraphSettings.tsx` |

## Priority: Low

| Source | Item | Refs |
| ------ | ---- | ---- |
| Epic 8 QA | Add click-to-detail interaction on topology nodes/edges | `TopologyView.tsx`, Story 8.5 |
| Epic 8 QA | LDAP msDS-ReplNeighbor for richer replication status data | `replication_status.rs`, Story 8.2 |
| Epic 8 QA | Service list filtering (auto-start only) for workstation monitoring | `WorkstationMonitoringPanel.tsx`, Story 8.4 |
| Epic 8 QA | Group DC cards by site in health dashboard for multi-site environments | `InfrastructureHealth.tsx`, Story 8.1 |
| Epic 9 QA | Add PDF export for privileged accounts report | `SecurityDashboard.tsx`, Story 9.1 |
| Epic 9 QA | Add weight configuration UI in settings for risk score factors | `RiskScore.tsx`, Story 9.2 |
| Epic 9 QA | Add UI for attack detection thresholds and exclusion lists (AttackDetectionConfig exists in backend) | `AttackDetection.tsx`, Story 9.3 |
| Epic 9 QA | Parse nTSecurityDescriptor for ownership/WriteDACL edges in escalation graph | `services/security.rs`, Story 9.4 |
| Epic 9 QA | Consider canvas-based graph visualization for escalation paths | `EscalationPaths.tsx`, Story 9.4 |
| Epic 6 QA | Interactive Browser auth (device code flow) as alternative to client secret for Graph API | `graph_exchange.rs`, Epic 12 (Story 12.2) |
| Epic 7 QA | Export snapshot history (CSV/JSON) | `SnapshotHistory.tsx`, Story 7.5 |
| Epic 7 QA | Server-side pagination for large Recycle Bin contents | `ldap_directory.rs`, Story 7.2 |

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
