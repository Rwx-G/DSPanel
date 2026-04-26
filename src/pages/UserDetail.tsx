import { useState, useCallback, useMemo, useRef, useEffect } from "react";
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
import { ExportToolbar, type ExportColumn } from "@/components/common/ExportToolbar";
import { FilterBar, type FilterChip } from "@/components/data/FilterBar";
import { AdvancedAttributes } from "@/components/data/AdvancedAttributes";
import { PasswordResetDialog } from "@/components/dialogs/PasswordResetDialog";
import { GroupMembersDialog } from "@/components/dialogs/GroupMembersDialog";
import { type DirectoryUser } from "@/types/directory";
import type { AccountHealthStatus, HealthLevel } from "@/types/health";
import {
  severityToBadgeVariant,
  type SecurityIndicatorSet,
} from "@/types/securityIndicators";
import { parseCnFromDn } from "@/utils/dn";
import { Users, FolderOpen, Save, ArrowUp, AlertTriangle, Trash2 } from "lucide-react";
import { useNavigation } from "@/contexts/NavigationContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useModifyAttribute } from "@/hooks/useModifyAttribute";
import { useDialog } from "@/contexts/DialogContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useErrorHandler } from "@/hooks/useErrorHandler";
import { StateInTimeView } from "@/components/comparison/StateInTimeView";
import { SnapshotHistory } from "@/components/common/SnapshotHistory";
import { ExchangePanel } from "@/components/data/ExchangePanel";
import { ExchangeOnlinePanel } from "@/components/data/ExchangeOnlinePanel";
import { UserPhoto } from "@/components/common/UserPhoto";
import { extractExchangeInfo } from "@/types/exchange";
import { type ExchangeOnlineInfo } from "@/types/exchange-online";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

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
  /**
   * Set of security indicators detected for this user (Story 14.2). When
   * undefined the security badge row is hidden, so the prop is optional
   * for callers that have not yet wired the evaluator.
   */
  securityIndicators?: SecurityIndicatorSet;
  groupColumns: Column<{ name: string; dn: string }>[];
  groupRows: { name: string; dn: string }[];
  groupFilterText: string;
  onGroupFilterText: (value: string) => void;
  onRefresh?: () => void;
  onDeleted?: () => void;
  schemaAttributes?: string[];
}

