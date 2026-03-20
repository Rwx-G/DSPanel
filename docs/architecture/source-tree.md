# Source Tree

```
DSPanel/
  .github/
    workflows/
      ci.yml                           # CI: cargo test + pnpm test + clippy + eslint on push/PR
      release.yml                      # CD: cargo tauri build on tag -> .msi/.dmg/.AppImage
    ISSUE_TEMPLATE/
      bug_report.md
      feature_request.md
  docs/
    brainstorming-session-results.md
    brief.md
    prd.md
    architecture.md                    # Monolithic architecture document
    architecture/                      # Sharded architecture docs
    stories/                           # User stories for development
  src/                                 # React/TypeScript frontend
    main.tsx                           # React entry point
    App.tsx                            # Root component with router
    App.css                            # Global styles
    vite-env.d.ts                      # Vite type declarations
    assets/                            # Static assets (images, icons)
    components/                        # Reusable React components
      common/
        SearchBar.tsx
        HealthBadge.tsx
        PermissionGate.tsx
        DiffViewer.tsx
        LoadingSpinner.tsx
        Pagination.tsx
        StatusBadge.tsx
        Avatar.tsx
        CopyButton.tsx
        EmptyState.tsx
      layout/
        AppShell.tsx                   # Main layout (sidebar + content)
        Sidebar.tsx
        TopBar.tsx
      dialogs/
        ConfirmationDialog.tsx
        PasswordResetDialog.tsx
        PresetEditorDialog.tsx
        DryRunPreviewDialog.tsx
    pages/                             # Page-level components (routes)
      UserLookupPage.tsx
      ComputerLookupPage.tsx
      ComparisonPage.tsx
      GroupManagementPage.tsx
      PresetManagementPage.tsx
      OnboardingWizardPage.tsx
      OffboardingPage.tsx
      InfrastructureHealthPage.tsx
      SecurityDashboardPage.tsx
      ReportsPage.tsx
      AuditLogPage.tsx
      SettingsPage.tsx
    hooks/                             # Custom React hooks
      usePermission.ts
      useDirectory.ts
      useDebounce.ts
      useNavigation.ts
      useTheme.ts
    contexts/                          # React context providers
      PermissionContext.tsx
      ThemeContext.tsx
      NotificationContext.tsx
    types/                             # TypeScript type definitions
      directory.ts                     # DirectoryUser, DirectoryComputer, etc.
      audit.ts                         # AuditLogEntry, etc.
      preset.ts                        # Preset, PresetDiff, etc.
      health.ts                        # AccountHealthStatus, etc.
      permissions.ts                   # PermissionLevel enum
    lib/                               # Utility functions
      tauri-commands.ts                # Typed wrappers around invoke()
      formatters.ts                    # Date, DN, and display formatters
      validators.ts                    # Client-side validation helpers
    styles/                            # CSS / Tailwind configuration
      tailwind.css                     # Tailwind directives
      themes/
        light.css
        dark.css
  src-tauri/                           # Rust backend (Tauri)
    Cargo.toml                         # Rust dependencies
    tauri.conf.json                    # Tauri configuration (permissions, CSP, window)
    capabilities/                      # Tauri v2 capability files
      default.json
    src/
      main.rs                          # Tauri app entry point
      lib.rs                           # Module declarations
      commands/                        # Tauri command handlers (IPC entry points)
        mod.rs
        user_commands.rs
        computer_commands.rs
        group_commands.rs
        preset_commands.rs
        audit_commands.rs
        health_commands.rs
        security_commands.rs
        settings_commands.rs
        password_commands.rs
      services/                        # Business logic modules
        mod.rs
        directory/
          mod.rs
          traits.rs                    # DirectoryProvider trait definition
          ldap_provider.rs             # ldap3-based implementation
          graph_provider.rs            # reqwest-based Graph API implementation
        exchange/
          mod.rs
        permission/
          mod.rs
          level.rs                     # PermissionLevel enum
        preset/
          mod.rs
          validator.rs
        audit/
          mod.rs
        snapshot/
          mod.rs
        health/
          mod.rs
        security/
          mod.rs
          risk_calculator.rs
          attack_detector.rs
        report/
          mod.rs
        export/
          mod.rs
          csv_export.rs
          pdf_export.rs
        notification/
          mod.rs
          webhook.rs
        password/
          mod.rs
          generator.rs
          hibp_client.rs
        update/
          mod.rs
      models/                          # Rust data structs (serde)
        mod.rs
        directory_user.rs
        directory_computer.rs
        directory_group.rs
        exchange_mailbox.rs
        health_status.rs
        preset.rs
        audit_entry.rs
        snapshot.rs
        automation_rule.rs
        risk_report.rs
        security_alert.rs
      db/                              # SQLite database access (rusqlite)
        mod.rs
        migrations.rs
        audit_repo.rs
        snapshot_repo.rs
        settings_repo.rs
      error.rs                         # Error types (thiserror)
      state.rs                         # Tauri managed state definitions
    tests/                             # Rust integration tests
      directory_tests.rs
      permission_tests.rs
      preset_tests.rs
      health_tests.rs
      audit_tests.rs
  public/                              # Static files served by Vite
    favicon.svg
  index.html                           # Vite HTML entry point
  package.json                         # JS dependencies
  pnpm-lock.yaml                       # Lockfile
  tsconfig.json                        # TypeScript config
  tsconfig.node.json                   # TypeScript config for Vite/Node
  vite.config.ts                       # Vite configuration
  tailwind.config.ts                   # Tailwind CSS configuration
  .eslintrc.cjs                        # ESLint configuration
  .prettierrc                          # Prettier configuration
  .gitignore
  .editorconfig
  CHANGELOG.md
  LICENSE
  README.md
```

### Test File Organization

**Rust tests**: Unit tests are colocated in the same file as the source code using `#[cfg(test)] mod tests {}`. Integration tests live in `src-tauri/tests/`.

**Frontend tests**: Test files are colocated with components using the `*.test.tsx` / `*.test.ts` convention:

- `src/components/common/SearchBar.tsx` -> `src/components/common/SearchBar.test.tsx`
- `src/hooks/usePermission.ts` -> `src/hooks/usePermission.test.ts`
- `src/lib/formatters.ts` -> `src/lib/formatters.test.ts`

---
