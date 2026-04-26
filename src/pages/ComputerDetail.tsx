import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { StatusBadge } from "@/components/common/StatusBadge";
import { CopyButton } from "@/components/common/CopyButton";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@/components/common/ContextMenu";
import {
  PropertyGrid,
  type PropertyGroup,
} from "@/components/data/PropertyGrid";
import { DataTable, type Column } from "@/components/data/DataTable";
import { ExportToolbar, type ExportColumn } from "@/components/common/ExportToolbar";
import { FilterBar, type FilterChip } from "@/components/data/FilterBar";
import { GroupMembersDialog } from "@/components/dialogs/GroupMembersDialog";
import { type DirectoryComputer } from "@/types/directory";
import {
  severityToBadgeVariant,
  type SecurityIndicator,
  type SecurityIndicatorSet,
} from "@/types/securityIndicators";
import { DisableUnconstrainedDelegationDialog } from "@/components/dialogs/DisableUnconstrainedDelegationDialog";
import { parseCnFromDn } from "@/utils/dn";
import { Users, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StateInTimeView } from "@/components/comparison/StateInTimeView";
import { WorkstationMonitoringPanel } from "@/components/common/WorkstationMonitoringPanel";
import { usePermissions } from "@/hooks/usePermissions";
import { useDialog } from "@/contexts/DialogContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useErrorHandler } from "@/hooks/useErrorHandler";

