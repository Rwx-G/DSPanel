# Epic 1: Foundation and Core Lookup

**Goal**: Establish the project skeleton with DI, MVVM infrastructure, the IDirectoryProvider abstraction, and permission-level detection. Build a comprehensive Base UI foundation (theme system, navigation shell, reusable controls, data display, forms, dialogs) so that all subsequent epics can build on solid, consistent UI patterns. Deliver the first user-facing value: searching for a user or computer account and displaying detailed information with a healthcheck badge. This epic proves the architecture end-to-end.

### Story 1.1: Project Skeleton and DI Bootstrap

As a developer,
I want a working WPF application with DI, hosting, logging, and solution structure,
so that all future features plug into a consistent architecture.

#### Acceptance Criteria
1. Solution builds and runs with .NET 10 WPF project + xUnit test project
2. Microsoft.Extensions.Hosting bootstraps the application with DI container
3. CommunityToolkit.Mvvm is configured with source generators
4. Serilog is configured with console + file sinks (structured logging)
5. Project follows the source tree convention defined in architecture docs
6. .editorconfig enforces coding standards
7. All NuGet packages from tech stack are referenced with correct versions
8. Application starts and displays an empty main window

### Story 1.2: IDirectoryProvider and AD On-Prem Connection

As a developer,
I want an IDirectoryProvider interface with an LDAP implementation that auto-detects the current domain,
so that all AD queries go through a consistent abstraction.

#### Acceptance Criteria
1. IDirectoryProvider interface is defined with methods for user search, computer search, and group queries
2. LdapDirectoryProvider implements IDirectoryProvider using System.DirectoryServices.Protocols
3. At startup, the provider auto-detects the current domain via environment (USERDNSDOMAIN / rootDSE)
4. Connection uses the current Windows user's Kerberos credentials (no stored passwords)
5. The provider is registered in DI and injectable into ViewModels
6. Unit tests cover provider registration and interface contract (with mocked LDAP)
7. Graceful error handling if no domain is reachable (show message, disable AD features)

### Story 1.3: Permission Level Detection

As a support technician,
I want DSPanel to detect my AD group memberships at startup and determine my permission level,
so that I only see actions I am authorized to perform.

#### Acceptance Criteria
1. IPermissionService detects current user's AD group memberships at startup
2. Groups are mapped to permission levels: ReadOnly (default), HelpDesk, AccountOperator, DomainAdmin
3. Group names used for detection are configurable (not hardcoded)
4. Higher levels inherit all permissions of lower levels
5. Permission level is displayed in the status bar
6. HasPermission(PermissionLevel required) method is available for UI binding
7. Unit tests cover all permission level mappings and edge cases (user in multiple groups)

### Story 1.4: Theme System, Design Tokens and Resource Architecture

As a developer,
I want a comprehensive theme system with design tokens, dark/light modes, and organized resource dictionaries,
so that the entire application has a consistent, professional visual identity from day one.

#### Acceptance Criteria
1. Color palette defined as design tokens in ResourceDictionaries: primary, secondary, accent, semantic colors (success/warning/error/info), surface colors (background, card, elevated), text colors (primary, secondary, disabled)
2. Dark and light theme ResourceDictionaries with all token values, switchable at runtime without restart
3. Typography scale defined: heading 1-4, body, caption, monospace - with consistent font family, sizes, and weights
4. Spacing system: 4px base unit scale (4, 8, 12, 16, 24, 32, 48) as static resources
5. Border radius, shadow, and elevation tokens defined
6. Icon system established: vector icons (Path geometry) or icon font, with a consistent naming convention and a catalog of base icons (search, settings, user, computer, group, lock, unlock, warning, error, check, close, refresh, export, plus, minus, edit, delete, filter, sort)
7. All control styles (Button, TextBox, ComboBox, CheckBox, DataGrid, TabControl, ListBox, ScrollBar) overridden with custom templates matching the design system
8. Theme preference persisted to user settings (default: system preference detection)
9. Unit tests verify all expected resources are resolvable in both themes

