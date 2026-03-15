import { useState, useCallback, useMemo } from "react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { CopyButton } from "@/components/common/CopyButton";
import { HealthBadge } from "@/components/common/HealthBadge";
import { UserActions } from "@/components/common/UserActions";
import { PasswordFlagsEditor } from "@/components/common/PasswordFlagsEditor";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@/components/common/ContextMenu";
import {
  PropertyGrid,
  type PropertyGroup,
  type PropertySeverity,
} from "@/components/data/PropertyGrid";
import { DataTable, type Column } from "@/components/data/DataTable";
import { FilterBar, type FilterChip } from "@/components/data/FilterBar";
import { AdvancedAttributes } from "@/components/data/AdvancedAttributes";
import { PasswordResetDialog } from "@/components/dialogs/PasswordResetDialog";
import { GroupMembersDialog } from "@/components/dialogs/GroupMembersDialog";
import { type DirectoryUser } from "@/types/directory";
import type { AccountHealthStatus, HealthLevel } from "@/types/health";
import { parseCnFromDn } from "@/utils/dn";
import { Users, FolderOpen } from "lucide-react";
import { useNavigation } from "@/contexts/NavigationContext";
import { StateInTimeView } from "@/components/comparison/StateInTimeView";

/** Maps health flag names to the PropertyGrid label they correspond to. */
const FLAG_TO_LABEL: Record<string, string> = {
  Disabled: "Status",
  Locked: "Locked Out",
  Expired: "Account Expires",
  PasswordExpired: "Password Expired",
  PasswordNeverExpires: "Password Never Expires",
  Inactive90Days: "Last Logon",
  Inactive30Days: "Last Logon",
  NeverLoggedOn: "Last Logon",
  PasswordNeverChanged: "Password Last Set",
};

function toPropertySeverity(level: HealthLevel): PropertySeverity | undefined {
  if (level === "Critical") return "Critical";
  if (level === "Warning") return "Warning";
  return undefined;
}

export interface UserDetailProps {
  user: DirectoryUser;
  healthStatus?: AccountHealthStatus;
  groupColumns: Column<{ name: string; dn: string }>[];
  groupRows: { name: string; dn: string }[];
  groupFilterText: string;
  onGroupFilterText: (value: string) => void;
  onRefresh?: () => void;
}

