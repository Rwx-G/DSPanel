# DSPanel Product Requirements Document (PRD)

## Goals and Background Context

### Goals

- Unify the entire AD support chain (ReadOnly, L1, L2, L3, DomainAdmin) into a single Windows desktop tool
- Dynamically adapt the UI based on the AD permissions of the current Windows user
- Natively support hybrid environments (AD on-prem via LDAP + Entra ID via Microsoft Graph)
- Deliver "premium" features as open source: NTFS permissions analysis crossed with AD, risk scoring, AD attack detection
- Provide guided workflows (onboarding/offboarding) based on declarative presets (JSON/YAML)
- Ensure full action traceability for compliance audits
- Fully replace aging and fragmented internal tools

### Background Context

Active Directory support in Windows environments currently relies on a fragmented combination of tools: RSAT, PowerShell, Exchange consoles, and aging in-house utilities. Each support level (L1 through L3) uses different tools, with no integrated permission management, no traceability, and no guided workflows. This fragmentation slows ticket resolution, increases error risk, and makes compliance impossible to demonstrate.

Existing commercial solutions (ManageEngine, Quest, Netwrix) cover parts of the need but are expensive, often web-based, and scatter features across multiple products. No open source tool covers the full identified scope - particularly NTFS analysis crossed with AD, risk scoring, and AD attack detection.

### Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-03-10 | 0.1 | Initial PRD draft | Romain G. |

---

## Requirements

### Functional

- **FR1**: The application shall detect the AD group memberships of the current Windows user at startup and map them to a permission level (ReadOnly, HelpDesk, AccountOperator, DomainAdmin).
- **FR2**: The UI shall dynamically show, gray out, or hide actions and modules based on the detected permission level.
- **FR3**: The application shall auto-detect the directory context at startup (AD on-prem, Entra ID, or hybrid) via the IDirectoryProvider adapter pattern.
- **FR4**: Users shall be able to search for AD user accounts by SAMAccountName, UPN, display name, or partial match and view complete account information (name, department, title, OU, DN, groups, status).
- **FR5**: Users shall be able to search for AD computer accounts by name and view complete information (OS, version, last logon, OU, groups).
- **FR6**: Each account lookup shall display a visual healthcheck badge showing account status flags (disabled, locked out, expired, password expired, inactive 30/90 days, never logged on, password never changed).
- **FR7**: Account lookup shall display authentication details: failed password count, last logon timestamp, last workstation used with IP address.
- **FR8**: Users shall be able to ping a computer (ICMP) and resolve its DNS from within the tool.
- **FR9**: The application shall query Exchange on-prem attributes via LDAP (msExch*) to display mailbox name, aliases, forwarding, quotas, and delegations in read-only mode.
- **FR10**: The application shall query Exchange Online via Microsoft Graph API to display the same mailbox information in read-only mode.
- **FR11**: Users shall be able to view login/logout event history for a user or computer.
- **FR12**: The application shall provide lockout diagnostics: trace lockout source DC, IP address, and originating process.
- **FR13**: Power users shall be able to execute custom LDAP filter queries and view results.
- **FR14**: Users shall be able to compare two user accounts side-by-side with a visual delta of their group memberships.
- **FR15**: Users shall be able to provide a UNC path (e.g., \\\\NAS\folder) and the tool shall resolve ACLs, identify which AD groups have which permissions, and cross-reference with the compared users' group memberships.
- **FR16**: The application shall provide NTFS Permissions Analyzer functionality: cross-reference NTFS folder permissions with AD group memberships to answer "why does user X have access but not user Y".
- **FR17**: The application shall support State-in-Time comparison: compare an AD object's configuration between two points in time using replication metadata.
- **FR18**: Groups shall be displayed in a tree view (by OU hierarchy) and a flat view.
- **FR19**: Users shall be able to add/remove group members via drag-and-drop and multi-selection.
- **FR20**: The application shall support group-centric bulk operations: Delete (remove members), Add (add members), Transfer (move members between groups) with multi-selection of target accounts.
- **FR21**: The application shall detect and report empty groups and circular group nesting.
- **FR22**: Administrators shall be able to define presets (onboarding/offboarding templates) as JSON/YAML files specifying AD groups, target OU, and other attributes per role/team.
- **FR23**: Presets shall be stored on a configurable network share and managed exclusively through the DSPanel UI (no manual file editing).
- **FR24**: The application shall provide an onboarding wizard: guided form, preset selection, diff preview, execution, and formatted output ready to paste into a ticket (login, temporary password, assigned groups, machine info).
- **FR25**: The application shall provide an offboarding workflow: account disable, group removal, mail forwarding setup, OU move to "disabled users", in a guided sequence.
- **FR26**: All modification operations (presets, bulk ops, workflows) shall offer a dry-run/preview mode showing the full diff before execution.
- **FR27**: HelpDesk users shall be able to reset user passwords with options (must change at next logon, etc.).
- **FR28**: HelpDesk users shall be able to unlock locked-out accounts.
- **FR29**: HelpDesk users shall be able to enable or disable user accounts.
- **FR30**: The application shall require MFA verification before executing sensitive actions (password reset, account deletion) - provider-agnostic.
- **FR31**: The application shall include a secure password generator with verification against compromised password databases (HaveIBeenPwned API).
- **FR32**: Users shall be able to manage password flags (Password Never Expires, User Cannot Change Password).
- **FR33**: AccountOperator+ users shall be able to move AD objects between OUs (single and bulk) with preview.
- **FR34**: The application shall provide access to the AD Recycle Bin to restore deleted objects.
- **FR35**: The application shall support CRUD operations on AD contact objects.
- **FR36**: The application shall support viewing and managing AD printer objects.
- **FR37**: The application shall display and allow modification of user thumbnail photos in AD.
- **FR38**: The application shall create a snapshot of an AD object before any modification, allowing one-click rollback.
- **FR39**: DomainAdmin users shall be able to view DC health: DNS status, AD services (NTDS, Netlogon, KDC), SYSVOL state, disk space, LDAP response time.
- **FR40**: The application shall display AD replication status between DCs: sync state, errors, latency.
- **FR41**: The application shall verify AD-related DNS records (_ldap._tcp, _kerberos._tcp SRV records).
- **FR42**: The application shall check Kerberos clock synchronization between DCs and workstations.
- **FR43**: The application shall provide real-time remote workstation monitoring: CPU, RAM, active sessions, services, disk usage.
- **FR44**: The application shall display a visual AD topology map: sites, DCs, replication links.
- **FR45**: The application shall provide a privileged accounts dashboard: Domain Admins, Enterprise Admins, Schema Admins members with alerts for expired/unchanged passwords.
- **FR46**: Users shall be able to export search results, group memberships, and OU contents to CSV.
- **FR47**: Users shall be able to export formatted reports to PDF.
- **FR48**: The application shall support scheduled reports: inactive accounts, expired passwords, empty groups, orphaned machines - with configurable frequency.
- **FR49**: The application shall support automated cleanup: disable/delete accounts based on criteria (inactive X days, never logged on) with mandatory dry-run before execution.
- **FR50**: The application shall generate compliance-ready reports (GDPR, HIPAA, SOX) with predefined templates.
- **FR51**: The application shall maintain an internal audit log of all actions performed: who, what, when, on which object.
- **FR52**: The application shall display AD change history for any object using replication metadata (timeline view).
- **FR53**: The application shall compute and display a domain-wide risk score based on privileged accounts, weak passwords, dangerous configurations.
- **FR54**: The application shall detect common AD attacks: Golden Ticket, DCSync, DCShadow, abnormal Kerberos activity.
- **FR55**: The application shall visualize privilege escalation paths (simplified BloodHound-style graph).
- **FR56**: The application shall support trigger-based automation: "if X then Y" rules on AD changes (e.g., new user in OU X triggers preset Y).
- **FR57**: Users shall be able to execute external scripts (PowerShell/exe) with the selected AD object's attributes passed as parameters.
- **FR58**: The application shall support webhook notifications to Teams, Slack, or email on configurable events.
- **FR59**: The application shall provide a GPO viewer: which GPOs apply to a user/computer/OU, scope report, and what-if modeling.
- **FR60**: DomainAdmin users shall be able to configure granular RBAC within DSPanel itself: customize which roles can see/do what, per OU if needed.

