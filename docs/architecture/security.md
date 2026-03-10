# Security

### Input Validation

- **Validation Library**: Built-in .NET data annotations + custom validators
- **Validation Location**: Service layer (before any AD operation)
- **Required Rules:**
    - All user search inputs sanitized for LDAP injection (escape special chars: `*`, `(`, `)`, `\`, NUL)
    - UNC paths validated for format and accessible characters
    - Preset JSON validated against schema before loading
    - Script paths validated against allowed script directory

### Authentication & Authorization

- **Auth Method**: Windows Integrated Authentication (Kerberos) - no stored credentials
- **Session Management**: Application-lifetime session, permission level cached at startup
- **Required Patterns:**
    - IPermissionService.HasPermission() checked at service layer before every write operation
    - UI elements bound to permission level for visibility (defense in depth, not sole control)
    - MFA challenge (TOTP) configurable for sensitive operations

### Secrets Management

- **Development**: No secrets needed (Kerberos auth uses current Windows credentials)
- **Graph API**: Azure AD App Registration credentials stored in Windows Credential Manager (not plaintext)
- **Code Requirements:**
    - NEVER hardcode secrets, tokens, or passwords
    - Access Graph credentials via Windows Credential Manager API
    - No secrets in logs, error messages, or snapshots

### Data Protection

- **Encryption at Rest**: SQLite database not encrypted (contains only operational logs, no sensitive data). Passwords are never stored.
- **Encryption in Transit**: LDAPS (port 636) for AD communication. HTTPS for all external API calls (Graph, HIBP, GitHub).
- **PII Handling**: AD user data displayed in-memory only, never cached to disk except in audit logs (action metadata only, not full user records)
- **Logging Restrictions**: Never log passwords (old or new), authentication tokens, thumbnail photo data, or full LDAP query results

### Dependency Security

- **Scanning Tool**: `dotnet list package --vulnerable` in CI pipeline
- **Update Policy**: Monthly dependency review, immediate update for critical CVEs
- **Approval Process**: New NuGet packages require justification in PR description

### Security Testing

- **SAST Tool**: .NET Analyzers (built-in) + security-focused rules
- **DAST Tool**: N/A (desktop application, not web)
- **Penetration Testing**: Manual review of LDAP injection vectors and permission bypass scenarios

---
