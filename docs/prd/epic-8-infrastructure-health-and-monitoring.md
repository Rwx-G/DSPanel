# Epic 8: Infrastructure Health and Monitoring

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

1. DNS check validates \_ldap.\_tcp, \_kerberos.\_tcp, and other critical SRV records
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