export function UserDetail({
  user,
  healthStatus,
  securityIndicators,
  groupColumns,
  groupRows,
  groupFilterText: _groupFilterText,
  onGroupFilterText,
  onRefresh,
  onDeleted,
  schemaAttributes,
}: UserDetailProps) {
  const { t } = useTranslation([
    "userDetail",
    "common",
    "sidebar",
    "securityIndicators",
  ]);
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
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission("AccountOperator");
  const { pendingChanges, saving, stageChange, clearChanges, submitChanges } =
    useModifyAttribute();
  const { showConfirmation, showCustomDialog } = useDialog();
  const { handleError } = useErrorHandler();
  const [snapshotRefresh, setSnapshotRefresh] = useState(0);

  const handleRefresh = onRefresh ?? (() => {});
  const { notify } = useNotifications();

  const handleDeleteUser = useCallback(async () => {
    const confirmed = await showConfirmation(
      t("deleteUser"),
      t("deleteConfirmation", { name: user.displayName || user.samAccountName }),
      t("deleteNote"),
    );
    if (!confirmed) return;
    try {
      await invoke("delete_ad_object", { dn: user.distinguishedName });
      notify(t("deleteSuccess"), "success");
      onDeleted?.();
    } catch (err) {
      handleError(err, "deleting user");
    }
  }, [user, showConfirmation, onDeleted, notify, handleError]);

  const handleSaveChanges = useCallback(async () => {
    if (pendingChanges.length === 0) return;
    const hasAdvanced = pendingChanges.some((c) => c.advanced);

    let confirmed: boolean;

    if (hasAdvanced) {
      confirmed =
        (await showCustomDialog<boolean>((resolve) => (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-surface-overlay)]">
            <div
              className="mx-4 w-full max-w-md rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3">
                <AlertTriangle
                  size={20}
                  className="text-[var(--color-warning)]"
                />
                <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
                  {t("confirmAttributeChanges")}
                </h2>
              </div>
              <div className="px-4 py-3 space-y-3">
                <p className="text-body text-[var(--color-text-primary)]">
                  {t("applyChangesTo", { count: pendingChanges.length, name: user.displayName || user.samAccountName })}
                </p>
                <div className="flex items-start gap-2 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-bg)] px-3 py-2">
                  <AlertTriangle
                    size={16}
                    className="mt-0.5 shrink-0 text-[var(--color-warning)]"
                  />
                  <p className="text-caption text-[var(--color-warning)]">
                    {t("attributeWarning")}
                  </p>
                </div>
                <details>
                  <summary className="cursor-pointer text-caption text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                    {t("common:details")}
                  </summary>
                  <pre className="mt-1 max-h-32 overflow-auto rounded bg-[var(--color-surface-bg)] p-2 text-caption text-[var(--color-text-secondary)]">
                    {pendingChanges
                      .map(
                        (c) =>
                          `${c.advanced ? "[ADV] " : ""}${c.attributeName}: "${c.oldValue}" -> "${c.newValue}"`,
                      )
                      .join("\n")}
                  </pre>
                </details>
              </div>
              <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-4 py-3">
                <button
                  className="btn btn-secondary"
                  onClick={() => resolve(false)}
                >
                  {t("common:cancel")}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => resolve(true)}
                >
                  {t("applyChanges")}
                </button>
              </div>
            </div>
          </div>
        ))) ?? false;
    } else {
      const detail = pendingChanges
        .map(
          (c) =>
            `${c.attributeName}: "${c.oldValue}" -> "${c.newValue}"`,
        )
        .join("\n");
      confirmed = await showConfirmation(
        t("confirmAttributeChanges"),
        t("applyChangesTo", { count: pendingChanges.length, name: user.displayName || user.samAccountName }),
        detail,
      );
    }

    if (!confirmed) return;
    const success = await submitChanges(user.distinguishedName);
    if (success) {
      handleRefresh();
      setSnapshotRefresh((n) => n + 1);
    }
  }, [
    pendingChanges,
    showConfirmation,
    showCustomDialog,
    submitChanges,
    user,
    handleRefresh,
  ]);

  const handleEdit = useCallback(
    (attributeName: string, oldValue: string, newValue: string) => {
      stageChange(attributeName, oldValue, newValue, false);
    },
    [stageChange],
  );

  const handleAdvancedEdit = useCallback(
    (attributeName: string, oldValue: string, newValue: string) => {
      stageChange(attributeName, oldValue, newValue, true);
    },
    [stageChange],
  );

  // Track whether the action bar is visible in the viewport
  const actionBarRef = useRef<HTMLDivElement>(null);
  const [actionBarVisible, setActionBarVisible] = useState(true);

  useEffect(() => {
    const el = actionBarRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setActionBarVisible(entry.isIntersecting),
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  const exchangeInfo = useMemo(
    () => extractExchangeInfo(user.rawAttributes),
    [user.rawAttributes],
  );

  // Fetch Exchange Online info via Graph API (if configured)
  const [exchangeOnlineInfo, setExchangeOnlineInfo] =
    useState<ExchangeOnlineInfo | null>(null);

  useEffect(() => {
    if (!user.userPrincipalName) return;
    invoke<ExchangeOnlineInfo | null>("get_exchange_online_info", {
      userPrincipalName: user.userPrincipalName,
    })
      .then(setExchangeOnlineInfo)
      .catch(() => setExchangeOnlineInfo(null));
  }, [user.userPrincipalName]);

  const s = (label: string) => severityByLabel.get(label);

  const propertyGroups: PropertyGroup[] = [
    {
      category: t("common:identity"),
      items: [
        { label: t("common:displayName"), value: user.displayName, editable: canEdit, attributeName: "displayName" },
        { label: t("common:samAccountName"), value: user.samAccountName },
        { label: t("userPrincipalName"), value: user.userPrincipalName },
        { label: t("common:firstName"), value: user.givenName, editable: canEdit, attributeName: "givenName" },
        { label: t("common:lastName"), value: user.surname, editable: canEdit, attributeName: "sn" },
        { label: t("common:email"), value: user.email, editable: canEdit, attributeName: "mail" },
        { label: t("common:department"), value: user.department, editable: canEdit, attributeName: "department" },
        { label: t("common:title"), value: user.title, editable: canEdit, attributeName: "title" },
      ],
    },
    {
      category: t("common:location"),
      items: [
        { label: t("common:ouPath"), value: user.organizationalUnit },
        { label: t("common:distinguishedName"), value: user.distinguishedName },
      ],
    },
    {
      category: t("common:accountStatus"),
      items: [
        {
          label: t("common:status"),
          value: user.enabled ? t("common:enabled") : t("common:disabled"),
          severity: s("Status"),
        },
        {
          label: t("lockedOut"),
          value: user.lockedOut ? t("common:yes") : t("common:no"),
          severity: s("Locked Out"),
        },
        {
          label: t("accountExpires"),
          value: user.accountExpires ?? t("common:never"),
          severity: s("Account Expires"),
        },
      ],
    },
    {
      category: t("common:authentication"),
      items: [
        { label: t("badPasswordCount"), value: String(user.badPasswordCount) },
        {
          label: t("common:lastLogon"),
          value: user.lastLogon ?? t("common:never"),
          severity: s("Last Logon"),
        },
        {
          label: t("lastLogonWorkstation"),
          value: user.lastLogonWorkstation || t("common:na"),
        },
      ],
    },
    {
      category: t("common:dates"),
      items: [
        {
          label: t("passwordLastSet"),
          value: user.passwordLastSet ?? t("common:never"),
          severity: s("Password Last Set"),
        },
        {
          label: t("passwordExpired"),
          value: user.passwordExpired ? t("common:yes") : t("common:no"),
          severity: s("Password Expired"),
        },
        {
          label: t("passwordNeverExpires"),
          value: user.passwordNeverExpires ? t("common:yes") : t("common:no"),
          severity: s("Password Never Expires"),
        },
        { label: t("common:created"), value: user.whenCreated || t("common:na") },
        { label: t("common:modified"), value: user.whenChanged || t("common:na") },
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
          label: t("viewGroupMembers"),
          icon: <Users size={14} />,
          onClick: () => {
            setGroupMembersDialog({
              dn: contextMenuRow.dn,
              name: parseCnFromDn(contextMenuRow.dn),
            });
          },
        },
        {
          label: t("openInGroupManagement"),
          icon: <FolderOpen size={14} />,
          onClick: () => {
            openTab(t("sidebar:groupManagement"), "groups", "users-group", {
              selectedGroupDn: contextMenuRow.dn,
            });
          },
        },
      ]
    : [];

  return (
    <div className="space-y-4" data-testid="user-detail">
      <div className="flex items-center gap-4">
        <UserPhoto
          userDn={user.distinguishedName}
          displayName={user.displayName || user.samAccountName}
          canEdit={canEdit}
          size={64}
        />
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
              {user.displayName || user.samAccountName}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {healthStatus && <HealthBadge healthStatus={healthStatus} />}
              <StatusBadge
                text={user.enabled ? t("common:enabled") : t("common:disabled")}
                variant={user.enabled ? "success" : "error"}
              />
              {user.lockedOut && <StatusBadge text={t("common:locked")} variant="warning" />}
              {user.rawAttributes?.adminCount?.[0] === "1" && (
                <span
                  title={t("common:adminSdHolderTooltip")}
                  data-testid="admin-sdholder-badge"
                >
                  <StatusBadge
                    text={t("common:adminSdHolderBadge")}
                    variant="warning"
                  />
                </span>
              )}
              {securityIndicators?.indicators.map((indicator) => (
                <span
                  key={indicator.kind}
                  title={t(
                    `securityIndicators:${indicator.kind}.tooltip`,
                  )}
                  data-testid={`security-indicator-badge-${indicator.kind}`}
                >
                  <StatusBadge
                    text={t(`securityIndicators:${indicator.kind}.badge`)}
                    variant={severityToBadgeVariant(indicator.severity)}
                  />
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1 text-caption text-[var(--color-text-secondary)]">
            <span>{user.samAccountName}</span>
            <CopyButton text={user.samAccountName} />
          </div>
        </div>
      </div>

      {/* Actions row: user actions + pending changes inline */}
      <div
        ref={actionBarRef}
        className="flex flex-wrap items-center gap-2"
        data-testid="action-bar"
      >
        <UserActions
          user={user}
          onRefresh={handleRefresh}
          onResetPassword={() => setShowPasswordReset(true)}
        />

        {canEdit && (
          <button
            className="btn btn-sm flex items-center gap-1"
            style={{ color: "var(--color-error)", borderColor: "var(--color-error)" }}
            onClick={handleDeleteUser}
            data-testid="user-delete-btn"
          >
            <Trash2 size={14} />
            {t("common:delete")}
          </button>
        )}

        {pendingChanges.length > 0 && (
          <>
            <div className="mx-1 h-6 w-px bg-[var(--color-border-default)]" />
            <div
              className="flex items-center gap-2 rounded-lg border border-[var(--color-primary)] bg-[var(--color-primary-subtle)] px-3 py-1"
              data-testid="pending-changes-bar"
            >
              <span className="text-caption text-[var(--color-text-primary)]">
                {t("unsavedChanges", { count: pendingChanges.length })}
                {pendingChanges.map((c) => (
                  <span
                    key={c.attributeName}
                    className="ml-1.5 inline-block rounded bg-[var(--color-surface-card)] px-1.5 py-0.5 text-[10px] font-mono"
                  >
                    {c.attributeName}
                  </span>
                ))}
              </span>
              <button
                onClick={clearChanges}
                className="btn btn-sm btn-ghost"
                data-testid="discard-changes-btn"
              >
                {t("common:discard")}
              </button>
              <button
                onClick={handleSaveChanges}
                disabled={saving}
                className="btn btn-sm btn-primary"
                data-testid="save-changes-btn"
              >
                <Save size={12} />
                {saving ? t("common:saving") : t("common:save")}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="border-t border-[var(--color-border-default)]" />

      <PropertyGrid
        groups={propertyGroups}
        onEdit={canEdit ? handleEdit : undefined}
      />

      <div className="border-t border-[var(--color-border-default)]" />

      <PasswordFlagsEditor user={user} onRefresh={handleRefresh} />

      {exchangeInfo && (
        <>
          <div className="border-t border-[var(--color-border-default)]" />
          <ExchangePanel exchangeInfo={exchangeInfo} />
        </>
      )}

      {exchangeOnlineInfo && (
        <>
          <div className="border-t border-[var(--color-border-default)]" />
          <ExchangeOnlinePanel exchangeOnlineInfo={exchangeOnlineInfo} />
        </>
      )}

      <div className="border-t border-[var(--color-border-default)]" />

      <div data-testid="user-groups-section">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
            {t("groupMemberships", { count: user.memberOf.length })}
          </h3>
          <ExportToolbar<{ name: string; dn: string }>
            columns={groupColumns.map((c): ExportColumn => ({ key: c.key, header: c.header }))}
            data={groupRows}
            rowMapper={(row) => [row.name, row.dn]}
            title={`${user.displayName} - Group Memberships`}
            filenameBase={`${user.samAccountName}_groups`}
          />
        </div>
        <FilterBar
          filters={groupFilters}
          onFilterChange={setGroupFilters}
          onTextFilter={onGroupFilterText}
          placeholder={t("filterGroups")}
        />
        <DataTable
          columns={groupColumns}
          data={groupRows}
          rowKey={(row) => row.dn}
          onRowContextMenu={handleGroupContextMenu}
        />
      </div>

      <div className="border-t border-[var(--color-border-default)]" />

      <AdvancedAttributes rawAttributes={user.rawAttributes} schemaAttributes={schemaAttributes} onEdit={canEdit ? handleAdvancedEdit : undefined} />

      <div className="border-t border-[var(--color-border-default)]" />

      <div data-testid="user-history-section">
        <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
          {t("replicationHistory")}
        </h3>
        <StateInTimeView objectDn={user.distinguishedName} objectType="user" />
      </div>

      <div className="border-t border-[var(--color-border-default)]" />

      <div data-testid="user-snapshot-section">
        <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
          {t("objectSnapshots")}
        </h3>
        <SnapshotHistory
          objectDn={user.distinguishedName}
          canRestore={hasPermission("DomainAdmin")}
          refreshTrigger={snapshotRefresh}
          onRestored={handleRefresh}
        />
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

      {/* Floating indicator when action bar is scrolled out of view */}
      {pendingChanges.length > 0 && !actionBarVisible && (
        <div
          className="fixed bottom-10 right-4 z-40 flex items-center gap-2 rounded-lg border border-[var(--color-primary)] bg-[var(--color-surface-elevated)] px-4 py-2 shadow-xl"
          data-testid="floating-changes-indicator"
        >
          <span className="text-caption font-medium text-[var(--color-text-primary)]">
            {t("unsavedChanges", { count: pendingChanges.length })}
          </span>
          <button
            onClick={handleSaveChanges}
            disabled={saving}
            className="btn btn-sm btn-primary"
            data-testid="floating-save-btn"
          >
            <Save size={12} />
            {saving ? t("common:saving") : t("common:save")}
          </button>
          <button
            onClick={() =>
              actionBarRef.current?.scrollIntoView({ behavior: "smooth" })
            }
            className="btn btn-sm btn-ghost"
            title={t("scrollToActionBar")}
            data-testid="floating-scroll-btn"
          >
            <ArrowUp size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
