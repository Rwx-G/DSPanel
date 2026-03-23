import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import {
  RefreshCw,
  AlertCircle,
  Server,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize,
  MapPin,
  Shield,
  Crown,
  Globe,
  GitBranch,
  CheckCircle,
} from "lucide-react";
import { type TopologyData, type SiteNode } from "@/types/topology";
import { extractErrorMessage } from "@/utils/errorMapping";

// Layout constants
const SITE_PADDING = 20;
const DC_RADIUS = 18;
const DC_SPACING = 60;
const SITE_GAP = 40;
const SITE_HEADER = 30;
const CANVAS_PADDING = 40;

interface LayoutSite {
  site: SiteNode;
  x: number;
  y: number;
  width: number;
  height: number;
  dcPositions: { hostname: string; x: number; y: number }[];
}

function computeLayout(data: TopologyData): LayoutSite[] {
  const layouts: LayoutSite[] = [];
  let currentX = CANVAS_PADDING;

  for (const site of data.sites) {
    const dcCount = Math.max(site.dcs.length, 1);
    const cols = Math.min(dcCount, 3);
    const rows = Math.ceil(dcCount / cols);
    const width = cols * DC_SPACING + 2 * SITE_PADDING;
    const height = rows * DC_SPACING + SITE_HEADER + 2 * SITE_PADDING;

    const dcPositions = site.dcs.map((dc, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      return {
        hostname: dc.hostname,
        x: currentX + SITE_PADDING + col * DC_SPACING + DC_SPACING / 2,
        y:
          CANVAS_PADDING +
          SITE_HEADER +
          SITE_PADDING +
          row * DC_SPACING +
          DC_SPACING / 2,
      };
    });

    layouts.push({
      site,
      x: currentX,
      y: CANVAS_PADDING,
      width,
      height,
      dcPositions,
    });

    currentX += width + SITE_GAP;
  }

  return layouts;
}

function linkStatusColor(status: string): string {
  switch (status) {
    case "Healthy":
      return "#22c55e";
    case "Warning":
      return "#eab308";
    case "Failed":
      return "#ef4444";
    default:
      return "#6b7280";
  }
}

