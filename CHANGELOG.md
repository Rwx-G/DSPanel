# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] - 2026-03-21

Epic 7 - Administration and Object Management. Administrative tools for
DomainAdmin/AccountOperator users: moving objects between OUs, AD Recycle Bin
access, contact and printer management, user photos, and object backup/restore.

### Added

#### Move Objects Between OUs (7.1)
- "Move to OU" context menu on users, computers, groups, contacts, and printers (AccountOperator+)
- MoveObjectDialog with OU picker, dry-run preview, and pre-selected current OU with auto-expand
- Bulk move support via `bulk_move_objects` command with per-object result reporting
- Audit logging for all move operations (success and failure)

#### AD Recycle Bin (7.2)
- Recycle Bin page listing deleted AD objects with name, type, deletion date, original OU
- Search by name and filter by object type (User, Computer, Group, Contact, Printer) with color-coded badges
- Restore dialog with OU picker for target selection (pre-selects original OU)
- AD Recycle Bin feature detection (case-insensitive, DN name + GUID matching) with warning UI
- DomainAdmin permission gating on sidebar and all operations

#### Contact and Printer Management (7.3)
- Contact lookup page with auto-loaded list, search, PropertyGrid detail view, and inline editing
- Printer lookup page with auto-loaded list, search, and inline editing for all fields
- Contact CRUD gated to AccountOperator+, printer edit/delete to AccountOperator+
- Sidebar entries for both pages in Directory group
- Audit logging and snapshot capture on all write operations

#### User Thumbnail Photo (7.4)
- User thumbnail photo display in user detail view (64px with border frame, or placeholder)
- Upload photo button with file picker (JPG/PNG) and client-side Canvas center-crop resize to 96x96
- Remove photo button to clear thumbnailPhoto attribute
- AccountOperator+ permission for photo modifications
- Audit trail for photo set/remove operations

#### Object Backup and Restore (7.5)
- SQLite-backed ObjectSnapshotService for capturing full AD attribute state before every write operation
- Snapshot history, diff comparison, and restore-from-snapshot capabilities
- SnapshotHistory component in user detail view with expandable diff viewer
- Auto-refresh snapshot list after save, delete consumed snapshot after restore
- Restore skips read-only attributes and clears attributes absent from snapshot
- Configurable snapshot retention with automatic cleanup
- DomainAdmin permission for restore operations, authenticated LDAP user as operator

#### General
- Delete button on user, group, and computer detail views (AccountOperator+)
- Generic `delete_ad_object` command with snapshot capture and audit logging
- `useBrowse.refresh()` reloads all pages when preloadAll is active
- TreeView auto-expands and auto-scrolls to pre-selected node
- Confirmation dialogs (ConfirmationDialog) for all destructive actions
- AD test data script: `scripts/populate-ad-epic7.ps1` (100 contacts, 20 printers, Recycle Bin)

## [0.6.0] - 2026-03-20

Epic 6 - Exchange Diagnostics. Read-only Exchange mailbox diagnostics for both
on-premises (via LDAP msExch* attributes) and Exchange Online (via Microsoft
Graph API). LDAP TLS improvements (StartTLS, custom CA). Preset integrity
checksums for security.

### Added

#### Exchange On-Prem Attributes (6.1)
- Exchange mailbox panel in user detail view, auto-detected from msExch* LDAP attributes
- Displays mailbox GUID, recipient type, primary SMTP, email aliases, forwarding target, delegates
- Panel hidden when user has no Exchange attributes (graceful degradation)
- proxyAddresses parsing (SMTP:/smtp: convention) and msExchRecipientTypeDetails mapping
- Rust model (`ExchangeMailboxInfo`) with 16 unit tests, TypeScript extraction with 10 tests
- Collapsible `ExchangePanel` component with 7 component tests

#### LDAP TLS Improvements
- StartTLS on port 389 as alternative to LDAPS (port 636) via `DSPANEL_LDAP_STARTTLS=true`
- Custom CA certificate loading via `DSPANEL_LDAP_CA_CERT=/path/to/ca.pem` (PEM or DER)
- LDAPS takes precedence over StartTLS if both are set
- CA cert works with both LDAPS and StartTLS modes
- New dependency: `native-tls` (direct) for custom TLS connector building

