# Epic 10: Reports, Export and Compliance

**Goal**: Implement comprehensive reporting capabilities: multi-format export (CSV, PDF, XLSX, HTML) from any view, automated account cleanup, and compliance-ready report templates with control mapping for regulatory audits.

### Story 10.1: Multi-Format Export (CSV, PDF, XLSX, HTML)

As a support technician,
I want to export any search results, group memberships, or reports to CSV, PDF, XLSX, or HTML,
so that I can share data with colleagues, auditors, and managers in the format they expect.

#### Acceptance Criteria

1. Export button available in all list/table views (search results, group members, comparison, reports)
2. CSV export with proper encoding (UTF-8 BOM) and delimiter options
3. PDF export with headers, timestamps, and page numbers
4. XLSX export with formatted table, auto-filters, and sheet name matching the view
5. HTML export as a self-contained styled file suitable for browser viewing or email attachment
6. File save dialog with suggested filename based on context
7. Large exports show progress indicator

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
I want predefined compliance report templates (GDPR, HIPAA, SOX, PCI-DSS),
so that I can generate audit-ready reports for compliance reviews.

#### Acceptance Criteria

1. Template library with predefined compliance report types
2. Built-in templates for GDPR, HIPAA, SOX, and PCI-DSS standards
3. Each template specifies which data points to collect and how to present them
4. Each template section maps to specific framework control references (e.g., "SOX Section 404", "PCI-DSS Req. 8.1")
5. Generated reports include: executive summary, findings with control mapping, evidence tables, recommendations
6. Reports include timestamp and generator identification
7. Export as PDF with professional formatting
8. Templates are extensible (admin can create custom templates with custom control mappings)

---
