# DSPanel - UX/UI Guidelines

Author: Romain G.

## Design Principles

1. **Consistency over novelty** - 5-6 interaction patterns reused everywhere (list/detail, property grid, search/results, dashboard, wizard, bulk action)
2. **Progressive disclosure** - 7-8 essential items per view max, details on demand
3. **Role-based adaptation** - UI adapts to permission level (HelpDesk sees fewer actions than DomainAdmin)
4. **Keyboard-first** - Every action reachable via keyboard, documented shortcuts
5. **Feedback always** - Every user action gets immediate visual feedback

## Color Token Architecture (3 levels)

### Level 1 - Reference Tokens (raw palette)

Defined in LightTheme.xaml / DarkTheme.xaml as `Color` resources.

### Level 2 - Semantic Tokens (functional role)

| Token | Light | Dark | Notes |
|-------|-------|------|-------|
| Background.Primary | #FAFAFA-#FFFFFF | #121212-#1E1E1E | Never pure #000 |
| Background.Surface | #FFFFFF | #1E1E1E-#1F2937 | Cards, elevated |
| Background.Elevated | #FFFFFF | #2D2D2D-#374151 | Dropdowns, dialogs |
| Text.Primary | #1A1A1A-#212121 | #E0E0E0-#F5F5F5 | Never pure #FFF |
| Text.Secondary | #666666-#757575 | #A0A0A0-#B0B0B0 | Labels, captions |
| Border.Default | #E0E0E0 | #374151-#3D3D3D | Visible separator |
| Border.Subtle | #F0F0F0 | #2D2D2D | Very light separator |
| Status.Error | #D32F2F | #EF5350 | Slightly lighter in dark |
| Status.Success | #2E7D32 | #66BB6A | Slightly lighter in dark |
| Status.Warning | #ED6C02 | #FFA726 | Slightly lighter in dark |
| Interactive.Primary | #0066CC | #5C9CE6 | Links, accent |

### Level 3 - Component Tokens

Map semantic tokens to specific components (sidebar.background, tab.active.border, etc.)

### Contrast Rules

- Normal text: minimum **4.5:1** (WCAG AA)
- Large text (>18px): minimum **3:1**
- Interactive elements: minimum **3:1** with adjacent background
- Dark mode target: 12:1 to 15:1 (not beyond - causes eye strain)

## Sidebar Navigation

- **Three modes**: Expanded (220px), Collapsed (52px), optionally Hidden
- **Active indicator**: Vertical colored bar (3-4px) on left side of active item + subtle background
- **Keyboard**: Ctrl+B to toggle expanded/collapsed
- **Grouping**: Separators between logical groups
- **Persist state**: Save collapsed/expanded between sessions
- **Tooltip on collapsed**: Show item name on hover when icon-only

## Tab Management

- **Close**: X button visible on hover, middle-click, Ctrl+W
- **Overflow**: Scroll arrows + "More tabs" dropdown when too many
- **Context menu** (right-click): Close, Close Others, Close All, Close to Right, Pin/Unpin
- **Reopen**: Ctrl+Shift+T to reopen last closed tab
- **Dirty indicator**: Dot on tab if unsaved changes
- **Pinned tabs**: Icon-only, anchored left, not closable by accident
- **Fixed width**: Use hidden bold text trick to prevent width shift on active state

## Search UX

- **Debounce**: 300ms after typing stops, minimum 3 characters
- **Result design**: Highlight matched terms, group by object type, show total count
- **Keyboard nav**: Arrow keys through results, Enter to open, auto-focus first result
- **States**:
  - Loading: Skeleton loader in results area (not global spinner)
  - Empty: Helpful message with search tips ("Try searching by email, SID, or display name")
  - Error: Clear message with Retry button ("Cannot reach domain controller")
  - Scope: Show search scope indicator
- **Future**: Command palette (Ctrl+K) with prefixes (u: users, c: computers, g: groups)

## Data-Dense Views (Property Grids)

