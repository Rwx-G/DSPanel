# Test Strategy and Standards

### Testing Philosophy

- **Approach**: Test-after for initial development, test-driven for bug fixes
- **Coverage Goals**: 90%+ on Rust services, best-effort on React components
- **Test Pyramid**: Heavy unit tests, selective integration tests, manual UI tests

### Test Types and Organization

#### Rust Unit Tests

- **Framework**: cargo test (built-in)
- **File Convention**: `#[cfg(test)] mod tests {}` at bottom of each source file
- **Location**: Inline in `src-tauri/src/`
- **Mocking**: Mock implementations of traits (no external mocking framework needed)
- **Coverage Requirement**: 90%+ on services/, best-effort on commands/

**AI Agent Requirements:**

- Test all public functions
- Cover edge cases and error conditions
- Follow arrange/act/assert pattern
- Use mock trait implementations for external dependencies (DirectoryProvider, file system, network)
- Test error paths (Result::Err) as well as happy paths

#### Frontend Unit Tests

- **Framework**: vitest
- **Component Testing**: React Testing Library
- **File Convention**: `ComponentName.test.tsx` colocated with component
- **Location**: Alongside source files in `src/`
- **Coverage Requirement**: Best-effort on pages, good coverage on hooks and utility functions

**AI Agent Requirements:**

- Test custom hooks with `renderHook()`
- Test components with user-centric queries (`getByRole`, `getByText`)
- Mock Tauri `invoke()` calls in tests
- Test loading, success, and error states

#### Integration Tests

- **Scope**: Optional - for developers with access to an AD test domain
- **Rust Location**: `src-tauri/tests/`
- **Test Infrastructure**:
    - **LDAP**: Real AD test domain (not mocked) - run only locally, excluded from CI
    - **SQLite**: In-memory SQLite for audit/snapshot repository tests

#### End-to-End Tests

- **Framework**: Manual testing (Tauri WebDriver support available for future automation)
- **Scope**: Full user workflows (lookup, reset, onboarding, bulk ops)
- **Environment**: Developer machine connected to AD test domain

### Test Data Management

- **Strategy**: Builder pattern for test data (Rust) + fixture factories (TypeScript)
- **Rust Fixtures**: Builder functions create DirectoryUser, DirectoryGroup, Preset instances
- **TS Fixtures**: Factory functions return typed mock data
- **Cleanup**: In-memory SQLite databases dropped after each test

### Continuous Testing

- **CI Integration**: GitHub Actions runs `cargo test` and `pnpm test` on every push/PR
- **Rust Linting**: `cargo clippy -- -D warnings` in CI
- **Frontend Linting**: `pnpm lint` (ESLint) in CI
- **Performance Tests**: Manual benchmarking for LDAP query performance on large domains
- **Security Tests**: Manual review of permission gating and input validation

---
