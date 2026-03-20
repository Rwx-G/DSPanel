# Epic 5: Presets, Onboarding and Offboarding Workflows

**Goal**: Implement declarative role-based presets stored as JSON on a configurable network share, a preset editor within the UI, and guided onboarding/offboarding wizards with dry-run preview and formatted ticket output.

### Story 5.1: Preset Storage and Configuration

As an administrator,
I want to configure a network share path for storing presets and have DSPanel read/write presets from there,
so that presets are centralized and shared across the team.

#### Acceptance Criteria

1. Settings view allows configuring the preset storage path (UNC or local path)
2. Application validates path accessibility at startup and shows warning if unreachable
3. Presets are stored as individual JSON files (one per preset)
4. Preset JSON schema is validated on load (malformed files are reported, not silently ignored)
5. File watching detects external changes (if another DSPanel instance modifies a preset)

### Story 5.2: Preset Editor UI

As an AccountOperator,
I want to create and edit presets through the DSPanel UI,
so that I do not need to manually edit JSON files.

#### Acceptance Criteria

1. Preset list view shows all available presets with name, type (onboarding/offboarding), and target role/team
2. Preset editor form: name, description, type, target OU, list of AD groups (searchable picker), additional attributes
3. Group picker allows browsing/searching AD groups and adding them to the preset
4. Save validates the preset and writes JSON to the configured storage path
5. Delete preset with confirmation
6. Only AccountOperator+ can create/edit presets

### Story 5.3: Onboarding Wizard

As a L2 support technician,
I want a guided wizard for creating a new user with a preset,
so that onboarding is consistent, fast, and error-free.

#### Acceptance Criteria

1. Wizard steps: user details form, preset selection, preview diff, confirm and execute
2. User details: first name, last name, login convention (auto-generated), password (generated), target OU (from preset or override)
3. Preset selection shows which groups and settings will be applied
4. Preview diff shows a complete summary of all changes that will be made
5. Execution creates the user account, applies groups, and sets attributes
6. Output panel shows formatted summary (login, temp password, groups, OU, machine) copyable to clipboard
7. Full audit logging of the entire onboarding operation

### Story 5.4: Offboarding Workflow

As a L2 support technician,
I want a guided offboarding workflow,
so that departing users are consistently and securely deprovisioned.

#### Acceptance Criteria

1. Workflow triggered from user lookup view context menu
2. Steps: confirm user, preview current state, select offboarding actions, preview changes, execute
3. Available actions (each toggleable): disable account, remove from all groups, set mail forwarding, move to "Disabled Users" OU, reset password to random
4. Dry-run preview before execution
5. Output summary of all changes made, copyable for ticket
6. Full audit logging

---
