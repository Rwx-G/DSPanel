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
} from "lucide-react";
import {
  type RiskScoreResult,
  type RiskScoreHistory,
  type RiskZone,
  type RiskFactor,
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

  // Convert fraction (0-1) to a point on the semi-circle arc
  function fractionToPoint(frac: number): { x: number; y: number } {
    const angle = Math.PI * (1 - frac); // 180 to 0 degrees
    return {
      x: cx + radius * Math.cos(angle),
      y: cy - radius * Math.sin(angle),
    };
  }

  // Generate arc path for a fraction range
  function arcPath(startFrac: number, endFrac: number): string {
    const start = fractionToPoint(startFrac);
    const end = fractionToPoint(endFrac);
    const largeArc = endFrac - startFrac > 0.5 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
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
          {score}
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

/** Factor breakdown card. */
function FactorCard({ factor }: { factor: RiskFactor }) {
  const showRecommendations = factor.score < 70 && factor.recommendations.length > 0;

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
          <span>Score: {factor.score}</span>
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
    </div>
  );
}

/** Sparkline using div bars for 30-day history. */
function TrendSparkline({ history }: { history: RiskScoreHistory[] }) {
  if (history.length === 0) return null;

  const maxScore = 100;
  const barHeight = 48;

  return (
    <div data-testid="trend-sparkline">
      <div className="flex items-center gap-1 mb-2">
        <TrendingUp size={14} className="text-[var(--color-text-secondary)]" />
        <span className="text-caption font-semibold text-[var(--color-text-primary)]">
          30-Day Trend
        </span>
      </div>
      <div className="flex items-end gap-px" style={{ height: barHeight }}>
        {history.map((entry, i) => {
          const height = Math.max(2, (entry.totalScore / maxScore) * barHeight);
          const color =
            entry.totalScore >= 71
              ? "var(--color-success)"
              : entry.totalScore >= 41
                ? "var(--color-warning)"
                : "var(--color-error)";
          return (
            <div
              key={i}
              className="flex-1 rounded-t-sm transition-all"
              style={{ height, backgroundColor: color, minWidth: 4 }}
              title={`${entry.date}: ${entry.totalScore}`}
              data-testid="trend-bar"
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-[var(--color-text-secondary)]">
        <span>{history[0]?.date}</span>
        <span>{history[history.length - 1]?.date}</span>
      </div>
    </div>
  );
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
              {result.totalScore}/100 - {zoneLabel(result.zone)}
            </span>
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
            {/* Top section: Gauge + Trend */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Gauge */}
              <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-6">
                <ScoreGauge score={result.totalScore} zone={result.zone} />
                <span className="mt-3 text-[11px] text-[var(--color-text-secondary)]">
                  Computed at {new Date(result.computedAt).toLocaleString()}
                </span>
              </div>

              {/* Trend */}
              <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
                {history.length > 0 ? (
                  <TrendSparkline history={history} />
                ) : (
                  <div className="flex items-center justify-center h-full text-caption text-[var(--color-text-secondary)]">
                    No trend data available
                  </div>
                )}
              </div>
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
