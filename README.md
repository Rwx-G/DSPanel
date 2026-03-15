<p align="center">
  <h1 align="center">DSPanel</h1>
  <p align="center">Active Directory support and administration tool for Windows, macOS, and Linux.</p>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Rust-2021-orange.svg" alt="Rust">
  <img src="https://img.shields.io/badge/Tauri-v2-blue.svg" alt="Tauri">
  <img src="https://img.shields.io/badge/Platform-Windows%20|%20macOS%20|%20Linux-0078D6.svg" alt="Platform">
  <img src="https://img.shields.io/badge/Status-v0.3.0-brightgreen.svg" alt="Status">
</p>

---

## Overview

DSPanel is an open source cross-platform desktop application (Rust/Tauri v2) that unifies the entire Active Directory support chain into a single tool. It dynamically adapts its interface based on the AD permissions of the current user, covering everything from read-only lookups to full domain administration.

### Key Features

- **User & Computer Lookup** - Search accounts, view detailed info, healthcheck badges, group memberships
- **Account Comparison** - Side-by-side user comparison with visual group delta
- **NTFS Permissions Audit** - Cross-reference folder permissions with AD groups to diagnose access issues
- **Group Management** - Tree/flat views, drag-and-drop, bulk operations (Add/Delete/Transfer)
- **Onboarding/Offboarding Wizards** - Guided workflows with declarative presets (JSON)
- **Support Actions** - Password reset, unlock, enable/disable with secure password generation
- **Exchange Diagnostics** - Read-only mailbox info for on-prem (LDAP) and Online (Graph)
- **Infrastructure Health** - DC health, replication status, DNS checks, AD topology map
- **Security Dashboard** - Domain risk score, privileged accounts monitoring, AD attack detection
- **Reports & Export** - CSV/PDF export, scheduled reports, compliance templates (GDPR, HIPAA, SOX)
- **Audit Trail** - Full internal action logging for compliance
- **Extensibility** - External script execution, webhooks, GPO viewer, automation triggers

### Adaptive Permissions

The UI adapts dynamically based on the running user's AD group memberships:

| Level               | Access                                                |
| ------------------- | ----------------------------------------------------- |
| **ReadOnly**        | Lookup, view, export                                  |
| **HelpDesk**        | + Password reset, unlock, diagnostics                 |
| **AccountOperator** | + Group management, presets, onboarding/offboarding   |
| **DomainAdmin**     | + Infrastructure monitoring, security, administration |

### Hybrid Support

- **AD on-prem** via LDAP
- **Entra ID** via Microsoft Graph API
- **Exchange on-prem** via LDAP attributes (msExch\*)
- **Exchange Online** via Microsoft Graph API

## Requirements

- Windows 10/11, macOS 12+, or Linux (x64)
- Network access to an Active Directory domain
- (Optional) Azure AD App Registration for Entra ID / Exchange Online features

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