### Story 1.5: Application Shell, Navigation and Tab System

As a developer,
I want a polished application shell with sidebar navigation, tabbed content area, breadcrumbs, and a status bar,
so that all features have a consistent navigation and layout framework.

#### Acceptance Criteria
1. Main window with three-zone layout: collapsible left sidebar (navigation), center content area, bottom status bar
2. Sidebar displays module icons and labels grouped by category (Lookup, Management, Security, Infrastructure, Settings), with active state highlighting
3. Sidebar is collapsible to icon-only mode (toggle button or keyboard shortcut)
4. Content area uses a tab system: each navigation action opens a new tab (or activates existing tab for same context)
5. Tabs support: close (X button + middle-click), close all, close others, reorder via drag-and-drop
6. Tab overflow handled with a dropdown menu listing all open tabs
7. Breadcrumb bar above the content area shows the current navigation path (e.g., Lookup > Users > john.doe)
8. Status bar displays: connected domain name, target DC, current user's permission level badge, connection status indicator (green/yellow/red)
9. INavigationService manages view registration, tab lifecycle, and breadcrumb state
10. Keyboard shortcuts: Ctrl+W (close tab), Ctrl+Tab (next tab), Ctrl+Shift+Tab (previous tab), Ctrl+F (focus search)
11. Window state (size, position, maximized, sidebar collapsed) persisted and restored on startup
12. Responsive layout: content area adapts to window resize, minimum window size enforced

### Story 1.6: Common Reusable Controls

As a developer,
I want a library of common reusable WPF controls,
so that all views use consistent, tested UI components.

#### Acceptance Criteria
1. SearchBar control: text input with search icon, clear button, placeholder text, debounced search event (300ms), keyboard shortcut support (Ctrl+F)
2. PermissionGate control: wrapper that shows/hides/disables content based on required PermissionLevel (binds to IPermissionService)
3. StatusBadge control: colored pill/chip with icon and text, variants for account status (Active, Disabled, Locked, Expired), severity (Critical, Warning, Info, Success)
4. Avatar control: circular image with fallback to initials, configurable size (small 24px, medium 36px, large 48px)
5. TagChip control: removable tag with label, used for group memberships and filters
6. LoadingSpinner control: animated spinner with optional text, overlays content during async operations
7. EmptyState control: illustration/icon + message + optional action button, for empty search results, no data, error states
8. InfoCard control: card container with header, content area, optional footer and collapse toggle
9. CopyButton control: button that copies bound text to clipboard with visual feedback (checkmark animation)
10. All controls support both dark and light themes
11. All controls have design-time preview (d:DesignInstance)
12. Unit tests for controls with behavioral logic (PermissionGate, SearchBar debounce)

### Story 1.7: Data Display Components

As a developer,
I want standardized data display components for tables, lists, and detail views,
so that all data-heavy views look and behave consistently.

#### Acceptance Criteria
1. StyledDataGrid: custom-styled DataGrid with alternating row colors, hover highlight, selection styling, sortable column headers with sort direction indicator, column resize, and frozen columns support
2. FilterBar control: horizontal bar with filter chips, text filter, and clear-all button - emits a filter predicate for CollectionViewSource binding
3. Pagination control: page size selector (25/50/100), page navigation (first/prev/next/last), item count display ("Showing 1-25 of 342")
4. VirtualizedList: ItemsControl with UI virtualization for large collections (1000+ items), smooth scrolling
5. PropertyGrid: two-column label-value display for object detail views, supports grouping by category, copy-value on click
6. TreeView styled component: custom-styled TreeView with expand/collapse animations, lazy-loading support, multi-select
7. DiffViewer control: side-by-side or inline diff display with color-coded additions (green), removals (red), unchanged (gray) - for comparison views
8. All components support both themes and handle empty/loading/error states via visual states
9. DataGrid supports CSV export via context menu (right-click > Export to CSV)

### Story 1.8: Form Controls, Validation and Input Patterns

