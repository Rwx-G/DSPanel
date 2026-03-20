# Epic 3: Comparison and Permissions Audit

**Goal**: Enable support technicians to compare user accounts side-by-side, visualize group membership differences, and audit effective permissions on network resources - answering the common question "why does user X have access but not user Y?"

### Story 3.1: Side-by-Side User Comparison

As a support technician,
I want to compare two user accounts side by side,
so that I can identify differences in their group memberships.

#### Acceptance Criteria

1. Comparison view accepts two user accounts (search or drag from lookup)
2. Both users' details are displayed in parallel columns
3. Group memberships are aligned and color-coded: green (both have), red (only user A), blue (only user B)
4. Delta summary shows count of shared, unique-to-A, and unique-to-B groups
5. Groups can be filtered/sorted in the comparison view
6. Comparison opens in a new tab

### Story 3.2: UNC Path Permissions Audit

As a support technician,
I want to enter a network path and see which AD groups have access and how that maps to two users,
so that I can diagnose file share access issues.

#### Acceptance Criteria

1. Input field accepts UNC paths (\\\\server\share\folder)
2. Tool resolves NTFS ACLs on the specified path and lists each ACE (group/user, permission type, allow/deny)
3. Each ACE is cross-referenced with the compared users' group memberships
4. Visual indicator shows which user has effective access and through which group
5. Error handling for inaccessible paths, permission denied, or invalid paths
6. Results are exportable to CSV

### Story 3.3: NTFS Permissions Analyzer

As a L2 support technician,
I want to analyze NTFS permissions on a folder and understand the full permission chain,
so that I can resolve complex access issues.

#### Acceptance Criteria

1. Standalone view (not just comparison mode) for analyzing a single path's permissions
2. Displays inherited vs explicit permissions separately
3. Shows full group resolution chain (user -> group -> nested group -> ACE)
4. Supports recursive analysis (show permissions at each folder level in the path)
5. Highlights deny rules and permission conflicts
6. Results are exportable to CSV/PDF

### Story 3.4: State-in-Time Comparison

As a L3 support technician,
I want to compare an AD object's state between two points in time,
so that I can investigate what changed and when.

#### Acceptance Criteria

1. For any AD object, display replication metadata (attribute change timestamps)
2. User selects two timestamps and sees a diff of attribute values
3. Changes are highlighted with before/after values
4. Supports user, computer, and group objects
5. Graceful handling when replication metadata is limited or unavailable

---
