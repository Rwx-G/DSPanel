<p align="center">
  <h1 align="center">DSPanel</h1>
  <p align="center">Active Directory support and administration tool for Windows environments.</p>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/.NET-10.0-purple.svg" alt=".NET">
  <img src="https://img.shields.io/badge/Platform-Windows-0078D6.svg" alt="Platform">
  <img src="https://img.shields.io/badge/Status-v0.0.2_Documentation-yellow.svg" alt="Status">
  <img src="https://img.shields.io/badge/Coverage%20Target->90%25-brightgreen.svg" alt="Coverage">
</p>

---

## Overview

DSPanel is an open source Windows desktop application (WPF/.NET 10) that unifies the entire Active Directory support chain into a single tool. It dynamically adapts its interface based on the AD permissions of the current Windows user, covering everything from read-only lookups to full domain administration.

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

| Level | Access |
|-------|--------|
| **ReadOnly** | Lookup, view, export |
| **HelpDesk** | + Password reset, unlock, diagnostics |
| **AccountOperator** | + Group management, presets, onboarding/offboarding |
| **DomainAdmin** | + Infrastructure monitoring, security, administration |

### Hybrid Support

- **AD on-prem** via LDAP (System.DirectoryServices.Protocols)
- **Entra ID** via Microsoft Graph SDK
- **Exchange on-prem** via LDAP attributes (msExch*)
- **Exchange Online** via Microsoft Graph API

Automatic context detection at startup via the `IDirectoryProvider` adapter pattern.

## Requirements

- Windows 10/11 (x64)
- .NET 10.0 Runtime
- Network access to an Active Directory domain
- (Optional) Azure AD App Registration for Entra ID / Exchange Online features

## Installation

### Portable

Download the latest release from [GitHub Releases](https://github.com/Rwx-G/DSPanel/releases), extract, and run `DSPanel.exe`.

### MSIX

Download the `.msix` package from [GitHub Releases](https://github.com/Rwx-G/DSPanel/releases) and install.

## Building from Source

### Prerequisites

- [.NET 10.0 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
- Windows 10/11 with WPF support
- (Optional) Visual Studio 2022 or Rider

### Build

```bash
git clone https://github.com/Rwx-G/DSPanel.git
cd DSPanel
dotnet restore
dotnet build
```

### Run

```bash
dotnet run --project src/DSPanel
```

### Test

```bash
dotnet test
```

## Project Structure

```
DSPanel/
  docs/           # Project documentation (brief, PRD, architecture)
  src/
    DSPanel/      # Main WPF application
    DSPanel.Tests/ # xUnit test project
  .github/        # CI/CD workflows, issue templates
```

See [Architecture Document](docs/architecture.md) for detailed source tree and component design.

## Documentation

- [Project Brief](docs/brief.md) - Vision, problem statement, target users
- [Product Requirements (PRD)](docs/prd.md) - Functional/non-functional requirements, epics, stories
- [Architecture](docs/architecture.md) - Tech stack, data models, components, workflows
- [Brainstorming Results](docs/brainstorming-session-results.md) - Feature discovery and competitive analysis

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by various AD administration tools and the needs of IT support teams
- Built with [CommunityToolkit.Mvvm](https://github.com/CommunityToolkit/dotnet), [Serilog](https://serilog.net/), [QuestPDF](https://www.questpdf.com/)
