# Data Models

### DirectoryUser

**Purpose**: Represents an Active Directory user account with all attributes needed for lookup, healthcheck, comparison, and actions.

**Key Attributes:**
- SamAccountName: string - Primary login identifier
- UserPrincipalName: string - UPN (user@domain.com)
- DisplayName: string - Full display name
- FirstName / LastName: string - Given name and surname
- Email: string - Primary email address
- Department: string - Organizational department
- Title: string - Job title
- DistinguishedName: string - Full DN in AD
- OrganizationalUnit: string - Parent OU path
- IsEnabled: bool - Account enabled/disabled state
- IsLockedOut: bool - Lockout state
- LastLogon: DateTime? - Last authentication timestamp
- LastLogonWorkstation: string? - Last machine name
- PasswordLastSet: DateTime? - Last password change
- AccountExpires: DateTime? - Account expiration date
- PasswordNeverExpires: bool - Password policy flag
- PasswordExpired: bool - Current password state
- BadPasswordCount: int - Failed authentication attempts
- MemberOf: List<string> - Group DNs
- HealthStatus: AccountHealthStatus - Computed health flags
- ThumbnailPhoto: byte[]? - Profile photo

**Relationships:**
- Member of multiple DirectoryGroup objects
- Located in one OrganizationalUnit
- Optionally has ExchangeMailbox info

### DirectoryComputer

**Purpose**: Represents an AD computer account.

**Key Attributes:**
- Name: string - Computer name
- DnsHostName: string - FQDN
- DistinguishedName: string - Full DN
- OrganizationalUnit: string - Parent OU
- OperatingSystem: string - OS name
- OperatingSystemVersion: string - OS version
- IsEnabled: bool - Account state
- LastLogon: DateTime? - Last authentication
- MemberOf: List<string> - Group DNs
- IPv4Address: string? - Resolved IP

**Relationships:**
- Member of multiple DirectoryGroup objects
- Located in one OrganizationalUnit

### DirectoryGroup

**Purpose**: Represents an AD security or distribution group.

**Key Attributes:**
- Name: string - Group name
- DistinguishedName: string - Full DN
- Description: string - Group description
- Scope: GroupScope (DomainLocal, Global, Universal)
- Category: GroupCategory (Security, Distribution)
- Members: List<string> - Member DNs
- MemberOf: List<string> - Parent group DNs
- MemberCount: int - Total member count

**Relationships:**
- Contains multiple DirectoryUser, DirectoryComputer, or nested DirectoryGroup members
- Can be member of other DirectoryGroup objects

### ExchangeMailboxInfo

**Purpose**: Read-only Exchange mailbox diagnostic data (on-prem or online).

**Key Attributes:**
- MailboxName: string - Display name
- PrimarySmtpAddress: string - Primary email
- Aliases: List<string> - All proxy addresses
- ForwardingAddress: string? - Mail forwarding target
- MailboxType: string - Mailbox type (User, Shared, Room)
- QuotaUsed: long? - Current mailbox size
- QuotaLimit: long? - Mailbox quota
- Delegates: List<string> - Delegation entries
- Source: MailboxSource (OnPrem, Online) - Data origin

### Preset

**Purpose**: Declarative template for onboarding/offboarding operations.

**Key Attributes:**
- Id: Guid - Unique identifier
- Name: string - Preset display name
- Description: string - What this preset does
- Type: PresetType (Onboarding, Offboarding)
- TargetRole: string - Role/team this applies to
- TargetOU: string - Default OU for new accounts
- Groups: List<string> - AD group DNs to add/remove
- AdditionalAttributes: Dictionary<string, string> - Extra AD attributes to set
- CreatedBy: string - Creator
- CreatedAt: DateTime - Creation timestamp
- ModifiedAt: DateTime - Last modification

**Relationships:**
- References multiple DirectoryGroup objects
- References one target OrganizationalUnit

### AuditLogEntry

**Purpose**: Internal DSPanel action log entry stored in SQLite.

**Key Attributes:**
- Id: long - Auto-increment ID
- Timestamp: DateTime - When the action occurred
- UserName: string - DSPanel operator (Windows account)
- ActionType: string - Action category (PasswordReset, GroupAdd, etc.)
- TargetObject: string - DN of the affected AD object
- Details: string - JSON serialized action details
- Result: ActionResult (Success, Failure, DryRun)
- ErrorMessage: string? - Error details if failed

### ObjectSnapshot

**Purpose**: Point-in-time capture of an AD object's attributes for backup/restore.

**Key Attributes:**
- Id: long - Auto-increment ID
- Timestamp: DateTime - Snapshot time
- ObjectDN: string - Distinguished name
- ObjectType: string - User, Computer, Group
- OperationType: string - What triggered the snapshot
- Attributes: string - JSON serialized attribute dictionary
- CreatedBy: string - Who triggered the operation

### AutomationRule

**Purpose**: Trigger-based automation rule definition.

**Key Attributes:**
- Id: Guid - Unique identifier
- Name: string - Rule name
- IsEnabled: bool - Active state
- TriggerType: TriggerType - What triggers the rule
- TriggerCondition: string - JSON condition definition
- Actions: List<AutomationAction> - What to execute
- CreatedBy: string - Creator
- LastTriggered: DateTime? - Last execution

---
