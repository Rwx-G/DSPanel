# Project Brief: DSPanel

## Executive Summary

**DSPanel** is an open source Windows desktop tool (Tauri v2 / React / TypeScript with a Rust backend) that unifies Active Directory support and administration into a single application. It replaces and surpasses aging, fragmented internal tools while adding modern features typically reserved for commercial solutions (NTFS permissions analysis, risk scoring, AD attack detection).

**Core problem**: the Windows/AD support chain is currently fragmented across multiple tools (RSAT, PowerShell, in-house utilities, Exchange consoles), with no integrated permission management - each support level uses different tools, increasing error risk and wasting time.

**Target market**: L1/L2/L3 support teams and Windows sysadmins in on-prem and/or hybrid AD environments (Entra ID).

**Value proposition**: a single tool, adaptive to the user's permissions, covering 100% of the chain - from simple read-only lookups to advanced administration and security monitoring.

---

## Problem Statement

### Current State and Pain Points

- **Tool fragmentation**: L1 support uses one tool for user lookup, another for group management, PowerShell for bulk operations, the Exchange console for mail diagnostics, and RSAT for advanced administration. No single tool covers the entire chain.
- **No integrated permission management**: existing tools do not distinguish permission levels. An L1 technician has access to the same buttons as a DomainAdmin, risking unauthorized actions or errors.
- **Aging tools**: current internal tools are functional but no longer actively maintained, do not support hybrid environments (Entra ID / Exchange Online), and lack modern features (presets, dry-run, audit).
- **Operational time waste**: switching between 3 to 5 tools to handle a simple ticket (password reset + group check + Exchange diagnostics) creates delays and friction.
- **No traceability**: none of the current internal solutions track who did what, making audit and compliance impossible.

### Impact

- Ticket resolution time increased by tool fragmentation
- Human error risk due to lack of safeguards (no dry-run, no granular permissions)
- Impossible to demonstrate compliance to auditors (no action logs)
- Difficulty onboarding new support technicians (multi-tool training)

### Why Existing Solutions Fall Short

- **RSAT / ADUC**: powerful but complex, not suited for L1 support, no guided workflows
- **PowerShell**: flexible but requires scripting skills, no graphical interface
- **Commercial tools** (ManageEngine, Quest, Netwrix): expensive (licensing), often web-based, vendor lock-in, features scattered across multiple products
- **BLAZAM** (open source): web-based only, no desktop version, no NTFS analysis or attack detection

### Urgency

Current internal tools are no longer maintained. The growing adoption of Entra ID in hybrid environments makes their replacement necessary in the short term.

---

## Proposed Solution

### Concept

DSPanel is a single Windows desktop application covering the entire Active Directory support and administration lifecycle. The interface dynamically adapts to the permissions of the Windows account running the application: features are shown, grayed out, or hidden based on the detected permission level (ReadOnly, HelpDesk, AccountOperator, DomainAdmin).

### Key Differentiators

1. **Single tool for the entire chain** - from L1 lookup to DomainAdmin administration, in one window
2. **Adaptive permissions** - the UI automatically adapts to the user's AD profile, with no manual configuration
3. **Hybrid on-prem + cloud** - native support for AD on-prem (LDAP) and Entra ID (Microsoft Graph) with automatic detection
4. **"Premium" features as open source** - NTFS analysis crossed with AD, risk scoring, AD attack detection, compliance reports
5. **Declarative presets** - onboarding/offboarding templates in Infrastructure-as-Code style (JSON/YAML), managed via the UI
6. **Systematic dry-run** - preview of all modifications before execution

### Product Vision

A tool that every IT team member opens first thing in the morning - from the L1 technician handling password reset tickets to the DomainAdmin monitoring AD infrastructure health.

---

## Target Users

### Primary Segment: L1/L2 Support

- **Profile**: helpdesk technicians, 1 to 3 years of experience, Windows environment
- **Current workflow**: receive tickets, search in ADUC/in-house tool, perform action (reset, unlock, add to group), document in ticketing system
- **Pain points**: tool multiplication, no quick account comparison, no account healthcheck overview, tedious bulk operations
- **Goal**: resolve tickets faster with fewer error risks

