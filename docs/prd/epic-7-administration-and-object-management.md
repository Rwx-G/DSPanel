# Epic 7: Administration and Object Management

**Goal**: Deliver administrative tools for DomainAdmin/AccountOperator users: moving objects between OUs, AD Recycle Bin access, contact and printer management, user photos, and object backup/restore for safe modifications.

### Story 7.1: Move Objects Between OUs

As an AccountOperator,
I want to move AD objects (users, computers, groups) between OUs,
so that I can reorganize AD structure as needed.

#### Acceptance Criteria

1. "Move to OU" action available from context menu on any AD object
2. OU picker shows the OU tree for target selection
3. Supports single and bulk move (multi-selection)
4. Dry-run preview shows source and destination for each object
5. Permission check: AccountOperator+ required
6. Audit logging of all moves

### Story 7.2: AD Recycle Bin

As a DomainAdmin,
I want to browse and restore deleted AD objects from the Recycle Bin,
so that I can recover accidental deletions.

#### Acceptance Criteria

1. Recycle Bin view lists all deleted objects with name, type, deletion date, and original OU
2. Search/filter within deleted objects
3. Restore selected object(s) to original location or a specified OU
4. Warning if AD Recycle Bin feature is not enabled on the domain
5. DomainAdmin permission required
6. Audit logging of all restorations

### Story 7.3: Contact and Printer Management

As an AccountOperator,
I want to view and manage AD contact and printer objects,
so that DSPanel covers all common AD object types.

#### Acceptance Criteria

1. Contacts appear in search results with a distinct icon
2. Contact detail view shows: name, email, phone, company, description
3. CRUD operations on contacts (create, edit, delete) for AccountOperator+
4. Printer objects viewable with name, location, server, share name
5. Printer management (create/delete) for DomainAdmin
6. Audit logging of all operations

### Story 7.4: User Thumbnail Photo

As an AccountOperator,
I want to view and update user thumbnail photos in AD,
so that directory photos stay current.

#### Acceptance Criteria

1. User detail view displays current thumbnail photo (or placeholder if none)
2. "Change Photo" button allows uploading a new image (JPG/PNG)
3. Image is resized to AD-appropriate dimensions (96x96 max) before upload
4. Photo removal option (set to empty)
5. AccountOperator+ permission required for modification
6. Audit logging

### Story 7.5: Object Backup and Restore

As a DomainAdmin,
I want DSPanel to snapshot an AD object before any modification,
so that I can rollback changes if something goes wrong.

#### Acceptance Criteria

1. Before any write operation, the object's current state is captured (all attributes)
2. Snapshots stored locally with timestamp, object DN, and operation type
3. "History" tab on object detail shows previous snapshots
4. "Restore" button applies a snapshot's attribute values back to the object
5. Dry-run preview before restore
6. Snapshot retention configurable (default: 30 days)
7. DomainAdmin permission for restore operations

---