### Non Functional

- **NFR1**: Application startup time shall be under 3 seconds on a standard workstation.
- **NFR2**: AD search queries shall return results in under 1 second on a local network.
- **NFR3**: The UI shall remain responsive (no freezing) during long-running AD operations - all AD calls must be async.
- **NFR4**: The application shall handle large domains (100k+ objects) efficiently using LDAP pagination and result caching.
- **NFR5**: No sensitive data (passwords, tokens) shall be stored locally on disk.
- **NFR6**: All AD communication shall use secure protocols (LDAPS / Kerberos).
- **NFR7**: The application shall follow MVVM pattern (CommunityToolkit.Mvvm) for clean separation of concerns.
- **NFR8**: The codebase shall target .NET 10+ (LTS) with WPF for Windows desktop.
- **NFR9**: The application shall be distributable as both MSIX package and portable exe (zip).
- **NFR10**: The application shall support auto-update notification (check for new GitHub releases at startup).
- **NFR11**: All user-facing strings shall be externalizable for future localization (English default, French planned).
- **NFR12**: The application shall log operations and errors using structured logging (Serilog) with configurable log levels.
- **NFR13**: Unit test coverage shall target 90%+ on core services (directory providers, permission service, preset engine).
- **NFR14**: The application shall gracefully degrade when features are unavailable (e.g., no Exchange attributes found - hide Exchange panel, no Entra ID - disable cloud features).

---

## User Interface Design Goals

### Overall UX Vision

A professional, dense-but-organized desktop interface inspired by tools like SQL Server Management Studio or Azure AD admin center. The UI prioritizes information density and quick access over visual simplicity. A single window with a left sidebar for navigation between modules, a main content area with tabs for multi-tasking, and a bottom status bar showing connection context (domain, DC, permission level).

The key UX principle is **progressive disclosure**: a ReadOnly user sees a clean lookup interface; a DomainAdmin sees the full power of every module. The tool grows with the user's permissions.

### Key Interaction Paradigms

- **Search-first**: a prominent search bar at the top that works across all object types (users, computers, groups) with type-ahead suggestions
- **Context menu actions**: right-click on any AD object to see available actions (filtered by permission level)
- **Tab-based multitasking**: open multiple lookups, comparisons, or views simultaneously in tabs
- **Drag-and-drop**: for group membership management (drag users between groups)
- **Dry-run preview**: modal dialog showing full diff before any write operation, with confirm/cancel
- **Breadcrumb navigation**: OU path displayed as clickable breadcrumbs for quick navigation

### Core Screens and Views

1. **Home / Dashboard** - Quick search bar, recent lookups, healthcheck summary, permission level indicator
2. **User Lookup View** - Full account details, healthcheck badge, groups, Exchange info, action buttons
3. **Computer Lookup View** - Machine details, ping/DNS, remote monitoring, login history
4. **Comparison View** - Side-by-side user comparison with delta highlighting, UNC permission audit
5. **Group Management View** - Tree/flat group browser, member list, bulk operations panel (D/A/T)
6. **Preset Management View** - List of presets, editor, onboarding/offboarding wizard launcher
7. **Onboarding Wizard** - Step-by-step guided form for new user creation with preset selection
8. **Infrastructure Health View** - DC status cards, replication map, DNS checks, topology visualization
9. **Security Dashboard** - Risk score gauge, privileged accounts list, attack detection alerts, escalation paths
10. **Reports View** - Report templates, scheduled reports, export options (CSV/PDF)
11. **Audit Log View** - Searchable/filterable log of all DSPanel actions
12. **Settings View** - Connection configuration, preset storage path, RBAC management, notification setup, GPO viewer
13. **AD Object Detail Dialog** - Reusable modal for viewing/editing any AD object's attributes

### Accessibility: WCAG AA