### Secondary Segment: Sysadmins / L3 Support

- **Profile**: Windows system administrators, 5+ years of experience, responsible for AD infrastructure
- **Current workflow**: PowerShell + RSAT + multiple consoles for diagnostics, maintenance, and security
- **Pain points**: no centralized dashboard for AD health, manual scripts for reports, no real-time visibility on AD security risks
- **Goal**: proactive monitoring, simplified maintenance, strengthened security posture

---

## Goals & Success Metrics

### Business Objectives

- Reduce the number of tools required for AD support from 5+ to 1
- Eliminate errors caused by lack of safeguards (permissions, dry-run)
- Provide full action traceability for audits
- Offer a credible open source alternative to commercial solutions

### User Success Metrics

- Resolution time for a standard L1 ticket (password reset + verification) reduced
- Number of clicks to complete a common operation (lookup, action, documentation)
- Adoption rate: the tool becomes the primary support tool, replacing fragmented alternatives
- User satisfaction: the tool is perceived as faster and safer than the current workflow

### Key Performance Indicators (KPIs)

- **Adoption**: number of downloads / active installations
- **GitHub engagement**: stars, forks, contributions, open/closed issues
- **Feature coverage**: percentage of the 57 identified features implemented
- **Reliability**: number of critical bugs reported per release

---

## MVP Scope

### Core Features (Must Have)

_Note: the full scope (57 features, 10 modules) is documented in the brainstorming results. No prioritization has been defined at this stage - all features are retained. Phased prioritization (MVP, V2, V3, V4) will be done during PRD creation._

**Module A - Lookup & Diagnostics**

- User account lookup (complete info, groups, OU, status)
- Computer account lookup
- Visual healthcheck badge (expired, inactive, password never changed, locked out, disabled)
- Authentication info (failed passwords, last logon, last workstation + IP)
- Workstation ping (ICMP + DNS resolution)
- Exchange on-prem query (mailbox, aliases, forwarding, quotas, delegations - read-only)
- Exchange Online/O365 query (via Graph - read-only)
- Login/Logout logs
- Lockout diagnostics (source DC, IP, process)
- Advanced LDAP search (custom filter)

**Module B - Comparison & Permissions Audit**

- Side-by-side comparison of 2 users (visual group delta)
- UNC path permissions audit (ACL, groups, user cross-reference)
- NTFS Permissions Analyzer (cross-reference NTFS permissions / AD groups)
- State-in-Time comparison

**Module C - Group Management**

- Group tree view (hierarchy + flat view)
- Add/remove members (drag & drop, multi-selection)
- Group-centric bulk operations (D=Delete, A=Add, T=Transfer)
- Empty / circular group detection

**Module D - Presets & Workflows**

- Presets per role/team (JSON/YAML on configurable network share)
- Preset management via UI (create/edit exclusively through the tool)
- Onboarding wizard (form, preset, preview, execute, ticket output)
- Offboarding workflow (disable, remove groups, mail forwarding, OU move)
- Systematic dry-run / preview before any execution

**Module E - Support Actions**

- Password reset (with options: must change at next logon, etc.)
- Account unlock
- Enable / Disable account
- MFA before sensitive actions
- Secure password generation (+ HaveIBeenPwned verification)
- Password flag management (Password Never Expires, Cannot Change)

**Module F - Object Administration**

- Move objects between OUs (single + bulk)
- AD Recycle Bin (restore deleted objects)
- AD contact management
- AD printer management
- User photo (thumbnail - display + modification)
- Object backup/restore (snapshot before modification, rollback)

**Module G - Infrastructure Monitoring & Health**

- DC health (DNS, AD services, SYSVOL, disk space, LDAP response time)
- AD replication (status, errors, latency between DCs)
- DNS health check (SRV records: \_ldap, \_kerberos)
- Kerberos / clock skew (time sync between DCs/workstations)
- Real-time remote workstation monitoring (CPU, RAM, sessions, services, disks)
- Visual AD topology (site map, DCs, replication links)
- Privileged accounts dashboard (Domain/Enterprise/Schema Admins + password alerts)

