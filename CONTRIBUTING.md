# Contributing to DSPanel

Thank you for your interest in contributing to DSPanel! This document provides guidelines and information for contributors.

## How to Contribute

### Reporting Issues

- Use the [GitHub Issues](https://github.com/Rwx-G/DSPanel/issues) page
- Check existing issues before creating a new one
- Use the provided issue templates (bug report, feature request)
- Include as much detail as possible: steps to reproduce, expected behavior, screenshots

### Suggesting Features

- Open a feature request issue
- Describe the use case and expected behavior
- Reference the [PRD](docs/prd.md) if the feature aligns with existing plans

### Submitting Code

1. **Fork** the repository
2. **Create a branch** from `main`: `feat/<feature-name>` or `fix/<bug-name>`
3. **Develop** following the coding standards below
4. **Test** your changes
5. **Submit a Pull Request** targeting `main`

## Development Setup

### Prerequisites

- .NET 10.0 SDK
- Windows 10/11 with WPF support
- An Active Directory test environment (for integration testing)

### Build and Test

```bash
dotnet restore
dotnet build
dotnet test
```

## Coding Standards

### Conventions

- **Language**: C# 12 with nullable reference types enabled
- **Style**: Follow `.editorconfig` rules, run `dotnet format` before committing
- **Namespaces**: File-scoped (`namespace DSPanel.Services;`)
- **Private fields**: `_camelCase` prefix
- **Async methods**: `Async` suffix
- **Interfaces**: `I` prefix

### Architecture Rules

- All AD operations go through `IDirectoryProvider` - never instantiate LDAP/Graph clients directly
- Every write operation must check permissions via `IPermissionService.HasPermission()`
- Every write operation must create a snapshot via `ISnapshotService.CaptureAsync()`
- Every write operation must be logged via `IAuditService.LogAsync()`
- No blocking calls on the UI thread - use `async/await` for all I/O

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

**Types**: `feat`, `fix`, `docs`, `refactor`, `test`, `ci`, `chore`

**Examples**:
- `feat(lookup): add user account search with healthcheck badge`
- `fix(groups): handle circular group nesting detection`
- `docs(architecture): update source tree after refactor`

### Tests

- Mirror the source tree: `src/DSPanel/Services/Foo.cs` -> `src/DSPanel.Tests/Services/FooTests.cs`
- Use xUnit + Moq + FluentAssertions
- Follow AAA pattern (Arrange, Act, Assert)
- Target 90%+ coverage on core services

## Pull Request Process

1. Ensure all tests pass
2. Update documentation if behavior changes
3. Update `CHANGELOG.md` under `[Unreleased]` if applicable
4. Request a review
5. Squash commits if needed for a clean history

## Code of Conduct

Be respectful and constructive. We are all here to build a useful tool for the IT community.

## Questions?

Open a [Discussion](https://github.com/Rwx-G/DSPanel/discussions) on GitHub.
