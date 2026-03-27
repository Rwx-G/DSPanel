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
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { ExportToolbar } from "@/components/common/ExportToolbar";
import {
  type RiskScoreResult,
  type RiskScoreHistory,
  type RiskZone,
  type RiskFactor,
  type RiskFinding,
  type AlertSeverity,
} from "@/types/security";
import { extractErrorMessage } from "@/utils/errorMapping";
import { SecurityDisclaimer } from "@/components/common/SecurityDisclaimer";
import { useTranslation } from "react-i18next";

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

function zoneLabel(zone: RiskZone, t: (key: string) => string): string {
  switch (zone) {
    case "Green":
      return t("zoneGood");
    case "Orange":
      return t("zoneFair");
    case "Red":
      return t("zonePoor");
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

/** Translate risk score explanations and recommendations from backend English text. */
function useTranslateRiskText() {
  const { t } = useTranslation("riskScore");
  return {
    explanation: (msg: string): string => {
      const patterns: [RegExp, string, (m: RegExpMatchArray) => Record<string, string>][] = [
        [/^(\d+)\/(\d+) privileged accounts have security alerts$/, "explanations.privAlerts", (m) => ({ count: m[1], total: m[2] })],
        [/^All privileged accounts pass security checks$/, "explanations.privOk", () => ({})],
        [/^No privileged accounts found to assess$/, "explanations.privNone", () => ({})],
        [/^Could not assess privileged accounts$/, "explanations.privError", () => ({})],
        [/^Password policy meets all recommended thresholds$/, "explanations.passwordOk", () => ({})],
        [/^Issues found: (.+)$/, "explanations.issuesFound", (m) => ({ issues: m[1] })],
        [/^Issues: (.+)$/, "explanations.issuesFound", (m) => ({ issues: m[1] })],
        [/^(\d+)\/(\d+) accounts are stale/, "explanations.staleAccounts", (m) => ({ count: m[1], total: m[2] })],
        [/^Account hygiene meets best practices$/, "explanations.staleOk", () => ({})],
        [/^Could not assess stale accounts$/, "explanations.staleError", () => ({})],
        [/^Kerberos configuration meets security best practices$/, "explanations.kerberosOk", () => ({})],
        [/^Infrastructure hardening meets security best practices$/, "explanations.infraOk", () => ({})],
        [/^No GPO security issues detected$/, "explanations.gpoOk", () => ({})],
        [/^No external trusts configured$/, "explanations.noExternalTrusts", () => ({})],
        [/^No AD CS security issues detected$/, "explanations.certOk", () => ({})],
        [/^Could not assess AD CS security$/, "explanations.certError", () => ({})],
        [/^AD CS not detected/, "explanations.certNone", () => ({})],
        [/^(\d+) GPO\(s\) found - audit SYSVOL/, "explanations.gpoAudit", (m) => ({ count: m[1] })],
        [/^AD CS issues: (.+)$/, "explanations.certIssues", (m) => ({ details: m[1] })],
      ];
      for (const [re, key, extract] of patterns) {
        const m = msg.match(re);
        if (m) return t(key, extract(m));
      }
      return msg;
    },
    recommendation: (msg: string): string => {
      const patterns: [RegExp, string, (m: RegExpMatchArray) => Record<string, string>][] = [
        [/^Review (\d+) high-severity alert/, "recommendations_tpl.reviewHighAlerts", (m) => ({ count: m[1] })],
        [/^Address (\d+) critical alert/, "recommendations_tpl.addressCriticalAlerts", (m) => ({ count: m[1] })],
        [/^Disable or remove (\d+) inactive admin/, "recommendations_tpl.disableInactiveAdmins", (m) => ({ count: m[1] })],
        [/^Reduce privileged accounts from (\d+)/, "recommendations_tpl.reducePrivAccounts", (m) => ({ count: m[1] })],
        [/^Increase minimum password length/, "recommendations_tpl.increaseMinPwdLength", () => ({})],
        [/^Enable account lockout/, "recommendations_tpl.enableLockout", () => ({})],
        [/^Review and disable\/remove (\d+) stale account/, "recommendations_tpl.reviewStaleAccounts", (m) => ({ count: m[1] })],
        [/^Review (\d+) stale machine account/, "recommendations_tpl.reviewStaleMachines", (m) => ({ count: m[1] })],
        [/^Add all privileged accounts to the Protected Users/, "recommendations_tpl.addProtectedUsers", () => ({})],
        [/^Configure msDS-SupportedEncryptionTypes/, "recommendations_tpl.configureAes", () => ({})],
        [/^Enable AES encryption on all service accounts/, "recommendations_tpl.enableAesSpn", () => ({})],
        [/^Deploy LAPS/, "recommendations_tpl.deployLaps", () => ({})],
        [/^Create PSOs/, "recommendations_tpl.createPsos", () => ({})],
        [/^Remove CT_FLAG_ENROLLEE_SUPPLIES_SUBJECT from: (.+)$/, "recommendations_tpl.removeCTFlag", (m) => ({ templates: m[1] })],
        [/^Remove Certificate Request Agent EKU.*from: (.+)$/, "recommendations_tpl.removeCertReqAgent", (m) => ({ templates: m[1] })],
        [/^Upgrade schema V1 templates to V2\+: (.+)$/, "recommendations_tpl.upgradeV1", (m) => ({ templates: m[1] })],
      ];
      for (const [re, key, extract] of patterns) {
        const m = msg.match(re);
        if (m) return t(key, extract(m));
      }
      return msg;
    },
  };
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
function ScoreGauge({ score, zone, t }: { score: number; zone: RiskZone; t: (key: string) => string }) {
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
          {zoneLabel(zone, t)}
        </span>
      </div>
    </div>
  );
}

/** Radar/spider chart SVG showing factor scores on a web diagram. */
function RadarChart({ factors }: { factors: RiskFactor[] }) {
  const { t } = useTranslation("riskScore");
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
              {t(`factorShort.${f.id}`, { defaultValue: f.name })}
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
  const { t } = useTranslation(["riskScore"]);
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
          {t(`severityLabels.${finding.severity}`, { defaultValue: finding.severity })}
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
          {t(`complexityLabels.${finding.complexity}`, { defaultValue: finding.complexity })}
        </span>
      </div>
      <div className="text-[10px] text-[var(--color-text-secondary)] pl-1">
        {finding.remediation}
      </div>
      {finding.frameworkRef && (
        <div className="text-[10px] text-[var(--color-text-secondary)] pl-1 italic">
          {t("ref")} {finding.frameworkRef}
        </div>
      )}
    </div>
  );
}

/** Factor breakdown card. */
function FactorCard({ factor }: { factor: RiskFactor }) {
  const { t } = useTranslation(["riskScore", "common"]);
  const riskText = useTranslateRiskText();
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
          {t(`factorNames.${factor.id}`, { defaultValue: factor.name })}
        </span>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
          <span>{t("score")} {Math.round(factor.score)}</span>
          <span>{t("weight")} {factor.weight}%</span>
        </div>
      </div>

      <ScoreBar score={factor.score} />

      <p className="mt-1.5 text-[11px] text-[var(--color-text-secondary)]">
        {riskText.explanation(factor.explanation)}
      </p>

      {showRecommendations && (
        <div className="mt-2 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] p-2">
          <div className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-warning)] mb-1">
            <Info size={10} />
            {t("recommendations")}
          </div>
          <ul className="list-disc list-inside text-[11px] text-[var(--color-text-secondary)] space-y-0.5">
            {factor.recommendations.map((rec, i) => (
              <li key={i}>{riskText.recommendation(rec)}</li>
            ))}
          </ul>
        </div>
      )}

      {findings.length > 0 && (
        <div className="mt-2 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] p-2">
          <button
            className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-text-primary)] w-full text-left"
            onClick={() => setFindingsOpen(!findingsOpen)}
            data-testid={`findings-toggle-${factor.id}`}
          >
            {findingsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t("findings", { count: findings.length })}
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
              {t("potentialGain", { points: Math.round(impactIfFixed) })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Sparkline using div bars for 30-day history. */
function TrendSparkline({ history }: { history: RiskScoreHistory[] }) {
  const { t } = useTranslation(["riskScore"]);
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
          {t("trend30Day")}
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
                title={`${day.date}: ${t("noDataShort")}`}
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

export function RiskScoreDashboard() {
  const { t } = useTranslation(["riskScore", "common"]);
  const [result, setResult] = useState<RiskScoreResult | null>(null);
  const [history, setHistory] = useState<RiskScoreHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      // Sequential: score first (stores today's entry), then history (reads it back)
      const scoreResult = await invoke<RiskScoreResult>("get_risk_score");
      setResult(scoreResult);
      const historyResult = await invoke<RiskScoreHistory[]>("get_risk_score_history", { days: 30 });
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
        <h2 className="flex items-center gap-1.5 text-body font-semibold text-[var(--color-text-primary)]">
          {t("pageTitle")}
          <SecurityDisclaimer
            coverage="~40%"
            checks={t("disclaimer.checks")}
            limitations={t("disclaimer.limitations")}
            tools={t("disclaimer.tools")}
          />
        </h2>
        <div className="flex items-center gap-3">
          {result && (
            <span
              className="flex items-center gap-1 text-caption font-medium"
              style={{ color: zoneColor(result.zone) }}
              data-testid="toolbar-zone"
            >
              <ZoneIcon zone={result.zone} size={14} />
              {Math.round(result.totalScore)}/100 - {zoneLabel(result.zone, t)}
            </span>
          )}
          <ExportToolbar<{ factor: string; finding: string; severity: string; points: string; remediation: string; complexity: string; ref: string }>
            columns={[
              { key: "factor", header: t("factor") },
              { key: "finding", header: t("finding") },
              { key: "severity", header: t("severity") },
              { key: "points", header: t("pointsDeducted") },
              { key: "remediation", header: t("remediation") },
              { key: "complexity", header: t("complexity") },
              { key: "ref", header: t("frameworkRef") },
            ]}
            data={result?.factors.flatMap((f) =>
              f.findings.map((fi) => ({
                factor: f.name,
                finding: fi.description,
                severity: fi.severity,
                points: String(Math.round(fi.pointsDeducted * 100) / 100),
                remediation: fi.remediation,
                complexity: fi.complexity,
                ref: fi.frameworkRef ?? "",
              })),
            ) ?? []}
            rowMapper={(r) => [r.factor, r.finding, r.severity, r.points, r.remediation, r.complexity, r.ref]}
            title={`${t("pageTitle")} - ${result ? Math.round(result.totalScore) : 0}/100`}
            filenameBase="risk-score"
          />
          <button
            className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-1"
            onClick={fetchData}
            disabled={loading}
            data-testid="refresh-button"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            {t("common:refresh")}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && !result && (
          <div className="flex items-center justify-center py-16">
            <LoadingSpinner message={t("computing")} />
          </div>
        )}

        {error && !result && (
          <EmptyState
            icon={<AlertCircle size={32} />}
            title={t("unavailable")}
            description={error}
            action={{ label: t("common:retry"), onClick: fetchData }}
          />
        )}

        {!loading && !error && !result && (
          <EmptyState
            icon={<ShieldCheck size={32} />}
            title={t("noData")}
            description={t("noDataDescription")}
            action={{ label: t("common:refresh"), onClick: fetchData }}
          />
        )}

        {result && (
          <div className="space-y-6">
            {/* Top section: Gauge + Radar */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Gauge */}
              <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-6">
                <ScoreGauge score={result.totalScore} zone={result.zone} t={t} />
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
                    {t("weakest")} {(() => {
                      const worstFactor = result.factors.find(f => f.name === result.worstFactorName);
                      return worstFactor ? t(`factorNames.${worstFactor.id}`, { defaultValue: result.worstFactorName }) : result.worstFactorName;
                    })()} ({Math.round(result.worstFactorScore)}/100)
                  </div>
                )}
                <span className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
                  {t("computedAt", { date: new Date(result.computedAt).toLocaleString() })}
                </span>
              </div>

              {/* Radar Chart */}
              <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
                {result.factors.length >= 3 ? (
                  <RadarChart factors={result.factors} />
                ) : (
                  <div className="flex items-center justify-center h-full text-caption text-[var(--color-text-secondary)]">
                    {t("notEnoughFactors")}
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
                {t("factorBreakdown")}
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
