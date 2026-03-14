# Epic 4: Group Management and Bulk Operations

**Goal**: Deliver a complete group management interface with tree/flat browsing, drag-and-drop member management, and group-centric bulk operations (Delete/Add/Transfer) for efficient batch processing.

### Story 4.1: Group Browser (Tree and Flat View)

As an AccountOperator,
I want to browse AD groups in a tree view by OU or in a flat searchable list,
so that I can quickly find and manage groups.

#### Acceptance Criteria
1. Tree view displays OU hierarchy with groups as leaf nodes
2. Flat view shows all groups in a searchable/sortable/filterable list
3. Toggle between tree and flat view
4. Selecting a group shows its details: name, DN, description, scope, category, member count
5. Group members are listed with type icons (user, computer, nested group)
6. Search works across both views with instant filtering
7. Large domains handled via lazy loading (expand OU on demand)

> **NB - Cross-module navigation**: The UserLookup "View group members" dialog
> (right-click on a group membership row) should include a link/button to open
> the Group Management module with that group pre-selected. This provides a
> seamless drill-down from user detail into full group management. The deep-link
> mechanism (e.g. `navigation.openTab("groups", { selectedGroupDn })`) should be
> implemented as part of this story.

### Story 4.2: Group Member Management

As an AccountOperator,
I want to add and remove members from groups using drag-and-drop,
so that I can manage group memberships efficiently.

#### Acceptance Criteria
1. Drag users/computers/groups from search results or other groups into a target group
2. Multi-selection supported for batch add
3. Remove members via selection + delete or context menu
4. All changes show a dry-run preview before execution
5. Changes are logged to the audit log
6. Permission check: only AccountOperator+ can modify groups
7. Confirmation dialog summarizes all pending changes

### Story 4.3: Bulk Operations (Delete/Add/Transfer)

As an AccountOperator,
I want to perform group-centric bulk operations (Delete members, Add members, Transfer members between groups),
so that I can handle batch changes like team moves efficiently.

#### Acceptance Criteria
1. Bulk operation panel: select source group(s), target group(s), and operation type (D/A/T)
2. Member selection within source group with multi-select and select-all
3. Transfer (T) = Add to target + Delete from source (atomic operation)
4. Dry-run preview shows all changes before execution
5. Progress indicator for large batch operations
6. Rollback option if operation partially fails
7. Full audit logging of all changes

### Story 4.4: Empty and Circular Group Detection

As a DomainAdmin,
I want to identify empty groups and circular group nesting,
so that I can clean up AD group hygiene issues.

#### Acceptance Criteria
1. "Hygiene" tab in group management shows detected issues
2. Empty groups listed with name, OU, and creation date
3. Circular nesting detected and displayed as a warning with the nesting chain
4. One-click navigation to the problematic group
5. Bulk delete option for empty groups (with dry-run)

---
