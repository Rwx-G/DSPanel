import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import {
  RefreshCw,
  Shield,
  AlertCircle,
  ArrowRight,
  Circle,
  Square,
  Monitor,
  FileText,
  Key,
} from "lucide-react";
import {
  type EscalationGraphResult,
  type EscalationPath,
  type GraphNode,
  type EdgeType,
} from "@/types/security";
import { SecurityDisclaimer } from "@/components/common/SecurityDisclaimer";
import { extractErrorMessage } from "@/utils/errorMapping";
import { useTranslation } from "react-i18next";

function edgeTypeStyle(edgeType: EdgeType): { style: string; color: string } {
  switch (edgeType) {
    case "Membership":
      return { style: "solid", color: "var(--color-text-primary)" };
    case "Ownership":
      return { style: "dashed", color: "var(--color-text-primary)" };
    case "Delegation":
      return { style: "dashed", color: "var(--color-text-primary)" };
    case "RBCD":
      return { style: "dotted", color: "var(--color-text-primary)" };
    case "SIDHistory":
      return { style: "solid", color: "var(--color-error)" };
    case "GPLink":
      return { style: "solid", color: "var(--color-info)" };
    case "CertESC":
      return { style: "solid", color: "#9333ea" };
    case "UnconstrainedDeleg":
      return { style: "dashed", color: "var(--color-warning)" };
  }
}

function riskScoreColor(score: number): string {
  if (score < 3) return "var(--color-error)";
  if (score <= 5) return "var(--color-warning)";
  return "var(--color-info)";
}

function riskScoreLabel(score: number, t: (key: string) => string): string {
  if (score < 3) return t("riskCritical");
  if (score <= 5) return t("riskHigh");
  return t("riskMedium");
}

function nodeIcon(nodeType: string) {
  switch (nodeType) {
    case "User":
      return <Circle size={10} />;
    case "Computer":
      return <Monitor size={10} />;
    case "GPO":
      return <FileText size={10} />;
    case "CertTemplate":
      return <Key size={10} />;
    default:
      return <Square size={10} />;
  }
}

function NodeBadge({ node }: { node: GraphNode }) {
  const isPrivileged = node.isPrivileged;
  const color = isPrivileged ? "var(--color-error)" : "var(--color-text-primary)";
  const bgColor = isPrivileged
    ? "color-mix(in srgb, var(--color-error) 12%, transparent)"
    : "color-mix(in srgb, var(--color-text-secondary) 8%, transparent)";

  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{ color, backgroundColor: bgColor }}
      title={node.dn}
    >
      {nodeIcon(node.nodeType)}
      {node.displayName}
    </span>
  );
}

function PathRow({
  path,
  nodeMap,
}: {
  path: EscalationPath;
  nodeMap: Map<string, GraphNode>;
}) {
  const { t } = useTranslation(["escalationPaths", "common"]);
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-lg border px-3 py-2 transition-colors"
      style={{
        borderColor: path.isCritical
          ? "var(--color-error)"
          : "var(--color-border-default)",
        backgroundColor: path.isCritical
          ? "color-mix(in srgb, var(--color-error) 4%, var(--color-surface-card))"
          : "var(--color-surface-card)",
      }}
      data-testid={`path-row-${path.nodes[0]}`}
    >
      {/* Hop count badge */}
      <span
        className="mr-1 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold"
        style={{
          color: path.isCritical ? "var(--color-error)" : "var(--color-text-secondary)",
          backgroundColor: path.isCritical
            ? "color-mix(in srgb, var(--color-error) 12%, transparent)"
            : "color-mix(in srgb, var(--color-text-secondary) 10%, transparent)",
        }}
        data-testid="hop-count"
      >
        {t("hop", { count: path.hopCount })}
      </span>

      {/* Risk score badge */}
      <span
        className="mr-1 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold"
        style={{
          color: riskScoreColor(path.riskScore),
          backgroundColor: `color-mix(in srgb, ${riskScoreColor(path.riskScore)} 12%, transparent)`,
        }}
        data-testid="risk-score"
        title={`${t("risk")}: ${riskScoreLabel(path.riskScore, t)}`}
      >
        {path.riskScore.toFixed(1)} {t("risk")}
      </span>

      {path.nodes.map((dn, i) => {
        const node = nodeMap.get(dn);
        const edgeLabel = i < path.edgeTypes.length ? path.edgeTypes[i] : null;
        return (
          <span key={dn} className="inline-flex items-center gap-1">
            {node ? (
              <NodeBadge node={node} />
            ) : (
              <span className="text-[11px] text-[var(--color-text-secondary)]">
                {dn}
              </span>
            )}
            {i < path.nodes.length - 1 && (
              <span className="inline-flex items-center gap-0.5">
                <span className="text-[9px] text-[var(--color-text-secondary)]">
                  {edgeLabel ? `[${edgeLabel}]` : ""}
                </span>
                <ArrowRight
                  size={12}
                  className="shrink-0 text-[var(--color-text-secondary)]"
                />
              </span>
            )}
          </span>
        );
      })}

      {path.isCritical && (
        <span
          className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold"
          style={{ color: "var(--color-error)" }}
        >
          <AlertCircle size={10} />
          {t("criticalBadge")}
        </span>
      )}
    </div>
  );
}