- **Sections collapsible by category**:
  - Identity (displayName, sAMAccountName, UPN, SID)
  - Contact (mail, phone, office)
  - Organization (title, department, manager, company)
  - Account (enabled, locked, password expiry, last logon)
  - Group Membership (list with count)
  - Advanced (DN, GUID, whenCreated, whenChanged)
- **Critical fields first**: Top 4-5 attributes (enabled, locked, password status) with colored badges
- **Two-column layout**: Label (right-aligned, muted) | Value (left-aligned, full color)
- **Copy-on-click**: Every value copiable, checkmark feedback for 1.5s
- **Inline editing**: Click to edit, pencil icon on hover (when permission allows)
- **Spacing**: 4/8px grid for dense views

## Status & Health Indicators

| Color | Meaning | Icon | Use in DSPanel |
|-------|---------|------|----------------|
| Green | Success | Checkmark circle | DC connected, replication OK |
| Blue | Info | Info circle | Sync in progress |
| Yellow | Warning | Warning triangle | Certificate expiring soon |
| Red | Error | X circle | DC unreachable, replication failed |
| Gray | Unknown | Dash circle | Status undetermined |

**Rule**: Never use color alone. Always combine color + icon + text (minimum 3 of 4 indicators).

## Feedback & Notifications

### Toast Notifications (Snackbars)
- Position: Bottom-right, stackable, auto-dismiss after 5s
- Include "Undo" button for reversible actions
- Types: Success (green), Error (red), Warning (orange), Info (blue)
- Non-blocking: User can continue working

### Confirmation Dialogs
- Reserve for **irreversible destructive actions only** (delete OU, reset password, bulk delete)
- Explicit text: "Reset password for John Doe (jdoe)?" not "Are you sure?"
- Action button named specifically: "Reset Password" not "OK"
- Cancel button has default focus
- For bulk destructive: require typing count or keyword to confirm

### Micro-interactions
- Button press: Instant visual change (darken, scale 0.98)
- Copy-to-clipboard: Copy icon -> checkmark green 1.5s -> back to copy icon
- Toggle: 150ms transition for switches

## Loading States

- **Skeleton screens**: Animated gray rectangles replacing content during load (~20% perceived speed improvement)
- **Contextual spinner**: In the specific zone loading, never global
- **Progress bar**: For bulk operations with "Processing 45/200 users..."
- **Timeout**: After 10s show "This is taking longer than expected..." with Cancel

## Accessibility

- **Keyboard**: All controls reachable via Tab, logical tab order
- **Focus indicators**: 2px outline, 3:1 contrast minimum
- **AutomationProperties.Name**: On every interactive WPF control
- **Shortcuts documented**: F1 or ? shows shortcut list
  - Ctrl+K: Search
  - Ctrl+B: Toggle sidebar
  - Ctrl+W: Close tab
  - Ctrl+Shift+T: Reopen tab
  - F5: Refresh
  - Escape: Close dialog/cancel
- **High contrast**: Test with Windows High Contrast mode
- **Minimum text size**: 12px secondary, 14px primary

## WPF-Specific Rules

- **Never block UI thread**: All AD queries via async/await
- **VirtualizingStackPanel**: On all lists that may exceed ~50 items
- **Freeze()**: Call on static Freezable objects (brushes, geometries)
- **Animate only Opacity and RenderTransform**: Never Width/Height/Margin (triggers layout pass)
- **DPI**: Test on multi-monitor setups with different DPI
- **Resource loading**: Theme dictionaries in App.xaml, single parse point

## Implementation Priority

### High impact, low effort
1. Copy-to-clipboard on all AD values
2. Sidebar active state indicator (vertical bar)
3. Focus indicators + keyboard navigation
4. Skeleton loading states
5. Collapsible sections in property grids
6. Toast notifications with Undo

### High impact, medium effort
7. Search with debounce + fuzzy match + keyboard nav
8. Sidebar state persistence
9. Tab overflow + context menu
10. Health dashboard improvements

### High impact, high effort
11. Command palette (Ctrl+K)
12. VirtualizingStackPanel on all lists
13. High contrast mode mapping
14. Drag-and-drop tab reordering
