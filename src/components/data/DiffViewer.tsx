import { useState } from "react";

export interface DiffLine {
  type: "unchanged" | "added" | "removed";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

type DiffMode = "side-by-side" | "inline";

interface DiffViewerProps {
  lines: DiffLine[];
  defaultMode?: DiffMode;
}

const LINE_STYLES: Record<DiffLine["type"], string> = {
  unchanged: "text-[var(--color-text-primary)]",
  added: "bg-[var(--color-diff-added-bg)] text-[var(--color-diff-added-text)]",
  removed:
    "bg-[var(--color-diff-removed-bg)] text-[var(--color-diff-removed-text)]",
};

const LINE_PREFIX: Record<DiffLine["type"], string> = {
  unchanged: " ",
  added: "+",
  removed: "-",
};

export function DiffViewer({ lines, defaultMode = "inline" }: DiffViewerProps) {
  const [mode, setMode] = useState<DiffMode>(defaultMode);

  if (lines.length === 0) {
    return (
      <div
        className="py-4 text-center text-caption text-[var(--color-text-secondary)]"
        data-testid="diff-viewer-empty"
      >
        No differences
      </div>
    );
  }

  return (
    <div data-testid="diff-viewer">
      <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b border-[var(--color-border-default)] bg-[var(--color-surface-card)]">
        <button
          className={`rounded px-2 py-0.5 text-caption transition-colors ${
            mode === "inline"
              ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          }`}
          onClick={() => setMode("inline")}
          data-testid="diff-mode-inline"
        >
          Inline
        </button>
        <button
          className={`rounded px-2 py-0.5 text-caption transition-colors ${
            mode === "side-by-side"
              ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          }`}
          onClick={() => setMode("side-by-side")}
          data-testid="diff-mode-side-by-side"
        >
          Side by Side
        </button>
      </div>

      {mode === "inline" ? (
        <InlineDiff lines={lines} />
      ) : (
        <SideBySideDiff lines={lines} />
      )}
    </div>
  );
}

function InlineDiff({ lines }: { lines: DiffLine[] }) {
  return (
    <div
      className="overflow-auto font-mono text-caption"
      data-testid="diff-inline"
    >
      {lines.map((line, i) => (
        <div
          key={i}
          className={`flex ${LINE_STYLES[line.type]}`}
          data-testid={`diff-line-${i}`}
          data-type={line.type}
        >
          <span className="w-10 shrink-0 text-right pr-2 text-[var(--color-text-secondary)] select-none opacity-60">
            {line.oldLineNumber ?? ""}
          </span>
          <span className="w-10 shrink-0 text-right pr-2 text-[var(--color-text-secondary)] select-none opacity-60">
            {line.newLineNumber ?? ""}
          </span>
          <span className="w-4 shrink-0 text-center select-none font-bold">
            {LINE_PREFIX[line.type]}
          </span>
          <span className="flex-1 whitespace-pre px-1">{line.content}</span>
        </div>
      ))}
    </div>
  );
}

function SideBySideDiff({ lines }: { lines: DiffLine[] }) {
  const oldLines = lines.filter((l) => l.type !== "added");
  const newLines = lines.filter((l) => l.type !== "removed");

  return (
    <div className="flex" data-testid="diff-side-by-side">
      <div className="flex-1 overflow-auto font-mono text-caption border-r border-[var(--color-border-default)]">
        {oldLines.map((line, i) => (
          <div
            key={i}
            className={`flex ${line.type === "removed" ? LINE_STYLES.removed : ""}`}
          >
            <span className="w-10 shrink-0 text-right pr-2 text-[var(--color-text-secondary)] select-none opacity-60">
              {line.oldLineNumber ?? ""}
            </span>
            <span className="flex-1 whitespace-pre px-1">{line.content}</span>
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-auto font-mono text-caption">
        {newLines.map((line, i) => (
          <div
            key={i}
            className={`flex ${line.type === "added" ? LINE_STYLES.added : ""}`}
          >
            <span className="w-10 shrink-0 text-right pr-2 text-[var(--color-text-secondary)] select-none opacity-60">
              {line.newLineNumber ?? ""}
            </span>
            <span className="flex-1 whitespace-pre px-1">{line.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
