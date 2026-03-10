# Epic 12: RBAC, Settings and Polish

**Goal**: Implement granular RBAC configuration within DSPanel, centralize all application settings, add auto-update notifications, prepare for localization, and finalize UX polish for a production-ready release.

### Story 12.1: Granular RBAC Configuration

As a DomainAdmin,
I want to define custom permission profiles in DSPanel beyond the 4 default levels,
so that I can precisely control who can do what, per OU if needed.

#### Acceptance Criteria
1. RBAC configuration UI in settings (DomainAdmin only)
2. Custom profiles: name, base level, feature overrides (enable/disable specific actions)
3. OU-scoped permissions: a profile can be restricted to specific OUs
4. Profile assignment: map AD groups to custom profiles
5. Custom profiles override default level behavior
6. Changes saved to preset storage (shared across instances)
7. Audit logging of RBAC changes

### Story 12.2: Application Settings

As a user,
I want a centralized settings view to configure all DSPanel options,
so that I can customize the tool to my environment.

#### Acceptance Criteria
1. Settings organized by category: Connection, Presets, Security, Notifications, Reports, Appearance
2. Connection: domain override, preferred DC, Graph tenant/app config
3. Presets: storage path configuration
4. Security: MFA settings, audit log retention
5. Appearance: dark/light theme toggle, language selection
6. Settings persisted locally (per-user) with sensible defaults
7. Settings validation with clear error messages

### Story 12.3: Auto-Update Notification

As a user,
I want DSPanel to notify me when a newer version is available,
so that I stay up to date.

#### Acceptance Criteria
1. At startup, check GitHub Releases API for the latest version
2. If newer version available, show a non-blocking notification bar with version number and release notes link
3. "Download" button opens the GitHub release page in browser
4. "Skip this version" and "Remind me later" options
5. Check frequency configurable (default: every startup)
6. Works without internet (silently skips check)

### Story 12.4: Localization Support

As a French-speaking user,
I want DSPanel to be available in French,
so that I can use the tool in my preferred language.

#### Acceptance Criteria
1. All user-facing strings externalized to .resx resource files
2. English (en) as default language
3. French (fr) translation provided
4. Language selection in settings (requires restart)
5. Date, number, and currency formatting follows selected locale
6. Developer documentation explains how to add new languages

### Story 12.5: UX Polish and Final Touches

As a user,
I want DSPanel to feel polished and professional,
so that it inspires confidence for daily production use.

#### Acceptance Criteria
1. Dark and light theme with proper contrast in all views
2. Keyboard shortcuts for common actions (Ctrl+F search, Ctrl+R refresh, etc.)
3. Loading indicators on all async operations
4. Error handling with user-friendly messages (no raw exceptions)
5. Window state persistence (size, position, last active tab)
6. Application icon and branding applied consistently
7. About dialog with version, license, and links

---
