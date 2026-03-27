# Technical Backlog

Items deferred from QA reviews. None are blocking - all stories are PASS.

## Priority: Medium

| Source | Item | Refs |
| ------ | ---- | ---- |
| *(none)* | - | - |

## Priority: Low

| Source | Item | Refs |
| ------ | ---- | ---- |
| *(none)* | - | - |

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