The application shall meet WCAG AA standards for accessibility: keyboard navigation for all actions, sufficient color contrast, screen reader compatibility for key workflows.

### Branding

- Clean, modern Windows desktop aesthetic - consistent with Windows 11 design language
- Color scheme: dark/light theme support with a professional blue accent palette
- Application icon: shield with directory tree motif
- No heavy custom styling - leverage WPF default controls with minimal theming for maintainability

### Target Device and Platforms: Desktop Only

- Windows 10/11 (x64) desktop application
- WPF (.NET 10+)
- No web, no mobile (potential future expansion noted in brief)

---

## Technical Assumptions

### Repository Structure: Monorepo

Single repository containing the WPF application project, test project, and documentation. Structure:

```
DSPanel/
  docs/                    # PRD, architecture, stories, brainstorming
  src/
    DSPanel/               # Main WPF application
    DSPanel.Tests/          # xUnit test project
  .github/                 # CI/CD workflows
  DSPanel.sln              # Solution file
```

### Service Architecture

Desktop monolith with internal modular architecture:

- **Presentation layer**: WPF Views + ViewModels (MVVM via CommunityToolkit.Mvvm)
- **Service layer**: business logic services injected via Microsoft.Extensions.DependencyInjection
- **Provider layer**: IDirectoryProvider abstraction with LdapDirectoryProvider (on-prem) and GraphDirectoryProvider (Entra ID) implementations
- **Data layer**: no local database - all data comes from AD/Graph/NTFS at query time. Presets stored as JSON/YAML on network share. Audit log stored locally (SQLite or structured log file).

### Testing Requirements

- **Unit tests**: xUnit + Moq for all core services (directory providers, permission service, preset engine, risk scoring)
- **Integration tests**: against a test AD environment (optional, not required for CI)
- **UI tests**: manual testing for WPF views (automated UI testing deferred)
- **Target coverage**: 90%+ on core services
- **Test convention**: mirror source tree (src/DSPanel/Services/Foo.cs -> src/DSPanel.Tests/Services/FooTests.cs)

### Additional Technical Assumptions and Requests

- **LDAP library**: System.DirectoryServices.Protocols for AD on-prem queries (lightweight, cross-platform capable within .NET)
- **Graph SDK**: Microsoft.Graph SDK for Entra ID and Exchange Online queries
- **MVVM toolkit**: CommunityToolkit.Mvvm 8.x for ObservableObject, RelayCommand, source generators
- **DI container**: Microsoft.Extensions.DependencyInjection + Microsoft.Extensions.Hosting for app lifecycle
- **Logging**: Serilog with console + file sinks, structured logging
- **Preset format**: JSON as default format (widely supported, schema-validatable), YAML as optional alternative
- **Password check**: HaveIBeenPwned API (k-anonymity model - only first 5 chars of SHA1 hash sent)
- **NTFS permissions**: System.Security.AccessControl + System.IO for ACL resolution on UNC paths
- **Remote monitoring**: WMI/CIM (System.Management) for remote workstation CPU/RAM/services
- **Event logs**: Windows Event Log API for login/logout and lockout event retrieval
- **Auto-update**: check GitHub Releases API at startup, notify user if newer version available
- **Localization**: .resx resource files, English default, French planned for V2

---

## Epic List

- **Epic 1: Foundation and Core Lookup** - Establish project infrastructure (solution, DI, navigation shell, IDirectoryProvider, permission detection) and deliver the first usable feature: user/computer account lookup with healthcheck badge.

- **Epic 2: Support Actions and Account Management** - Deliver the core helpdesk actions (password reset, unlock, enable/disable) with permission enforcement, MFA gate, and secure password generation.

- **Epic 3: Comparison and Permissions Audit** - Enable side-by-side user comparison with group delta, UNC path permission audit, and NTFS permissions analyzer.

- **Epic 4: Group Management and Bulk Operations** - Deliver the group browser (tree/flat), member management (drag-and-drop), and group-centric bulk operations (D/A/T).

- **Epic 5: Presets, Onboarding and Offboarding Workflows** - Implement declarative presets (JSON on network share), the preset editor UI, onboarding wizard, and offboarding workflow with dry-run preview.

- **Epic 6: Exchange Diagnostics** - Add Exchange on-prem (LDAP msExch*) and Exchange Online (Graph) read-only mailbox diagnostics to the user lookup view.

- **Epic 7: Administration and Object Management** - Deliver OU object movement, AD Recycle Bin access, contact/printer management, thumbnail photos, and object backup/restore.

- **Epic 8: Infrastructure Health and Monitoring** - Implement DC health checks, replication status, DNS validation, Kerberos clock check, remote workstation monitoring, and AD topology visualization.

- **Epic 9: Security, Risk Scoring and Attack Detection** - Deliver the security dashboard: domain risk score, privileged accounts monitoring, AD attack detection, and privilege escalation path visualization.

- **Epic 10: Reports, Export and Compliance** - Implement CSV/PDF export, scheduled reports, automated cleanup, and compliance report templates.

- **Epic 11: Audit, Automation and Extensibility** - Deliver the internal audit log, AD change history timeline, trigger-based automation, external script execution, webhook notifications, and GPO viewer.

- **Epic 12: RBAC, Settings and Polish** - Implement granular RBAC configuration, application settings UI, auto-update, localization support, and final UX polish.

---

## Epic 1: Foundation and Core Lookup

**Goal**: Establish the project skeleton with DI, MVVM navigation, the IDirectoryProvider abstraction, and permission-level detection. Deliver the first user-facing value: searching for a user or computer account and displaying detailed information with a healthcheck badge. This epic proves the architecture end-to-end.

### Story 1.1: Project Skeleton and Navigation Shell

As a developer,
I want a working WPF application with DI, MVVM infrastructure, and a navigation shell,
so that all future features plug into a consistent architecture.