export function ComputerDetail({
  computer,
  securityIndicators,
  onDeleted,
  onRefresh,
}: {
  computer: DirectoryComputer;
  /**
   * Set of security indicators detected for this computer (Story 14.3).
   * Optional so callers that have not yet wired the evaluator still compile.
   */
  securityIndicators?: SecurityIndicatorSet;
  onDeleted?: () => void;
  /**
   * Triggered after a Story 14.6 quick-fix succeeds so the parent can
   * re-fetch the computer attributes + re-evaluate indicators (the badge
   * disappears once the next render reads the cleared UAC).
   */
  onRefresh?: () => void;
}) {
  const { t } = useTranslation([
    "computerDetail",
    "common",
    "securityIndicators",
  ]);

  /**
   * Builds the i18next interpolation context for one indicator's tooltip.
   * `ConstrainedDelegation` injects `{{targets}}` from
   * `metadata.target_spns`; `Rbcd` injects `{{principals}}` from
   * `metadata.allowed_principals`. Other kinds receive an empty params
   * object - their tooltips have no placeholders, so i18next ignores it.
   */
  const tooltipParamsFor = (
    indicator: SecurityIndicator,
  ): Record<string, string> => {
    if (indicator.kind === "ConstrainedDelegation") {
      const spns = indicator.metadata?.target_spns;
      return {
        targets: Array.isArray(spns) ? (spns as string[]).join(", ") : "",
      };
    }
    if (indicator.kind === "Rbcd") {
      const principals = indicator.metadata?.allowed_principals;
      return {
        principals: Array.isArray(principals)
          ? (principals as string[]).join(", ")
          : "",
      };
    }
    return {};
  };
  const [groupFilterText, setGroupFilterText] = useState("");
  const [showMonitoring, setShowMonitoring] = useState(false);
  const [platform, setPlatform] = useState("unknown");
  const { hasPermission } = usePermissions();
  const canDelete = hasPermission("AccountOperator");
  const canMonitor = hasPermission("HelpDesk");
  /**
   * Story 14.6: clearing TRUSTED_FOR_DELEGATION on a computer object
   * requires Admin, NOT AccountOperator. Computer delegation changes can
   * break production Kerberos services so the bar is intentionally higher
   * than user-side quick-fixes.
   */
  const canEditCritical = hasPermission("Admin");
  /**
   * Active quick-fix dialog (Story 14.6). `null` hides all dialogs.
   * Discriminated union extensible if more computer-side quick-fixes
   * land in a future story.
   */
  const [activeQuickFix, setActiveQuickFix] = useState<
    "DisableUnconstrainedDelegation" | null
  >(null);

  useEffect(() => {
    invoke<string>("get_platform").then(setPlatform).catch(() => {});
  }, []);
  const { showConfirmation } = useDialog();
  const { notify } = useNotifications();
  const { handleError } = useErrorHandler();

  const handleDeleteComputer = useCallback(async () => {
    const confirmed = await showConfirmation(
      t("deleteComputer"),
      t("deleteConfirmation", { name: computer.name }),
      t("common:cannotBeUndone"),
    );
    if (!confirmed) return;
    try {
      await invoke("delete_ad_object", { dn: computer.distinguishedName });
      notify(t("deleteSuccess"), "success");
      onDeleted?.();
    } catch (err) {
      handleError(err, "deleting computer");
    }
  }, [computer, showConfirmation, onDeleted, notify, handleError]);
  const [groupFilters, setGroupFilters] = useState<FilterChip[]>([]);
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
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [isPinging, setIsPinging] = useState(false);
  const [resolvedAddresses, setResolvedAddresses] = useState<string[]>([]);
  const [isResolvingDns, setIsResolvingDns] = useState(false);
  const [dnsTimedOut, setDnsTimedOut] = useState(false);
  const dnsCacheRef = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    if (!computer.dnsHostName) {
      setResolvedAddresses([]);
      setPingResult(null);
      setDnsTimedOut(false);
      return;
    }

    const cached = dnsCacheRef.current.get(computer.dnsHostName);
    if (cached) {
      setResolvedAddresses(cached);
      setPingResult(null);
      setDnsTimedOut(false);
      return;
    }

    setIsResolvingDns(true);
    setResolvedAddresses([]);
    setPingResult(null);
    setDnsTimedOut(false);

    // Timeout indicator after 10 seconds
    const timeoutTimer = setTimeout(() => setDnsTimedOut(true), 10_000);

    invoke<string[]>("resolve_dns", { hostname: computer.dnsHostName })
      .then((addrs) => {
        dnsCacheRef.current.set(computer.dnsHostName!, addrs);
        setResolvedAddresses(addrs);
      })
      .catch(() => setResolvedAddresses(["DNS resolution failed"]))
      .finally(() => {
        clearTimeout(timeoutTimer);
        setIsResolvingDns(false);
        setDnsTimedOut(false);
      });

    return () => clearTimeout(timeoutTimer);
  }, [computer.dnsHostName]);

  const handlePing = async () => {
    if (!computer.dnsHostName) return;
    setIsPinging(true);
    try {
      const result = await invoke<string>("ping_host", {
        hostname: computer.dnsHostName,
      });
      setPingResult(result);
    } catch {
      setPingResult("Unreachable (ping failed)");
    } finally {
      setIsPinging(false);
    }
  };

  const filteredGroups = computer.memberOf.filter((dn) =>
    parseCnFromDn(dn).toLowerCase().includes(groupFilterText.toLowerCase()),
  );

  const groupColumns: Column<{ name: string; dn: string }>[] = [
    { key: "name", header: t("groupName"), sortable: true },
    { key: "dn", header: t("common:distinguishedName"), sortable: true },
  ];

  const groupRows = filteredGroups.map((dn) => ({
    name: parseCnFromDn(dn),
    dn,
  }));

  const propertyGroups: PropertyGroup[] = [
    {
      category: t("common:identity"),
      items: [
        { label: t("computerName"), value: computer.name },
        { label: t("dnsHostname"), value: computer.dnsHostName },
        { label: t("operatingSystem"), value: computer.operatingSystem },
        { label: t("osVersion"), value: computer.osVersion },
      ],
    },
    {
      category: t("common:status"),
      items: [
        {
          label: t("common:status"),
          value: computer.enabled ? t("common:enabled") : t("common:disabled"),
        },
        { label: t("lastLogon"), value: computer.lastLogon ?? t("common:never") },
      ],
    },
    {
      category: t("common:location"),
      items: [
        { label: t("common:ouPath"), value: computer.organizationalUnit },
        {
          label: t("common:distinguishedName"),
          value: computer.distinguishedName,
        },
      ],
    },
    {
      category: t("common:network"),
      items: [
        {
          label: t("ipAddress"),
          value: isResolvingDns
            ? dnsTimedOut
              ? t("resolvingSlow")
              : t("resolving")
            : resolvedAddresses.length > 0
              ? resolvedAddresses.join(", ")
              : t("common:na"),
          severity:
            isResolvingDns && dnsTimedOut ? ("Warning" as const) : undefined,
        },
        {
          label: t("pingStatus"),
          value: pingResult ?? t("notTested"),
          severity: pingResult
            ? pingResult.startsWith("Reachable")
              ? ("Success" as const)
              : ("Error" as const)
            : undefined,
        },
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
      ]
    : [];

  return (
    <div className="space-y-4" data-testid="computer-detail">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {computer.name}
        </h2>
        <div className="flex items-center gap-2">
          {canDelete && (
            <button
              className="btn btn-sm flex items-center gap-1"
              style={{ color: "var(--color-error)", borderColor: "var(--color-error)" }}
              onClick={handleDeleteComputer}
              data-testid="computer-delete-btn"
            >
              <Trash2 size={14} />
              {t("common:delete")}
            </button>
          )}
          <StatusBadge
            text={computer.enabled ? t("common:enabled") : t("common:disabled")}
            variant={computer.enabled ? "success" : "error"}
          />
          {securityIndicators?.indicators.map((indicator) => (
            <span
              key={indicator.kind}
              className="inline-flex items-center gap-1"
              title={t(
                `securityIndicators:${indicator.kind}.tooltip`,
                tooltipParamsFor(indicator),
              )}
              data-testid={`computer-security-indicator-badge-${indicator.kind}`}
            >
              <StatusBadge
                text={t(`securityIndicators:${indicator.kind}.badge`)}
                variant={severityToBadgeVariant(indicator.severity)}
              />
              {indicator.kind === "UnconstrainedDelegation" && canEditCritical && (
                <button
                  type="button"
                  className="rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveQuickFix("DisableUnconstrainedDelegation");
                  }}
                  aria-label={t(
                    "computerDetail:quickFix.disableUnconstrainedDelegation.fixButtonAriaLabel",
                  )}
                  data-testid="quick-fix-DisableUnconstrainedDelegation-btn"
                >
                  {t(
                    "computerDetail:quickFix.disableUnconstrainedDelegation.fixButton",
                  )}
                </button>
              )}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1 text-caption text-[var(--color-text-secondary)]">
        <span>{computer.dnsHostName}</span>
        {computer.dnsHostName && <CopyButton text={computer.dnsHostName} />}
      </div>

      <div className="flex items-center gap-2">
        <button
          className="btn btn-sm flex items-center gap-1 bg-[var(--color-info)] text-white hover:opacity-90"
          onClick={handlePing}
          disabled={isPinging || !computer.dnsHostName}
          data-testid="ping-button"
        >
          {isPinging ? t("pinging") : t("ping")}
        </button>
        {pingResult && (
          <StatusBadge
            text={pingResult}
            variant={pingResult.startsWith("Reachable") ? "success" : "error"}
          />
        )}
      </div>

      <div className="border-t border-[var(--color-border-default)]" />

      <PropertyGrid groups={propertyGroups} />

      <div className="border-t border-[var(--color-border-default)]" />

      <div data-testid="computer-groups-section">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
            {t("groupMemberships")} ({computer.memberOf.length})
          </h3>
          <ExportToolbar<{ name: string; dn: string }>
            columns={groupColumns.map((c): ExportColumn => ({ key: c.key, header: c.header }))}
            data={groupRows}
            rowMapper={(row) => [row.name, row.dn]}
            title={`${computer.name} - Group Memberships`}
            filenameBase={`${computer.name}_groups`}
          />
        </div>
        <FilterBar
          filters={groupFilters}
          onFilterChange={setGroupFilters}
          onTextFilter={setGroupFilterText}
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

      <div data-testid="computer-history-section">
        <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
          {t("replicationHistory")}
        </h3>
        <StateInTimeView
          objectDn={computer.distinguishedName}
          objectType="computer"
        />
      </div>

      <ContextMenu
        items={contextMenuItems}
        position={contextMenuPos}
        onClose={closeContextMenu}
      />

      {groupMembersDialog && (
        <GroupMembersDialog
          groupDn={groupMembersDialog.dn}
          groupName={groupMembersDialog.name}
          onClose={() => setGroupMembersDialog(null)}
        />
      )}

      {activeQuickFix === "DisableUnconstrainedDelegation" && (
        <DisableUnconstrainedDelegationDialog
          computerDn={computer.distinguishedName}
          computerName={computer.name}
          onClose={() => setActiveQuickFix(null)}
          onSuccess={() => {
            setActiveQuickFix(null);
            notify(
              t(
                "computerDetail:quickFix.disableUnconstrainedDelegation.successNotification",
                { name: computer.name },
              ),
              "success",
            );
            onRefresh?.();
          }}
        />
      )}

      {/* Workstation Monitoring - Windows only, HelpDesk+ */}
      {canMonitor && platform === "windows" && computer.dnsHostName && (
        <div className="mt-4">
          {!showMonitoring ? (
            <button
              className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
              onClick={() => setShowMonitoring(true)}
            >
              {t("openMonitoring")}
            </button>
          ) : (
            <WorkstationMonitoringPanel hostname={computer.dnsHostName} />
          )}
        </div>
      )}
    </div>
  );
}