#### Exchange Online Diagnostics (6.2)
- Microsoft Graph API integration for Exchange Online mailbox diagnostics
- OAuth2 client credentials flow with token caching and auto-expiry
- Settings UI (`GraphSettings` component) for Azure AD tenant ID, client ID, and client secret
- "Test Connection" button to validate Graph API connectivity
- Exchange Online panel with mailbox quota usage bar (color-coded: green/yellow/red)
- Displays primary SMTP, aliases, forwarding, auto-reply status, delegates
- Panel hidden when Graph is not configured or user has no Exchange Online mailbox
- `AppSettings` extended with Graph config fields (backwards-compatible)
- Graph config synced from persisted settings at startup
- Real mailbox quota via `Reports.Read.All` (getMailboxUsageDetail CSV), fallback to 50 GB default
- Rust `GraphExchangeService` with 29 unit tests (10 sync + 19 async/mockito), TypeScript types with 10 tests
- `ExchangeOnlinePanel` component with 8 tests, `GraphSettings` component with 7 tests
- New dependencies: reqwest `json` feature for Graph API response parsing, `csv` crate for report parsing

### Security

- SHA-256 integrity checksums for preset JSON files stored in local app data
- Warning displayed when a preset file is modified outside DSPanel (checksum mismatch)
- User must explicitly accept externally modified presets before use
- Checksum registry persisted in `preset-checksums.json` (LOCALAPPDATA/DSPanel)
- New dependency: `sha2` crate for SHA-256 hashing

## [0.5.0] - 2026-03-20

Epic 5 - Presets, Onboarding and Offboarding Workflows. Role-based presets,
guided onboarding/offboarding wizards, and inline attribute editing. Validated
against a real AD (Windows Server 2022 + BadBlood).

### Added

#### Preset Storage & Configuration (5.1)
- PresetService with JSON file storage on configurable network share path
- Debounced file watcher (notify crate) for auto-reload on external changes
- Preset model with validation (name, targetOU, groups/attributes)
- Settings UI for preset path configuration with Browse (native folder picker), Test, and Save buttons
- Preset path persisted to `app-settings.json` and auto-restored at startup
- Cross-platform data directory: `%LOCALAPPDATA%/DSPanel` (Windows), `~/Library/Application Support/DSPanel` (macOS), `$XDG_DATA_HOME/DSPanel` (Linux)
- Tauri commands: get/set/test preset path, list/save/delete presets, pick_folder_dialog

#### Preset Editor UI (5.2)
- Preset management page with list/editor split view
- Full CRUD: create, edit, delete presets with confirmation dialog
- Reuses GroupPicker for AD group selection and OUPicker for target OU
- Custom attributes editor (key/value pairs)
- Name uniqueness validation, permission gating (AccountOperator+)
- Inline storage path configuration shown when path is not yet set

#### Onboarding Wizard (5.3)
- 4-step wizard: User Details, Preset Selection, Preview, Execute
- Auto-generated login from first/last name (configurable pattern)
- UPN derived from AD base DN (e.g. `user@dspanel.local`), not server IP
- Secure password auto-generation with regenerate button
- Preview diff showing all planned changes before execution
- Rollback on partial failure: offers to delete partially created user if group additions fail
- Copyable output summary (login, password, OU, groups)
- Full audit logging of onboarding operations

#### Offboarding Workflow (5.4)
- 4-step workflow: Search User, Select Actions, Preview, Execute
- Toggleable actions: disable account, remove groups, set random password, move to Disabled OU
- OUPicker for Disabled OU selection (replaces text input), pre-filled from app settings
- "Start Offboarding" context menu entry in User Lookup results (auto-searches user)
- Dry-run preview before execution with detailed action list in confirmation dialog
- Per-action progress and error tracking
- Copyable output summary for ticket documentation