#### Acceptance Criteria
1. Solution builds and runs with .NET 10 WPF project + xUnit test project
2. Microsoft.Extensions.Hosting bootstraps the application with DI container
3. CommunityToolkit.Mvvm is configured with source generators
4. Main window displays a left sidebar with placeholder module buttons and a content area
5. Navigation service allows switching views in the content area
6. Bottom status bar shows placeholder text for domain name, DC, and permission level
7. Serilog is configured with console + file sinks
8. Project follows the source tree convention defined in architecture docs

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

### Story 1.4: User Account Lookup

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

### Story 1.5: Healthcheck Badge

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

### Story 1.6: Computer Account Lookup

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

## Epic 2: Support Actions and Account Management

**Goal**: Deliver the core helpdesk actions that L1/L2 technicians perform daily - password reset, account unlock, enable/disable - with proper permission enforcement, secure password generation, and optional MFA gating for sensitive operations.

### Story 2.1: Password Reset

As a HelpDesk technician,
I want to reset a user's password from the lookup view,
so that I can resolve "can't log in" tickets quickly.

#### Acceptance Criteria
1. "Reset Password" button is visible only to HelpDesk+ permission level
2. Password reset dialog offers: manual entry, auto-generate, and "must change at next logon" checkbox
3. Password is validated against complexity requirements before submission
4. Successful reset shows confirmation with the new password (copyable)
5. Failed reset shows clear error message (insufficient permissions, policy violation)
6. Action is logged to the internal audit log (who, when, target user)
7. Unit tests cover permission gating and password validation logic

### Story 2.2: Secure Password Generator

As a HelpDesk technician,
I want to generate secure passwords and check them against compromised databases,
so that reset passwords are strong and not previously breached.

#### Acceptance Criteria
1. Password generator is accessible from the reset dialog and as a standalone tool
2. Generator produces passwords matching configurable criteria (length, complexity, character sets)
3. Generated passwords are checked against HaveIBeenPwned API using k-anonymity (only first 5 chars of SHA1 sent)
4. Compromised passwords are flagged with a warning and user is prompted to regenerate
5. Generator works offline (skips HIBP check with a warning if API unreachable)
6. Unit tests cover generation logic, HIBP integration (mocked), and offline fallback

### Story 2.3: Account Unlock and Enable/Disable

As a HelpDesk technician,
I want to unlock, enable, or disable a user account from the lookup view,
so that I can resolve lockout and access tickets.

#### Acceptance Criteria
1. "Unlock" button appears only when account is locked out (HelpDesk+ permission)
2. "Enable/Disable" toggle appears for HelpDesk+ permission level
3. Each action shows a confirmation dialog before execution
4. Successful action updates the lookup view immediately (badge + status)
5. All actions are logged to the internal audit log
6. Unit tests cover permission gating and state transitions

### Story 2.4: Password Flag Management

As an AccountOperator,
I want to manage password policy flags on a user account,
so that I can configure special accounts (service accounts, etc.).

#### Acceptance Criteria
1. "Password Never Expires" and "User Cannot Change Password" checkboxes in user detail view
2. Visible only to AccountOperator+ permission level
3. Changes show a confirmation dialog with dry-run preview
4. Changes are logged to the internal audit log
5. Unit tests cover flag read/write logic

### Story 2.5: MFA Gate for Sensitive Actions

As a security-conscious admin,
I want sensitive actions (password reset, account deletion) to require MFA verification,
so that compromised DSPanel sessions cannot perform critical operations.

#### Acceptance Criteria
1. MFA gate is configurable (can be enabled/disabled per action type in settings)
2. MFA challenge is provider-agnostic: supports TOTP (authenticator app) as built-in method
3. MFA dialog appears before the action executes and blocks until verified
4. Failed MFA prevents the action and logs the attempt
5. MFA setup wizard for first-time configuration
6. Unit tests cover MFA flow (with mocked verification)

---

## Epic 3: Comparison and Permissions Audit

**Goal**: Enable support technicians to compare user accounts side-by-side, visualize group membership differences, and audit effective permissions on network resources - answering the common question "why does user X have access but not user Y?"

### Story 3.1: Side-by-Side User Comparison

As a support technician,
I want to compare two user accounts side by side,
so that I can identify differences in their group memberships.

#### Acceptance Criteria
1. Comparison view accepts two user accounts (search or drag from lookup)
2. Both users' details are displayed in parallel columns
3. Group memberships are aligned and color-coded: green (both have), red (only user A), blue (only user B)
4. Delta summary shows count of shared, unique-to-A, and unique-to-B groups
5. Groups can be filtered/sorted in the comparison view
6. Comparison opens in a new tab

### Story 3.2: UNC Path Permissions Audit

As a support technician,
I want to enter a network path and see which AD groups have access and how that maps to two users,
so that I can diagnose file share access issues.

#### Acceptance Criteria
1. Input field accepts UNC paths (\\\\server\share\folder)
2. Tool resolves NTFS ACLs on the specified path and lists each ACE (group/user, permission type, allow/deny)
3. Each ACE is cross-referenced with the compared users' group memberships
4. Visual indicator shows which user has effective access and through which group
5. Error handling for inaccessible paths, permission denied, or invalid paths
6. Results are exportable to CSV

### Story 3.3: NTFS Permissions Analyzer

As a L2 support technician,
I want to analyze NTFS permissions on a folder and understand the full permission chain,
so that I can resolve complex access issues.

#### Acceptance Criteria
1. Standalone view (not just comparison mode) for analyzing a single path's permissions
2. Displays inherited vs explicit permissions separately
3. Shows full group resolution chain (user -> group -> nested group -> ACE)
4. Supports recursive analysis (show permissions at each folder level in the path)
5. Highlights deny rules and permission conflicts
6. Results are exportable to CSV/PDF

### Story 3.4: State-in-Time Comparison

As a L3 support technician,
I want to compare an AD object's state between two points in time,
so that I can investigate what changed and when.

#### Acceptance Criteria
1. For any AD object, display replication metadata (attribute change timestamps)
2. User selects two timestamps and sees a diff of attribute values
3. Changes are highlighted with before/after values
4. Supports user, computer, and group objects
5. Graceful handling when replication metadata is limited or unavailable

