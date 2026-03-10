# Coding Standards

### Core Standards

- **Language**: C# 13, .NET 10.0
- **Style & Linting**: .editorconfig with .NET default rules, `dotnet format` for enforcement
- **Test Organization**: Mirror source tree (src/DSPanel/Services/Foo.cs -> src/DSPanel.Tests/Services/FooTests.cs)

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Interfaces | I-prefix | `IDirectoryProvider` |
| Async methods | Async suffix | `SearchUsersAsync` |
| Private fields | _camelCase | `_permissionService` |
| Constants | PascalCase | `MaxRetryCount` |
| XAML resources | PascalCase keys | `PrimaryButtonStyle` |

### Critical Rules

- **No blocking calls on UI thread**: All AD/network operations must use async/await. Never use .Result or .Wait() on the UI thread.
- **Always use IDirectoryProvider**: Never instantiate LdapConnection or GraphServiceClient directly in ViewModels or Services. Always go through the provider abstraction.
- **Permission check before action**: Every write operation must call HasPermission() before executing. Never rely solely on UI visibility for security.
- **Snapshot before modify**: Every write operation on AD objects must call SnapshotService.CaptureAsync() before the modification.
- **Audit every write**: Every successful or failed write operation must be logged via AuditService.LogAsync().
- **No secrets in code or logs**: Never log passwords, tokens, or credentials. Never hardcode connection strings or API keys.
- **Dispose LDAP connections**: LdapConnection must be properly disposed. Use `using` statements or connection pooling.
- **Null-check AD attributes**: AD attributes may be null or missing. Always handle null when reading from SearchResultEntry.

### C# Specifics

- **Nullable reference types**: Enabled project-wide. No suppression operators (!.) unless justified with comment.
- **Primary constructors**: Use for DI injection in services and ViewModels.
- **Collection expressions**: Prefer `[]` over `new List<T>()` for initialization.
- **File-scoped namespaces**: Use `namespace DSPanel.Services;` (not block-scoped).
- **Records**: Use for immutable data transfer objects (DTOs, report results).

---