As a developer,
I want standardized form controls with a validation framework,
so that all input forms follow consistent patterns and provide clear user feedback.

#### Acceptance Criteria
1. FormField control: label + input + validation message container, supports required indicator (asterisk)
2. Styled TextBox with validation states: normal, focused, error (red border + message), disabled
3. Styled PasswordBox with show/hide toggle
4. Styled ComboBox with search/filter capability for long lists
5. OUPicker control: ComboBox or TreeView picker that displays the OU hierarchy from AD for OU selection
6. GroupPicker control: searchable multi-select picker for AD groups with type-ahead
7. DateTimePicker: styled date picker with optional time component
8. Validation framework using INotifyDataErrorInfo with CommunityToolkit.Mvvm, supporting sync and async validation rules
9. Validation summary control: displays all validation errors for a form in a grouped list
10. Form state management: dirty tracking (unsaved changes indicator), reset to original values
11. All form controls support both themes and accessibility (keyboard navigation, screen reader labels)

### Story 1.9: Dialogs, Notifications and Feedback System

As a developer,
I want a dialog service, toast notification system, and progress feedback framework,
so that user interactions and background operations provide clear, consistent feedback.

#### Acceptance Criteria
1. IDialogService with methods: ShowConfirmation(title, message, details), ShowWarning, ShowError, ShowDryRunPreview(changes), ShowCustomDialog<T>
2. Confirmation dialog: title, message, optional detail expander, Cancel/Confirm buttons with configurable labels
3. DryRunPreview dialog: scrollable list of pending changes with icons (add/modify/delete), cancel/execute buttons
4. Toast notification system: non-blocking notifications that appear in bottom-right corner, auto-dismiss after configurable duration (default 5s), support info/success/warning/error severity, click to dismiss, action button support
5. Progress dialog for long operations: determinate (progress bar with percentage) and indeterminate modes, cancellation support, status message updates
6. Inline progress indicator for sections within a view (not full dialog)
7. All dialogs support both themes and are keyboard-accessible (Enter=confirm, Escape=cancel)
8. IDialogService registered in DI, testable via mock

### Story 1.10: User Account Lookup

As a L1 support technician,
I want to search for a user account and see their complete information,
so that I can quickly diagnose account issues when handling tickets.

#### Acceptance Criteria
1. Search bar accepts SAMAccountName, UPN, display name, or partial match
2. Search results appear in a list with name, department, and status
3. Selecting a result opens a detail view with: display name, first/last name, email, department, title, OU (as breadcrumb), DN, account status (enabled/disabled), locked status
4. Authentication info is displayed: failed password count, last logon, last workstation + IP
5. Group memberships are listed in a sortable/filterable list
6. All AD queries are async (UI never freezes)
7. Empty/error states are handled gracefully (user not found, network error)

### Story 1.11: Healthcheck Badge

As a support technician,
I want to see a visual healthcheck badge on each account,
so that I can instantly identify problematic accounts without reading every field.

#### Acceptance Criteria
1. Healthcheck badge appears next to the user's name in lookup results and detail view
2. Badge aggregates multiple status flags: Disabled, Locked Out, Expired, Password Expired, Password Never Expires, Inactive 30 days, Inactive 90 days, Never Logged On, Password Never Changed
3. Each flag has a distinct color/icon (red for critical, orange for warning, green for healthy)
4. Hovering over the badge shows a tooltip with all active flags
5. A "Healthy" badge is shown when no issues are detected
6. Healthcheck logic is in a testable service with unit tests for each flag combination

### Story 1.12: Computer Account Lookup

As a support technician,
I want to search for a computer account and see its details,
so that I can diagnose workstation issues.

#### Acceptance Criteria
1. Computer search works by name (exact and partial match)
2. Detail view shows: computer name, DNS hostname, OS, OS version, last logon, OU, enabled status
3. Group memberships are listed
4. Ping button sends ICMP ping and displays result (reachable/unreachable + latency)
5. DNS resolution displays the computer's IP address
6. Results open in the same tab system as user lookups

---