#### Modify User Attributes (5.5)
- Inline edit (pencil icon on hover) for Identity fields: Display Name, First Name, Last Name, Email, Department, Title
- Inline edit for Advanced Attributes (any LDAP attribute)
- Pending changes bar next to user action buttons (Reset Password, Disable)
- Floating indicator with Save button when action bar is scrolled out of view
- Confirmation dialog with old->new value diff; warning box for advanced attribute changes
- Backend `modify_attribute` Tauri command with LDAP Mod::Replace
- `create_user` Tauri command for onboarding (LDAP add + password + enable)
- Snapshot capture before every modification
- Audit logging on every attribute modification

#### Infrastructure
- `AppSettingsService` for persisted app-wide settings (`app-settings.json`)
- `disabledOu` setting for offboarding default OU (configurable in future Settings page)

## [0.4.0] - 2026-03-20

Epic 4 - Group Management & Bulk Operations. Complete group lifecycle with
browse, member management, bulk operations, and hygiene detection. Validated
against a real AD (Windows Server 2022 + [BadBlood](https://github.com/davidprowe/BadBlood)).

### Added

#### Group Management (4.1-4.3)
- Group browser with flat search and OU tree, preloaded at mount
- Group member management with add/remove, dry-run preview, and audit logging
- Bulk operations redesigned with 4 categories (Members, Groups, Properties, Export) and 10 operations:
  Add/Remove/Transfer members, Copy user groups, Import CSV, Create/Clone/Merge/Move groups, Set ManagedBy, Export CSV
- Dry-run preview, progress indicator, and rollback on failure for all bulk ops
- Cross-module deep-link from User Lookup to Group Management

#### Group Hygiene (4.4)
- 7 hygiene detections: empty, circular nesting, single-member, stale (180d), undescribed, deep nesting (>3 levels), duplicate member sets
- Bulk delete with re-check before deletion (race condition protection)
- One-click navigation to problematic group
- Hygiene scan audit event logging

#### LDAP & Authentication (4.5-4.6)
- Simple bind authentication via `DSPANEL_LDAP_SERVER`, `DSPANEL_LDAP_BIND_DN`, `DSPANEL_LDAP_BIND_PASSWORD`
- LDAPS (TLS) support on port 636 via `ldaps://` URL scheme or `DSPANEL_LDAP_USE_TLS`
- Self-signed cert support via `DSPANEL_LDAP_TLS_SKIP_VERIFY`
- LDAP paged results for fetching >1000 objects
- Connection keepalive (5-minute background ping)
- 22 integration tests against real AD over LDAPS

#### Permission System
- 5 permission levels: ReadOnly, HelpDesk, AccountOperator, Admin, DomainAdmin
- Language-independent detection via well-known SID RIDs (works in any AD locale)
- Probe-based detection via `allowedAttributesEffective` on all OUs for delegated permissions
- LDAP WhoAmI for authenticated identity (supports "Run as" and simple bind)
- Custom groups: `DSPanel-HelpDesk`, `DSPanel-AccountOps`, `DSPanel-Admin`, `DSPanel-DomainAdmin`

#### UI/UX Improvements
- Health filter buttons (Healthy/Warning/Critical) with live counts
- GroupBadge with category icon (Shield/Mail) + scope (G/DL/U) + tooltip
- Category/Status/OS filters for Group Management and Computer Lookup
- Advanced Attributes "Show empty" toggle with AD schema discovery
- Visible-but-disabled actions with permission tooltips (replaces hidden)
- "Authenticated as" display in Home page
- Windows FILETIME and AD generalized time date formatting
- Consistent error display via `extractErrorMessage`

### Changed

- Preload all users/groups/computers at mount (replaces paginated scroll)
- Bulk health evaluation in single IPC call (replaces per-user sequential)
- Audit log operator set from WhoAmI identity (not Windows USERNAME)
- LDAP retry only on connection errors, not business logic errors

### Fixed

- LDAP paged results controls leaking into shared connection pool
- `get_schema_attributes` race condition corrupting shared `base_dn`
- Password flags "User Cannot Change Password" not re-saveable after toggle
- `nTSecurityDescriptor` read failure shows info message for ReadOnly users
- `sizeLimitExceeded` (rc=4) treated as fatal instead of partial success
- Raw JSON error objects in toaster notifications
- Health badge tooltip icon alignment and missing Healthy checkmark

## [0.3.0] - 2026-03-15

Epic 3 - Comparison & Permissions Audit. Side-by-side user comparison, NTFS permissions
analysis with ACL cross-referencing, and AD replication metadata timeline.

### Added

- Side-by-side user comparison with group membership delta (shared/only-A/only-B) and color-coded display (3.1)
- Group diff algorithm with case-insensitive DN comparison and sorted output (3.1)
- User comparison page with dual search, filter, sort, OU/lastLogon/status in user cards (3.1)
- Right-click context menu on groups: "View group members" and "Add user to group" (3.1)
- Cross-tab compare: right-click in User Lookup to compare two users directly (3.1)
- Nested group resolution via LDAP_MATCHING_RULE_IN_CHAIN for transitive membership in user comparison (3.1)
- UNC path permissions audit with NTFS ACL reading via Windows API (3.2)
- ACE cross-reference with user group SIDs showing access indicators (allowed/denied/no-match) (3.2)
- Access Summary with per-user breakdown and differences explanation (3.2)
- Color-coded ACE rows with legend (green=both, red=A only, blue=B only) (3.2)
- Contextual tooltips on access indicators showing user name and matched trustee (3.2)
- CSV export via native save file dialog (rfd crate) (3.2)
- Standalone NTFS Permissions Analyzer page with recursive depth scanning (3.3)
- Allow/deny conflict detection across parent/child paths (3.3)
- Inherited vs explicit ACE filtering toggle (3.3)
- Group chain tree with recursive expansion and circular reference detection (3.3)
- Session-level cache for group member queries in GroupChainTree to avoid redundant LDAP calls (3.3)
- Right-click "View group members" on ACE trustees (3.3)
- State-in-time replication metadata viewer parsing msDS-ReplAttributeMetaData XML (3.4)
- `msDS-ReplValueMetaData` parser for linked-attribute replication (member, memberOf) with Active/Removed status (3.4)
- Linked Attribute Changes section in StateInTimeView displaying value-level replication history (3.4)
- Attribute timeline sorted by last change time with version and originating DC (3.4)
- Attribute diff between two timestamps showing version changes (3.4)
- Replication History section in user and computer detail views (3.4)
- Tauri `search_groups` command wired to GroupPicker component with `useGroupSearch` hook
- Tauri `get_ou_tree` command wired to OUPicker component with `useOUTree` hook
- `DirectoryProvider::get_ou_tree()` trait method with LDAP and demo implementations
- CSV export via context menu in DataTable with `csvFilename` prop and `exportTableToCsv` utility (1.7)
- `aria-describedby` linking error messages to form inputs in FormField (1.8)
- Highlight matching search text in ComboBox dropdown options (1.8)
- Keyboard accessibility on HealthBadge tooltip: Escape to close, Enter/Space to toggle (1.11)
- DNS resolution timeout indicator after 10s in ComputerDetail (1.12)
- Storybook setup with Vite builder, theme switcher (light/dark), and a11y addon
- Stories for 15 components: TextInput, PasswordInput, FormField, ComboBox, OUPicker, GroupPicker, StatusBadge, TagChip, LoadingSpinner, EmptyState, CopyButton, HealthBadge, DataTable, PropertyGrid, TreeView, FilterBar, DialogShell
- Tab state persistence across switches (components stay mounted)
- Toast notifications with severity-colored progress bar
- Technical backlog document (docs/backlog.md)
- New sidebar entries: User Comparison (Directory group), NTFS Analyzer (Tools group)
- New Tauri commands: compare_users, add_user_to_group, audit_ntfs_permissions, cross_reference_ntfs, analyze_ntfs, get_replication_metadata, compute_attribute_diff, save_file_dialog
- 1691 tests (616 Rust + 1075 frontend), 62% Rust line coverage, 89% frontend line coverage

### Changed

- Audit service migrated from JSON file to SQLite for durability and performance under high-volume support workflows
- LDAP connection pooling: reuse a single multiplexed connection instead of connect/bind per operation
- Automatic reconnect on stale LDAP connection with one retry before propagating errors
- Replace fragile string-split XML parsing in replication metadata with `quick-xml` crate (3.4)
- Context menu onClick deferred to microtask for async-safe handling
- Demo provider: search_users and get_user_by_identity use full 26-user dataset
- useBrowse: removed auto-select on single search result for better UX

### Fixed

- Resolve NTFS ACE trustee SIDs to DOMAIN\Username via LookupAccountSidW instead of showing raw SIDs (3.2)
- Array sort mutation in useComparison: spread before sort to prevent source mutation (3.1)
- Reject path traversal (`..` segments) in UNC path validation (3.2)
- Search input validation: trim, max 256 chars, reject control characters (defense-in-depth)
- Notification notify() argument order (message, severity) was inverted causing NotificationHost crash
- Async context menu actions no longer trigger ErrorBoundary via unhandled rejections

## [0.2.0] - 2026-03-14

Epic 2 - Support Actions and Account Management. Password reset, secure password generator,
account unlock/enable/disable, password flag management, and MFA gate for sensitive operations.

### Added

- User browse mode: UserLookup page loads users on mount without requiring a search query
- VirtualizedList infinite scroll with onEndReached and loadingMore support
- Browse users command with server-side caching (60s TTL) and pagination for directory listing
- Get group members Tauri command to list members of a group by DN
- 26 sample users in demo mode for scroll/browse testing
- ContextMenu component (portal-rendered, keyboard accessible)
- GroupMembersDialog to view members of a group from the user detail view
- Right-click context menu on group membership rows to explore group members
- Password reset with manual/auto-generate modes via PasswordResetDialog (2.1)
- Secure password generator with configurable criteria and HIBP k-anonymity breach checking (2.2)
- Standalone Password Generator page accessible to all permission levels (2.2)
- Account unlock, enable, and disable actions with confirmation dialogs (2.3)
- Password flag management (Password Never Expires, User Cannot Change Password) with dry-run preview (2.4)
- DACL-based "User Cannot Change Password" flag via binary security descriptor manipulation (2.4)
- MFA gate service with RFC 6238 TOTP, backup codes, and per-action configuration (2.5)
- MFA verification dialog for sensitive operations (2.5)
- MFA setup wizard with QR code display, verification step, and backup codes (2.5)
- MFA enforcement at command level with 5-minute session window (2.5)
- Rate limiting on MFA verification (5 failed attempts before lockout) (2.5)
- Audit service logging all sensitive operations with file-based persistence (2.5)
- UserActions component integrating password reset, unlock, enable/disable buttons
- PasswordFlagsEditor component with dirty tracking and AccountOperator gating
- useMfaGate hook for reusable MFA verification across components
- New Tauri commands: reset_password, unlock_account, enable_account, disable_account, set_password_flags, generate_password, check_password_hibp, get_audit_entries, get_cannot_change_password, mfa_setup, mfa_verify, mfa_is_configured, mfa_revoke, mfa_get_config, mfa_set_config, mfa_requires
- DirectoryProvider trait extended with write operations (reset_password, unlock_account, enable_account, disable_account, set_password_flags)
- ResilientDirectoryProvider wraps all new write operations with retry and circuit breaker
- 135 new tests (34 Rust + 54 frontend + 47 coverage hardening) covering Epic 2 features

### Changed

- UserLookup page: removed blank initial state, users visible on open
- Action buttons (UserActions, PasswordFlagsEditor) use btn-sm for compact sizing
- UserDetail sections separated with visible borders for better visual hierarchy
- PropertyGrid categories separated with subtle borders

## [0.1.0] - 2026-03-13

Epic 1 - Foundation and Core Lookup. Full rewrite from C#/WPF to Rust/Tauri v2 + React/TypeScript.
Cross-platform (Windows, macOS, Linux), lightweight native binary (~8.5 MB).

Code quality pass across Rust backend and React frontend: accessibility (WCAG focus traps,
ARIA live regions, skip-to-main link), error resilience (per-user health checks, stale request
cancellation, explicit error logging), performance (React.memo, concurrency-limited batch ops),
and maintainability (shared hooks and components to eliminate duplication).

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