export function UserDetail({
  user,
  healthStatus,
  groupColumns,
  groupRows,
  groupFilterText: _groupFilterText,
  onGroupFilterText,
  onRefresh,
}: UserDetailProps) {
  const [groupFilters, setGroupFilters] = useState<FilterChip[]>([]);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenuRow, setContextMenuRow] = useState<{
    name: string;
    dn: string;
  } | null>(null);
  const [groupMembersDialog, setGroupMembersDialog] = useState<{
    dn: string;
    name: string;
  } | null>(null);
  const { openTab } = useNavigation();

  const handleRefresh = onRefresh ?? (() => {});

  // Build a map of property label -> worst severity from health flags
  const severityByLabel = useMemo(() => {
    const map = new Map<string, PropertySeverity>();
    if (!healthStatus) return map;
    for (const flag of healthStatus.activeFlags) {
      const label = FLAG_TO_LABEL[flag.name];
      if (!label) continue;
      const sev = toPropertySeverity(flag.severity);
      if (!sev) continue;
      const existing = map.get(label);
      // Critical wins over Warning
      if (!existing || (existing === "Warning" && sev === "Critical")) {
        map.set(label, sev);
      }
    }
    return map;
  }, [healthStatus]);

  const s = (label: string) => severityByLabel.get(label);

  const propertyGroups: PropertyGroup[] = [
    {
      category: "Identity",
      items: [
        { label: "Display Name", value: user.displayName },
        { label: "SAM Account Name", value: user.samAccountName },
        { label: "User Principal Name", value: user.userPrincipalName },
        { label: "First Name", value: user.givenName },
        { label: "Last Name", value: user.surname },
        { label: "Email", value: user.email },
        { label: "Department", value: user.department },
        { label: "Title", value: user.title },
      ],
    },
    {
      category: "Location",
      items: [
        { label: "OU Path", value: user.organizationalUnit },
        { label: "Distinguished Name", value: user.distinguishedName },
      ],
    },
    {
      category: "Account Status",
      items: [
        {
          label: "Status",
          value: user.enabled ? "Enabled" : "Disabled",
          severity: s("Status"),
        },
        {
          label: "Locked Out",
          value: user.lockedOut ? "Yes" : "No",
          severity: s("Locked Out"),
        },
        {
          label: "Account Expires",
          value: user.accountExpires ?? "Never",
          severity: s("Account Expires"),
        },
      ],
    },
    {
      category: "Authentication",
      items: [
        { label: "Bad Password Count", value: String(user.badPasswordCount) },
        {
          label: "Last Logon",
          value: user.lastLogon ?? "Never",
          severity: s("Last Logon"),
        },
        {
          label: "Last Logon Workstation",
          value: user.lastLogonWorkstation || "N/A",
        },
      ],
    },
    {
      category: "Dates",
      items: [
        {
          label: "Password Last Set",
          value: user.passwordLastSet ?? "Never",
          severity: s("Password Last Set"),
        },
        {
          label: "Password Expired",
          value: user.passwordExpired ? "Yes" : "No",
          severity: s("Password Expired"),
        },
        {
          label: "Password Never Expires",
          value: user.passwordNeverExpires ? "Yes" : "No",
          severity: s("Password Never Expires"),
        },
        { label: "Created", value: user.whenCreated || "N/A" },
        { label: "Modified", value: user.whenChanged || "N/A" },
      ],
    },
  ];

  const handleGroupContextMenu = useCallback(
    (row: { name: string; dn: string }, event: React.MouseEvent) => {
      setContextMenuRow(row);
      setContextMenuPos({ x: event.clientX, y: event.clientY });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenuPos(null);
    setContextMenuRow(null);
  }, []);

  const contextMenuItems: ContextMenuItem[] = contextMenuRow
    ? [
        {
          label: "View group members",
          icon: <Users size={14} />,
          onClick: () => {
            setGroupMembersDialog({
              dn: contextMenuRow.dn,
              name: parseCnFromDn(contextMenuRow.dn),
            });
          },
        },
        {
          label: "Open in Group Management",
          icon: <FolderOpen size={14} />,
          onClick: () => {
            openTab("Group Management", "groups", "users-group", {
              selectedGroupDn: contextMenuRow.dn,
            });
          },
        },
      ]
    : [];

  return (
    <div className="space-y-4" data-testid="user-detail">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {user.displayName || user.samAccountName}
        </h2>
        <div className="flex items-center gap-2">
          {healthStatus && <HealthBadge healthStatus={healthStatus} />}
          <StatusBadge
            text={user.enabled ? "Enabled" : "Disabled"}
            variant={user.enabled ? "success" : "error"}
          />
          {user.lockedOut && <StatusBadge text="Locked" variant="warning" />}
        </div>
      </div>

      <div className="flex items-center gap-1 text-caption text-[var(--color-text-secondary)]">
        <span>{user.samAccountName}</span>
        <CopyButton text={user.samAccountName} />
      </div>

      <UserActions
        user={user}
        onRefresh={handleRefresh}
        onResetPassword={() => setShowPasswordReset(true)}
      />

      <div className="border-t border-[var(--color-border-default)]" />

      <PropertyGrid groups={propertyGroups} />

      <div className="border-t border-[var(--color-border-default)]" />

      <PasswordFlagsEditor user={user} onRefresh={handleRefresh} />

      <div className="border-t border-[var(--color-border-default)]" />

      <div data-testid="user-groups-section">
        <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
          Group Memberships ({user.memberOf.length})
        </h3>
        <FilterBar
          filters={groupFilters}
          onFilterChange={setGroupFilters}
          onTextFilter={onGroupFilterText}
          placeholder="Filter groups..."
        />
        <DataTable
          columns={groupColumns}
          data={groupRows}
          rowKey={(row) => row.dn}
          onRowContextMenu={handleGroupContextMenu}
        />
      </div>

      <div className="border-t border-[var(--color-border-default)]" />

      <AdvancedAttributes rawAttributes={user.rawAttributes} />

      <div className="border-t border-[var(--color-border-default)]" />

      <div data-testid="user-history-section">
        <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
          Replication History
        </h3>
        <StateInTimeView objectDn={user.distinguishedName} objectType="user" />
      </div>

      <ContextMenu
        items={contextMenuItems}
        position={contextMenuPos}
        onClose={closeContextMenu}
      />

      {showPasswordReset && (
        <PasswordResetDialog
          userDn={user.distinguishedName}
          displayName={user.displayName || user.samAccountName}
          onClose={() => setShowPasswordReset(false)}
          onSuccess={handleRefresh}
        />
      )}

      {groupMembersDialog && (
        <GroupMembersDialog
          groupDn={groupMembersDialog.dn}
          groupName={groupMembersDialog.name}
          onClose={() => setGroupMembersDialog(null)}
        />
      )}
    </div>
  );
}
