import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import {
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  TrendingUp,
  Info,
  Download,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  type RiskScoreResult,
  type RiskScoreHistory,
  type RiskZone,
  type RiskFactor,
  type RiskFinding,
  type AlertSeverity,
} from "@/types/security";
import { extractErrorMessage } from "@/utils/errorMapping";

function zoneColor(zone: RiskZone): string {
  switch (zone) {
    case "Green":
      return "var(--color-success)";
    case "Orange":
      return "var(--color-warning)";
    case "Red":
      return "var(--color-error)";
  }
}

function zoneLabel(zone: RiskZone): string {
  switch (zone) {
    case "Green":
      return "Good";
    case "Orange":
      return "Fair";
    case "Red":
      return "Poor";
  }
}

function severityColor(severity: AlertSeverity): string {
  switch (severity) {
    case "Critical":
      return "var(--color-error)";
    case "High":
      return "var(--color-warning)";
    case "Medium":
      return "var(--color-caution, var(--color-warning))";
    case "Info":
      return "var(--color-info, var(--color-text-secondary))";
  }
}

function complexityColor(complexity: "Easy" | "Medium" | "Hard"): string {
  switch (complexity) {
    case "Easy":
      return "var(--color-success)";
    case "Medium":
      return "var(--color-warning)";
    case "Hard":
      return "var(--color-error)";
  }
}

function ZoneIcon({ zone, size = 16 }: { zone: RiskZone; size?: number }) {
  switch (zone) {
    case "Green":
      return <ShieldCheck size={size} style={{ color: zoneColor(zone) }} />;
    case "Orange":
      return <AlertTriangle size={size} style={{ color: zoneColor(zone) }} />;
    case "Red":
      return <AlertCircle size={size} style={{ color: zoneColor(zone) }} />;
  }
}

/** Semi-circle gauge SVG showing score 0-100 with color zones. */
function ScoreGauge({ score, zone }: { score: number; zone: RiskZone }) {
  const size = 200;
  const strokeWidth = 16;
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // Zone arc boundaries (fraction of semi-circle)
  const zones: { start: number; end: number; color: string }[] = [
    { start: 0, end: 0.4, color: "var(--color-error)" },
    { start: 0.4, end: 0.7, color: "var(--color-warning)" },
    { start: 0.7, end: 1, color: "var(--color-success)" },
  ];

  // Convert fraction (0-1) to a point on the semi-circle arc.
  // frac=0 (score 0) maps to the LEFT (angle PI = 180 degrees).
  // frac=1 (score 100) maps to the RIGHT (angle 0 degrees).
  function fractionToPoint(frac: number): { x: number; y: number } {
    const angle = Math.PI * (1 - frac);
    return {
      x: cx + radius * Math.cos(angle),
      y: cy - radius * Math.sin(angle),
    };
  }

  // Generate arc path for a fraction range.
  // SVG arc sweep-flag=1 draws clockwise (left to right on upper half).
  function arcPath(startFrac: number, endFrac: number): string {
    const start = fractionToPoint(startFrac);
    const end = fractionToPoint(endFrac);
    const largeArc = endFrac - startFrac > 0.5 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  }

  // Needle position
  const needleFrac = Math.max(0, Math.min(1, score / 100));
  const needlePoint = fractionToPoint(needleFrac);

  return (
    <div className="flex flex-col items-center" data-testid="risk-gauge">
      <svg
        width={size}
        height={size / 2 + 20}
        viewBox={`0 0 ${size} ${size / 2 + 20}`}
        data-testid="gauge-svg"
      >
        {/* Background zone arcs */}
        {zones.map((z, i) => (
          <path
            key={i}
            d={arcPath(z.start, z.end)}
            fill="none"
            stroke={z.color}
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
            opacity={0.25}
          />
        ))}

        {/* Active arc up to score */}
        {zones.map((z, i) => {
          const clampedStart = Math.max(z.start, 0);
          const clampedEnd = Math.min(z.end, needleFrac);
          if (clampedEnd <= clampedStart) return null;
          return (
            <path
              key={`active-${i}`}
              d={arcPath(clampedStart, clampedEnd)}
              fill="none"
              stroke={z.color}
              strokeWidth={strokeWidth}
              strokeLinecap="butt"
            />
          );
        })}

        {/* Needle line */}
        <line
          x1={cx}
          y1={cy}
          x2={needlePoint.x}
          y2={needlePoint.y}
          stroke="var(--color-text-primary)"
          strokeWidth={2}
          strokeLinecap="round"
        />

        {/* Center dot */}
        <circle cx={cx} cy={cy} r={4} fill="var(--color-text-primary)" />
      </svg>

      {/* Score number */}
      <div className="flex flex-col items-center -mt-4">
        <span
          className="text-[2.5rem] font-bold leading-none"
          style={{ color: zoneColor(zone) }}
          data-testid="risk-score-value"
        >
          {Math.round(score)}
        </span>
        <span
          className="text-body font-semibold mt-1 flex items-center gap-1"
          style={{ color: zoneColor(zone) }}
          data-testid="risk-zone-label"
        >
          <ZoneIcon zone={zone} size={18} />
          {zoneLabel(zone)}
        </span>
      </div>
    </div>
  );
}

