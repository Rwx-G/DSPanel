<p align="center">
  <h1 align="center">DSPanel</h1>
  <p align="center">Active Directory support and administration tool for Windows, macOS, and Linux.</p>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Rust-2021-orange.svg" alt="Rust">
  <img src="https://img.shields.io/badge/Tauri-v2-blue.svg" alt="Tauri">
  <img src="https://img.shields.io/badge/Platform-Windows%20|%20macOS%20|%20Linux-0078D6.svg" alt="Platform">
  <img src="https://img.shields.io/badge/Status-v0.9.0-brightgreen.svg" alt="Status">
</p>

---

## Overview

DSPanel is an open source cross-platform desktop application (Rust/Tauri v2) that unifies the entire Active Directory support chain into a single tool. It dynamically adapts its interface based on the AD permissions of the current user, covering everything from read-only lookups to full domain administration.

### Key Features

- **User & Computer Lookup** - Search accounts, view detailed info, healthcheck badges, group memberships
- **Account Comparison** - Side-by-side user comparison with visual group delta
- **NTFS Permissions Audit** - Cross-reference folder permissions with AD groups to diagnose access issues
- **Group Management** - Tree/flat views, drag-and-drop, bulk operations (Add/Delete/Transfer)
- **Contact & Printer Management** - Browse, search, and edit AD contacts and printers with inline editing
- **Onboarding/Offboarding Wizards** - Guided workflows with declarative presets (JSON)
- **Support Actions** - Password reset, unlock, enable/disable with secure password generation
- **User Photos** - View, upload (auto-resize to 96x96), and remove AD thumbnail photos
- **Move Objects** - Move users, computers, groups, contacts, printers between OUs with dry-run preview
- **AD Recycle Bin** - Browse and restore deleted objects with type filtering and OU picker
- **Object Snapshots** - SQLite-backed attribute snapshots before every write, with diff viewer and restore
- **Exchange Diagnostics** - Read-only mailbox info for on-prem (LDAP) and Online (Graph)
- **Audit Trail** - Full internal action logging for compliance
- **Infrastructure Health** - 7 cross-platform DC health checks (DNS, LDAP, SPNs, replication, SYSVOL/DFSR, clock skew, machine account), FSMO roles, functional level
- **Replication Monitoring** - Partnership table with latency, error tracking, and force-replication via repadmin
- **DNS & Kerberos Validation** - SRV record validation via AD DNS (cross-platform, hickory-resolver), clock skew detection
- **AD Topology** - Site/DC/replication/site-link overview with per-DC details (IP, OS, roles, online status, subnets)
- **Privileged Accounts** - Audit of admin group members with 12 security checks per account (Kerberoastable, AS-REP Roastable, Protected Users, SIDHistory, delegation, etc.), domain findings (KRBTGT age, LAPS coverage, PSO), CSV/HTML export
- **Domain Risk Score** - Security posture scoring (0-100) with 9 weighted factors and ~70 checks, SVG gauge + radar chart, per-finding CIS/MITRE references, remediation complexity and impact scoring, 30-day trend, HTML report export
- **Attack Detection** - On-demand Windows Security Event Log analysis for 14 attack types (Golden Ticket, DCSync, Kerberoasting, Pass-the-Hash, etc.) with structured XML parsing and MITRE ATT&CK mapping
- **Escalation Paths** - Privilege escalation path analysis with 5 node types, 8 edge types (membership, delegation, RBCD, SIDHistory, ADCS, GPO), and weighted Dijkstra path-finding

### Adaptive Permissions

The UI adapts dynamically based on the running user's AD permissions. Detection
uses three strategies (highest wins):

1. **SID-based** - automatic detection of well-known AD groups (Domain Admins,
   Account Operators, etc.) via RID matching - works in any AD locale
2. **Probe-based** - tests effective permissions via `allowedAttributesEffective`
   and `allowedChildClassesEffective` on representative objects - detects
   delegated permissions without requiring specific group membership
3. **Custom groups** - optional AD groups for explicit role assignment

