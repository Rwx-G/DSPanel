# Epic 11: Audit, History and GPO Insights

**Goal**: Deliver a local activity journal for DSPanel actions, AD change history timeline using replication metadata, and an integrated GPO viewer - completing the observability layer with read-heavy, low-risk features that align with DSPanel's desktop architecture.

> **Scope rationale (v0.10 audit)**
>
> Three stories from the original Epic 11 were removed after an architectural review:
>
> - **Trigger-Based Automation** (ex-11.3): DSPanel is a desktop application, not a background service. Automation rules would only execute while the app is open, creating a false sense of reliability. Server-based tools (Adaxes, ManageEngine) solve this properly with persistent services.
> - **External Script Execution** (ex-11.4): Executing PowerShell/exe from a tool with AD credentials introduces an unacceptable attack surface (script tampering on network shares, privilege escalation, social engineering). PowerShell already exists for this use case.
> - **Webhook Notifications** (ex-11.5): Same desktop limitation as automation - notifications only fire while the app runs. Reliable alerting requires a SIEM or dedicated monitoring service.

---

### Story 11.1: Activity Journal

As a DomainAdmin,
I want a searchable log of all write operations performed through DSPanel on this workstation,
so that I can review my own actions and investigate local issues.

> **Note**: This is a *local* activity journal per workstation, not a centralized audit system. It does not replace server-side audit solutions (Netwrix, ADAudit Plus) for compliance purposes.

#### Acceptance Criteria

1. A dedicated journal view displays a searchable, filterable table: timestamp, user, action type, target object, details, result (success/failure)
2. All write operations across the application feed into the journal via `AuditService` trait
3. Entries stored in a local SQLite database
4. Filters: date range, user, action type, target DN (partial match)
5. Export to CSV/PDF via existing `ExportToolbar`
6. Configurable retention period (default: 1 year) with automatic cleanup at startup
7. Unit tests cover the audit service, repository, filtering, and retention cleanup

### Story 11.2: AD Change History Timeline

As a L3 support technician,
I want to see a timeline of changes made to any AD object,
so that I can investigate "what changed and when" for troubleshooting.

#### Acceptance Criteria

1. "History" tab on any AD object detail view
2. Timeline shows attribute changes with timestamps, before/after values
3. Data sourced from AD replication metadata (`msDS-ReplAttributeMetaData`)
4. Sortable by date, filterable by attribute name
5. Visual diff for multi-value attributes (group membership changes)

### Story 11.3: GPO Viewer

As a DomainAdmin,
I want to see which GPOs apply to a user, computer, or OU,
so that I can troubleshoot Group Policy issues without leaving DSPanel.

#### Acceptance Criteria

1. GPO panel accessible from user/computer/OU detail views
2. Lists all GPOs applying to the selected scope (linked + inherited)
3. Shows GPO name, link order, enforcement status, WMI filter
4. "What-if" mode: simulate GPO application for a user at a specific OU
5. GPO scope report: for a selected GPO, show all OUs/objects it applies to
6. Read-only view (no GPO modification)
7. DomainAdmin permission required

---