function GraphLegendStats({ data }: { data: EscalationGraphResult }) {
  const { t } = useTranslation(["escalationPaths", "common"]);
  const userCount = data.nodes.filter((n) => n.nodeType === "User").length;
  const groupCount = data.nodes.filter(
    (n) => n.nodeType === "Group" && !n.isPrivileged,
  ).length;
  const privilegedGroupCount = data.nodes.filter(
    (n) => n.nodeType === "Group" && n.isPrivileged,
  ).length;
  const computerCount = data.nodes.filter(
    (n) => n.nodeType === "Computer",
  ).length;
  const gpoCount = data.nodes.filter((n) => n.nodeType === "GPO").length;
  const certTemplateCount = data.nodes.filter(
    (n) => n.nodeType === "CertTemplate",
  ).length;

  const edgeTypeCounts: { type: EdgeType; label: string; style: string; color: string }[] = [
    { type: "Membership", label: t("membership"), ...edgeTypeStyle("Membership") },
    { type: "Ownership", label: t("ownership"), ...edgeTypeStyle("Ownership") },
    { type: "Delegation", label: t("delegation"), ...edgeTypeStyle("Delegation") },
    { type: "UnconstrainedDeleg", label: t("unconstrainedDeleg"), ...edgeTypeStyle("UnconstrainedDeleg") },
    { type: "RBCD", label: t("rbcd"), ...edgeTypeStyle("RBCD") },
    { type: "SIDHistory", label: t("sidHistoryEdge"), ...edgeTypeStyle("SIDHistory") },
    { type: "GPLink", label: t("gpLink"), ...edgeTypeStyle("GPLink") },
    { type: "CertESC", label: t("certEsc"), ...edgeTypeStyle("CertESC") },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-caption" data-testid="graph-legend">
      {/* Nodes */}
      <span className="font-semibold text-[var(--color-text-primary)]">{t("nodes")}:</span>
      <span className="inline-flex items-center gap-1 text-[var(--color-text-secondary)]"><Circle size={10} /> {userCount} {t("users")}</span>
      {groupCount > 0 && <span className="inline-flex items-center gap-1 text-[var(--color-text-secondary)]"><Square size={10} /> {groupCount} {t("groups")}</span>}
      <span className="inline-flex items-center gap-1" style={{ color: "var(--color-error)" }}><Square size={10} /> {privilegedGroupCount} {t("privileged")}</span>
      {computerCount > 0 && <span className="inline-flex items-center gap-1 text-[var(--color-text-secondary)]"><Monitor size={10} /> {computerCount} {t("computers")}</span>}
      {gpoCount > 0 && <span className="inline-flex items-center gap-1 text-[var(--color-text-secondary)]"><FileText size={10} /> {gpoCount} {t("gpos")}</span>}
      {certTemplateCount > 0 && <span className="inline-flex items-center gap-1 text-[var(--color-text-secondary)]"><Key size={10} /> {certTemplateCount} {t("certTemplates")}</span>}

      <span className="text-[var(--color-border-default)]">|</span>

      {/* Edges */}
      <span className="font-semibold text-[var(--color-text-primary)]">{t("edges")}:</span>
      {edgeTypeCounts.map((et) => {
        const count = data.edges.filter((e) => e.edgeType === et.type).length;
        if (count === 0) return null;
        return (
          <span key={et.type} className="inline-flex items-center gap-1 text-[var(--color-text-secondary)]">
            <span className="inline-block w-3" style={{ borderTop: `2px ${et.style} ${et.color}` }} />
            {count} {et.label}
          </span>
        );
      })}
    </div>
  );
}

