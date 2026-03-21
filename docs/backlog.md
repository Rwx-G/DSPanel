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
| Epic 8 QA | Integrate WorkstationMonitoringPanel into ComputerLookup detail view | `ComputerLookup.tsx`, `WorkstationMonitoringPanel.tsx`, Story 8.4 |
| Epic 8 QA | Add click-to-detail interaction on topology nodes/edges | `TopologyView.tsx`, Story 8.5 |
| Epic 8 QA | Force-directed layout for complex multi-site topologies | `TopologyView.tsx`, Story 8.5 |
| Epic 8 QA | Add _ldap._tcp.dc._msdcs SRV record validation | `dns_validation.rs`, Story 8.3 |
| Epic 8 QA | LDAP msDS-ReplNeighbor for richer replication status data | `replication_status.rs`, Story 8.2 |
| Epic 8 QA | Service list filtering (auto-start only) for workstation monitoring | `WorkstationMonitoringPanel.tsx`, Story 8.4 |
| Epic 8 QA | Group DC cards by site in health dashboard for multi-site environments | `InfrastructureHealth.tsx`, Story 8.1 |
| Epic 6 QA | Interactive Browser auth (device code flow) as alternative to client secret for Graph API | `graph_exchange.rs`, Epic 12 (Story 12.2) |
| Epic 7 QA | Bulk restore for Recycle Bin (currently single object only) | `RecycleBin.tsx`, Story 7.2 |
| Epic 7 QA | Snapshot capture for contact/printer modifications | `object_snapshot.rs`, Story 7.5 |
| Epic 7 QA | Export snapshot history (CSV/JSON) | `SnapshotHistory.tsx`, Story 7.5 |
| Epic 7 QA | Server-side pagination for large Recycle Bin contents | `ldap_directory.rs`, Story 7.2 |

## Dependencies (checked 2026-03-20)

Major version bumps available. Each requires migration work - do not batch.

### Rust (Cargo.toml)

| Crate | Current | Latest | Breaking | Notes |
| ----- | ------- | ------ | -------- | ----- |
| `ldap3` | 0.11 | 0.12 | Yes | Core dependency - test against real AD after upgrade |
| `notify` + `notify-debouncer-mini` | 7 / 0.5 | 8 / 0.7 | Yes | Upgrade together, file watcher API may change |
| `quick-xml` | 0.37 | 0.39 | Possible | Used for replication metadata XML parsing |
| `rand` | 0.8 | 0.10 | Yes | API changes (password generator, MFA) |
| `reqwest` | 0.12 | 0.13 | Yes | `rustls-tls` feature renamed, check Graph + HIBP calls |
| `rfd` | 0.15 | 0.17 | Possible | Native file dialogs (save/folder picker) |
| `rusqlite` | 0.31 | 0.39 | Yes | Audit DB - large version gap, review migration guide |
| `windows` | 0.58 | 0.62 | Possible | NTFS ACL + DPAPI - test on Windows after upgrade |

### NPM (package.json)

| Package | Current | Latest | Breaking | Notes |
| ------- | ------- | ------ | -------- | ----- |
| `vite` | 7 | 8 | Yes | Major - check config compat, plugin-react must follow |
| `@vitejs/plugin-react` | 4 | 6 | Yes | Upgrade with vite 8 |
| `jsdom` | 28 | 29 | Yes | Test environment - run full test suite after |
| `react` / `react-dom` | 19.1 | 19.2 | No | Safe minor bump |
| `typescript` | 5.8 | 5.9 | No | Safe minor bump |
| `storybook` | 10.2 | 10.3 | No | Safe minor bump |
| `tailwindcss` | 4.2.1 | 4.2.2 | No | Safe patch |
| `eslint` | 10.0 | 10.1 | No | Safe minor bump |
