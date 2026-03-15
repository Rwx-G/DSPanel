# Technical Backlog

Items deferred from QA reviews. None are blocking - all stories are PASS.

## Priority: Medium

| Source | Item | Refs |
|--------|------|------|
| 1.8 | Wire OUPicker to Tauri `get_ou_tree` command | `src/components/form/OUPicker.tsx` |
| 1.8 | Wire GroupPicker to Tauri `search_groups` command | `src/components/form/GroupPicker.tsx` |

## Priority: Low

| Source | Item | Refs |
|--------|------|------|
| 1.6 | Set up Storybook or visual regression testing | - |
| 1.7 | Integrate CSV export into DataTable via context menu | `src/components/data/DataTable.tsx` |
| 1.8 | Add `aria-describedby` linking errors to inputs | `src/components/form/` |
| 1.8 | Highlight matching search text in ComboBox dropdown | `src/components/form/ComboBox.tsx` |
| 1.11 | Keyboard accessibility on HealthBadge tooltip | `src/components/common/HealthBadge.tsx` |
| 1.12 | Timeout indicator for DNS resolution + DNS cache | `src/pages/ComputerDetail.tsx` |
| 3.1 | Nested group resolution via tokenGroups | `src-tauri/src/services/comparison.rs` |
| 3.3 | Cache group member queries within session | `src/components/comparison/GroupChainTree.tsx` |
| 3.4 | Support `msDS-ReplValueMetaData` for linked attributes | `src-tauri/src/services/replication.rs` |
| - | Integration tests against a real AD environment (requires lab infra) | CI/infra |