---

## Epic 4: Group Management and Bulk Operations

**Goal**: Deliver a complete group management interface with tree/flat browsing, drag-and-drop member management, and group-centric bulk operations (Delete/Add/Transfer) for efficient batch processing.

### Story 4.1: Group Browser (Tree and Flat View)

As an AccountOperator,
I want to browse AD groups in a tree view by OU or in a flat searchable list,
so that I can quickly find and manage groups.

#### Acceptance Criteria
1. Tree view displays OU hierarchy with groups as leaf nodes
2. Flat view shows all groups in a searchable/sortable/filterable list
3. Toggle between tree and flat view
4. Selecting a group shows its details: name, DN, description, scope, category, member count
5. Group members are listed with type icons (user, computer, nested group)
6. Search works across both views with instant filtering
7. Large domains handled via lazy loading (expand OU on demand)

### Story 4.2: Group Member Management

As an AccountOperator,
I want to add and remove members from groups using drag-and-drop,
so that I can manage group memberships efficiently.

#### Acceptance Criteria
1. Drag users/computers/groups from search results or other groups into a target group
2. Multi-selection supported for batch add
3. Remove members via selection + delete or context menu
4. All changes show a dry-run preview before execution
5. Changes are logged to the audit log
6. Permission check: only AccountOperator+ can modify groups
7. Confirmation dialog summarizes all pending changes

### Story 4.3: Bulk Operations (Delete/Add/Transfer)

As an AccountOperator,
I want to perform group-centric bulk operations (Delete members, Add members, Transfer members between groups),
so that I can handle batch changes like team moves efficiently.

#### Acceptance Criteria
1. Bulk operation panel: select source group(s), target group(s), and operation type (D/A/T)
2. Member selection within source group with multi-select and select-all
3. Transfer (T) = Add to target + Delete from source (atomic operation)
4. Dry-run preview shows all changes before execution
5. Progress indicator for large batch operations
6. Rollback option if operation partially fails
7. Full audit logging of all changes

### Story 4.4: Empty and Circular Group Detection

As a DomainAdmin,
I want to identify empty groups and circular group nesting,
so that I can clean up AD group hygiene issues.

#### Acceptance Criteria
1. "Hygiene" tab in group management shows detected issues
2. Empty groups listed with name, OU, and creation date
3. Circular nesting detected and displayed as a warning with the nesting chain
4. One-click navigation to the problematic group
5. Bulk delete option for empty groups (with dry-run)

---

## Epic 5: Presets, Onboarding and Offboarding Workflows

**Goal**: Implement declarative role-based presets stored as JSON on a configurable network share, a preset editor within the UI, and guided onboarding/offboarding wizards with dry-run preview and formatted ticket output.

### Story 5.1: Preset Storage and Configuration

As an administrator,
I want to configure a network share path for storing presets and have DSPanel read/write presets from there,
so that presets are centralized and shared across the team.

#### Acceptance Criteria
1. Settings view allows configuring the preset storage path (UNC or local path)
2. Application validates path accessibility at startup and shows warning if unreachable
3. Presets are stored as individual JSON files (one per preset)
4. Preset JSON schema is validated on load (malformed files are reported, not silently ignored)
5. File watching detects external changes (if another DSPanel instance modifies a preset)

### Story 5.2: Preset Editor UI

As an AccountOperator,
I want to create and edit presets through the DSPanel UI,
so that I do not need to manually edit JSON files.

#### Acceptance Criteria
1. Preset list view shows all available presets with name, type (onboarding/offboarding), and target role/team
2. Preset editor form: name, description, type, target OU, list of AD groups (searchable picker), additional attributes
3. Group picker allows browsing/searching AD groups and adding them to the preset
4. Save validates the preset and writes JSON to the configured storage path
5. Delete preset with confirmation
6. Only AccountOperator+ can create/edit presets

### Story 5.3: Onboarding Wizard

As a L2 support technician,
I want a guided wizard for creating a new user with a preset,
so that onboarding is consistent, fast, and error-free.

#### Acceptance Criteria
1. Wizard steps: user details form, preset selection, preview diff, confirm and execute
2. User details: first name, last name, login convention (auto-generated), password (generated), target OU (from preset or override)
3. Preset selection shows which groups and settings will be applied
4. Preview diff shows a complete summary of all changes that will be made
5. Execution creates the user account, applies groups, and sets attributes
6. Output panel shows formatted summary (login, temp password, groups, OU, machine) copyable to clipboard
7. Full audit logging of the entire onboarding operation

### Story 5.4: Offboarding Workflow

As a L2 support technician,
I want a guided offboarding workflow,
so that departing users are consistently and securely deprovisioned.

#### Acceptance Criteria
1. Workflow triggered from user lookup view context menu
2. Steps: confirm user, preview current state, select offboarding actions, preview changes, execute
3. Available actions (each toggleable): disable account, remove from all groups, set mail forwarding, move to "Disabled Users" OU, reset password to random
4. Dry-run preview before execution
5. Output summary of all changes made, copyable for ticket
6. Full audit logging

---

## Epic 6: Exchange Diagnostics

**Goal**: Add read-only Exchange mailbox diagnostics (on-prem via LDAP and Online via Graph) to the user lookup view, giving support technicians immediate visibility into mail configuration without switching tools.

### Story 6.1: Exchange On-Prem Attributes (LDAP)

As a support technician,
I want to see Exchange on-prem mailbox information in the user lookup view,
so that I can diagnose mail issues without opening the Exchange console.

#### Acceptance Criteria
1. Exchange panel appears in user detail view when msExch* attributes are detected
2. Displays: mailbox name, email aliases (proxyAddresses), forwarding address, mailbox type
3. Displays delegations (msExchDelegateListBL) if present
4. Panel is hidden when no Exchange attributes exist (graceful degradation)
5. All data is read-only (no modification)

### Story 6.2: Exchange Online Diagnostics (Graph)

As a support technician,
I want to see Exchange Online mailbox information for hybrid/cloud users,
so that I can diagnose mail issues for O365 users.

