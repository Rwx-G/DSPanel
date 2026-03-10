# Test Strategy and Standards

### Testing Philosophy

- **Approach**: Test-after for initial development, test-driven for bug fixes
- **Coverage Goals**: 90%+ on core services, best-effort on ViewModels
- **Test Pyramid**: Heavy unit tests, selective integration tests, manual UI tests

### Test Types and Organization

#### Unit Tests

- **Framework**: xUnit 2.9.x
- **File Convention**: `{ClassName}Tests.cs` in mirrored directory
- **Location**: `src/DSPanel.Tests/`
- **Mocking Library**: Moq 4.20.x
- **Coverage Requirement**: 90%+ on Services/, best-effort on ViewModels/

**AI Agent Requirements:**
- Generate tests for all public methods
- Cover edge cases and error conditions
- Follow AAA pattern (Arrange, Act, Assert)
- Mock all external dependencies (IDirectoryProvider, file system, network)
- Use FluentAssertions for readable assertions

#### Integration Tests

- **Scope**: Optional - for developers with access to an AD test domain
- **Location**: `src/DSPanel.Tests/Integration/`
- **Test Infrastructure**:
    - **LDAP**: Real AD test domain (not mocked) - run only locally, excluded from CI
    - **SQLite**: In-memory SQLite for audit/snapshot repository tests

#### End-to-End Tests

- **Framework**: Manual testing
- **Scope**: Full user workflows (lookup, reset, onboarding, bulk ops)
- **Environment**: Developer machine connected to AD test domain

### Test Data Management

- **Strategy**: Builder pattern for test data
- **Fixtures**: TestDataBuilder class creates DirectoryUser, DirectoryGroup, Preset instances
- **Factories**: MockDirectoryProvider returns configurable test data
- **Cleanup**: In-memory SQLite databases auto-dispose after each test

### Continuous Testing

- **CI Integration**: GitHub Actions runs `dotnet test` on every push/PR (unit tests only)
- **Performance Tests**: Manual benchmarking for LDAP query performance on large domains
- **Security Tests**: Manual review of permission gating and input validation

---
