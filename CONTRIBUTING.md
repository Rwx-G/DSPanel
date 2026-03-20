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

- Rust (stable toolchain) - install via [rustup](https://rustup.rs/)
- Node.js 20+
- pnpm (`npm install -g pnpm`)
- Platform-specific Tauri dependencies:
    - **Linux**: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev`
    - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
    - **Windows**: Microsoft Visual Studio C++ Build Tools, WebView2

### Build and Test

```bash
# Install frontend dependencies
pnpm install

# Run in development mode (hot-reload)
cargo tauri dev

# Run Rust tests
cargo test

# Run frontend tests
pnpm test

# Check Rust formatting
cargo fmt --check

# Run Rust linter
cargo clippy

# Run frontend linter
pnpm lint

# Build release binary
cargo tauri build
```

## Coding Standards

### Rust Conventions

- **Edition**: Rust 2021
- **Formatting**: Run `cargo fmt` before committing
- **Linting**: `cargo clippy` must pass with no warnings
- **Error handling**: Use `thiserror` for library errors, `anyhow` for application errors
- **Naming**: snake_case for functions/variables, PascalCase for types, SCREAMING_SNAKE_CASE for constants

### TypeScript/React Conventions

- **Style**: Follow ESLint + Prettier rules (configured in the project)
- **Components**: Functional components with hooks
- **State management**: React state + Tauri IPC commands
- **Naming**: camelCase for variables/functions, PascalCase for components and types

### Architecture Rules

- All AD operations go through the Rust backend via Tauri commands - never call LDAP directly from the frontend
- Every write operation must check permissions before execution
- Every write operation must create a snapshot for rollback
- Every write operation must be logged for audit
- Keep the frontend responsive - use async Tauri commands for all I/O

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

- **Rust**: Place unit tests in `#[cfg(test)] mod tests` blocks within each module; integration tests go in `src-tauri/tests/`
- **Frontend**: Place tests alongside components as `*.test.tsx` files; use Vitest + React Testing Library
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
