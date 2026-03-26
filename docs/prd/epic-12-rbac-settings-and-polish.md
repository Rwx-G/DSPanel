# Epic 12: RBAC, Settings and Polish

**Goal**: Configure AD group-based permission mapping, centralize all application settings, add auto-update notifications, and finalize UX polish for a production-ready release.

### Story 12.1: AD Group-Based Permission Mapping

As a DomainAdmin,
I want to map AD security groups to DSPanel permission levels,
so that access control is driven by AD group membership rather than auto-detection only.

#### Acceptance Criteria

1. Permission mapping UI in settings (DomainAdmin only)
2. For each of the 5 permission levels (ReadOnly, HelpDesk, AccountOperator, Admin, DomainAdmin), allow mapping one or more AD groups
3. Multiple groups can be mapped to the same permission level
4. The highest matching level wins when a user belongs to multiple mapped groups
5. When no mapping is configured, fall back to the current auto-detection logic
6. Mappings saved to preset storage (shared across instances)
7. Audit logging of permission mapping changes
8. Validation: warn if a mapped group does not exist in AD

### Story 12.2: Application Settings

As a user,
I want a centralized settings view to configure all DSPanel options,
so that I can customize the tool to my environment.

#### Acceptance Criteria

1. Settings organized by category: Connection, Presets, Security, Reports, Appearance
2. Connection: domain override, preferred DC, Graph tenant/app config
3. Presets: storage path configuration
4. Security: MFA settings, audit log retention
5. Appearance: dark/light theme toggle
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

### Story 12.4: UX Polish and Final Touches

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
