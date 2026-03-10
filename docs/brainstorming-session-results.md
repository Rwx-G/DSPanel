# DSPanel - Brainstorming Session Results

## Executive Summary

- **Topic**: Full functional scope of DSPanel - Active Directory support and administration tool for Windows environments
- **Objective**: 100% coverage of the AD support chain (ReadOnly, L1, L2, L3, DomainAdmin) in a single tool
- **Techniques used**: Role Playing (L1/L2/L3/Admin), competitive research (BLAZAM, ADTools, ManageEngine, Quest, Netwrix, Adaxes, SolarWinds)
- **Total features identified**: 57
- **Context**: Replacement of aging but functional internal tools + addition of modern features inspired by commercial solutions
- **Differentiation**: Open source tool (MIT) offering features typically reserved for paid solutions (risk score, AD attack detection, NTFS permissions analyzer)

---

## Modules and Features

### Module A - Lookup & Diagnostics

| # | Feature | Description | Source |
|---|---------|-------------|--------|
| 1 | **User account lookup** | Search by SAM, UPN, name - display complete info (name, department, title, OU, DN) | Internal tools |
| 2 | **Computer account lookup** | Search by machine name - OS, version, last logon, OU, groups | Internal tools |
| 3 | **Visual healthcheck badge** | Visual indicator per account: expired, inactive 30/90d, password never changed, never logged on, locked out, disabled | Brainstorm |
| 4 | **Authentication info** | Failed password count, last logon, last workstation used + IP | Role Playing L1 |
| 5 | **Workstation ping** | ICMP ping from within the tool, DNS resolution | Role Playing L1 |
| 6 | **Exchange query (on-prem)** | Mailbox name, aliases, forwarding, quotas, delegations - read-only via LDAP attributes (msExch*) | Brainstorm |
| 7 | **Exchange query (Online/O365)** | Same info via Microsoft Graph API - read-only / diagnostics | Brainstorm |
| 8 | **Login/Logout logs** | Login history for a workstation or user | ADTools |
| 9 | **Lockout diagnostics** | Trace lockout source: which DC, which IP, which process | Competitive research |
| 10 | **Advanced LDAP search** | Custom LDAP filter for power users / L3 | ADTools |

### Module B - Comparison & Permissions Audit

| # | Feature | Description | Source |
|---|---------|-------------|--------|
| 11 | **Side-by-side comparison** | Compare security groups of 2 users with visual delta | Internal tools + Role Playing L1 |
| 12 | **UNC path permissions audit** | Provide a path (\\\\NAS\folder) - resolve ACLs - which groups have which permissions - cross-reference with compared users' groups | Role Playing L1 |
| 13 | **NTFS Permissions Analyzer** | Cross-reference NTFS folder permissions with AD groups - answer "why does X have access but not Y" | SolarWinds / ManageEngine |
| 14 | **State-in-Time comparison** | Compare an AD object's configuration between two dates | Netwrix |

### Module C - Group Management

| # | Feature | Description | Source |
|---|---------|-------------|--------|
| 15 | **Group tree view** | Hierarchical view (tree view) of OUs and groups + flat view | Internal tools |
| 16 | **Add/remove members** | Drag & drop, multi-selection | Internal tools |
| 17 | **Bulk operations (D/A/T)** | Group-centric view: Delete / Add / Transfer members between groups, multi-selection of target accounts | Role Playing L2 |
| 18 | **Empty / circular groups** | Detection of groups with no members or circular nesting | Competitive research |

### Module D - Presets & Workflows

| # | Feature | Description | Source |
|---|---------|-------------|--------|
| 19 | **Presets per role/team** | Declarative templates (AD groups, target OU, drive mappings) - Terraform-style - stored as JSON/YAML on configurable network share | Role Playing L2 |
| 20 | **Preset management via UI** | Create/edit presets exclusively through the DSPanel interface - no manual file editing | Role Playing L2 |
| 21 | **Onboarding wizard** | Guided form - preset selection - preview diff - execute - formatted output for ticket (login, temp password, groups, machine) | Role Playing L2 |
| 22 | **Offboarding workflow** | Disable account, remove groups, mail forwarding, move to "disabled users" OU - guided sequence | Brainstorm |
| 23 | **Dry-run / preview** | Simulation mode before any execution (presets, bulk ops, workflows) - display diff without applying | Brainstorm |

