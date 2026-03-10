# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Epic 1 implementation: Foundation and Core Lookup (Stories 1.1-1.12)
- Project skeleton with GenericHost DI, Serilog logging, MVVM architecture (1.1)
- IDirectoryProvider abstraction with LDAP implementation and Kerberos auth (1.2)
- Permission level detection from AD group memberships (ReadOnly/HelpDesk/AccountOperator/DomainAdmin) (1.3)
- Theme system with 31 design tokens, dark/light modes, runtime switching (1.4)
- Application shell with collapsible sidebar, tab navigation, status bar (1.5)
- Reusable UI controls: SearchBar, PermissionGate, StatusBadge, LoadingSpinner, EmptyState (1.6)
- Data display components: CopyButton, PropertyGrid (1.7)
- Form controls: FormField with label and validation wrapper (1.8)
- Dialog service with confirmation, error, and warning modals (1.9)
- User lookup with debounced search, property grid detail, group membership list (1.10)
- Health check badge evaluating 9 account flags with severity levels (1.11)
- Computer lookup with search, detail view, and ping/DNS commands (1.12)
- 207 unit tests covering all services, ViewModels, and controls

## [0.0.2] - 2026-03-10

### Added

- 60 BMAD story files covering all 12 epics (`docs/stories/`)
- Epic 1 Base UI foundation stories (1.4-1.9): theme system, application shell, common controls, data display components, form controls and validation, dialogs and notifications
- Story template follows BMAD v2 format with Dev Notes, Tasks/Subtasks, and Testing sections

### Changed

- Epic 1 expanded from 6 to 12 stories to include comprehensive Base UI foundations
- Epic list updated with story counts and summary table

## [0.0.1] - 2026-03-07

### Added

- Project documentation: brainstorming results, project brief, PRD, architecture
- Repository initialization with GitHub best practices
