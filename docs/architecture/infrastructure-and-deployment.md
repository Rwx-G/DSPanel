# Infrastructure and Deployment

### Infrastructure as Code

- **Tool**: N/A - Desktop application, no cloud infrastructure to provision
- **CI/CD only**: GitHub Actions for build, test, and release packaging

### Deployment Strategy

- **Strategy**: GitHub Releases with manual trigger on version tags
- **CI/CD Platform**: GitHub Actions
- **Pipeline Configuration**: `.github/workflows/`
- **Artifacts**: MSIX package (signed) + portable exe (zip)

### Environments

- **Development**: Local developer machine with AD test domain
- **CI**: GitHub Actions runner (Windows) - build + unit tests only
- **Release**: GitHub Releases - tagged builds produce downloadable artifacts

### Environment Promotion Flow

```
feature branch --> PR --> main (CI: build + test)
                                  |
                          tag vX.Y.Z --> Release workflow
                                  |
                          GitHub Release (MSIX + portable zip)
```

### Rollback Strategy

- **Primary Method**: Users download previous version from GitHub Releases
- **Trigger Conditions**: Critical bug in released version
- **Recovery Time Objective**: Immediate (previous versions always available on GitHub)

---