#### Acceptance Criteria
1. Graph provider detects Exchange Online mailbox for the user
2. Displays: mailbox name, email aliases, forwarding rules, mailbox quota/usage, delegations
3. Requires Azure AD App Registration with Mail.Read permissions
4. Configuration for tenant ID and app credentials in settings
5. Panel is hidden when Graph is not configured or user has no Exchange Online mailbox
6. All data is read-only

---

## Epic 7: Administration and Object Management

**Goal**: Deliver administrative tools for DomainAdmin/AccountOperator users: moving objects between OUs, AD Recycle Bin access, contact and printer management, user photos, and object backup/restore for safe modifications.

### Story 7.1: Move Objects Between OUs

As an AccountOperator,
I want to move AD objects (users, computers, groups) between OUs,
so that I can reorganize AD structure as needed.

#### Acceptance Criteria
1. "Move to OU" action available from context menu on any AD object
2. OU picker shows the OU tree for target selection
3. Supports single and bulk move (multi-selection)
4. Dry-run preview shows source and destination for each object
5. Permission check: AccountOperator+ required
6. Audit logging of all moves

### Story 7.2: AD Recycle Bin

As a DomainAdmin,
I want to browse and restore deleted AD objects from the Recycle Bin,
so that I can recover accidental deletions.

#### Acceptance Criteria
1. Recycle Bin view lists all deleted objects with name, type, deletion date, and original OU
2. Search/filter within deleted objects
3. Restore selected object(s) to original location or a specified OU
4. Warning if AD Recycle Bin feature is not enabled on the domain
5. DomainAdmin permission required
6. Audit logging of all restorations

### Story 7.3: Contact and Printer Management

As an AccountOperator,
I want to view and manage AD contact and printer objects,
so that DSPanel covers all common AD object types.

#### Acceptance Criteria
1. Contacts appear in search results with a distinct icon
2. Contact detail view shows: name, email, phone, company, description
3. CRUD operations on contacts (create, edit, delete) for AccountOperator+
4. Printer objects viewable with name, location, server, share name
5. Printer management (create/delete) for DomainAdmin
6. Audit logging of all operations

### Story 7.4: User Thumbnail Photo

As an AccountOperator,
I want to view and update user thumbnail photos in AD,
so that directory photos stay current.

#### Acceptance Criteria
1. User detail view displays current thumbnail photo (or placeholder if none)
2. "Change Photo" button allows uploading a new image (JPG/PNG)
3. Image is resized to AD-appropriate dimensions (96x96 max) before upload
4. Photo removal option (set to empty)
5. AccountOperator+ permission required for modification
6. Audit logging

### Story 7.5: Object Backup and Restore

As a DomainAdmin,
I want DSPanel to snapshot an AD object before any modification,
so that I can rollback changes if something goes wrong.

#### Acceptance Criteria
1. Before any write operation, the object's current state is captured (all attributes)
2. Snapshots stored locally with timestamp, object DN, and operation type
3. "History" tab on object detail shows previous snapshots
4. "Restore" button applies a snapshot's attribute values back to the object
5. Dry-run preview before restore
6. Snapshot retention configurable (default: 30 days)
7. DomainAdmin permission for restore operations

---

## Epic 8: Infrastructure Health and Monitoring

**Goal**: Provide DomainAdmin users with a centralized view of AD infrastructure health: DC status, replication, DNS, Kerberos, remote workstation monitoring, and visual topology mapping.

### Story 8.1: Domain Controller Health Checks

As a DomainAdmin,
I want to see the health status of all domain controllers at a glance,
so that I can proactively identify infrastructure issues.

#### Acceptance Criteria
1. Infrastructure view lists all DCs with status cards
2. Each DC card shows: DNS status, AD services (NTDS, Netlogon, KDC), SYSVOL state, disk space, LDAP response time
3. Status color coding: green (healthy), yellow (warning), red (critical)
4. Auto-refresh on configurable interval
5. Click on a DC for detailed diagnostics
6. DomainAdmin permission required

### Story 8.2: AD Replication Status

As a DomainAdmin,
I want to see replication status between all domain controllers,
so that I can detect and troubleshoot replication issues.

#### Acceptance Criteria
1. Replication view shows all replication partnerships
2. Each partnership displays: source DC, target DC, last sync time, sync status, error count
3. Failed replications highlighted in red with error details
4. Latency metrics displayed
5. Manual "force replication" button (with confirmation)

### Story 8.3: DNS and Kerberos Validation

As a DomainAdmin,
I want to verify AD DNS records and Kerberos clock synchronization,
so that I can prevent authentication issues.

#### Acceptance Criteria
1. DNS check validates _ldap._tcp, _kerberos._tcp, and other critical SRV records
2. Results show expected vs actual records with pass/fail status
3. Kerberos check queries time offset between DCs and reports clock skew
4. Warning threshold configurable (default: 5 minutes skew)
5. Results exportable

### Story 8.4: Remote Workstation Monitoring

As a L2/L3 support technician,
I want to see real-time status of a remote workstation,
so that I can diagnose performance issues without RDP.

#### Acceptance Criteria
1. Accessible from computer lookup view
2. Displays: CPU usage, RAM usage, active user sessions, running services, disk space per volume
3. Data retrieved via WMI/CIM (requires network access to target machine)
4. Auto-refresh every 5 seconds while panel is open
5. Graceful degradation if WMI access is denied or machine unreachable

### Story 8.5: AD Topology Visualization

As a DomainAdmin,
I want to see a visual map of AD sites, domain controllers, and replication links,
so that I understand the infrastructure layout at a glance.

#### Acceptance Criteria
1. Visual graph/map showing AD sites as regions and DCs as nodes
2. Replication links shown as edges with status color coding
3. Site link costs and replication intervals displayed on edges
4. Interactive: click nodes for DC details, click edges for replication details
5. Zoomable and pannable canvas
6. Export as image (PNG)

---

## Epic 9: Security, Risk Scoring and Attack Detection

