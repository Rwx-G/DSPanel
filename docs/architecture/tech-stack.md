# Tech Stack

### Cloud Infrastructure

- **Provider**: N/A - Desktop application, no cloud hosting required
- **Key Services**: Azure AD App Registration (for Microsoft Graph access to Entra ID / Exchange Online)
- **Deployment**: GitHub Releases (MSIX + portable exe)

### Technology Stack Table

| Category | Technology | Version | Purpose | Rationale |
|----------|-----------|---------|---------|-----------|
| **Language** | C# | 13 | Primary development language | Modern C# features (primary constructors, collection expressions, params collections), strong typing, WPF native |
| **Runtime** | .NET | 10.0 (LTS) | Application runtime | Long-term support (Nov 2025 - Nov 2028), Windows desktop support, latest APIs |
| **UI Framework** | WPF | .NET 10 built-in | Desktop UI | Windows-native, rich controls, data binding, MVVM support |
| **MVVM Toolkit** | CommunityToolkit.Mvvm | 8.4.0 | MVVM infrastructure | Source generators, ObservableObject, RelayCommand, Messenger |
| **DI Container** | Microsoft.Extensions.DependencyInjection | 10.0.3 | Dependency injection | Standard .NET DI, lightweight, well-integrated |
| **App Hosting** | Microsoft.Extensions.Hosting | 10.0.3 | Application lifecycle | Startup/shutdown, configuration, logging integration |
| **LDAP** | System.DirectoryServices.Protocols | 10.0.3 | AD on-prem queries | Low-level LDAP control, pagination support, performant |
| **Graph SDK** | Microsoft.Graph | 5.x | Entra ID + Exchange Online | Official Microsoft SDK, typed models, batch support |
| **Graph Auth** | Azure.Identity | 1.13.x | Graph authentication | MSAL integration, device code flow, token caching |
| **Logging** | Serilog | 4.3.1 | Structured logging | Structured output, multiple sinks, enrichers |
| **Logging Sink** | Serilog.Sinks.File | 7.0.0 | File logging | Rolling files, size limits |
| **Logging Sink** | Serilog.Sinks.Console | 6.1.1 | Console logging (debug) | Development diagnostics |
| **Local DB** | Microsoft.Data.Sqlite | 10.0.3 | Audit log + snapshots storage | Lightweight, embedded, no server needed |
| **ORM** | Dapper | 2.1.72 | SQLite data access | Lightweight, fast, minimal abstraction |
| **JSON** | System.Text.Json | Built-in | Preset serialization, settings | Built-in, performant, source generators |
| **PDF Export** | QuestPDF | 2026.2.3 | PDF report generation | Open source (MIT), fluent API, no external dependencies |
| **CSV Export** | CsvHelper | 33.1.0 | CSV export | Robust, handles edge cases (encoding, escaping) |
| **Password Hash** | System.Security.Cryptography | Built-in | SHA1 for HIBP k-anonymity | Built-in, no external dependency needed |
| **HTTP Client** | System.Net.Http | Built-in | HIBP API, GitHub API, webhooks | Built-in HttpClient with IHttpClientFactory pattern |
| **WMI/CIM** | System.Management | 10.0.3 | Remote workstation monitoring | WMI queries for CPU, RAM, services, disks |
| **ACL** | System.Security.AccessControl | Built-in | NTFS permission analysis | Built-in ACL resolution |
| **Testing** | xUnit | 2.9.3 | Unit + integration tests | Modern, extensible, good .NET integration |
| **Mocking** | Moq | 4.20.72 | Test mocking | Interface mocking, setup verification |
| **Test Assertions** | FluentAssertions | 8.8.0 | Readable test assertions | Expressive syntax, better error messages |
| **Code Analysis** | .NET Analyzers | Built-in | Static code analysis | Built-in, catches common issues |

---