function drawTopology(
  ctx: CanvasRenderingContext2D,
  data: TopologyData,
  layouts: LayoutSite[],
  scale: number,
  offsetX: number,
  offsetY: number,
  isDark: boolean,
) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  const textColor = isDark ? "#e5e7eb" : "#1f2937";
  const borderColor = isDark ? "#374151" : "#d1d5db";
  const siteBg = isDark ? "#1f2937" : "#f9fafb";
  const dcBg = isDark ? "#374151" : "#ffffff";

  // Build DC position lookup
  const dcPosMap = new Map<string, { x: number; y: number }>();
  for (const layout of layouts) {
    for (const pos of layout.dcPositions) {
      dcPosMap.set(pos.hostname, pos);
    }
  }

  // Draw site link connections (dashed lines between sites)
  for (const sl of data.siteLinks) {
    const siteLayouts = sl.sites
      .map((name) => layouts.find((l) => l.site.name === name))
      .filter(Boolean) as LayoutSite[];

    for (let i = 0; i < siteLayouts.length - 1; i++) {
      const a = siteLayouts[i];
      const b = siteLayouts[i + 1];
      const ax = a.x + a.width / 2;
      const ay = a.y + a.height;
      const bx = b.x + b.width / 2;
      const by = b.y + b.height;

      ctx.beginPath();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.moveTo(ax, ay + 5);
      ctx.lineTo(bx, by + 5);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      const midX = (ax + bx) / 2;
      const midY = (ay + by) / 2 + 15;
      ctx.font = "10px sans-serif";
      ctx.fillStyle = textColor;
      ctx.textAlign = "center";
      ctx.fillText(`Cost: ${sl.cost} / ${sl.replInterval}min`, midX, midY);
    }
  }

  // Draw replication links
  for (const link of data.replicationLinks) {
    const from = dcPosMap.get(link.sourceDc);
    const to = dcPosMap.get(link.targetDc);
    if (!from || !to) continue;

    ctx.beginPath();
    ctx.strokeStyle = linkStatusColor(link.status);
    ctx.lineWidth = 2;
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // Arrow
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const arrowLen = 8;
    const endX = to.x - Math.cos(angle) * DC_RADIUS;
    const endY = to.y - Math.sin(angle) * DC_RADIUS;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - arrowLen * Math.cos(angle - Math.PI / 6),
      endY - arrowLen * Math.sin(angle - Math.PI / 6),
    );
    ctx.lineTo(
      endX - arrowLen * Math.cos(angle + Math.PI / 6),
      endY - arrowLen * Math.sin(angle + Math.PI / 6),
    );
    ctx.closePath();
    ctx.fillStyle = linkStatusColor(link.status);
    ctx.fill();
  }

  // Draw sites
  for (const layout of layouts) {
    // Site container
    ctx.fillStyle = siteBg;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(layout.x, layout.y, layout.width, layout.height, 8);
    ctx.fill();
    ctx.stroke();

    // Site name
    ctx.fillStyle = textColor;
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      layout.site.name,
      layout.x + layout.width / 2,
      layout.y + 20,
    );

    // DCs
    for (const pos of layout.dcPositions) {
      const dc = layout.site.dcs.find((d) => d.hostname === pos.hostname);
      if (!dc) continue;

      // DC circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, DC_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = dcBg;
      ctx.strokeStyle = dc.isPdc ? "#3b82f6" : borderColor;
      ctx.lineWidth = dc.isPdc ? 2 : 1;
      ctx.fill();
      ctx.stroke();

      // DC icon (simple server shape)
      ctx.fillStyle = textColor;
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const shortName = dc.hostname.split(".")[0];
      ctx.fillText(shortName, pos.x, pos.y);

      // GC badge
      if (dc.isGc) {
        ctx.fillStyle = "#3b82f6";
        ctx.font = "bold 8px sans-serif";
        ctx.fillText("GC", pos.x, pos.y + DC_RADIUS + 8);
      }

      // PDC badge
      if (dc.isPdc) {
        ctx.fillStyle = "#8b5cf6";
        ctx.font = "bold 8px sans-serif";
        ctx.fillText("PDC", pos.x, pos.y - DC_RADIUS - 5);
      }
    }
  }

  ctx.restore();
}

