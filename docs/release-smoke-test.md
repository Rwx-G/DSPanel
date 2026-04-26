# Release smoke test - Epic 14 visual checklist

Component-level tests cover correctness; this checklist covers **visual rendering** that automated tests cannot judge (color contrast, severity colors, dialog layout, popover positioning). Run before tagging any release that touches the UI surface.

DSPanel ships two themes: `light` and `dark` (the third toggle is `system`, which resolves to one of the two). There are no accent variants in the current build.

## Setup

1. Launch dev: `cmd //c "npx pnpm tauri dev"` (or use `acces DSPanel powershell`)
2. Connect to a test directory that has at least one user / computer in each indicator state below
3. Open Settings -> Appearance and switch the theme via the `light` / `dark` buttons between each pass

## Pass 1 - light theme | Pass 2 - dark theme

For each pass, walk the following screens:

### UserLookup

- [ ] Row with 1 indicator: shield icon visible, color matches severity
- [ ] Row with 2+ indicators: shield-alert icon when any is Critical
- [ ] Row with no indicators: no icon, layout unshifted
- [ ] Hover the dot: popover opens, header reads "Security indicators"
- [ ] Popover row text remains readable on the surface-card background

### ComputerLookup

- [ ] Same as UserLookup
- [ ] **Hover an `UnconstrainedDelegation` row**: badge reads correctly
- [ ] **Hover a `ConstrainedDelegation` row**: popover shows the SPN list inline (`MSSQLSvc/...`, etc.) under the kind label, in monospace
- [ ] **Hover an `Rbcd` row**: popover shows allowed-principal SIDs inline
- [ ] When > 3 metadata entries: `+N more` suffix appears, font is muted

### UserDetail

- [ ] All 5 user-side indicator badges (Kerberoastable / PasswordNotRequired / PasswordNeverExpires / ReversibleEncryption / AsRepRoastable) render with correct severity color
- [ ] Severity escalation (AdminSDHolder): a `Kerberoastable` user with `adminCount=1` renders the badge in Critical (red), not Warning (orange)
- [ ] AccountOperator+: inline "Fix" buttons next to `PasswordNotRequired` and `Kerberoastable` badges have border + bg (not invisible) and contrast against the row
- [ ] Click the `Fix` next to `PasswordNotRequired`: ClearPasswordNotRequiredDialog opens centered, header bar visible, body text readable, "I understand..." checkbox interactive, Confirm disabled until checked, Cancel/Confirm buttons distinct
- [ ] Click the `Manage SPNs` button: ManageSpnsDialog opens, removable + system sections visible, system SPNs rendered with reduced opacity
- [ ] Read-only viewer (no Admin / no AccountOperator): Fix buttons hidden, no broken layout

### ComputerDetail

- [ ] All 3 computer-side indicator badges (UnconstrainedDelegation / ConstrainedDelegation / Rbcd) render with correct severity color
- [ ] ConstrainedDelegation tooltip (hover badge): SPN list interpolated correctly via `tooltipParamsFor`
- [ ] Rbcd tooltip: principal SID list visible
- [ ] Admin: inline "Fix" button next to `UnconstrainedDelegation` has border + bg
- [ ] AccountOperator (NOT Admin): Fix button hidden (Story 14.6 has higher bar than 14.4/14.5)
- [ ] Click the `Fix`: DisableUnconstrainedDelegationDialog opens, body has 4 paragraphs (definition + attack + migration + risk), checkbox interactive, dialog has `lg` max-width and scrolls when window is short

### AuditLog

- [ ] Existing entries render unchanged
- [ ] After a successful `disable_unconstrained_delegation`: new row visible with action `DisabledUnconstrainedDelegation`. The TS type now exposes `severity?: "info" | "warning" | "critical"` but the table does not yet render a visual severity column - confirm no broken layout from the new optional field

### Notification toasts

- [ ] After a successful quick-fix: green success toast bottom-right, dismissible, auto-fades after ~5s
- [ ] On failure: red error toast with the readable error message

## Sign-off

When both passes are clean, tick this list in the PR / release notes and proceed with the version bump.
