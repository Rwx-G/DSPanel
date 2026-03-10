# Epic 6: Exchange Diagnostics

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
