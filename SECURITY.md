# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| Latest  | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in DSPanel, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please send an email to the maintainer or use [GitHub Security Advisories](https://github.com/Rwx-G/DSPanel/security/advisories/new) to report it privately.

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgment**: within 48 hours
- **Assessment**: within 7 days
- **Fix release**: as soon as possible, depending on severity

## Security Considerations

DSPanel interacts directly with Active Directory and can perform privileged operations (password resets, group management, account modifications). Security is a top priority:

- All AD communication uses secure protocols (LDAPS / Kerberos)
- No credentials are stored locally (Windows Integrated Authentication)
- All write operations are logged in the internal audit trail
- Permission levels are enforced at the service layer, not just the UI
- Object snapshots are taken before any modification for rollback capability
- Sensitive data in memory (LDAP passwords, TOTP secrets) is zeroized on drop

### MFA secret storage by platform

| Platform | Protection | Notes |
| -------- | ---------- | ----- |
| Windows  | DPAPI (CryptProtectData) | Secret tied to current user profile |
| macOS    | Base64 only | **Not encrypted at rest** |
| Linux    | Base64 only | **Not encrypted at rest** |

On non-Windows platforms, the TOTP shared secret stored in `mfa.dat` is **not encrypted at rest**. A warning is logged at application startup when MFA is configured on a non-Windows host. Native keychain integration (macOS Keychain, Linux Secret Service) is planned for a future release.