### Module E - Support Actions

| # | Feature | Description | Source |
|---|---------|-------------|--------|
| 24 | **Password reset** | Reset password with options (must change at next logon, etc.) | Internal tools |
| 25 | **Account unlock** | Unlock a locked-out account | Internal tools |
| 26 | **Enable / Disable account** | Enable or disable a user account | Internal tools |
| 27 | **MFA before sensitive action** | Additional identity verification before critical actions (password reset, deletion) | Specops / ManageEngine |
| 28 | **Secure password generation** | Built-in generator + verification against compromised password databases (HaveIBeenPwned) | Competitive research |
| 29 | **Password Never Expires / Cannot Change** | Password flag management checkboxes | Internal tools |

### Module F - Object Administration

| # | Feature | Description | Source |
|---|---------|-------------|--------|
| 30 | **Move objects between OUs** | Single + bulk, with preview | Brainstorm |
| 31 | **AD Recycle Bin** | Restore deleted objects from the AD Recycle Bin | BLAZAM |
| 32 | **AD contact management** | CRUD on contact objects (not just users/computers/groups) | ADTools |
| 33 | **AD printer management** | View and manage printer objects | BLAZAM |
| 34 | **User photo (thumbnail)** | Display + modification of AD photo | ADTools / BLAZAM |
| 35 | **Object backup/restore** | Snapshot of an object before modification - one-click rollback | Quest Active Administrator |

### Module G - Infrastructure Monitoring & Health

| # | Feature | Description | Source |
|---|---------|-------------|--------|
| 36 | **DC health** | Check DNS, AD services (NTDS, Netlogon, KDC), SYSVOL, disk space, LDAP response time | Competitive research |
| 37 | **AD replication** | Replication status between DCs, error detection, latency | Competitive research |
| 38 | **DNS health check** | Verify AD-related DNS records (_ldap._tcp, _kerberos._tcp, SRV records) | Competitive research |
| 39 | **Kerberos / clock skew** | Time synchronization check between DCs and workstations | Competitive research |
| 40 | **Real-time workstation monitoring** | CPU, RAM, active sessions, services, disks on a remote workstation | BLAZAM |
| 41 | **Visual AD topology** | Map of AD sites, DCs, replication links - overview | Competitive research |
| 42 | **Privileged accounts dashboard** | Dedicated view: Domain Admins, Enterprise Admins, Schema Admins members - alerts for expired/unchanged passwords | Competitive research |

### Module H - Reports & Export

| # | Feature | Description | Source |
|---|---------|-------------|--------|
| 43 | **CSV export** | Export groups, members, OUs, search results | Internal tools |
| 44 | **PDF export** | Formatted reports for printing / archiving | Competitive research |
| 45 | **Scheduled reports** | Inactive accounts, expired passwords, empty groups, orphaned machines - automatic scheduling | Competitive research |
| 46 | **Automated cleanup** | Disable/delete based on criteria (inactive X days, never logged on) with mandatory dry-run | Competitive research |
| 47 | **Compliance reports** | Pre-formatted reports for GDPR / HIPAA / SOX - audit-ready | Netwrix / ManageEngine |

### Module I - Audit, Security & Traceability

