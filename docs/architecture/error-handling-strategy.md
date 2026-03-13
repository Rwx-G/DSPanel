# Error Handling Strategy

### General Approach

- **Error Model**: Rust `Result<T, E>` with typed error enums via thiserror, propagated with the `?` operator
- **Error Hierarchy**: `DsPanelError` (enum) with variants: DirectoryError, PermissionDeniedError, PresetValidationError, ExportError, NetworkError, DatabaseError
- **Error Propagation**: Rust services return `Result<T, DsPanelError>`. Tauri commands convert errors to serializable responses. React components display user-friendly messages via notification context.
- **Frontend Errors**: Tauri `invoke()` rejects with error string on Rust errors. React error boundaries catch rendering failures.

### Logging Standards

- **Library**: tracing crate with tracing-subscriber
- **Format**: Structured JSON to file (tracing-appender with daily rotation), plain text to console (debug only)
- **Levels**: TRACE, DEBUG, INFO, WARN, ERROR
- **Required Context**:
    - Operation context: current action type (Lookup, PasswordReset, GroupModify, etc.) via tracing spans
    - User context: current OS username (never log passwords or tokens)
    - Target context: AD object DN being operated on

### Error Handling Patterns

#### External API Errors

- **Retry Policy**: Exponential backoff (1s, 2s, 4s) with max 3 retries for transient failures (network timeout, 429, 503)
- **Circuit Breaker**: After 5 consecutive failures to a provider, disable that provider and show status bar warning
- **Timeout Configuration**: LDAP queries 30s, Graph API 15s, HIBP 5s
- **Error Translation**: All external errors mapped to DsPanelError variants with user-friendly messages

#### Business Logic Errors

- **Error Variants**: PermissionDeniedError, ObjectNotFoundError, PresetValidationError, SnapshotNotFoundError
- **User-Facing Errors**: Displayed in a notification toast (non-modal) with severity icon (info/warning/error) via React NotificationContext
- **Error Codes**: Not used - error enum variants are sufficient for a desktop app

#### Data Consistency

- **Transaction Strategy**: SQLite transactions (rusqlite) for audit log batch writes
- **Compensation Logic**: Object snapshots enable rollback of AD modifications
- **Idempotency**: Group membership operations check current state before applying

---