export function EscalationPaths() {
  const { t } = useTranslation(["escalationPaths", "common"]);
  const [data, setData] = useState<EscalationGraphResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const result = await invoke<EscalationGraphResult>("get_escalation_paths");
      setData(result);
    } catch (e: unknown) {
      setError(extractErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const nodeMap = new Map<string, GraphNode>();
  if (data) {
    for (const node of data.nodes) {
      nodeMap.set(node.dn, node);
    }
  }

  const sortedPaths = data
    ? [...data.criticalPaths].sort((a, b) => {
        // Critical first, then by risk score ascending (most dangerous first)
        if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
        return a.riskScore - b.riskScore;
      })
    : [];

  const criticalPathCount = sortedPaths.filter((p) => p.isCritical).length;

  return (
    <div className="flex h-full flex-col" data-testid="escalation-paths">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-2">
        <h2 className="flex items-center gap-1.5 text-body font-semibold text-[var(--color-text-primary)]">
          {t("pageTitle")}
          <SecurityDisclaimer
            coverage="~20%"
            checks="8 edge types via LDAP: group membership (recursive), managedBy ownership, constrained/unconstrained delegation, RBCD, SIDHistory, GPO links, AD CS ESC1 templates. Weighted Dijkstra path-finding."
            limitations="Does not parse binary ACLs (WriteDACL, GenericAll, ForceChangePassword, WriteOwner), does not collect local admin sessions, no cross-domain/forest trust path analysis."
            tools="BloodHound CE (~35 edge types with full ACL parsing) or Semperis Forest Druid for comprehensive attack path analysis."
          />
        </h2>
        <div className="flex items-center gap-3">
          {data && (
            <div className="flex items-center gap-2 text-caption" data-testid="summary">
              <span className="text-[var(--color-text-secondary)]">
                {data.nodes.length} {t("nodes")}
              </span>
              <span className="text-[var(--color-text-secondary)]">
                {data.edges.length} {t("edges")}
              </span>
              {criticalPathCount > 0 ? (
                <span
                  className="flex items-center gap-1"
                  style={{ color: "var(--color-error)" }}
                >
                  <AlertCircle size={12} />
                  {t("criticalPath", { count: criticalPathCount })}
                </span>
              ) : (
                <span className="text-[var(--color-text-secondary)]">
                  {data.criticalPaths.length} {t("paths")}
                </span>
              )}
            </div>
          )}

          <button
            className="btn btn-sm flex items-center gap-1"
            onClick={() => {
              setLoading(true);
              fetchData();
            }}
            disabled={loading}
            data-testid="refresh-button"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {t("common:refresh")}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && !data ? (
          <LoadingSpinner message={t("analyzing")} />
        ) : error ? (
          <EmptyState
            icon={<AlertCircle size={40} />}
            title={t("analysisFailed")}
            description={error}
          />
        ) : !data || (data.criticalPaths.length === 0 && data.nodes.length === 0) ? (
          <EmptyState
            icon={<Shield size={40} />}
            title={t("noPathsFound")}
            description={t("noPathsDescription")}
          />
        ) : (
          <div className="space-y-4">
            {/* Stats bar */}
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-4 py-3">
              <GraphLegendStats data={data} />
            </div>

            {/* Paths panel */}
            <div
              className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]"
              data-testid="critical-paths-panel"
            >
              <div className="border-b border-[var(--color-border-default)] px-3 py-2">
                <h3 className="text-caption font-semibold text-[var(--color-text-primary)]">
                  {t("panelTitle")} ({sortedPaths.length})
                </h3>
              </div>
              {sortedPaths.length === 0 ? (
                <div className="px-3 py-6 text-center text-caption text-[var(--color-text-secondary)]">
                  {t("noPaths")}
                </div>
              ) : (
                <div className="space-y-2 p-3">
                  {sortedPaths.map((path, i) => (
                    <PathRow key={i} path={path} nodeMap={nodeMap} />
                  ))}
                </div>
              )}
              {data.computedAt && (
                <div className="border-t border-[var(--color-border-default)] px-3 py-2 text-[10px] text-[var(--color-text-secondary)]">
                  {t("computedAt")}: {new Date(data.computedAt).toLocaleString()}
                </div>
              )}
            </div>

            {/* Graph Legend & Stats - removed, now shown above */}
          </div>
        )}
      </div>
    </div>
  );
}
