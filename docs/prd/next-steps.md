# Next Steps

### UX Expert Prompt

Review the DSPanel PRD (docs/prd.md) and create a detailed front-end specification for the Tauri v2 desktop application. Focus on the navigation shell, core screen layouts (13 views), component hierarchy, theming system (dark/light with CSS custom properties), and interaction patterns (search-first, drag-and-drop, dry-run previews). The frontend is React + TypeScript with Vite, communicating with a Rust backend via Tauri IPC.

### Architect Prompt

Review the DSPanel PRD (docs/prd.md) and create the technical architecture document. Key decisions to address: DirectoryProvider trait abstraction (LDAP vs Graph), permission detection system, preset engine (JSON on network share), audit log storage (SQLite via rusqlite), NTFS/ACL resolution (windows-rs), WMI remote monitoring, event log analysis for attack detection, and the Tauri command/IPC structure. Target stack: Tauri v2, Rust (ldap3, reqwest, serde, tracing, thiserror), React 19, TypeScript, Vite, Vitest.
