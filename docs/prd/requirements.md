# Requirements

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
