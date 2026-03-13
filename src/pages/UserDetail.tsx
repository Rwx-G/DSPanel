import { useState } from "react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { CopyButton } from "@/components/common/CopyButton";
import { HealthBadge } from "@/components/common/HealthBadge";
import {
  PropertyGrid,
  type PropertyGroup,
} from "@/components/data/PropertyGrid";
import { DataTable, type Column } from "@/components/data/DataTable";
import { FilterBar, type FilterChip } from "@/components/data/FilterBar";
import { type DirectoryUser } from "@/types/directory";
import type { AccountHealthStatus } from "@/types/health";

export interface UserDetailProps {
  user: DirectoryUser;
  healthStatus?: AccountHealthStatus;
  groupColumns: Column<{ name: string; dn: string }>[];
  groupRows: { name: string; dn: string }[];
  groupFilterText: string;
  onGroupFilterText: (value: string) => void;
}

export function UserDetail({
  user,
  healthStatus,
  groupColumns,
  groupRows,
  groupFilterText: _groupFilterText,
  onGroupFilterText,
}: UserDetailProps) {
  const [groupFilters, setGroupFilters] = useState<FilterChip[]>([]);

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

      <PropertyGrid groups={propertyGroups} />

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
    </div>
  );
}
