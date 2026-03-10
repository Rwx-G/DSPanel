# Technical Assumptions

### Repository Structure: Monorepo

Single repository containing the WPF application project, test project, and documentation. Structure:

```
DSPanel/
  docs/                    # PRD, architecture, stories, brainstorming
  src/
    DSPanel/               # Main WPF application
    DSPanel.Tests/          # xUnit test project
  .github/                 # CI/CD workflows
  DSPanel.sln              # Solution file
```

### Service Architecture

Desktop monolith with internal modular architecture:

- **Presentation layer**: WPF Views + ViewModels (MVVM via CommunityToolkit.Mvvm)
- **Service layer**: business logic services injected via Microsoft.Extensions.DependencyInjection
- **Provider layer**: IDirectoryProvider abstraction with LdapDirectoryProvider (on-prem) and GraphDirectoryProvider (Entra ID) implementations
- **Data layer**: no local database - all data comes from AD/Graph/NTFS at query time. Presets stored as JSON/YAML on network share. Audit log stored locally (SQLite or structured log file).

### Testing Requirements

- **Unit tests**: xUnit + Moq for all core services (directory providers, permission service, preset engine, risk scoring)
- **Integration tests**: against a test AD environment (optional, not required for CI)
- **UI tests**: manual testing for WPF views (automated UI testing deferred)
- **Target coverage**: 90%+ on core services
- **Test convention**: mirror source tree (src/DSPanel/Services/Foo.cs -> src/DSPanel.Tests/Services/FooTests.cs)

### Additional Technical Assumptions and Requests

- **LDAP library**: System.DirectoryServices.Protocols for AD on-prem queries (lightweight, cross-platform capable within .NET)
- **Graph SDK**: Microsoft.Graph SDK for Entra ID and Exchange Online queries
- **MVVM toolkit**: CommunityToolkit.Mvvm 8.x for ObservableObject, RelayCommand, source generators
- **DI container**: Microsoft.Extensions.DependencyInjection + Microsoft.Extensions.Hosting for app lifecycle
- **Logging**: Serilog with console + file sinks, structured logging
- **Preset format**: JSON as default format (widely supported, schema-validatable), YAML as optional alternative
- **Password check**: HaveIBeenPwned API (k-anonymity model - only first 5 chars of SHA1 hash sent)
- **NTFS permissions**: System.Security.AccessControl + System.IO for ACL resolution on UNC paths
- **Remote monitoring**: WMI/CIM (System.Management) for remote workstation CPU/RAM/services
- **Event logs**: Windows Event Log API for login/logout and lockout event retrieval
- **Auto-update**: check GitHub Releases API at startup, notify user if newer version available
- **Localization**: .resx resource files, English default, French planned for V2

---