**Module H - Reports & Export**

- CSV export (groups, members, OUs, results)
- PDF export (formatted reports)
- Scheduled reports (inactive accounts, expired passwords, empty groups, orphaned machines)
- Automated cleanup (disable/delete based on criteria with mandatory dry-run)
- Compliance reports (GDPR / HIPAA / SOX)

**Module I - Audit, Security & Traceability**

- DSPanel internal audit log (who, what, when, on which object)
- AD change history (timeline via replication metadata)
- Risk Score / security posture (domain-wide score)
- AD attack detection (Golden Ticket, DCSync, DCShadow, abnormal Kerberos)
- Privilege escalation paths (visual map, simplified BloodHound style)
- Triggers / automation ("if X then Y" rules on AD changes)

**Module J - Extensibility & Integration**

- External script execution (PowerShell/exe with object context)
- Webhooks / notifications (Teams, Slack, email)
- GPO viewer (which GPOs apply where + scope report + what-if)
- Internal DSPanel delegation (granular RBAC customizable per OU)

### Out of Scope for MVP

_No exclusions defined at this stage. Prioritization will be done in the PRD._

### MVP Success Criteria

The tool fully replaces existing internal tools for L1/L2 support and is adopted as the primary tool by the support team.

---

## Post-MVP Vision

### Phase 2+ Features

_No phasing defined - all 57 features are in the global scope. Sequencing will be defined in the PRD based on technical complexity and user value._

### Long-term Vision

DSPanel becomes the open source reference for desktop AD administration, positioned as a credible alternative to commercial solutions (ManageEngine ADManager Plus, Quest Active Administrator). The tool is adopted beyond the internal team, by the Windows sysadmin community.

### Expansion Opportunities

- **Plugin system**: extensible architecture for community modules
- **Multi-tenant**: support for multiple AD forests and domains
- **ITSM integration**: direct connection to ticketing systems (ServiceNow, GLPI, Jira Service Management)
- **Lightweight SaaS mode**: companion web version for simple operations (lookup, password reset) from a browser
- **Mobile companion**: mobile app for urgent operations outside the office

---

## Technical Considerations

### Platform Requirements

- **Target Platform**: Windows 10/11 (x64)
- **Backend Runtime**: Rust (compiled native binary via Tauri v2)
- **UI Framework**: React + TypeScript (Vite bundler, rendered in Tauri webview)
- **Performance**: startup < 3s, AD search < 1s on local network, UI responsive even on large domains (100k+ objects)

### Technology Preferences

- **Frontend**: React 19 + TypeScript, Vite, CSS Modules
- **Backend**: Rust with Tauri v2 for desktop shell and system integration
- **AD on-prem**: ldap3 crate (Rust LDAP client)
- **HTTP client**: reqwest crate (for Graph API, HaveIBeenPwned, etc.)
- **Serialization**: serde + serde_json
- **Preset storage**: JSON/YAML on configurable network share
- **Logging**: tracing crate (Rust structured logging)
- **Error handling**: thiserror crate (Rust typed errors)
- **Frontend testing**: Vitest + React Testing Library
- **Backend testing**: Rust built-in test framework (cargo test)

### Architecture Considerations

- **Repository**: monorepo (src-tauri/ for Rust backend, src/ for React frontend)
- **Key pattern**: DirectoryProvider trait (adapter pattern) for AD on-prem vs Entra ID abstraction - automatic context detection at startup
- **Permissions**: detect current Windows account's AD groups at launch, map to PermissionLevel (ReadOnly, HelpDesk, AccountOperator, DomainAdmin)
- **Security**: no sensitive data stored locally, optional MFA before critical actions, audit log of all actions
- **Distribution**: NSIS installer + portable exe (zip) via Tauri bundler

---

## Constraints & Assumptions

### Constraints

- **Budget**: none - open source project, developed on personal time
- **Timeline**: no imposed deadline, incremental delivery
- **Resources**: single lead developer + community contributions over time
- **Technical**: Tauri webview requires Windows WebView2 runtime (pre-installed on Windows 10/11), requires an AD environment for real testing