**Goal**: Deliver a security dashboard with domain-wide risk scoring, privileged account monitoring, basic AD attack detection (Golden Ticket, DCSync, DCShadow), and simplified privilege escalation path visualization.

### Story 9.1: Privileged Accounts Dashboard

As a DomainAdmin,
I want a dedicated view monitoring all privileged accounts,
so that I can ensure high-privilege accounts are properly secured.

#### Acceptance Criteria
1. Lists members of Domain Admins, Enterprise Admins, Schema Admins, and other configurable privileged groups
2. For each account: last logon, password age, password expires flag, enabled status
3. Alerts for: password older than 90 days, password never expires on admin account, never logged on, disabled but still in privileged group
4. Alert severity levels (critical, warning, info)
5. Export list to CSV/PDF
6. DomainAdmin permission required

### Story 9.2: Domain Risk Score

As a DomainAdmin,
I want a single risk score summarizing the security posture of my AD domain,
so that I can track improvements over time.

#### Acceptance Criteria
1. Risk score computed from weighted factors: privileged account hygiene, password policy compliance, stale accounts, dangerous configurations
2. Score displayed as gauge (0-100) with color zones (green/yellow/orange/red)
3. Breakdown showing individual factor scores with explanations
4. Recommendations for improving each factor
5. Historical trend (score over last 30 days stored locally)
6. Factors and weights are configurable

### Story 9.3: AD Attack Detection

As a DomainAdmin,
I want DSPanel to detect common AD attacks based on event log analysis,
so that I can identify potential security breaches.

#### Acceptance Criteria
1. Monitors for: Golden Ticket indicators (TGT with unusual lifetime), DCSync (DS-Replication-Get-Changes requests from non-DC), DCShadow (rogue DC registration), abnormal Kerberos activity
2. Detection based on Windows Security Event Log analysis (event IDs 4768, 4769, 4662, etc.)
3. Alerts displayed in security dashboard with severity, timestamp, source, and description
4. Alert details include recommended response actions
5. Configurable alert thresholds and event log sources
6. DomainAdmin permission required

### Story 9.4: Privilege Escalation Path Visualization

As a DomainAdmin,
I want to visualize privilege escalation paths in my AD,
so that I can identify and remediate dangerous permission chains.

#### Acceptance Criteria
1. Graph visualization showing paths from standard user groups to privileged groups
2. Paths consider: direct membership, nested groups, group ownership, delegation permissions
3. Nodes represent groups/users, edges represent relationships
4. Critical paths highlighted (shortest path to Domain Admin)
5. Click on any node for details
6. DomainAdmin permission required

---

## Epic 10: Reports, Export and Compliance

**Goal**: Implement comprehensive reporting capabilities: CSV/PDF export from any view, scheduled report generation, automated account cleanup, and compliance-ready report templates for regulatory audits.

### Story 10.1: CSV and PDF Export

As a support technician,
I want to export any search results, group memberships, or reports to CSV or PDF,
so that I can share data with colleagues and document findings.

#### Acceptance Criteria
1. Export button available in all list/table views (search results, group members, comparison, reports)
2. CSV export with proper encoding (UTF-8 BOM) and delimiter options
3. PDF export with headers, timestamps, and page numbers
4. File save dialog with suggested filename based on context
5. Large exports show progress indicator

### Story 10.2: Scheduled Reports

As a DomainAdmin,
I want to schedule recurring reports (inactive accounts, expired passwords, empty groups),
so that I receive regular hygiene reports without manual effort.

#### Acceptance Criteria
1. Report scheduler UI: select report type, frequency (daily/weekly/monthly), output format, destination (local folder or email)
2. Available report types: inactive accounts (configurable threshold), expired passwords, password never expires, empty groups, orphaned computer accounts, privileged account summary
3. Reports run in background (Windows Task Scheduler integration or in-app scheduler)
4. Report history shows previous runs with status and output links
5. DomainAdmin permission required for scheduling

### Story 10.3: Automated Cleanup

As a DomainAdmin,
I want to automate cleanup of stale accounts based on configurable criteria,
so that AD stays clean without manual intervention.

#### Acceptance Criteria
1. Cleanup rules: inactive for X days, never logged on + created more than Y days ago, disabled for more than Z days
2. Actions: disable, move to cleanup OU, delete (escalating severity)
3. Mandatory dry-run preview showing all affected objects before execution
4. Execution requires explicit confirmation after dry-run review
5. Full audit logging of all cleanup actions
6. DomainAdmin permission required

### Story 10.4: Compliance Report Templates

As a DomainAdmin,
I want predefined compliance report templates (GDPR, HIPAA, SOX),
so that I can generate audit-ready reports for compliance reviews.

#### Acceptance Criteria
1. Template library with predefined compliance report types
2. Each template specifies which data points to collect and how to present them
3. Generated reports include: executive summary, findings, evidence tables, recommendations
4. Reports include timestamp and generator identification
5. Export as PDF with professional formatting
6. Templates are extensible (admin can create custom templates)

---

## Epic 11: Audit, Automation and Extensibility

**Goal**: Deliver the internal audit log, AD change history timeline, trigger-based automation rules, external script execution, webhook notifications, and GPO viewer to make DSPanel a complete operational platform.

### Story 11.1: Internal Audit Log

As an auditor,
I want to search and review all actions performed in DSPanel,
so that I can verify compliance and investigate incidents.

#### Acceptance Criteria
1. Audit log view with searchable/filterable table: timestamp, user, action type, target object, details, result (success/failure)
2. Log stored locally (SQLite database)
3. Filters: date range, user, action type, target object
4. Export to CSV/PDF
5. Log retention configurable (default: 1 year)
6. All write operations throughout the application feed into this log (retroactive verification)

### Story 11.2: AD Change History Timeline

As a L3 support technician,
I want to see a timeline of changes made to any AD object,
so that I can investigate "what changed and when" for troubleshooting.

#### Acceptance Criteria
1. "History" tab on any AD object detail view
2. Timeline shows attribute changes with timestamps, before/after values
3. Data sourced from AD replication metadata (msDS-ReplAttributeMetaData)
4. Sortable by date, filterable by attribute name
5. Visual diff for multi-value attributes (group membership changes)