/** Structured card view for simple topologies (single site, no replication links). */
function SimpleTopologyView({ data }: { data: TopologyData }) {
  const site = data.sites[0];
  const totalDcs = site.dcs.length;

  return (
    <div className="flex-1 overflow-y-auto p-6" data-testid="topology-canvas">
      {/* Site card */}
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]">
          {/* Site header */}
          <div className="flex items-center gap-3 border-b border-[var(--color-border-default)] px-4 py-3">
            <MapPin size={18} className="text-[var(--color-primary)]" />
            <div>
              <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
                {site.name}
              </h3>
              <span className="text-caption text-[var(--color-text-secondary)]">
                {site.location
                  ? `${site.location} - ${totalDcs} domain controller${totalDcs > 1 ? "s" : ""}`
                  : `${totalDcs} domain controller${totalDcs > 1 ? "s" : ""}`}
              </span>
            </div>
          </div>

          {/* DC list */}
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {site.dcs.map((dc) => (
              <div
                key={dc.hostname}
                className="flex items-start gap-4 px-4 py-3"
              >
                <div className="relative mt-0.5 shrink-0">
                  <Server
                    size={20}
                    className="text-[var(--color-text-secondary)]"
                  />
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-surface-card)]"
                    style={{
                      backgroundColor: dc.isOnline
                        ? "var(--color-success)"
                        : "var(--color-error)",
                    }}
                    title={dc.isOnline ? "Online" : "Offline"}
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
                    {dc.fsmoRoles
                      .filter((r) => r !== "PDC")
                      .map((role) => (
                        <span
                          key={role}
                          className="rounded bg-[var(--color-text-secondary)] px-1.5 py-0.5 text-[10px] font-medium text-white"
                        >
                          {role}
                        </span>
                      ))}
                  </div>
                  <div className="mt-1 space-y-0.5 text-caption text-[var(--color-text-secondary)]">
                    {dc.osVersion && <div>{dc.osVersion}</div>}
                    {dc.ipAddress && <div>IP: {dc.ipAddress}</div>}
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{
                          backgroundColor: dc.isOnline
                            ? "var(--color-success)"
                            : "var(--color-error)",
                        }}
                      />
                      <span style={{ color: dc.isOnline ? "var(--color-success)" : "var(--color-error)" }}>
                        {dc.isOnline ? "Online" : "Offline"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Subnets */}
          {site.subnets.length > 0 && (
            <div className="border-t border-[var(--color-border-default)] px-4 py-3">
              <div className="text-caption font-medium text-[var(--color-text-secondary)]">
                Subnets
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

        {/* Site links info */}
        {data.siteLinks.length > 0 && (
          <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]">
            <div className="flex items-center gap-3 border-b border-[var(--color-border-default)] px-4 py-3">
              <GitBranch size={18} className="text-[var(--color-text-secondary)]" />
              <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
                Site Links
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
                    <span>Cost: {sl.cost}</span>
                    <span>Interval: {sl.replInterval} min</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Topology summary */}
        <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-4 py-3">
          <div className="flex items-center gap-2 text-caption text-[var(--color-text-secondary)]">
            <CheckCircle size={14} className="text-[var(--color-success)]" />
            {totalDcs === 1
              ? "Single domain controller - no replication topology"
              : `${totalDcs} domain controllers in a single site`}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TopologyView() {
  const [data, setData] = useState<TopologyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

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

  // Render canvas
  useEffect(() => {
    if (!data || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cw = container.clientWidth || 800;
    const ch = container.clientHeight || 600;
    canvas.width = cw;
    canvas.height = ch;

    try {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      const layouts = computeLayout(data);
      drawTopology(ctx, data, layouts, scale, offset.x, offset.y, isDark);
    } catch {
      // Canvas rendering may fail in test environments
    }
  }, [data, scale, offset]);

  // Mouse handlers for pan
  const handleMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  };

  const handleMouseUp = () => {
    dragging.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((prev) => Math.max(0.3, Math.min(3, prev + delta)));
  };

  const fitToView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const exportPng = () => {
    if (!canvasRef.current) return;
    canvasRef.current.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ad-topology-${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  return (
    <div className="flex h-full flex-col" data-testid="topology-view">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-2">
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          AD Topology
        </h2>
        <div className="flex items-center gap-2">
          {data && (
            <>
              <span className="text-caption text-[var(--color-text-secondary)]">
                {data.sites.length} site{data.sites.length > 1 ? "s" : ""},{" "}
                {data.sites.reduce((n, s) => n + s.dcs.length, 0)} DC{data.sites.reduce((n, s) => n + s.dcs.length, 0) > 1 ? "s" : ""}
              </span>
              {(data.sites.length > 1 || data.replicationLinks.length > 0) && (
              <>
              <button
                className="btn btn-sm p-1"
                onClick={() =>
                  setScale((s) => Math.min(3, s + 0.2))
                }
                title="Zoom in"
              >
                <ZoomIn size={14} />
              </button>
              <button
                className="btn btn-sm p-1"
                onClick={() =>
                  setScale((s) => Math.max(0.3, s - 0.2))
                }
                title="Zoom out"
              >
                <ZoomOut size={14} />
              </button>
              <button
                className="btn btn-sm p-1"
                onClick={fitToView}
                title="Fit to view"
              >
                <Maximize size={14} />
              </button>
              <button
                className="btn btn-sm flex items-center gap-1"
                onClick={exportPng}
                data-testid="export-png"
              >
                <Download size={14} /> PNG
              </button>
              </>
              )}
            </>
          )}
          <button
            className="btn btn-sm flex items-center gap-1"
            onClick={fetchTopology}
            disabled={loading}
            data-testid="refresh-button"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden" ref={containerRef}>
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner message="Loading AD topology..." />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<AlertCircle size={40} />}
              title="Topology Load Failed"
              description={error}
            />
          </div>
        ) : !data || data.sites.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<Server size={40} />}
              title="No Topology Data"
              description="No AD sites were found in the configuration."
            />
          </div>
        ) : data.sites.length === 1 && data.replicationLinks.length === 0 ? (
          <SimpleTopologyView data={data} />
        ) : (
          <canvas
            ref={canvasRef}
            className="h-full w-full cursor-grab active:cursor-grabbing"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            data-testid="topology-canvas"
          />
        )}
      </div>
    </div>
  );
}
