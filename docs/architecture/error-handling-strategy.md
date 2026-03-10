# Error Handling Strategy

### General Approach

- **Error Model**: Exception-based with custom exception hierarchy
- **Exception Hierarchy**: DSPanelException (base) -> DirectoryException, PermissionDeniedException, PresetValidationException, ExportException, NetworkException
- **Error Propagation**: Services throw typed exceptions. ViewModels catch and display user-friendly messages. Unhandled exceptions caught by global handler.

### Logging Standards

- **Library**: Serilog 4.x
- **Format**: Structured JSON to file, plain text to console (debug only)
- **Levels**: Verbose (trace), Debug (development), Information (operations), Warning (recoverable issues), Error (failures), Fatal (app crash)
- **Required Context**:
    - Operation context: current action type (Lookup, PasswordReset, GroupModify, etc.)
    - User context: current Windows username (never log passwords or tokens)
    - Target context: AD object DN being operated on

### Error Handling Patterns

#### External API Errors

- **Retry Policy**: Exponential backoff (1s, 2s, 4s) with max 3 retries for transient failures (network timeout, 429, 503)
- **Circuit Breaker**: After 5 consecutive failures to a provider, disable that provider and show status bar warning
- **Timeout Configuration**: LDAP queries 30s, Graph API 15s, HIBP 5s, WMI 10s
- **Error Translation**: All external errors wrapped in typed DSPanelExceptions with user-friendly messages

#### Business Logic Errors

- **Custom Exceptions**: PermissionDeniedException, ObjectNotFoundException, PresetValidationException, SnapshotNotFoundException
- **User-Facing Errors**: Displayed in a notification bar (non-modal) with severity icon (info/warning/error)
- **Error Codes**: Not used - exception types are sufficient for a desktop app

#### Data Consistency

- **Transaction Strategy**: SQLite transactions for audit log batch writes
- **Compensation Logic**: Object snapshots enable rollback of AD modifications
- **Idempotency**: Group membership operations check current state before applying

---