/** Radar/spider chart SVG showing factor scores on a web diagram. */
function RadarChart({ factors }: { factors: RiskFactor[] }) {
  const size = 380;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 90;
  const labelOffset = 24;
  const n = factors.length;

  if (n < 3) return null;

  // Compute vertex angle for index i (starting from top, going clockwise)
  function angleFor(i: number): number {
    return (2 * Math.PI * i) / n - Math.PI / 2;
  }

  // Point at given radius fraction for index i
  function pointAt(i: number, fraction: number): { x: number; y: number } {
    const angle = angleFor(i);
    return {
      x: cx + radius * fraction * Math.cos(angle),
      y: cy + radius * fraction * Math.sin(angle),
    };
  }

  // Build polygon points string for a given set of fractions (0-1)
  function polygonPoints(fractions: number[]): string {
    return fractions
      .map((f, i) => {
        const p = pointAt(i, f);
        return `${p.x},${p.y}`;
      })
      .join(" ");
  }

  // Reference circles at 33%, 66%, 100%
  const refLevels = [0.33, 0.66, 1];

  // Score fractions (0-1)
  const scoreFractions = factors.map((f) => Math.max(0, Math.min(1, f.score / 100)));

  // Abbreviate factor name (first 10 chars + ellipsis if longer)
  // Show up to two words for the radar label
  function abbreviate(name: string): string {
    const words = name.split(" ");
    if (name.length <= 18) return name;
    if (words.length >= 2) {
      const twoWords = words[0] + " " + words[1];
      if (twoWords.length <= 18) return twoWords;
    }
    return words[0];
  }

  return (
    <div className="flex flex-col items-center" data-testid="radar-chart">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Reference polygons (concentric) */}
        {refLevels.map((level) => (
          <polygon
            key={level}
            points={polygonPoints(Array(n).fill(level))}
            fill="none"
            stroke="var(--color-text-secondary)"
            strokeWidth={0.5}
            strokeDasharray="none"
            opacity={0.6}
          />
        ))}

        {/* Axis lines from center to each vertex */}
        {factors.map((_, i) => {
          const p = pointAt(i, 1);
          return (
            <line
              key={`axis-${i}`}
              x1={cx}
              y1={cy}
              x2={p.x}
              y2={p.y}
              stroke="var(--color-text-secondary)"
              strokeWidth={0.5}
              opacity={0.5}
            />
          );
        })}

        {/* Score polygon - filled */}
        <polygon
          points={polygonPoints(scoreFractions)}
          fill="var(--color-primary)"
          fillOpacity={0.2}
          stroke="var(--color-primary)"
          strokeWidth={2}
          data-testid="radar-score-polygon"
        />

        {/* Score dots at each vertex */}
        {scoreFractions.map((f, i) => {
          const p = pointAt(i, f);
          return (
            <circle
              key={`dot-${i}`}
              cx={p.x}
              cy={p.y}
              r={3}
              fill="var(--color-primary)"
            />
          );
        })}

        {/* Axis labels */}
        {factors.map((f, i) => {
          const angle = angleFor(i);
          const lx = cx + (radius + labelOffset) * Math.cos(angle);
          const ly = cy + (radius + labelOffset) * Math.sin(angle);
          let textAnchor: "start" | "middle" | "end" = "middle";
          if (Math.cos(angle) > 0.3) textAnchor = "start";
          else if (Math.cos(angle) < -0.3) textAnchor = "end";

          return (
            <text
              key={`label-${i}`}
              x={lx}
              y={ly}
              textAnchor={textAnchor}
              dominantBaseline="central"
              fontSize={10}
              fill="var(--color-text-secondary)"
              data-testid="radar-label"
            >
              {abbreviate(f.name)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

/** Score bar showing a factor's score as a horizontal bar. */
function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 71
      ? "var(--color-success)"
      : score >= 41
        ? "var(--color-warning)"
        : "var(--color-error)";

  return (
    <div
      className="h-2 w-full rounded-full"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)` }}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${score}%`, backgroundColor: color }}
        data-testid="score-bar-fill"
      />
    </div>
  );
}

/** Single finding row inside a FactorCard. */
function FindingRow({ finding }: { finding: RiskFinding }) {
  return (
    <div
      className="flex flex-col gap-1 py-1.5 border-b border-[var(--color-border-default)] last:border-b-0"
      data-testid={`finding-${finding.id}`}
    >
      <div className="flex items-center gap-2">
        {/* Severity badge */}
        <span
          className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            color: severityColor(finding.severity),
            backgroundColor: `color-mix(in srgb, ${severityColor(finding.severity)} 12%, transparent)`,
          }}
        >
          {finding.severity}
        </span>
        <span className="text-[11px] text-[var(--color-text-primary)] flex-1">
          {finding.description}
        </span>
        {/* Complexity badge */}
        <span
          className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            color: complexityColor(finding.complexity),
            backgroundColor: `color-mix(in srgb, ${complexityColor(finding.complexity)} 12%, transparent)`,
          }}
          data-testid="finding-complexity"
        >
          {finding.complexity}
        </span>
      </div>
      <div className="text-[10px] text-[var(--color-text-secondary)] pl-1">
        {finding.remediation}
      </div>
      {finding.frameworkRef && (
        <div className="text-[10px] text-[var(--color-text-secondary)] pl-1 italic">
          Ref: {finding.frameworkRef}
        </div>
      )}
    </div>
  );
}

