# Coding Standards

### Core Standards

- **Backend**: Rust (stable), enforced by `cargo fmt` and `cargo clippy`
- **Frontend**: TypeScript (strict mode), enforced by ESLint and Prettier
- **Test Organization (Rust)**: Unit tests in same file (`#[cfg(test)] mod tests`), integration tests in `src-tauri/tests/`
- **Test Organization (Frontend)**: Colocated test files (`Component.test.tsx` next to `Component.tsx`)

### Naming Conventions

#### Rust

| Element | Convention | Example |
|---------|-----------|---------|
| Modules | snake_case | `directory_provider` |
| Structs/Enums | PascalCase | `DirectoryUser`, `PermissionLevel` |
| Functions | snake_case | `search_users`, `compute_risk_score` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Trait names | PascalCase | `DirectoryProvider` |
| Fields | snake_case | `sam_account_name` |

#### TypeScript / React

| Element | Convention | Example |
|---------|-----------|---------|
| Components | PascalCase | `UserLookupPage`, `SearchBar` |
| Hooks | camelCase with use prefix | `usePermission`, `useDebounce` |
| Interfaces/Types | PascalCase | `DirectoryUser`, `AuditLogEntry` |
| Functions/variables | camelCase | `searchUsers`, `isLoading` |
| Constants | SCREAMING_SNAKE_CASE or camelCase | `MAX_PAGE_SIZE` |
| CSS classes | kebab-case (Tailwind utilities) | `text-sm`, `bg-primary` |

### Critical Rules

- **Rust - no unwrap() in production code**: Always propagate errors with `?` or handle explicitly. `unwrap()` / `expect()` only in tests.
- **Rust - no unsafe**: Unless strictly necessary and documented with a safety comment.
- **Always use DirectoryProvider trait**: Never use ldap3 or reqwest directly in command handlers. Always go through the provider abstraction.
- **Permission check before action**: Every write command must call `has_permission()` before executing. Never rely solely on UI visibility for security.
- **Snapshot before modify**: Every write operation on AD objects must call `snapshot::capture()` before the modification.
- **Audit every write**: Every successful or failed write operation must be logged via `audit::log()`.
- **No secrets in code or logs**: Never log passwords, tokens, or credentials. Never hardcode connection strings or API keys.
- **Handle Option/Result for AD attributes**: AD attributes may be null or missing. Always handle None when parsing LDAP search results.
- **Frontend - no any types**: TypeScript strict mode, no `any` escape hatches unless justified with a comment.
- **Frontend - always handle loading/error states**: Every component that invokes a Tauri command must handle loading, success, and error states.

### Rust Specifics

- **Edition**: 2021
- **Clippy**: Run with `--deny warnings` in CI
- **Error types**: Use `thiserror` for library-style errors, `anyhow` only in main/command entry points if needed
- **Serde**: Derive `Serialize`/`Deserialize` on all IPC-crossing types, use `#[serde(rename_all = "camelCase")]` for frontend compatibility
- **Async runtime**: tokio (bundled with Tauri)

### TypeScript Specifics

- **Strict mode**: Enabled in tsconfig.json (`strict: true`)
- **No default exports**: Use named exports for better refactoring support
- **React**: Functional components only, no class components
- **State**: Prefer hooks (`useState`, `useReducer`) and context over external state management libraries

---
