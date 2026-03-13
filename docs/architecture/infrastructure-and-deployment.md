# Infrastructure and Deployment

### Infrastructure as Code

- **Tool**: N/A - Desktop application, no cloud infrastructure to provision
- **CI/CD only**: GitHub Actions for build, test, and release packaging

### Deployment Strategy

- **Strategy**: GitHub Releases with manual trigger on version tags
- **CI/CD Platform**: GitHub Actions
- **Pipeline Configuration**: `.github/workflows/`
- **Build Command**: `cargo tauri build`
- **Artifacts**:
    - **Windows**: .msi installer (signed)
    - **macOS**: .dmg disk image
    - **Linux**: .AppImage (portable) + .deb (Debian/Ubuntu)

### Build Pipeline

```yaml
# Simplified CI workflow
# Triggers: push to main, pull requests
steps:
  - cargo fmt --check          # Rust formatting
  - cargo clippy -- -D warnings # Rust linting
  - cargo test                  # Rust unit tests
  - pnpm install                # Frontend dependencies
  - pnpm lint                   # ESLint
  - pnpm test                   # vitest
  - cargo tauri build           # (release only) Full app build
```

### Environments

- **Development**: Local developer machine with AD test domain, `cargo tauri dev` for hot-reload (Vite HMR for frontend, Rust recompile for backend)
- **CI**: GitHub Actions runner (Linux/Windows/macOS matrix) - build + unit tests only
- **Release**: GitHub Releases - tagged builds produce downloadable platform artifacts

### Environment Promotion Flow

```
feature branch --> PR --> main (CI: cargo test + pnpm test + clippy + eslint)
                                  |
                          tag vX.Y.Z --> Release workflow (matrix: win/mac/linux)
                                  |
                          GitHub Release (.msi + .dmg + .AppImage + .deb)
```

### Rollback Strategy

- **Primary Method**: Users download previous version from GitHub Releases
- **Trigger Conditions**: Critical bug in released version
- **Recovery Time Objective**: Immediate (previous versions always available on GitHub)

---