| # | Feature | Description | Source |
|---|---------|-------------|--------|
| 48 | **DSPanel internal audit log** | Log of all actions performed in the tool: who, what, when, on which object | BLAZAM |
| 49 | **AD change history** | Timeline of recent modifications on an object (via replication metadata) | Competitive research |
| 50 | **Risk Score / security posture** | Domain-wide risk score: privileged accounts, weak passwords, dangerous configurations | ManageEngine / Netwrix |
| 51 | **AD attack detection** | Alerts for Golden Ticket, DCSync, DCShadow, abnormal Kerberos activity | Competitive research |
| 52 | **Privilege escalation paths** | Visual map of privilege escalation paths (simplified BloodHound style) | Competitive research |
| 53 | **Triggers / automation** | "If X then Y" rules on AD changes (e.g., new user in OU X triggers preset Y) | BLAZAM |

### Module J - Extensibility & Integration

| # | Feature | Description | Source |
|---|---------|-------------|--------|
| 54 | **External script execution** | Run a PowerShell script/exe with the selected object's context as parameters | ADTools |
| 55 | **Webhooks / notifications** | Alert on configurable events (lockout, privilege changes, etc.) to Teams/Slack/email | BLAZAM |
| 56 | **GPO viewer** | View which GPOs apply to a user/computer/OU + scope report + what-if modeling | ManageEngine / Quest |
| 57 | **Internal DSPanel delegation** | Granular RBAC within the tool - beyond the 4 levels, customize who can see/do what per OU | Adaxes / BLAZAM |

---

## Permission Levels - Access Matrix

The dynamic permission system adapts the UI based on the Windows account running DSPanel:

| Level | Associated AD Groups | Access |
|-------|---------------------|--------|
| **ReadOnly** | No specific group / standard user | Lookup, view, export - no modification actions |
| **HelpDesk (L1)** | Configurable group (e.g., `DSPanel-HelpDesk`) | + Password reset, unlock, lockout diagnostics, ping |
| **AccountOperator (L2)** | Configurable group (e.g., `DSPanel-AccountOps`) | + Group management, presets, onboarding/offboarding, bulk ops |
| **DomainAdmin (L3+)** | Domain Admins / configurable group | + Object administration, infrastructure monitoring, security, GPO, triggers, internal RBAC |

---

## Supported Technical Contexts

| Context | Technology | Detection |
|---------|-----------|-----------|
| **AD on-prem** | LDAP via System.DirectoryServices.Protocols | Auto-detection at startup |
| **Entra ID (Azure AD)** | Microsoft Graph SDK | Auto-detection at startup |
| **Exchange on-prem** | LDAP attributes msExch* + Remote PowerShell (optional) | Detection of Exchange attributes presence |
| **Exchange Online** | Microsoft Graph API | O365 tenant detection |

`IDirectoryProvider` adapter pattern for context abstraction.

---

## Inspirations & Sources

### Replaced Tools
- Internal legacy tools for user lookup and group administration

### Open Source Tools Studied
- **BLAZAM** - https://github.com/Blazam-App/BLAZAM (web-based, .NET, full AD management with delegation and automation)
- **ADTools** - https://github.com/ramer/ADTools (WPF, LDAP, cross-domain search, Exchange integration)
- **ADxRay** - https://github.com/ClaudioMerola/ADxRay (AD health check, HTML report)

### Commercial Tools Studied
- **ManageEngine ADManager Plus / ADAudit Plus** - 200+ reports, risk score, compliance, hybrid management
- **Quest Active Administrator** - 100+ diagnostic tests, backup/restore, GPO management
- **Netwrix Auditor** - Audit, state-in-time, compliance, threat detection
- **Adaxes** - Advanced RBAC, granular delegation, automation
- **SolarWinds Permissions Analyzer** - NTFS analysis crossed with AD
- **Specops uReset** - Advanced MFA for password reset

---

## Reflections & Next Steps

- **Ambitious scope (57 features)** - will require phased prioritization during PRD creation
- **Key differentiation**: free open source tool offering features typically found only in paid solutions (NTFS analyzer, risk score, attack detection)
- **Architecture**: the `IDirectoryProvider` pattern (AD on-prem / Entra ID) is essential from the start to support both contexts
- **UX**: dynamic UI adaptation based on permissions is the core UX principle
- **Next steps**: Project Brief, PRD, Technical Architecture
