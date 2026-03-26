import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import {
  RefreshCw,
  AlertCircle,
  Server,
  MapPin,
  Crown,
  Globe,
  GitBranch,
  CheckCircle,
  ChevronDown,
} from "lucide-react";
import { type TopologyData, type TopologyDcNode } from "@/types/topology";
import { extractErrorMessage } from "@/utils/errorMapping";
import { useTranslation } from "react-i18next";

/** Renders a single DC entry within a site card, expandable on click. */
function DcEntry({ dc }: { dc: TopologyDcNode }) {
  const { t } = useTranslation(["topology", "common"]);
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        className="flex w-full items-start gap-4 px-4 py-3 text-left hover:bg-[var(--color-surface-hover)] transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid={`dc-entry-${dc.hostname}`}
      >
        <div className="relative mt-0.5 shrink-0">
          <Server size={20} className="text-[var(--color-text-secondary)]" />
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-surface-card)]"
            style={{
              backgroundColor: dc.isOnline ? "var(--color-success)" : "var(--color-error)",
            }}
            title={dc.isOnline ? t("online") : t("offline")}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-body font-medium text-[var(--color-text-primary)]">
            {dc.hostname}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {dc.isPdc && (
              <span className="flex items-center gap-1 rounded bg-[#8b5cf6] px-1.5 py-0.5 text-[10px] font-medium text-white">
                <Crown size={10} /> PDC
              </span>
            )}
            {dc.isGc && (
              <span className="flex items-center gap-1 rounded bg-[var(--color-primary)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                <Globe size={10} /> GC
              </span>
            )}
            {dc.fsmoRoles.filter((r) => r !== "PDC").map((role) => (
              <span
                key={role}
                className="rounded bg-[var(--color-text-secondary)] px-1.5 py-0.5 text-[10px] font-medium text-white"
              >
                {role}
              </span>
            ))}
          </div>
        </div>
        <ChevronDown
          size={14}
          className={`mt-1 shrink-0 text-[var(--color-text-secondary)] transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-hover)] px-4 py-2">
          <table className="w-full text-caption">
            <tbody>
              <tr>
                <td className="py-0.5 pr-3 font-medium text-[var(--color-text-secondary)]">{t("common:status")}</td>
                <td className="py-0.5" style={{ color: dc.isOnline ? "var(--color-success)" : "var(--color-error)" }}>
                  {dc.isOnline ? t("online") : t("offline")}
                </td>
              </tr>
              {dc.ipAddress && (
                <tr>
                  <td className="py-0.5 pr-3 font-medium text-[var(--color-text-secondary)]">{t("ipAddress")}</td>
                  <td className="py-0.5 font-mono text-[var(--color-text-primary)]">{dc.ipAddress}</td>
                </tr>
              )}
              {dc.osVersion && (
                <tr>
                  <td className="py-0.5 pr-3 font-medium text-[var(--color-text-secondary)]">{t("os")}</td>
                  <td className="py-0.5 text-[var(--color-text-primary)]">{dc.osVersion}</td>
                </tr>
              )}
              <tr>
                <td className="py-0.5 pr-3 font-medium text-[var(--color-text-secondary)]">{t("site")}</td>
                <td className="py-0.5 text-[var(--color-text-primary)]">{dc.siteName}</td>
              </tr>
              <tr>
                <td className="py-0.5 pr-3 font-medium text-[var(--color-text-secondary)]">{t("globalCatalog")}</td>
                <td className="py-0.5 text-[var(--color-text-primary)]">{dc.isGc ? t("common:yes") : t("common:no")}</td>
              </tr>
              {dc.fsmoRoles.length > 0 && (
                <tr>
                  <td className="py-0.5 pr-3 font-medium text-[var(--color-text-secondary)]">{t("fsmoRoles")}</td>
                  <td className="py-0.5 text-[var(--color-text-primary)]">{dc.fsmoRoles.join(", ")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function replLinkStatusColor(status: string): string {
  switch (status) {
    case "Healthy": return "var(--color-success)";
    case "Warning": return "var(--color-warning)";
    case "Failed": return "var(--color-error)";
    default: return "var(--color-text-secondary)";
  }
}

/** Structured card view for AD topology. */
function SimpleTopologyView({ data }: { data: TopologyData }) {
  const { t } = useTranslation(["topology", "common"]);
  const totalDcs = data.sites.reduce((n, s) => n + s.dcs.length, 0);

  return (
    <div className="flex-1 overflow-y-auto p-6" data-testid="topology-canvas">
      <div className="mx-auto max-w-3xl space-y-4">
        {/* Site cards */}
        {data.sites.map((site) => (
          <div
            key={site.name}
            className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]"
          >
            {/* Site header */}
            <div className="flex items-center gap-3 border-b border-[var(--color-border-default)] px-4 py-3">
              <MapPin size={18} className="text-[var(--color-primary)]" />
              <div>
                <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
                  {site.name}
                </h3>
                <span className="text-caption text-[var(--color-text-secondary)]">
                  {site.location
                    ? `${site.location} - ${site.dcs.length} DC${site.dcs.length > 1 ? "s" : ""}`
                    : `${site.dcs.length} DC${site.dcs.length > 1 ? "s" : ""}`}
                </span>
              </div>
            </div>

            {/* DC list */}
            <div className="divide-y divide-[var(--color-border-subtle)]">
              {site.dcs.map((dc) => (
                <DcEntry key={dc.hostname} dc={dc} />
              ))}
            </div>

            {/* Subnets */}
            {site.subnets.length > 0 && (
              <div className="border-t border-[var(--color-border-default)] px-4 py-3">
                <div className="text-caption font-medium text-[var(--color-text-secondary)]">
                  {t("subnets")}
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {site.subnets.map((subnet) => (
                    <span
                      key={subnet}
                      className="rounded border border-[var(--color-border-default)] bg-[var(--color-surface-hover)] px-2 py-0.5 font-mono text-caption text-[var(--color-text-primary)]"
                    >
                      {subnet}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Replication links */}
        {data.replicationLinks.length > 0 && (
          <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]">
            <div className="flex items-center gap-3 border-b border-[var(--color-border-default)] px-4 py-3">
              <RefreshCw size={18} className="text-[var(--color-text-secondary)]" />
              <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
                {t("replicationLinks")}
              </h3>
            </div>
            <div className="divide-y divide-[var(--color-border-subtle)]">
              {data.replicationLinks.map((link, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-2.5">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: replLinkStatusColor(link.status) }}
                    title={link.status}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-caption text-[var(--color-text-primary)]">
                      {link.sourceDc}
                    </span>
                    <span className="mx-2 text-[var(--color-text-secondary)]">{"-->"}</span>
                    <span className="font-mono text-caption text-[var(--color-text-primary)]">
                      {link.targetDc}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-caption text-[var(--color-text-secondary)]">
                    {link.errorCount > 0 && (
                      <span style={{ color: "var(--color-error)" }}>
                        {link.errorCount} errors
                      </span>
                    )}
                    <span>{link.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Site links */}
        {data.siteLinks.length > 0 && (
          <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]">
            <div className="flex items-center gap-3 border-b border-[var(--color-border-default)] px-4 py-3">
              <GitBranch size={18} className="text-[var(--color-text-secondary)]" />
              <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
                {t("siteLinks")}
              </h3>
            </div>
            <div className="divide-y divide-[var(--color-border-subtle)]">
              {data.siteLinks.map((sl) => (
                <div key={sl.name} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-body font-medium text-[var(--color-text-primary)]">
                      {sl.name}
                    </span>
                    <span className="ml-2 text-caption text-[var(--color-text-secondary)]">
                      ({sl.sites.join(" - ")})
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-caption text-[var(--color-text-secondary)]">
                    <span>{t("cost")} {sl.cost}</span>
                    <span>{t("interval")} {sl.replInterval} {t("min")}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-4 py-3">
          <div className="flex items-center gap-2 text-caption text-[var(--color-text-secondary)]">
            <CheckCircle size={14} className="text-[var(--color-success)]" />
            {data.sites.length} site{data.sites.length > 1 ? "s" : ""},{" "}
            {totalDcs} DC{totalDcs > 1 ? "s" : ""},{" "}
            {data.replicationLinks.length} replication link{data.replicationLinks.length !== 1 ? "s" : ""},{" "}
            {data.siteLinks.length} site link{data.siteLinks.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TopologyView() {
  const { t } = useTranslation(["topology", "common"]);
  const [data, setData] = useState<TopologyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTopology = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<TopologyData>("get_topology");
      setData(result);
    } catch (e: unknown) {
      setError(extractErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTopology();
  }, [fetchTopology]);

  return (
    <div className="flex h-full flex-col" data-testid="topology-view">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-2">
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          {t("pageTitle")}
        </h2>
        <div className="flex items-center gap-2">
          {data && (
            <>
              <span className="text-caption text-[var(--color-text-secondary)]">
                {data.sites.length} site{data.sites.length > 1 ? "s" : ""},{" "}
                {data.sites.reduce((n, s) => n + s.dcs.length, 0)} DC{data.sites.reduce((n, s) => n + s.dcs.length, 0) > 1 ? "s" : ""}
              </span>
            </>
          )}
          <button
            className="btn btn-sm flex items-center gap-1"
            onClick={fetchTopology}
            disabled={loading}
            data-testid="refresh-button"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {t("common:refresh")}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner message={t("loadingTopology")} />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<AlertCircle size={40} />}
              title={t("loadFailed")}
              description={error}
            />
          </div>
        ) : !data || data.sites.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<Server size={40} />}
              title={t("noData")}
              description={t("noDataDescription")}
            />
          </div>
        ) : (
          <SimpleTopologyView data={data} />
        )}
      </div>
    </div>
  );
}
