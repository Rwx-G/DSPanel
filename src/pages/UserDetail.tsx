import { useState } from "react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { CopyButton } from "@/components/common/CopyButton";
import { HealthBadge } from "@/components/common/HealthBadge";
import { UserActions } from "@/components/common/UserActions";
import { PasswordFlagsEditor } from "@/components/common/PasswordFlagsEditor";
import {
  PropertyGrid,
  type PropertyGroup,
} from "@/components/data/PropertyGrid";
import { DataTable, type Column } from "@/components/data/DataTable";
import { FilterBar, type FilterChip } from "@/components/data/FilterBar";
import { PasswordResetDialog } from "@/components/dialogs/PasswordResetDialog";
import { type DirectoryUser } from "@/types/directory";
import type { AccountHealthStatus } from "@/types/health";

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

  const handleRefresh = onRefresh ?? (() => {});

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
        { label: "Status", value: user.enabled ? "Enabled" : "Disabled" },
        { label: "Locked Out", value: user.lockedOut ? "Yes" : "No" },
        { label: "Account Expires", value: user.accountExpires ?? "Never" },
      ],
    },
    {
      category: "Authentication",
      items: [
        { label: "Bad Password Count", value: String(user.badPasswordCount) },
        { label: "Last Logon", value: user.lastLogon ?? "Never" },
        {
          label: "Last Logon Workstation",
          value: user.lastLogonWorkstation || "N/A",
        },
      ],
    },
    {
      category: "Dates",
      items: [
        { label: "Password Last Set", value: user.passwordLastSet ?? "Never" },
        {
          label: "Password Expired",
          value: user.passwordExpired ? "Yes" : "No",
        },
        {
          label: "Password Never Expires",
          value: user.passwordNeverExpires ? "Yes" : "No",
        },
        { label: "Created", value: user.whenCreated || "N/A" },
        { label: "Modified", value: user.whenChanged || "N/A" },
      ],
    },
  ];

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
        />
      </div>

      {showPasswordReset && (
        <PasswordResetDialog
          userDn={user.distinguishedName}
          displayName={user.displayName || user.samAccountName}
          onClose={() => setShowPasswordReset(false)}
          onSuccess={handleRefresh}
        />
      )}
    </div>
  );
}