| Level               | Access                                                |
| ------------------- | ----------------------------------------------------- |
| **ReadOnly**        | Lookup, view, export                                  |
| **HelpDesk**        | + Password reset, unlock, diagnostics                 |
| **AccountOperator** | + Group management, presets, onboarding/offboarding   |
| **Admin**           | + Delete/move objects, create users                   |
| **DomainAdmin**     | + Built-in/sensitive objects, infrastructure           |

#### Custom Permission Groups

Organizations can create these AD security groups for explicit DSPanel role
assignment (optional - probe-based detection works without them):

| AD Group                | DSPanel Level   |
| ----------------------- | --------------- |
| `DSPanel-HelpDesk`      | HelpDesk        |
| `DSPanel-AccountOps`    | AccountOperator |
| `DSPanel-Admin`         | Admin           |
| `DSPanel-DomainAdmin`   | DomainAdmin     |

### Hybrid Support

- **AD on-prem** via LDAP
- **Entra ID** via Microsoft Graph API
- **Exchange on-prem** via LDAP attributes (msExch\*)
- **Exchange Online** via Microsoft Graph API

## Requirements

- Windows 10/11, macOS 12+, or Linux (x64)
- Network access to an Active Directory domain
- (Optional) Azure AD App Registration for Entra ID / Exchange Online features

### Event Log Permissions

The **Attack Detection** feature reads the Windows Security Event Log on the
target DC. If the account running DSPanel is not a member of the
**Event Log Readers** group on that DC, the Security log is silently
inaccessible and all checks will display **N/A** with a warning banner.

To grant access, add the DSPanel user to the built-in **Event Log Readers**
group on each monitored DC (or via Group Policy).

## Installation

### Portable (Windows)

Download the latest release from [GitHub Releases](https://github.com/Rwx-G/DSPanel/releases), extract, and run `DSPanel.exe`.

### Installers

- **Windows**: `.msi` or `.exe` installer
- **macOS**: `.dmg`
- **Linux**: `.deb`, `.AppImage`, `.rpm`

## Building from Source

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) (v20+) with [pnpm](https://pnpm.io/)
- OS-specific dependencies (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))

### Build

```bash
git clone https://github.com/Rwx-G/DSPanel.git
cd DSPanel
pnpm install
pnpm tauri build
```

### Dev mode

```bash
pnpm tauri dev
```

### Integration Tests (Real AD)

Integration tests run against a real Active Directory domain controller. They are
skipped by default and gated by environment variables.

**Lab setup:**

