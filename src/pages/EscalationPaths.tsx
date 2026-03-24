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
  User,
  Users,
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
import { extractErrorMessage } from "@/utils/errorMapping";

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

function riskScoreLabel(score: number): string {
  if (score < 3) return "Critical";
  if (score <= 5) return "High";
  return "Medium";
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
        {path.hopCount} hop{path.hopCount !== 1 ? "s" : ""}
      </span>

      {/* Risk score badge */}
      <span
        className="mr-1 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold"
        style={{
          color: riskScoreColor(path.riskScore),
          backgroundColor: `color-mix(in srgb, ${riskScoreColor(path.riskScore)} 12%, transparent)`,
        }}
        data-testid="risk-score"
        title={`Risk: ${riskScoreLabel(path.riskScore)}`}
      >
        {path.riskScore.toFixed(1)} risk
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
          CRITICAL
        </span>
      )}
    </div>
  );
}

function GraphLegendStats({ data }: { data: EscalationGraphResult }) {
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
    { type: "Membership", label: "Membership", ...edgeTypeStyle("Membership") },
    { type: "Ownership", label: "Ownership", ...edgeTypeStyle("Ownership") },
    { type: "Delegation", label: "Delegation", ...edgeTypeStyle("Delegation") },
    { type: "UnconstrainedDeleg", label: "Unconstrained Deleg", ...edgeTypeStyle("UnconstrainedDeleg") },
    { type: "RBCD", label: "RBCD", ...edgeTypeStyle("RBCD") },
    { type: "SIDHistory", label: "SIDHistory", ...edgeTypeStyle("SIDHistory") },
    { type: "GPLink", label: "GPLink", ...edgeTypeStyle("GPLink") },
    { type: "CertESC", label: "CertESC", ...edgeTypeStyle("CertESC") },
  ];

  return (
    <div className="space-y-4" data-testid="graph-legend">
      {/* Node counts */}
      <div>
        <h3 className="mb-2 text-caption font-semibold text-[var(--color-text-primary)]">
          Node Types
        </h3>
        <table className="w-full text-caption">
          <tbody>
            <tr className="border-b border-[var(--color-border-subtle)]">
              <td className="py-1.5 pr-2">
                <span className="flex items-center gap-2 text-[var(--color-text-primary)]">
                  <User size={14} /> Users
                </span>
              </td>
              <td className="py-1.5 text-right font-medium text-[var(--color-text-primary)]">
                {userCount}
              </td>
            </tr>
            <tr className="border-b border-[var(--color-border-subtle)]">
              <td className="py-1.5 pr-2">
                <span className="flex items-center gap-2 text-[var(--color-text-primary)]">
                  <Users size={14} /> Groups
                </span>
              </td>
              <td className="py-1.5 text-right font-medium text-[var(--color-text-primary)]">
                {groupCount}
              </td>
            </tr>
            <tr className="border-b border-[var(--color-border-subtle)]">
              <td className="py-1.5 pr-2">
                <span className="flex items-center gap-2" style={{ color: "var(--color-error)" }}>
                  <Users size={14} /> Privileged Groups
                </span>
              </td>
              <td
                className="py-1.5 text-right font-medium"
                style={{ color: "var(--color-error)" }}
              >
                {privilegedGroupCount}
              </td>
            </tr>
            {computerCount > 0 && (
              <tr className="border-b border-[var(--color-border-subtle)]">
                <td className="py-1.5 pr-2">
                  <span className="flex items-center gap-2 text-[var(--color-text-primary)]">
                    <Monitor size={14} /> Computers
                  </span>
                </td>
                <td className="py-1.5 text-right font-medium text-[var(--color-text-primary)]">
                  {computerCount}
                </td>
              </tr>
            )}
            {gpoCount > 0 && (
              <tr className="border-b border-[var(--color-border-subtle)]">
                <td className="py-1.5 pr-2">
                  <span className="flex items-center gap-2 text-[var(--color-text-primary)]">
                    <FileText size={14} /> GPOs
                  </span>
                </td>
                <td className="py-1.5 text-right font-medium text-[var(--color-text-primary)]">
                  {gpoCount}
                </td>
              </tr>
            )}
            {certTemplateCount > 0 && (
              <tr>
                <td className="py-1.5 pr-2">
                  <span className="flex items-center gap-2 text-[var(--color-text-primary)]">
                    <Key size={14} /> Cert Templates
                  </span>
                </td>
                <td className="py-1.5 text-right font-medium text-[var(--color-text-primary)]">
                  {certTemplateCount}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edge counts */}
      <div>
        <h3 className="mb-2 text-caption font-semibold text-[var(--color-text-primary)]">
          Edge Types
        </h3>
        <table className="w-full text-caption">
          <tbody>
            {edgeTypeCounts.map((et) => {
              const count = data.edges.filter((e) => e.edgeType === et.type).length;
              if (count === 0) return null;
              return (
                <tr key={et.type} className="border-b border-[var(--color-border-subtle)]">
                  <td className="py-1.5 pr-2">
                    <span className="flex items-center gap-2 text-[var(--color-text-primary)]">
                      <span
                        className="inline-block w-4"
                        style={{ borderTop: `2px ${et.style} ${et.color}` }}
                      />
                      {et.label}
                    </span>
                  </td>
                  <td className="py-1.5 text-right font-medium text-[var(--color-text-primary)]">
                    {count}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Color legend */}
      <div>
        <h3 className="mb-2 text-caption font-semibold text-[var(--color-text-primary)]">
          Legend
        </h3>
        <div className="space-y-1.5 text-caption">
          <div className="flex items-center gap-2 text-[var(--color-text-primary)]">
            <Circle size={12} /> User
          </div>
          <div className="flex items-center gap-2 text-[var(--color-text-primary)]">
            <Square size={12} /> Group
          </div>
          <div className="flex items-center gap-2" style={{ color: "var(--color-error)" }}>
            <Square size={12} /> Privileged
          </div>
          <div className="flex items-center gap-2 text-[var(--color-text-primary)]">
            <Monitor size={12} /> Computer
          </div>
          <div className="flex items-center gap-2 text-[var(--color-text-primary)]">
            <FileText size={12} /> GPO
          </div>
          <div className="flex items-center gap-2 text-[var(--color-text-primary)]">
            <Key size={12} /> Cert Template
          </div>
        </div>
      </div>

      {/* Edges list */}
      <div>
        <h3 className="mb-2 text-caption font-semibold text-[var(--color-text-primary)]">
          All Edges
        </h3>
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-caption" data-testid="edges-table">
            <thead>
              <tr className="text-left text-[var(--color-text-secondary)]">
                <th className="pb-1 pr-2 font-medium">Source</th>
                <th className="pb-1 pr-2 font-medium">Type</th>
                <th className="pb-1 font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              {data.edges.map((edge, i) => {
                const sourceNode = data.nodes.find((n) => n.dn === edge.sourceDn);
                const targetNode = data.nodes.find((n) => n.dn === edge.targetDn);
                const es = edgeTypeStyle(edge.edgeType);
                return (
                  <tr
                    key={i}
                    className="border-t border-[var(--color-border-subtle)]"
                  >
                    <td className="py-1 pr-2 text-[var(--color-text-primary)]">
                      {sourceNode?.displayName ?? edge.sourceDn}
                    </td>
                    <td className="py-1 pr-2">
                      <span
                        className="inline-block w-4"
                        style={{
                          borderTop: `2px ${es.style} ${es.color}`,
                        }}
                        title={edge.label ?? edge.edgeType}
                      />
                      <span className="ml-1 text-[var(--color-text-secondary)]">
                        {edge.label ?? edge.edgeType}
                      </span>
                    </td>
                    <td className="py-1 text-[var(--color-text-primary)]">
                      {targetNode?.displayName ?? edge.targetDn}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function EscalationPaths() {
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
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          Privilege Escalation Paths
        </h2>
        <div className="flex items-center gap-3">
          {data && (
            <div className="flex items-center gap-2 text-caption" data-testid="summary">
              <span className="text-[var(--color-text-secondary)]">
                {data.nodes.length} nodes
              </span>
              <span className="text-[var(--color-text-secondary)]">
                {data.edges.length} edges
              </span>
              {criticalPathCount > 0 ? (
                <span
                  className="flex items-center gap-1"
                  style={{ color: "var(--color-error)" }}
                >
                  <AlertCircle size={12} />
                  {criticalPathCount} critical path{criticalPathCount !== 1 ? "s" : ""}
                </span>
              ) : (
                <span className="text-[var(--color-text-secondary)]">
                  {data.criticalPaths.length} paths
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
            Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && !data ? (
          <LoadingSpinner message="Analyzing group memberships..." />
        ) : error ? (
          <EmptyState
            icon={<AlertCircle size={40} />}
            title="Analysis Failed"
            description={error}
          />
        ) : !data || (data.criticalPaths.length === 0 && data.nodes.length === 0) ? (
          <EmptyState
            icon={<Shield size={40} />}
            title="No Escalation Paths Found"
            description="No privilege escalation paths were detected in the directory."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            {/* Critical Paths panel */}
            <div
              className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]"
              data-testid="critical-paths-panel"
            >
              <div className="border-b border-[var(--color-border-default)] px-3 py-2">
                <h3 className="text-caption font-semibold text-[var(--color-text-primary)]">
                  Escalation Paths ({sortedPaths.length})
                </h3>
              </div>
              {sortedPaths.length === 0 ? (
                <div className="px-3 py-6 text-center text-caption text-[var(--color-text-secondary)]">
                  No escalation paths detected.
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
                  Computed at: {new Date(data.computedAt).toLocaleString()}
                </div>
              )}
            </div>

            {/* Graph Legend & Stats panel */}
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3">
              <h3 className="mb-3 text-caption font-semibold text-[var(--color-text-primary)]">
                Graph Legend & Stats
              </h3>
              <GraphLegendStats data={data} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
