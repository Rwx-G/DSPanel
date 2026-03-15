# Data Models

All backend data models are Rust structs with `serde::Serialize` and `serde::Deserialize` derives for IPC serialization. TypeScript interfaces on the frontend mirror these structs for type-safe communication across the Tauri IPC boundary. Rust uses snake_case fields; `#[serde(rename_all = "camelCase")]` ensures frontend compatibility.

### DirectoryUser

**Purpose**: Represents an Active Directory user account with all attributes needed for lookup, healthcheck, comparison, and actions.

**Key Attributes (Rust struct):**

- sam_account_name: String - Primary login identifier
- user_principal_name: String - UPN (user@domain.com)
- display_name: String - Full display name
- first_name / last_name: String - Given name and surname
- email: String - Primary email address
- department: String - Organizational department
- title: String - Job title
- distinguished_name: String - Full DN in AD
- organizational_unit: String - Parent OU path
- is_enabled: bool - Account enabled/disabled state
- is_locked_out: bool - Lockout state
- last_logon: Option<DateTime> - Last authentication timestamp
- last_logon_workstation: Option<String> - Last machine name
- password_last_set: Option<DateTime> - Last password change
- account_expires: Option<DateTime> - Account expiration date
- password_never_expires: bool - Password policy flag
- password_expired: bool - Current password state
- bad_password_count: i32 - Failed authentication attempts
- member_of: Vec<String> - Group DNs
- health_status: AccountHealthStatus - Computed health flags
- thumbnail_photo: Option<Vec<u8>> - Profile photo

**Relationships:**

- Member of multiple DirectoryGroup objects
- Located in one OrganizationalUnit
- Optionally has ExchangeMailbox info

### DirectoryComputer

**Purpose**: Represents an AD computer account.

**Key Attributes (Rust struct):**

- name: String - Computer name
- dns_host_name: String - FQDN
- distinguished_name: String - Full DN
- organizational_unit: String - Parent OU
- operating_system: String - OS name
- operating_system_version: String - OS version
- is_enabled: bool - Account state
- last_logon: Option<DateTime> - Last authentication
- member_of: Vec<String> - Group DNs
- ipv4_address: Option<String> - Resolved IP

**Relationships:**

- Member of multiple DirectoryGroup objects
- Located in one OrganizationalUnit

### DirectoryGroup

**Purpose**: Represents an AD security or distribution group.

**Key Attributes (Rust struct):**

- name: String - Group name
- distinguished_name: String - Full DN
- description: String - Group description
- scope: GroupScope (DomainLocal, Global, Universal)
- category: GroupCategory (Security, Distribution)
- members: Vec<String> - Member DNs
- member_of: Vec<String> - Parent group DNs
- member_count: i32 - Total member count

**Relationships:**

- Contains multiple DirectoryUser, DirectoryComputer, or nested DirectoryGroup members
- Can be member of other DirectoryGroup objects

### ExchangeMailboxInfo

**Purpose**: Read-only Exchange mailbox diagnostic data (on-prem or online).

**Key Attributes (Rust struct):**

- mailbox_name: String - Display name
- primary_smtp_address: String - Primary email
- aliases: Vec<String> - All proxy addresses
- forwarding_address: Option<String> - Mail forwarding target
- mailbox_type: String - Mailbox type (User, Shared, Room)
- quota_used: Option<i64> - Current mailbox size
- quota_limit: Option<i64> - Mailbox quota
- delegates: Vec<String> - Delegation entries
- source: MailboxSource (OnPrem, Online) - Data origin

### Preset

**Purpose**: Declarative template for onboarding/offboarding operations.

**Key Attributes (Rust struct):**

- id: Uuid - Unique identifier
- name: String - Preset display name
- description: String - What this preset does
- preset_type: PresetType (Onboarding, Offboarding)
- target_role: String - Role/team this applies to
- target_ou: String - Default OU for new accounts
- groups: Vec<String> - AD group DNs to add/remove
- additional_attributes: HashMap<String, String> - Extra AD attributes to set
- created_by: String - Creator
- created_at: DateTime - Creation timestamp
- modified_at: DateTime - Last modification

**Relationships:**

- References multiple DirectoryGroup objects
- References one target OrganizationalUnit

### AuditLogEntry

**Purpose**: Internal DSPanel action log entry stored in SQLite.

**Key Attributes (Rust struct):**

- id: i64 - Auto-increment ID
- timestamp: DateTime - When the action occurred
- user_name: String - DSPanel operator (OS account)
- action_type: String - Action category (PasswordReset, GroupAdd, etc.)
- target_object: String - DN of the affected AD object
- details: String - JSON serialized action details
- result: ActionResult (Success, Failure, DryRun)
- error_message: Option<String> - Error details if failed

### ObjectSnapshot

**Purpose**: Point-in-time capture of an AD object's attributes for backup/restore.

**Key Attributes (Rust struct):**

- id: i64 - Auto-increment ID
- timestamp: DateTime - Snapshot time
- object_dn: String - Distinguished name
- object_type: String - User, Computer, Group
- operation_type: String - What triggered the snapshot
- attributes: String - JSON serialized attribute dictionary
- created_by: String - Who triggered the operation

### AutomationRule

**Purpose**: Trigger-based automation rule definition.

**Key Attributes (Rust struct):**

- id: Uuid - Unique identifier
- name: String - Rule name
- is_enabled: bool - Active state
- trigger_type: TriggerType - What triggers the rule
- trigger_condition: String - JSON condition definition
- actions: Vec<AutomationAction> - What to execute
- created_by: String - Creator
- last_triggered: Option<DateTime> - Last execution

### TypeScript Interfaces (Frontend)

All TypeScript interfaces mirror the Rust structs and are used for type-safe IPC communication. Field names use camelCase per TypeScript conventions. Tauri's `invoke()` automatically handles the serde JSON serialization/deserialization across the IPC boundary.

Example:

```typescript
// src/types/directory.ts
export interface DirectoryUser {
    samAccountName: string;
    userPrincipalName: string;
    displayName: string;
    firstName: string;
    lastName: string;
    email: string;
    department: string;
    title: string;
    distinguishedName: string;
    organizationalUnit: string;
    isEnabled: boolean;
    isLockedOut: boolean;
    lastLogon: string | null;
    memberOf: string[];
    healthStatus: AccountHealthStatus;
    // ... etc.
}
```

---
