# Technical Assumptions

### Repository Structure: Monorepo

Single repository containing the Tauri/Rust backend, React/TypeScript frontend, and documentation. Structure:

```
DSPanel/
  docs/                    # PRD, architecture, stories, brainstorming
  src/                     # React/TypeScript frontend (Vite)
  src-tauri/               # Rust backend (Tauri v2 application)
    src/                   # Rust source code
    Cargo.toml             # Rust dependencies
    tauri.conf.json        # Tauri configuration
  .github/                 # CI/CD workflows
  package.json             # Frontend dependencies (pnpm)
  vite.config.ts           # Vite configuration
  tsconfig.json            # TypeScript configuration
```

### Service Architecture

Desktop monolith with internal modular architecture:

- **Frontend layer**: React components + TypeScript, communicating with the backend via Tauri IPC (invoke commands)
- **Backend layer**: Rust modules exposing Tauri commands for business logic, AD queries, and system operations
- **Provider layer**: DirectoryProvider trait abstraction with LdapDirectoryProvider (on-prem) and GraphDirectoryProvider (Entra ID) implementations in Rust
- **Data layer**: no local database - all data comes from AD/Graph/NTFS at query time. Presets stored as JSON/YAML on network share. Audit log stored locally (SQLite via rusqlite or structured log file).

### Testing Requirements

- **Backend unit tests**: Rust built-in test framework (cargo test) for all core services (directory providers, permission service, preset engine, risk scoring)
- **Frontend unit tests**: Vitest + React Testing Library for components and hooks
- **Integration tests**: against a test AD environment (optional, not required for CI)
- **UI tests**: manual testing for React views (automated E2E testing deferred)
- **Target coverage**: 90%+ on core services
- **Test convention**: Rust tests in same file or `tests/` module; frontend tests mirror source tree (src/components/Foo.tsx -> src/components/Foo.test.tsx)

### Additional Technical Assumptions and Requests

- **LDAP library**: ldap3 crate for AD on-prem queries (async Rust LDAP client)
- **HTTP client**: reqwest crate for Graph API and external HTTP calls
- **Serialization**: serde + serde_json for all data serialization/deserialization
- **Error handling**: thiserror crate for typed, ergonomic error definitions
- **Logging**: tracing crate with console + file subscribers, structured logging
- **Desktop shell**: Tauri v2 for window management, system tray, IPC, and native OS integration
- **Frontend state**: React context + hooks for state management (or Zustand if complexity warrants it)
- **Preset format**: JSON as default format (widely supported, schema-validatable), YAML as optional alternative
- **Password check**: HaveIBeenPwned API (k-anonymity model - only first 5 chars of SHA1 hash sent)
- **NTFS permissions**: windows-rs crate for Win32 ACL/security API access on UNC paths
- **Remote monitoring**: windows-rs crate for WMI/CIM access for remote workstation CPU/RAM/services
- **Event logs**: Windows Event Log API via windows-rs for login/logout and lockout event retrieval
- **Auto-update**: Tauri built-in updater or check GitHub Releases API at startup, notify user if newer version available
- **Localization**: i18next (react-i18next) with JSON translation files, English default, French planned for V2
- **Package manager**: pnpm for frontend dependencies

---
