# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Application shell with collapsible sidebar, tab bar, breadcrumbs, and status bar (Story 1.5)
- NavigationContext with tab management: open, close, closeAll, activate, move, deduplication by moduleId
- Keyboard shortcuts: Ctrl+B (toggle sidebar), Ctrl+W (close tab), Ctrl+Tab/Shift+Tab (cycle tabs), Ctrl+1-9 (jump to tab)
- Auto-collapse sidebar at narrow window widths (<900px) with localStorage persistence of user preference
- TabBar overflow scroll buttons (left/right chevrons) when tabs exceed available width
- Tab context menu with Close, Close Others, Close All options (right-click)
- StatusBar with connection indicator, domain info, permission badge, and app version
- Common reusable controls: SearchBar (debounced), PermissionGate, StatusBadge, Avatar, TagChip, LoadingSpinner, EmptyState, InfoCard, CopyButton (Story 1.6)
- useDebounce hook and avatar utility functions (getInitials, getAvatarColor)
- Data display components: DataTable (sortable, frozen columns, column resize), FilterBar, Pagination, PropertyGrid, TreeView, DiffViewer (synchronized scroll), VirtualizedList (Story 1.7)
- CSV export utility with field escaping (csvExport.ts)
- Diff color tokens for light and dark themes
- Form controls: FormField, TextInput, PasswordInput (show/hide), ComboBox (searchable), OUPicker (TreeView), GroupPicker (search + multi-select), DateTimePicker (calendar + time), ValidationSummary (Story 1.8)
- useFormValidation hook with field-level and form-level validation
- useChangeTracker hook with dirty detection and beforeunload guard
- Validators: isValidSamAccountName, isValidDistinguishedName, isRequired, isMinLength, isMaxLength
- Dialog system: ConfirmationDialog (severity icons, expandable detail, keyboard Enter/Escape), DryRunPreviewDialog (scrollable change list), ProgressDialog (determinate/indeterminate with cancel) (Story 1.9)
- DialogContext with Promise-based useDialog hook: showConfirmation, showWarning, showError, showDryRunPreview, showCustomDialog
- Toast notification system: NotificationContext with auto-dismiss, severity levels, action buttons, NotificationHost (Story 1.9)
- InlineProgress compact progress bar for embedding in toolbars
- User account lookup page with search, results list, detail panel (PropertyGrid), and group memberships DataTable (Story 1.10)
- Tauri commands: search_users and get_user delegating to DirectoryProvider
- DirectoryUser type with mapEntryToUser mapping from DirectoryEntry attributes
- DN parsing utilities: parseOuBreadcrumb, parseCnFromDn, formatOuPath
- Healthcheck badge with 9 account flags: Disabled, Locked, Expired, PasswordExpired, PasswordNeverExpires, Inactive30/90Days, NeverLoggedOn, PasswordNeverChanged (Story 1.11)
- evaluateHealth() pure function with injectable clock for deterministic testing
- HealthBadge component with severity colors, icons, hover tooltip, and keyboard accessibility (focus/blur)
- User detail view now displays SAM Account Name and User Principal Name fields
- Computer account lookup page with search, results list, detail panel, group memberships DataTable (Story 1.12)
- Tauri commands: search_computers, ping_host (system ping), resolve_dns (tokio lookup_host)
- DirectoryComputer type with mapEntryToComputer mapping
- ComputerLookup detail: Identity, Status, Location, Network sections with ping button, DNS auto-resolution with cache and timeout indicator
- DirectoryError enum with LDAP error code classification (transient vs permanent) and user-friendly messages (Story 1.13)
- Exponential backoff retry policy with injectable delay function for deterministic testing
- Circuit breaker (Closed/Open/HalfOpen) with configurable threshold and recovery timeout
- ResilientDirectoryProvider decorator wrapping DirectoryProvider with retry + circuit breaker
- TimeoutConfig centralizing timeouts: LDAP 30s, Graph API 15s, HIBP 5s, WMI 10s
- React ErrorBoundary with fallback UI and retry, global unhandled rejection handler
- Backend error mapping: parseBackendError, mapErrorToNotification, useErrorHandler hook
- Rust panic hook logging panics via tracing before default handler
- Rust health check service: evaluate_health() with 9 account flags, exposed via evaluate_health_cmd Tauri command
- Rust tests for ping_host and resolve_dns commands
- Snapshot visual tests for all 9 common controls (Story 1.6 AC11)
- Comprehensive ARIA accessibility attributes across all components (26 issues resolved)
- 595 frontend tests + 172 Rust tests = 767 total tests

### Changed

- ping_host command migrated from std::process::Command to tokio::process::Command for non-blocking async execution
- resolve_dns command now has a 5-second timeout to prevent indefinite hanging
- Health check evaluation moved from TypeScript pure function to Rust backend service with Tauri command
- Redesigned UI with professional design tokens: Inter + JetBrains Mono fonts, slate-based color palette, improved shadows and radii
- Sidebar: icon-only collapsed mode with hover tooltips, active indicator bar, DSPanel branding, theme toggle (Sun/Moon)
- StatusBar: animated ping connection indicator, ring-inset permission badge with color-mix, vertical separators
- TabBar: bottom-bar active indicator instead of border
- Breadcrumbs: hover backgrounds, refined height
- Home screen: Shield icon, QuickAction cards grid, professional welcome layout
- Dark theme: no pure black backgrounds (slate-900 base), improved contrast ratios
- All documentation (~45 files) migrated from C#/WPF/.NET references to Rust/Tauri v2 + React/TypeScript
- Architecture docs rewritten: tech stack, source tree, components, coding standards, error handling, test strategy, deployment
- All 12 Epic 1 stories rewritten with Rust/TypeScript acceptance criteria, tasks, and code examples
- All 49 Epic 2-12 stories updated with new stack references
- PRD updated: requirements, technical assumptions, repo structure, service architecture, testing stack
- CI workflows rewritten for cargo/pnpm/tauri (build.yml + release.yml)
- CONTRIBUTING.md rewritten for Rust + Node.js development workflow
- PR template updated for cargo/pnpm commands
- Story 2.0 (Error Handling Foundation) moved to Story 1.13 under Epic 1

## [0.2.0] - 2026-03-13

### Changed

- Full migration from C#/WPF (.NET 10) to Rust/Tauri v2 + React/TypeScript
- Cross-platform support: Windows, macOS, Linux (previously Windows-only)
- Lightweight native binary (~8.5 MB) instead of .NET runtime dependency

### Removed

- All C#/WPF source code (tagged as `v0.1.0-csharp` for reference)

## [0.1.0] - 2026-03-11

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