/** Factor breakdown card. */
function FactorCard({ factor }: { factor: RiskFactor }) {
  const [findingsOpen, setFindingsOpen] = useState(false);
  const showRecommendations = factor.score < 70 && factor.recommendations.length > 0;
  const findings = factor.findings ?? [];
  const impactIfFixed = factor.impactIfFixed ?? 0;

  return (
    <div
      className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
      data-testid={`factor-card-${factor.id}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-caption font-semibold text-[var(--color-text-primary)]">
          {factor.name}
        </span>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
          <span>Score: {Math.round(factor.score)}</span>
          <span>Weight: {factor.weight}%</span>
        </div>
      </div>

      <ScoreBar score={factor.score} />

      <p className="mt-1.5 text-[11px] text-[var(--color-text-secondary)]">
        {factor.explanation}
      </p>

      {showRecommendations && (
        <div className="mt-2 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-2">
          <div className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-warning)] mb-1">
            <Info size={10} />
            Recommendations
          </div>
          <ul className="list-disc list-inside text-[11px] text-[var(--color-text-secondary)] space-y-0.5">
            {factor.recommendations.map((rec, i) => (
              <li key={i}>{rec}</li>
            ))}
          </ul>
        </div>
      )}

      {findings.length > 0 && (
        <div className="mt-2 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-2">
          <button
            className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-text-primary)] w-full text-left"
            onClick={() => setFindingsOpen(!findingsOpen)}
            data-testid={`findings-toggle-${factor.id}`}
          >
            {findingsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Findings ({findings.length})
          </button>

          {findingsOpen && (
            <div className="mt-1.5" data-testid={`findings-list-${factor.id}`}>
              {findings.map((finding) => (
                <FindingRow key={finding.id} finding={finding} />
              ))}
            </div>
          )}

          {impactIfFixed > 0 && (
            <div
              className="mt-1.5 text-[11px] font-medium"
              style={{ color: "var(--color-success)" }}
              data-testid={`impact-if-fixed-${factor.id}`}
            >
              Potential gain: +{Math.round(impactIfFixed)} points
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Sparkline using div bars for 30-day history. */
function TrendSparkline({ history }: { history: RiskScoreHistory[] }) {
  const maxScore = 100;
  const barHeight = 64;
  const totalDays = 30;

  // Build a 30-day grid: map history entries by date, fill gaps with null
  const historyMap = new Map(history.map((h) => [h.date, h.totalScore]));
  const today = new Date();
  const days: { date: string; score: number | null }[] = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    days.push({ date: dateStr, score: historyMap.get(dateStr) ?? null });
  }

  return (
    <div data-testid="trend-sparkline">
      <div className="flex items-center gap-1 mb-2">
        <TrendingUp size={14} className="text-[var(--color-text-secondary)]" />
        <span className="text-caption font-semibold text-[var(--color-text-primary)]">
          30-Day Trend
        </span>
      </div>
      <div className="flex items-end gap-px" style={{ height: barHeight }}>
        {days.map((day, i) => {
          if (day.score == null) {
            return (
              <div
                key={i}
                className="flex-1 rounded-t-sm"
                style={{ height: 2, backgroundColor: "var(--color-border-default)", minWidth: 4 }}
                title={`${day.date}: no data`}
                data-testid="trend-bar"
              />
            );
          }
          const height = Math.max(14, (day.score / maxScore) * barHeight);
          const color =
            day.score >= 71
              ? "var(--color-success)"
              : day.score >= 41
                ? "var(--color-warning)"
                : "var(--color-error)";
          return (
            <div
              key={i}
              className="flex-1 rounded-t-sm transition-all flex items-end justify-center"
              style={{ height, backgroundColor: color, minWidth: 4 }}
              title={`${day.date}: ${Math.round(day.score)}`}
              data-testid="trend-bar"
            >
              <span className="text-[8px] font-medium leading-none pb-0.5" style={{ color: "white" }}>
                {Math.round(day.score)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-[var(--color-text-secondary)]">
        <span>{days[0]?.date}</span>
        <span>{days[days.length - 1]?.date}</span>
      </div>
    </div>
  );
}

/** Generate a self-contained HTML report document. */
function generateReportHtml(result: RiskScoreResult): string {
  const severityHtmlColor: Record<string, string> = {
    Critical: "#ef4444",
    High: "#f59e0b",
    Medium: "#3b82f6",
    Info: "#6b7280",
  };

  const zoneHtmlColor: Record<string, string> = {
    Green: "#22c55e",
    Orange: "#f59e0b",
    Red: "#ef4444",
  };

  // Collect all findings grouped by severity
  const allFindings: { factor: string; finding: RiskFinding }[] = [];
  for (const factor of result.factors) {
    for (const finding of factor.findings ?? []) {
      allFindings.push({ factor: factor.name, finding });
    }
  }

  const severityOrder = ["Critical", "High", "Medium", "Info"];
  allFindings.sort(
    (a, b) =>
      severityOrder.indexOf(a.finding.severity) - severityOrder.indexOf(b.finding.severity),
  );

  // Collect all recommendations sorted by impact (show impact only on first rec per factor)
  const allRecommendations: { factor: string; rec: string; impact: number }[] = [];
  for (const factor of result.factors) {
    const impact = factor.impactIfFixed ?? 0;
    let first = true;
    for (const rec of factor.recommendations) {
      allRecommendations.push({ factor: factor.name, rec, impact: first ? impact : 0 });
      first = false;
    }
  }
  allRecommendations.sort((a, b) => b.impact - a.impact);

  const factorRowsHtml = result.factors
    .map(
      (f) => `
      <tr>
        <td>${f.name}</td>
        <td style="text-align:center">${Math.round(f.score)}/100</td>
        <td style="text-align:center">${f.weight}%</td>
        <td>${f.explanation}</td>
      </tr>`,
    )
    .join("");

  const findingsHtml =
    allFindings.length > 0
      ? `
    <h2>Findings</h2>
    <table>
      <thead>
        <tr><th>Severity</th><th>Factor</th><th>Description</th><th>Remediation</th><th>Complexity</th><th>Ref</th></tr>
      </thead>
      <tbody>
        ${allFindings
          .map(
            ({ factor, finding }) => `
          <tr>
            <td><span style="color:${severityHtmlColor[finding.severity] ?? "#6b7280"};font-weight:600">${finding.severity}</span></td>
            <td>${factor}</td>
            <td>${finding.description}</td>
            <td>${finding.remediation}</td>
            <td>${finding.complexity}</td>
            <td>${finding.frameworkRef ?? "-"}</td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>`
      : "";

  const recommendationsHtml =
    allRecommendations.length > 0
      ? `
    <h2>Recommendations</h2>
    <table>
      <thead>
        <tr><th>Factor</th><th>Recommendation</th><th>Impact</th></tr>
      </thead>
      <tbody>
        ${allRecommendations
          .map(
            (r) => `
          <tr>
            <td>${r.factor}</td>
            <td>${r.rec}</td>
            <td>${r.impact > 0 ? `+${Math.round(r.impact)} pts` : "-"}</td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>DSPanel - Domain Risk Score Report</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 2rem; color: #1f2937; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    h2 { font-size: 1.15rem; margin-top: 2rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.25rem; }
    .meta { color: #6b7280; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .score-badge { display: inline-block; font-size: 2rem; font-weight: 700; padding: 0.25rem 1rem; border-radius: 0.5rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.85rem; }
    th, td { border: 1px solid #d1d5db; padding: 0.4rem 0.6rem; text-align: left; }
    th { background: #f3f4f6; font-weight: 600; }
    tr:nth-child(even) { background: #f9fafb; }
  </style>
</head>
<body>
  <h1>DSPanel - Domain Risk Score Report</h1>
  <div class="meta">
    Generated: ${new Date().toLocaleString()} | Computed: ${new Date(result.computedAt).toLocaleString()}
  </div>
  <div>
    <span class="score-badge" style="color:${zoneHtmlColor[result.zone] ?? "#6b7280"};background:${zoneHtmlColor[result.zone] ?? "#6b7280"}15">
      ${Math.round(result.totalScore)}/100 - ${result.zone === "Green" ? "Good" : result.zone === "Orange" ? "Fair" : "Poor"}
    </span>
  </div>

  <h2>Factor Breakdown</h2>
  <table>
    <thead>
      <tr><th>Factor</th><th>Score</th><th>Weight</th><th>Explanation</th></tr>
    </thead>
    <tbody>
      ${factorRowsHtml}
    </tbody>
  </table>

  ${findingsHtml}
  ${recommendationsHtml}
</body>
</html>`;
}

async function exportReport(result: RiskScoreResult) {
  const html = generateReportHtml(result);
  await invoke("save_file_dialog", {
    content: html,
    defaultName: "risk-score-report.html",
    filterName: "HTML files",
    filterExtensions: ["html"],
  });
}

export function RiskScoreDashboard() {
  const [result, setResult] = useState<RiskScoreResult | null>(null);
  const [history, setHistory] = useState<RiskScoreHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const [scoreResult, historyResult] = await Promise.all([
        invoke<RiskScoreResult>("get_risk_score"),
        invoke<RiskScoreHistory[]>("get_risk_score_history", { days: 30 }),
      ]);
      setResult(scoreResult);
      setHistory(historyResult);
    } catch (e: unknown) {
      setError(extractErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="flex h-full flex-col" data-testid="risk-score-dashboard">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-2">
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          Domain Risk Score
        </h2>
        <div className="flex items-center gap-3">
          {result && (
            <span
              className="flex items-center gap-1 text-caption font-medium"
              style={{ color: zoneColor(result.zone) }}
              data-testid="toolbar-zone"
            >
              <ZoneIcon zone={result.zone} size={14} />
              {Math.round(result.totalScore)}/100 - {zoneLabel(result.zone)}
            </span>
          )}
          {result && (
            <button
              className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-1"
              onClick={() => exportReport(result)}
              data-testid="export-button"
            >
              <Download size={12} />
              Export Report
            </button>
          )}
          <button
            className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-1"
            onClick={fetchData}
            disabled={loading}
            data-testid="refresh-button"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && !result && (
          <div className="flex items-center justify-center py-16">
            <LoadingSpinner message="Computing risk score..." />
          </div>
        )}

        {error && !result && (
          <EmptyState
            icon={<AlertCircle size={32} />}
            title="Risk Score Unavailable"
            description={error}
            action={{ label: "Retry", onClick: fetchData }}
          />
        )}

        {!loading && !error && !result && (
          <EmptyState
            icon={<ShieldCheck size={32} />}
            title="No Risk Data"
            description="No risk score data is available. Try refreshing."
            action={{ label: "Refresh", onClick: fetchData }}
          />
        )}

        {result && (
          <div className="space-y-6">
            {/* Top section: Gauge + Radar */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Gauge */}
              <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-6">
                <ScoreGauge score={result.totalScore} zone={result.zone} />
                {result.worstFactorScore < 70 && (
                  <div
                    className="mt-3 flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium"
                    style={{
                      color: result.worstFactorScore <= 40 ? "var(--color-error)" : "var(--color-warning)",
                      backgroundColor: result.worstFactorScore <= 40 ? "var(--color-error-bg)" : "var(--color-warning-bg)",
                    }}
                    data-testid="worst-factor-badge"
                  >
                    <AlertTriangle size={12} />
                    Weakest: {result.worstFactorName} ({Math.round(result.worstFactorScore)}/100)
                  </div>
                )}
                <span className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
                  Computed at {new Date(result.computedAt).toLocaleString()}
                </span>
              </div>

              {/* Radar Chart */}
              <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
                {result.factors.length >= 3 ? (
                  <RadarChart factors={result.factors} />
                ) : (
                  <div className="flex items-center justify-center h-full text-caption text-[var(--color-text-secondary)]">
                    Not enough factors for radar chart
                  </div>
                )}
              </div>
            </div>

            {/* Trend - full width */}
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
              <TrendSparkline history={history} />
            </div>

            {/* Factor breakdown */}
            <div>
              <h3 className="text-caption font-semibold text-[var(--color-text-primary)] mb-3">
                Factor Breakdown
              </h3>
              <div
                className="grid grid-cols-1 md:grid-cols-2 gap-3"
                data-testid="factor-breakdown"
              >
                {result.factors.map((factor) => (
                  <FactorCard key={factor.id} factor={factor} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
