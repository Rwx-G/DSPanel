# Epic 1: Foundation and Core Lookup

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
