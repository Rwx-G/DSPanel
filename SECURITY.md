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
- All write operations are logged in the internal audit trail with SHA-256 hash chain integrity
- Optional remote syslog forwarding (RFC 5424 UDP) for tamper-resistant external logging
- Permission levels are enforced at the service layer, not just the UI
- Object snapshots are taken before any modification for rollback capability
- Sensitive data in memory (LDAP passwords, TOTP secrets) is zeroized on drop

### MFA secret storage by platform

| Platform | Protection | Backend |
| -------- | ---------- | ------- |
| Windows  | DPAPI (CryptProtectData) | Encrypted file (`mfa.dat`) tied to current user profile |
| macOS    | OS Keychain | Stored via `keyring` crate (macOS Keychain Services) |
| Linux    | Secret Service | Stored via `keyring` crate (GNOME Keyring / KWallet) |

On all platforms the TOTP shared secret is protected by the OS-native credential store. No plaintext secrets are written to disk.

The internal `services::dpapi` module is intentionally **Windows-only** (gated with `#[cfg(target_os = "windows")]` at the parent module). There is no portable DPAPI equivalent and we deliberately do not ship a base64 "fallback" that would silently produce unencrypted bytes if invoked on non-Windows. Calling DPAPI from cross-platform code is a compile error, forcing developers onto the keyring path on macOS / Linux.