1. Windows Server 2022 VM (Hyper-V, Internal switch, 2-4 GB RAM)
2. Promote to DC, then populate with [BadBlood](https://github.com/davidprowe/BadBlood)
3. Create three test accounts: `TestReadOnly` (standard user), `TestOperator`
   (Account Operators), `TestAdmin` (Domain Admins + Enterprise Admins)

**Running:**

```bash
# Read-only tests (15 tests)
export DSPANEL_LDAP_SERVER=172.31.72.165
export DSPANEL_LDAP_BIND_DN="CN=TestReadOnly,CN=Users,DC=dspanel,DC=local"
export DSPANEL_LDAP_BIND_PASSWORD="P@ssw0rd2026!"
cargo test --test ldap_integration -- --nocapture read_

# Write tests (4 tests - requires Account Operator)
export DSPANEL_LDAP_BIND_DN="CN=TestOperator,CN=Users,DC=dspanel,DC=local"
cargo test --test ldap_integration -- --nocapture write_

# Admin tests (2 tests - requires Domain Admin)
export DSPANEL_LDAP_BIND_DN="CN=TestAdmin,CN=Users,DC=dspanel,DC=local"
cargo test --test ldap_integration -- --nocapture admin_

# All tests (22 tests - use admin account)
export DSPANEL_LDAP_BIND_DN="CN=TestAdmin,CN=Users,DC=dspanel,DC=local"
cargo test --test ldap_integration -- --nocapture
```

## Configuration

### LDAP Connection

By default, DSPanel uses **GSSAPI (Kerberos)** authentication on the current
user's domain. For environments requiring explicit credentials or custom servers:

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `DSPANEL_LDAP_SERVER` | LDAP server hostname or IP. Supports `ldaps://` and `ldap://` prefixes. | Auto-detected from `USERDNSDOMAIN` |
| `DSPANEL_LDAP_BIND_DN` | Bind DN for simple bind authentication (e.g. `CN=svc,CN=Users,DC=corp,DC=local`) | GSSAPI |
| `DSPANEL_LDAP_BIND_PASSWORD` | Password for simple bind | GSSAPI |
| `DSPANEL_LDAP_USE_TLS` | Enable LDAPS (implicit TLS on port 636). Set to `true` or `1`. | `false` |
| `DSPANEL_LDAP_STARTTLS` | Enable StartTLS (upgrade plaintext on port 389). Set to `true` or `1`. Mutually exclusive with LDAPS - if both set, LDAPS wins. | `false` |
| `DSPANEL_LDAP_CA_CERT` | Path to a custom CA certificate file (PEM or DER). Added as trusted root alongside the system store. | System store only |
| `DSPANEL_LDAP_TLS_SKIP_VERIFY` | **Development only.** Skip TLS certificate verification. Disables hostname and chain validation, making the connection vulnerable to MITM attacks. Never use in production - use `DSPANEL_LDAP_CA_CERT` instead. | `false` |

All three credential variables (`SERVER`, `BIND_DN`, `BIND_PASSWORD`) must be set
together. If only some are set, DSPanel falls back to GSSAPI with a warning.

**Examples:**

```bash
# LDAPS (implicit TLS, port 636)
DSPANEL_LDAP_SERVER=dc01.corp.local
DSPANEL_LDAP_BIND_DN="CN=DSPanel-Svc,CN=Users,DC=corp,DC=local"
DSPANEL_LDAP_BIND_PASSWORD="s3cur3!"
DSPANEL_LDAP_USE_TLS=true

# StartTLS (upgrade on port 389)
DSPANEL_LDAP_SERVER=dc01.corp.local
DSPANEL_LDAP_BIND_DN="CN=DSPanel-Svc,CN=Users,DC=corp,DC=local"
DSPANEL_LDAP_BIND_PASSWORD="s3cur3!"
DSPANEL_LDAP_STARTTLS=true

# Internal PKI with custom CA certificate
DSPANEL_LDAP_CA_CERT=/etc/ssl/certs/corp-ca.pem

# Lab/dev only - skip TLS verification (INSECURE, vulnerable to MITM)
DSPANEL_LDAP_TLS_SKIP_VERIFY=true
```

### Microsoft Graph (Exchange Online)

Exchange Online diagnostics require an Azure AD App Registration. Configuration
is done in-app via the Graph Settings panel (available in a future Settings page,
Epic 12).

**Required Azure AD permissions** (Application type, admin consent required):

| Permission | Type | Purpose |
| ---------- | ---- | ------- |
| `Mail.Read` | Application | Read mailbox settings, folder sizes |
| `User.Read.All` | Application | Read user profiles, proxy addresses |
| `Reports.Read.All` | Application | Read mailbox usage reports (real quota) |

The client secret is stored securely in the OS credential store (Windows Credential Manager, macOS Keychain, Linux Secret Service via keyring crate).

## Project Structure

```
DSPanel/
  src/              # Frontend (React + TypeScript)
  src-tauri/        # Backend (Rust + Tauri v2)
    src/            # Rust source code
    Cargo.toml      # Rust dependencies
    tauri.conf.json # Tauri configuration
  docs/             # Project documentation
  .github/          # CI/CD workflows, issue templates
```

## Documentation

- [Project Brief](docs/brief.md) - Vision, problem statement, target users
- [Product Requirements (PRD)](docs/prd.md) - Functional/non-functional requirements, epics, stories
- [Architecture](docs/architecture.md) - Tech stack, data models, components, workflows

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
