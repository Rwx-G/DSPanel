# Security

### Input Validation

- **Backend Validation**: Custom validation functions in Rust service layer (before any AD operation)
- **Frontend Validation**: TypeScript validation helpers for client-side UX (not security boundary)
- **Required Rules:**
    - All user search inputs sanitized for LDAP injection (escape special chars: `*`, `(`, `)`, `\`, NUL) in Rust
    - UNC paths validated for format and accessible characters
    - Preset JSON validated with serde deserialization + custom validation before loading
    - Script paths validated against allowed script directory

### Authentication & Authorization

- **Auth Method**: Windows Integrated Authentication (Kerberos) - no stored credentials
- **Session Management**: Application-lifetime session, permission level cached at startup in Tauri managed state
- **Required Patterns:**
    - Permission checked in Rust command handlers before every write operation
    - React PermissionGate component controls UI visibility (defense in depth, not sole control)
    - MFA challenge (TOTP) configurable for sensitive operations

### Secrets Management

- **Development**: No secrets needed (Kerberos auth uses current OS credentials)
- **Graph API**: Azure AD App Registration credentials stored in OS keychain (not plaintext)
- **Code Requirements:**
    - NEVER hardcode secrets, tokens, or passwords
    - Access Graph credentials via OS keychain API
    - No secrets in logs, error messages, or snapshots

### Data Protection

- **Encryption at Rest**: SQLite database not encrypted (contains only operational logs, no sensitive data). Passwords are never stored.
- **Encryption in Transit**: LDAPS (port 636) for AD communication. HTTPS for all external API calls (Graph, HIBP, GitHub).
- **PII Handling**: AD user data displayed in-memory only, never cached to disk except in audit logs (action metadata only, not full user records)
- **Logging Restrictions**: Never log passwords (old or new), authentication tokens, thumbnail photo data, or full LDAP query results

### Tauri Security Configuration

- **Content Security Policy (CSP)**: Strict CSP in `tauri.conf.json` - no inline scripts, no remote script loading
- **Capability Permissions**: Minimal Tauri v2 permissions - only enable required APIs (fs, http, shell as needed)
- **IPC Security**: All Tauri commands validate inputs on the Rust side before processing
- **No Remote Content**: Frontend is bundled locally, no remote URLs loaded in the webview

### Dependency Security

- **Rust Scanning**: `cargo audit` in CI pipeline for known vulnerabilities in crate dependencies
- **Frontend Scanning**: `pnpm audit` in CI pipeline for npm package vulnerabilities
- **Update Policy**: Monthly dependency review, immediate update for critical CVEs
- **Approval Process**: New crate or npm packages require justification in PR description

### Security Testing

- **Rust SAST**: cargo clippy with security-related lints
- **Frontend SAST**: ESLint with security plugins
- **DAST Tool**: N/A (desktop application, not web)
- **Penetration Testing**: Manual review of LDAP injection vectors and permission bypass scenarios

---
