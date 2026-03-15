# User Interface Design Goals

### Overall UX Vision

A professional, dense-but-organized desktop interface inspired by tools like SQL Server Management Studio or Azure AD admin center. The UI prioritizes information density and quick access over visual simplicity. A single window with a left sidebar for navigation between modules, a main content area with tabs for multi-tasking, and a bottom status bar showing connection context (domain, DC, permission level).

The key UX principle is **progressive disclosure**: a ReadOnly user sees a clean lookup interface; a DomainAdmin sees the full power of every module. The tool grows with the user's permissions.

### Key Interaction Paradigms

- **Search-first**: a prominent search bar at the top that works across all object types (users, computers, groups) with type-ahead suggestions
- **Context menu actions**: right-click on any AD object to see available actions (filtered by permission level)
- **Tab-based multitasking**: open multiple lookups, comparisons, or views simultaneously in tabs
- **Drag-and-drop**: for group membership management (drag users between groups)
- **Dry-run preview**: modal dialog showing full diff before any write operation, with confirm/cancel
- **Breadcrumb navigation**: OU path displayed as clickable breadcrumbs for quick navigation

### Core Screens and Views

1. **Home / Dashboard** - Quick search bar, recent lookups, healthcheck summary, permission level indicator
2. **User Lookup View** - Full account details, healthcheck badge, groups, Exchange info, action buttons
3. **Computer Lookup View** - Machine details, ping/DNS, remote monitoring, login history
4. **Comparison View** - Side-by-side user comparison with delta highlighting, UNC permission audit
5. **Group Management View** - Tree/flat group browser, member list, bulk operations panel (D/A/T)
6. **Preset Management View** - List of presets, editor, onboarding/offboarding wizard launcher
7. **Onboarding Wizard** - Step-by-step guided form for new user creation with preset selection
8. **Infrastructure Health View** - DC status cards, replication map, DNS checks, topology visualization
9. **Security Dashboard** - Risk score gauge, privileged accounts list, attack detection alerts, escalation paths
10. **Reports View** - Report templates, scheduled reports, export options (CSV/PDF)
11. **Audit Log View** - Searchable/filterable log of all DSPanel actions
12. **Settings View** - Connection configuration, preset storage path, RBAC management, notification setup, GPO viewer
13. **AD Object Detail Dialog** - Reusable modal for viewing/editing any AD object's attributes

### Accessibility: WCAG AA

The application shall meet WCAG AA standards for accessibility: keyboard navigation for all actions, sufficient color contrast, screen reader compatibility for key workflows.

### Branding

- Clean, modern Windows desktop aesthetic - consistent with Windows 11 design language
- Color scheme: dark/light theme support with a professional blue accent palette
- Application icon: shield with directory tree motif
- No heavy custom styling - leverage standard HTML/CSS controls with a lightweight design system for maintainability

### Target Device and Platforms: Desktop Only

- Windows 10/11 (x64) desktop application
- Tauri v2 (Rust backend) + React/TypeScript frontend (rendered in webview)
- No mobile (potential future expansion noted in brief)

---
