# Epic 9: Security, Risk Scoring and Attack Detection

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
