import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, FileSpreadsheet, FileText, Globe, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface ExportColumn {
  key: string;
  header: string;
  widthHint?: number;
}

type ExportFormat = "csv" | "pdf" | "xlsx" | "html";

interface FormatOption {
  id: ExportFormat;
  label: string;
  icon: React.ReactNode;
  ext: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  { id: "csv", label: "CSV", icon: <FileText size={14} />, ext: "csv" },
  { id: "xlsx", label: "Excel", icon: <FileSpreadsheet size={14} />, ext: "xlsx" },
  { id: "pdf", label: "PDF", icon: <FileText size={14} />, ext: "pdf" },
  { id: "html", label: "HTML", icon: <Globe size={14} />, ext: "html" },
];

interface ExportToolbarProps<T> {
  /** Column definitions for the export. */
  columns: ExportColumn[];
  /** Raw data rows to export. */
  data: T[];
  /** Map each data row to an array of string values matching the columns order. */
  rowMapper: (row: T) => string[];
  /** Title for the exported file (used in PDF/HTML header). */
  title: string;
  /** Base filename without extension (date will be appended). */
  filenameBase: string;
  /** Override the default disabled logic (disabled when data is empty). */
  disabled?: boolean;
}

export function ExportToolbar<T>({
  columns,
  data,
  rowMapper,
  title,
  filenameBase,
  disabled,
}: ExportToolbarProps<T>) {
  const { t } = useTranslation(["components", "common"]);
  const [exporting, setExporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      setMenuOpen(false);
      setExporting(true);
      try {
        const rows = data.map(rowMapper);
        const date = new Date().toISOString().slice(0, 10);
        const ext = FORMAT_OPTIONS.find((f) => f.id === format)?.ext ?? format;
        const defaultName = `${filenameBase}_${date}.${ext}`;

        await invoke<string | null>("export_table", {
          columns: columns.map((c) => ({
            header: c.header,
            key: c.key,
            widthHint: c.widthHint ?? null,
          })),
          rows,
          format,
          title,
          defaultName,
          csvOptions: format === "csv" ? { delimiter: "comma", includeHeaders: true } : null,
        });
      } catch (err) {
        console.error("Export failed:", err);
      } finally {
        setExporting(false);
      }
    },
    [columns, data, rowMapper, title, filenameBase],
  );

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div className="relative inline-flex" ref={menuRef} data-testid="export-toolbar">
      <button
        className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-1"
        onClick={() => setMenuOpen((prev) => !prev)}
        disabled={exporting || (disabled ?? data.length === 0)}
        data-testid="export-button"
      >
        <Download size={14} />
        {exporting ? t("components:exportToolbar.exporting") : t("components:exportToolbar.export")}
        <ChevronDown size={12} />
      </button>

      {menuOpen && (
        <div
          className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] py-1 shadow-lg"
          data-testid="export-menu"
        >
          {FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-caption text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
              onClick={() => handleExport(opt.id)}
              data-testid={`export-${opt.id}`}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
