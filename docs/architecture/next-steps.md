# Next Steps

### Development Start

DSPanel uses a Tauri v2 hybrid architecture - the Rust backend handles system operations while the React frontend provides the UI. Both layers are developed in parallel.

Review the PRD (docs/prd.md) Epic 1 stories and begin implementation following this architecture document. Key files to create first:

1. **Tauri project skeleton** (Story 1.1) - `src-tauri/src/main.rs` with Tauri app builder, managed state setup, `src/App.tsx` with React Router shell
2. **DirectoryProvider trait + ldap3 implementation** (Story 1.2) - `src-tauri/src/services/directory/traits.rs` and `ldap_provider.rs`
3. **Permission module + React context** (Story 1.3) - `src-tauri/src/services/permission/mod.rs` and `src/contexts/PermissionContext.tsx`
4. **UserLookupPage + Tauri commands** (Story 1.4) - `src/pages/UserLookupPage.tsx` and `src-tauri/src/commands/user_commands.rs`