### Key Assumptions

- Target environments have at minimum a functional on-prem AD
- The Windows account running DSPanel has at minimum read access to the AD directory
- JSON/YAML presets will be stored on a network share accessible to tool users
- Exchange on-prem query is feasible via LDAP msExch\* attributes without requiring a dedicated Exchange Management Shell server
- For Exchange Online and Entra ID, an Azure AD App Registration with appropriate permissions will be configured
- AD attack detection features will be based on event log analysis and AD metadata, not a network agent

---

## Risks & Open Questions

### Key Risks

- **Scope complexity**: 57 features is a very ambitious scope for a solo developer. Risk of feature creep or abandonment without strict prioritization in the PRD.
- **Real environment testing**: AD features require a test domain. Some features (replication, multi-DC, Exchange) are difficult to test without dedicated infrastructure.
- **Permissions and security**: a tool that performs password resets and group management must be flawless in terms of security. A vulnerability could compromise the entire AD domain.
- **Exchange on-prem compatibility**: LDAP msExch\* attributes cover basic info but some data (actual quotas, mailbox stats) may require Remote PowerShell Exchange.
- **Performance on large domains**: LDAP queries on 100k+ object domains with complex filters can be slow. Pagination and caching will be critical.
- **AD attack detection**: ambitious feature requiring specific security expertise (Kerberos, Golden Ticket, DCSync). Risk of false positives/negatives.

### Open Questions

- Which format to prefer for presets: JSON or YAML? (both are supported, but one should be the default)
- How to handle "MFA before sensitive action" without depending on a specific external MFA provider?
- Is an "offline" / cache mode needed for environments with intermittent connectivity?
- How to handle tool updates: silent auto-update, notification, or manual only?
- What strategy for multi-domain forests from V1?

### Areas Needing Further Research

- Technical feasibility of AD attack detection (Golden Ticket, DCSync) from a desktop tool without an agent
- Microsoft Graph APIs available for Exchange Online in read-only mode (quotas, delegations, forwarding)
- Performance comparison: ldap3 crate vs alternative Rust LDAP clients
- Rust crates for remote NTFS/ACL analysis (windows-rs for Win32 API access)
- Compliance report standards (GDPR, SOX) - format and content expected by auditors

---

## Appendices

### A. Research Summary

**Open source tools analyzed:**

- BLAZAM (web-based, .NET, full AD management with delegation and automation)
- ADTools (WPF, LDAP, cross-domain search, Exchange integration)
- ADxRay (AD health check, HTML report)

**Commercial tools analyzed:**

- ManageEngine ADManager Plus / ADAudit Plus (200+ reports, risk score, compliance, hybrid management)
- Quest Active Administrator (100+ diagnostic tests, backup/restore, GPO management)
- Netwrix Auditor (audit, state-in-time, compliance, threat detection)
- Adaxes (advanced RBAC, granular delegation, automation)
- SolarWinds Permissions Analyzer (NTFS analysis crossed with AD)
- Specops uReset (advanced MFA for password reset)

**Key finding**: no open source tool covers the full identified scope. "Premium" features (risk scoring, attack detection, NTFS analyzer, compliance reports) are exclusively available in paid commercial solutions.

### B. References

- Brainstorming session results: `docs/brainstorming-session-results.md`
- GitHub repository: https://github.com/Rwx-G/DSPanel.git
- License: Apache-2.0

---

## Next Steps

### Immediate Actions

1. Validate this Project Brief
2. Write the PRD (Product Requirements Document) with phased prioritization (MVP, V2, V3, V4)
3. Define the detailed technical architecture (architecture document)
4. Set up the Tauri v2 + React + Rust project skeleton
5. Create the GitHub repo with base structure, CI/CD, and issue templates

### PM Handoff

This Project Brief provides the full context for DSPanel. Please start in 'PRD Generation Mode', review the brief thoroughly to work with the user to create the PRD section by section as the template indicates, asking for any necessary clarification or suggesting improvements.
