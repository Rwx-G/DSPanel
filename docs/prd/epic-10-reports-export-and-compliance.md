# Epic 10: Reports, Export and Compliance

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