### Story 11.3: Trigger-Based Automation

As a DomainAdmin,
I want to define automation rules (if X then Y) on AD changes,
so that routine operations happen automatically.

#### Acceptance Criteria
1. Rule editor UI: trigger condition + action(s)
2. Trigger types: object created in OU, object moved to OU, group membership changed, attribute changed
3. Action types: apply preset, add/remove from group, send notification, execute script
4. Rules can be enabled/disabled individually
5. Rule execution is logged in audit log
6. Dry-run mode for testing rules
7. DomainAdmin permission required

### Story 11.4: External Script Execution

As a DomainAdmin,
I want to execute external scripts (PowerShell/exe) with the selected AD object's context,
so that I can extend DSPanel with custom actions.

#### Acceptance Criteria
1. "Run Script" context menu on any AD object
2. Script library configurable in settings (path to folder with approved scripts)
3. Object attributes passed to script as parameters (SAMAccountName, DN, email, etc.)
4. Script output captured and displayed in a result panel
5. Scripts run with the current user's credentials (no privilege escalation)
6. Audit logging of all script executions
7. DomainAdmin permission required

### Story 11.5: Webhook Notifications

As a DomainAdmin,
I want to receive notifications (Teams, Slack, email) on configurable events,
so that I am alerted to important AD changes without watching DSPanel.

#### Acceptance Criteria
1. Notification configuration UI: event type + channel + recipients
2. Supported channels: webhook URL (Teams/Slack), SMTP email
3. Configurable events: account lockout, privileged group change, security alert, automation rule triggered
4. Notification payload includes event details (who, what, when, target)
5. Test notification button to verify configuration
6. Notification history log

### Story 11.6: GPO Viewer

As a DomainAdmin,
I want to see which GPOs apply to a user, computer, or OU,
so that I can troubleshoot Group Policy issues.

#### Acceptance Criteria
1. GPO panel accessible from user/computer/OU detail views
2. Lists all GPOs applying to the selected scope (linked + inherited)
3. Shows GPO name, link order, enforcement status, WMI filter
4. "What-if" mode: simulate GPO application for a user at a specific OU
5. GPO scope report: for a selected GPO, show all OUs/objects it applies to
6. Read-only view (no GPO modification)
7. DomainAdmin permission required

---

## Epic 12: RBAC, Settings and Polish

**Goal**: Implement granular RBAC configuration within DSPanel, centralize all application settings, add auto-update notifications, prepare for localization, and finalize UX polish for a production-ready release.

### Story 12.1: Granular RBAC Configuration

As a DomainAdmin,
I want to define custom permission profiles in DSPanel beyond the 4 default levels,
so that I can precisely control who can do what, per OU if needed.

#### Acceptance Criteria
1. RBAC configuration UI in settings (DomainAdmin only)
2. Custom profiles: name, base level, feature overrides (enable/disable specific actions)
3. OU-scoped permissions: a profile can be restricted to specific OUs
4. Profile assignment: map AD groups to custom profiles
5. Custom profiles override default level behavior
6. Changes saved to preset storage (shared across instances)
7. Audit logging of RBAC changes

### Story 12.2: Application Settings

As a user,
I want a centralized settings view to configure all DSPanel options,
so that I can customize the tool to my environment.

#### Acceptance Criteria
1. Settings organized by category: Connection, Presets, Security, Notifications, Reports, Appearance
2. Connection: domain override, preferred DC, Graph tenant/app config
3. Presets: storage path configuration
4. Security: MFA settings, audit log retention
5. Appearance: dark/light theme toggle, language selection
6. Settings persisted locally (per-user) with sensible defaults
7. Settings validation with clear error messages

### Story 12.3: Auto-Update Notification

As a user,
I want DSPanel to notify me when a newer version is available,
so that I stay up to date.

#### Acceptance Criteria
1. At startup, check GitHub Releases API for the latest version
2. If newer version available, show a non-blocking notification bar with version number and release notes link
3. "Download" button opens the GitHub release page in browser
4. "Skip this version" and "Remind me later" options
5. Check frequency configurable (default: every startup)
6. Works without internet (silently skips check)

### Story 12.4: Localization Support

As a French-speaking user,
I want DSPanel to be available in French,
so that I can use the tool in my preferred language.

#### Acceptance Criteria
1. All user-facing strings externalized to .resx resource files
2. English (en) as default language
3. French (fr) translation provided
4. Language selection in settings (requires restart)
5. Date, number, and currency formatting follows selected locale
6. Developer documentation explains how to add new languages

### Story 12.5: UX Polish and Final Touches

As a user,
I want DSPanel to feel polished and professional,
so that it inspires confidence for daily production use.

#### Acceptance Criteria
1. Dark and light theme with proper contrast in all views
2. Keyboard shortcuts for common actions (Ctrl+F search, Ctrl+R refresh, etc.)
3. Loading indicators on all async operations
4. Error handling with user-friendly messages (no raw exceptions)
5. Window state persistence (size, position, last active tab)
6. Application icon and branding applied consistently
7. About dialog with version, license, and links

---

## Next Steps

### UX Expert Prompt

Review the DSPanel PRD (docs/prd.md) and create a detailed front-end specification for the WPF desktop application. Focus on the navigation shell, core screen layouts (13 views), component hierarchy, theming system (dark/light), and interaction patterns (search-first, drag-and-drop, dry-run previews). The application is WPF/.NET 10 with CommunityToolkit.Mvvm.

### Architect Prompt

Review the DSPanel PRD (docs/prd.md) and create the technical architecture document. Key decisions to address: IDirectoryProvider abstraction (LDAP vs Graph), permission detection system, preset engine (JSON on network share), audit log storage (SQLite), NTFS/ACL resolution, WMI remote monitoring, event log analysis for attack detection, and the MVVM/DI structure. Target stack: WPF, .NET 10, System.DirectoryServices.Protocols, Microsoft.Graph SDK, CommunityToolkit.Mvvm, Serilog, xUnit.
