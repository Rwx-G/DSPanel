# Epic 11: Audit, Automation and Extensibility

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
