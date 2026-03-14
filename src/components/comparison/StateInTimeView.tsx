import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { History, ArrowRight, AlertTriangle, Clock, Server, Hash } from "lucide-react";
import {
  type ReplicationMetadataResult,
  type AttributeMetadata,
  type AttributeChangeDiff,
} from "@/types/replication";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";

interface StateInTimeViewProps {
  objectDn: string;
  objectType: "user" | "computer" | "group";
}

export function StateInTimeView({ objectDn, objectType }: StateInTimeViewProps) {
  const [metadata, setMetadata] = useState<ReplicationMetadataResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFrom, setSelectedFrom] = useState<string>("");
  const [selectedTo, setSelectedTo] = useState<string>("");
  const [diff, setDiff] = useState<AttributeChangeDiff[] | null>(null);

  const loadMetadata = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setDiff(null);

    try {
      const result = await invoke<ReplicationMetadataResult>(
        "get_replication_metadata",
        { objectDn },
      );
      setMetadata(result);
    } catch (e) {
      setError(`Failed to load metadata: ${e}`);
    } finally {
      setIsLoading(false);
    }
  }, [objectDn]);

  const timestamps = useMemo(() => {
    if (!metadata?.attributes) return [];
    const ts = new Set(
      metadata.attributes.map((a) => a.lastOriginatingChangeTime).filter(Boolean),
    );
    return Array.from(ts).sort().reverse();
  }, [metadata]);

  const computeDiff = useCallback(async () => {
    if (!metadata?.attributes || !selectedFrom || !selectedTo) return;

    try {
      const result = await invoke<AttributeChangeDiff[]>(
        "compute_attribute_diff",
        {
          metadata: metadata.attributes,
          fromTime: selectedFrom,
          toTime: selectedTo,
        },
      );
      setDiff(result);
    } catch (e) {
      setError(`Failed to compute diff: ${e}`);
    }
  }, [metadata, selectedFrom, selectedTo]);

  return (
    <div className="space-y-3" data-testid="state-in-time-view">
      {/* Load button */}
      {!metadata && (
        <button
          className="btn btn-primary flex items-center gap-1.5 px-4 py-1.5"
          onClick={loadMetadata}
          disabled={isLoading}
          data-testid="load-metadata-button"
        >
          {isLoading ? <LoadingSpinner size="sm" /> : <History size={14} />}
          Load Replication History
        </button>
      )}

      {/* Error */}
      {error && (
        <div
          className="rounded-md border border-[var(--color-error)] bg-[var(--color-error-bg)] px-4 py-2 text-body text-[var(--color-error)]"
          data-testid="metadata-error"
        >
          {error}
        </div>
      )}

      {/* Not available */}
      {metadata && !metadata.isAvailable && (
        <div
          className="rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-bg)] px-4 py-2 text-body text-[var(--color-text-primary)]"
          data-testid="metadata-unavailable"
        >
          <AlertTriangle size={14} className="mr-1 inline text-[var(--color-warning)]" />
          {metadata.message ?? "Replication metadata is not available for this object."}
        </div>
      )}

      {/* Timeline */}
      {metadata?.isAvailable && (
        <>
          <div className="text-caption text-[var(--color-text-secondary)]">
            {metadata.attributes.length} attribute(s) with replication metadata
          </div>

          {/* Attribute timeline table */}
          <div
            className="max-h-[400px] overflow-y-auto rounded-lg border border-[var(--color-border-default)]"
            data-testid="metadata-timeline"
          >
            <table className="w-full text-body">
              <thead className="sticky top-0">
                <tr className="border-b border-[var(--color-border-default)] bg-[var(--color-surface-card)]">
                  <th className="px-3 py-2 text-left text-caption font-medium text-[var(--color-text-secondary)]">
                    Attribute
                  </th>
                  <th className="px-3 py-2 text-left text-caption font-medium text-[var(--color-text-secondary)]">
                    <Clock size={12} className="mr-1 inline" />
                    Last Changed
                  </th>
                  <th className="px-3 py-2 text-center text-caption font-medium text-[var(--color-text-secondary)]">
                    <Hash size={12} className="mr-1 inline" />
                    Version
                  </th>
                  <th className="px-3 py-2 text-left text-caption font-medium text-[var(--color-text-secondary)]">
                    <Server size={12} className="mr-1 inline" />
                    Originating DC
                  </th>
                </tr>
              </thead>
              <tbody>
                {metadata.attributes.map((attr, idx) => (
                  <tr
                    key={attr.attributeName}
                    className={`border-b border-[var(--color-border-subtle)] last:border-b-0 ${
                      idx % 2 === 0 ? "" : "bg-[var(--color-surface-bg)]"
                    }`}
                    data-testid={`metadata-row-${attr.attributeName}`}
                  >
                    <td className="px-3 py-1.5 font-medium text-[var(--color-text-primary)]">
                      {attr.attributeName}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--color-text-primary)]">
                      {attr.lastOriginatingChangeTime || "Unknown"}
                    </td>
                    <td className="px-3 py-1.5 text-center text-[var(--color-text-secondary)]">
                      {attr.version}
                    </td>
                    <td className="px-3 py-1.5 text-caption text-[var(--color-text-secondary)] truncate max-w-[200px]">
                      {attr.lastOriginatingDsaDn || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Diff controls */}
          {timestamps.length >= 2 && (
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3">
              <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
                Compare Time Ranges
              </h3>
              <div className="flex items-center gap-2">
                <select
                  className="flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] px-3 py-1.5 text-body text-[var(--color-text-primary)]"
                  value={selectedFrom}
                  onChange={(e) => setSelectedFrom(e.target.value)}
                  data-testid="diff-from-select"
                >
                  <option value="">From...</option>
                  {timestamps.map((ts) => (
                    <option key={ts} value={ts}>
                      {ts}
                    </option>
                  ))}
                </select>
                <ArrowRight size={16} className="text-[var(--color-text-secondary)]" />
                <select
                  className="flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] px-3 py-1.5 text-body text-[var(--color-text-primary)]"
                  value={selectedTo}
                  onChange={(e) => setSelectedTo(e.target.value)}
                  data-testid="diff-to-select"
                >
                  <option value="">To...</option>
                  {timestamps.map((ts) => (
                    <option key={ts} value={ts}>
                      {ts}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-primary px-4 py-1.5"
                  onClick={computeDiff}
                  disabled={!selectedFrom || !selectedTo}
                  data-testid="compute-diff-button"
                >
                  Compare
                </button>
              </div>

              {/* Diff results */}
              {diff !== null && (
                <div className="mt-3" data-testid="diff-results">
                  {diff.length === 0 ? (
                    <div className="text-caption text-[var(--color-text-secondary)]">
                      No attribute changes detected in this time range.
                    </div>
                  ) : (
                    <div className="rounded-md border border-[var(--color-border-default)] overflow-hidden">
                      <table className="w-full text-body">
                        <thead>
                          <tr className="bg-[var(--color-surface-bg)] border-b border-[var(--color-border-default)]">
                            <th className="px-3 py-1.5 text-left text-caption font-medium text-[var(--color-text-secondary)]">
                              Attribute
                            </th>
                            <th className="px-3 py-1.5 text-center text-caption font-medium text-[var(--color-text-secondary)]">
                              Version Before
                            </th>
                            <th className="px-3 py-1.5 text-center text-caption font-medium text-[var(--color-text-secondary)]">
                              Version After
                            </th>
                            <th className="px-3 py-1.5 text-left text-caption font-medium text-[var(--color-text-secondary)]">
                              Changed At
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {diff.map((d) => (
                            <tr
                              key={d.attributeName}
                              className="border-b border-[var(--color-border-subtle)] last:border-b-0 bg-[var(--color-diff-added-bg)]"
                              data-testid={`diff-row-${d.attributeName}`}
                            >
                              <td className="px-3 py-1.5 font-medium text-[var(--color-text-primary)]">
                                {d.attributeName}
                              </td>
                              <td className="px-3 py-1.5 text-center text-[var(--color-text-secondary)]">
                                {d.versionBefore}
                              </td>
                              <td className="px-3 py-1.5 text-center font-medium text-[var(--color-success)]">
                                {d.versionAfter}
                              </td>
                              <td className="px-3 py-1.5 text-[var(--color-text-primary)]">
                                {d.changeTime}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
