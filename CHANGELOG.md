# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-03-13

Epic 1 - Foundation and Core Lookup. Full rewrite from C#/WPF to Rust/Tauri v2 + React/TypeScript.
Cross-platform (Windows, macOS, Linux), lightweight native binary (~8.5 MB).

### Added

- Project skeleton: Tauri v2 + React/TS, tracing logging, panic hook (1.1)
- DirectoryProvider trait with LDAP implementation, Kerberos auth (1.2)
- Permission detection from AD groups: ReadOnly/HelpDesk/AccountOperator/DomainAdmin (1.3)
- Theme system with design tokens, dark/light modes, CSS architecture (1.4)
- Application shell: sidebar, tab bar (drag, context menu, scroll), breadcrumbs, status bar, keyboard shortcuts (1.5)
- Common controls: SearchBar, PermissionGate, StatusBadge, Avatar, TagChip, LoadingSpinner, EmptyState, InfoCard, CopyButton (1.6)
- Data display: DataTable, FilterBar, Pagination, PropertyGrid, TreeView, DiffViewer, VirtualizedList, CSV export (1.7)
- Form controls: FormField, TextInput, PasswordInput, ComboBox, OUPicker, GroupPicker, DateTimePicker, ValidationSummary, useFormValidation, useChangeTracker (1.8)
- Dialogs and notifications: ConfirmationDialog, DryRunPreviewDialog, ProgressDialog, DialogContext, NotificationContext, InlineProgress (1.9)
- User account lookup: search, detail panel, group memberships, DN parsing (1.10)
- Healthcheck badge: 9 account flags with severity levels, Rust backend evaluate_health (1.11)
- Computer account lookup: search, detail, ping, DNS resolution (1.12)
- Error handling: DirectoryError, retry with backoff, circuit breaker, ResilientDirectoryProvider, ErrorBoundary, useErrorHandler (1.13)
- ARIA accessibility across all components
- All documentation migrated to Rust/Tauri v2 stack (~45 files)
- CI workflows for cargo/pnpm/tauri
- 840 tests (632 frontend + 208 Rust), 78% Rust line coverage

### Removed

- All C#/WPF source code (tagged as `v0.1.0-csharp` for reference)

## [0.1.0-csharp] - 2026-03-11 (archived, see tag `v0.1.0-csharp`)

### Added

- Epic 1 implementation: Foundation and Core Lookup (Stories 1.1-1.12)
- Project skeleton with GenericHost DI, Serilog logging, MVVM architecture (1.1)
- IDirectoryProvider abstraction with LDAP implementation and Kerberos auth (1.2)
- Permission level detection from AD group memberships (ReadOnly/HelpDesk/AccountOperator/DomainAdmin) (1.3)
- Theme system with 31 design tokens, dark/light modes, runtime switching (1.4)
- Application shell with collapsible sidebar, tab navigation with context menu (close-all/close-others), middle-click to close tab, breadcrumb bar, keyboard shortcuts (Ctrl+W/Tab/Shift+Tab/B/1-9), window state persistence, responsive auto-collapse (1.5)
- Reusable UI controls: SearchBar, PermissionGate, StatusBadge, Avatar (initials fallback, deterministic color), TagChip (removable), LoadingSpinner, EmptyState, InfoCard (collapsible, icon) (1.6)
- Data display components: FilterBar, Pagination, DiffViewer, TreeView styling, DataGrid styling, CsvExportService, CopyButton, PropertyGrid (1.7)
- Form controls: FormField, PasswordInput with show/hide toggle, searchable ComboBox, OUPicker (TreeView), GroupPicker (debounced multi-select with chips), DateTimePicker (calendar + spinners), ValidationSummary, dirty tracking via IChangeTracker (1.8)
- Custom validation attributes: ValidSamAccountName, ValidDistinguishedName (1.8)
- Dialog service with styled ConfirmationDialog, ProgressDialog (determinate/indeterminate, cancellation, completion state), InlineProgress control (1.9)
- Toast notification system with auto-dismiss, countdown bar animation, 4 severity levels (1.9)
- User lookup with debounced search, property grid detail, group membership list (1.10)
- Health check badge evaluating 9 account flags with severity levels (1.11)
- Computer lookup with search, detail view, and ping/DNS commands (1.12)
- Application settings service (IAppSettingsService) with JSON persistence in LocalAppData
- Diff-specific theme brushes (BrushDiffAdded/Removed/AddedText/RemovedText) for light and dark modes
- LdapFilterHelper with RFC 4515 escaping and input validation (defense-in-depth against LDAP injection)
- XamlBindingValidator for static XAML binding verification against ViewModels via reflection
- Stryker.NET mutation testing setup (tool + config ready, blocked by Buildalyzer/WPF/.NET 10 upstream)
- 668 unit tests covering all services, ViewModels, controls, security, and XAML bindings (99.7% line coverage)

### Changed

- GitHub Actions CI enhanced: format check, Coverlet/Cobertura coverage, vulnerability check, self-contained publish (128 MB exe)
- User and Computer lookup ViewModels hardened with LdapFilterHelper input validation

## [0.0.2] - 2026-03-10

### Added

- 60 BMAD story files covering all 12 epics (`docs/stories/`)
- Epic 1 Base UI foundation stories (1.4-1.9): theme system, application shell, common controls, data display components, form controls and validation, dialogs and notifications
- Story template follows BMAD v2 format with Dev Notes, Tasks/Subtasks, and Testing sections

### Changed

- Epic 1 expanded from 6 to 12 stories to include comprehensive Base UI foundations
- Epic list updated with story counts and summary table

## [0.0.1] - 2026-03-07

### Added

- Project documentation: brainstorming results, project brief, PRD, architecture
- Repository initialization with GitHub best practices
