import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { extractErrorMessage } from "@/utils/errorMapping";
import {
  FileText,
  Plus,
  Trash2,
  Play,
  AlertTriangle,
  CheckCircle,
  Shield,
} from "lucide-react";
import { ExportToolbar } from "@/components/common/ExportToolbar";

// ---------------------------------------------------------------------------
// Types (mirror Rust models)
// ---------------------------------------------------------------------------

type SectionType = "query" | "static";

interface TemplateSection {
  title: string;
  controlReference: string;
  type: SectionType;
  queryScope: string | null;
  queryAttributes: string[] | null;
  content: string | null;
}

interface ComplianceTemplate {
  name: string;
  standard: string;
  version: string;
  description: string;
  sections: TemplateSection[];
  builtin: boolean;
}

interface ReportSection {
  title: string;
  controlReference: string;
  sectionType: SectionType;
  headers: string[] | null;
  rows: string[][] | null;
  content: string | null;
  findingCount: number | null;
}

interface ComplianceReport {
  templateName: string;
  standard: string;
  version: string;
  generatedAt: string;
  generator: string;
  sections: ReportSection[];
}

// ---------------------------------------------------------------------------
// Standard colors
// ---------------------------------------------------------------------------

const STANDARD_COLORS: Record<string, string> = {
  GDPR: "#1565c0",
  HIPAA: "#2e7d32",
  SOX: "#e65100",
  "PCI-DSS": "#6a1b9a",
};

const QUERY_SCOPES = [
  { value: "privilegedAccounts", label: "Privileged Accounts" },
  { value: "inactiveAccounts", label: "Inactive Accounts (90d)" },
  { value: "disabledAccounts", label: "Disabled Accounts" },
  { value: "passwordNeverExpires", label: "Password Never Expires" },
];

// ---------------------------------------------------------------------------
// Template Card
// ---------------------------------------------------------------------------

function TemplateCard({
  template,
  onGenerate,
  onDelete,
  generating,
}: {
  template: ComplianceTemplate;
  onGenerate: () => void;
  onDelete?: () => void;
  generating: boolean;
}) {
  const color = STANDARD_COLORS[template.standard] ?? "#546e7a";
  return (
    <div
      className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4 flex flex-col gap-2"
      data-testid={`template-card-${template.standard}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
            style={{ backgroundColor: color }}
          >
            {template.standard}
          </span>
          <span className="text-caption font-medium text-[var(--color-text-primary)]">
            {template.name}
          </span>
        </div>
        {!template.builtin && onDelete && (
          <button
            className="btn btn-sm p-1 text-[var(--color-error)]"
            onClick={onDelete}
            data-testid={`delete-template-${template.name}`}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <p className="text-[11px] text-[var(--color-text-secondary)]">{template.description}</p>
      <div className="flex flex-wrap gap-1">
        {template.sections
          .filter((s) => s.type !== "static")
          .map((s) => (
            <span
              key={s.title}
              className="inline-flex items-center rounded bg-[var(--color-surface-hover)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]"
            >
              {s.controlReference}
            </span>
          ))}
      </div>
      <button
        className="btn btn-sm btn-primary flex items-center gap-1 self-end mt-1"
        onClick={onGenerate}
        disabled={generating}
        data-testid={`generate-${template.standard}`}
      >
        <Play size={12} />
        {generating ? "Generating..." : "Generate Report"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report Viewer
// ---------------------------------------------------------------------------

function ReportViewer({
  report,
}: {
  report: ComplianceReport;
}) {
  // Flatten all query sections into exportable rows
  const exportRows = report.sections
    .filter((s) => s.sectionType === "query" && s.headers && s.rows)
    .flatMap((s) =>
      (s.rows ?? []).map((row) => ({
        section: s.title,
        controlRef: s.controlReference,
        values: row,
        headers: s.headers ?? [],
      })),
    );

  // Build a unified column set: Section, Control Ref, then union of all headers
  const allHeaders = Array.from(
    new Set(report.sections.filter((s) => s.headers).flatMap((s) => s.headers ?? [])),
  );

  const color = STANDARD_COLORS[report.standard] ?? "#546e7a";
  return (
    <div className="space-y-4" data-testid="report-viewer">
      {/* Report header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
            {report.templateName}
          </h3>
          <div className="text-[11px] text-[var(--color-text-secondary)]">
            {report.standard} | Generated: {report.generatedAt} | By: {report.generator}
          </div>
        </div>
        <ExportToolbar<{ section: string; controlRef: string; values: string[]; headers: string[] }>
          columns={[
            { key: "section", header: "Section" },
            { key: "controlRef", header: "Control Reference" },
            ...allHeaders.map((h) => ({ key: h, header: h })),
          ]}
          data={exportRows}
          rowMapper={(r) => {
            const vals: string[] = [r.section, r.controlRef];
            for (const h of allHeaders) {
              const idx = r.headers.indexOf(h);
              vals.push(idx >= 0 ? (r.values[idx] ?? "-") : "-");
            }
            return vals;
          }}
          title={`${report.standard} Compliance Report - ${report.templateName}`}
          filenameBase={`${report.standard.toLowerCase()}-compliance-report`}
        />
      </div>

      {/* Sections */}
      {report.sections.map((section, i) => (
        <div
          key={`${section.title}-${i}`}
          className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
        >
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-caption font-semibold text-[var(--color-text-primary)]">
              {section.title}
            </h4>
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
              style={{ backgroundColor: color }}
            >
              {section.controlReference}
            </span>
            {section.findingCount != null && (
              <span className="text-[10px] text-[var(--color-text-secondary)]">
                {section.findingCount} items
              </span>
            )}
          </div>

          {section.sectionType === "query" && section.headers && section.rows && (
            <div className="overflow-x-auto">
              <table className="w-full text-caption">
                <thead>
                  <tr className="border-b border-[var(--color-border-default)] text-left text-[var(--color-text-secondary)]">
                    {section.headers.map((h) => (
                      <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.rows.slice(0, 50).map((row, ri) => (
                    <tr key={ri} className="border-t border-[var(--color-border-subtle)]">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-2 py-1 text-[var(--color-text-primary)]">
                          {cell || "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {section.rows.length > 50 && (
                    <tr>
                      <td
                        colSpan={section.headers.length}
                        className="px-2 py-1 text-center text-[var(--color-text-secondary)] italic"
                      >
                        ... and {section.rows.length - 50} more rows (see exported report)
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {section.sectionType === "static" && section.content && (
            <div className="whitespace-pre-line text-caption text-[var(--color-text-secondary)] bg-[var(--color-surface-default)] rounded p-2">
              {section.content}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ComplianceReports() {
  const [templates, setTemplates] = useState<ComplianceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const loadTemplates = useCallback(async () => {
    try {
      const result = await invoke<ComplianceTemplate[]>("get_compliance_templates");
      setTemplates(result);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleGenerate = async (template: ComplianceTemplate) => {
    setGenerating(template.standard);
    setError(null);
    setReport(null);
    try {
      const result = await invoke<ComplianceReport>("generate_compliance_report", { template });
      setReport(result);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setGenerating(null);
    }
  };


  const handleDeleteTemplate = async (name: string) => {
    try {
      await invoke("delete_custom_template", { name });
      await loadTemplates();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleSaveCustom = async (template: ComplianceTemplate) => {
    try {
      await invoke("save_custom_template", { template });
      await loadTemplates();
      setShowEditor(false);
    } catch (err) {
      console.error("Save failed:", err);
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="compliance-reports">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-2">
        <h2 className="flex items-center gap-1.5 text-body font-semibold text-[var(--color-text-primary)]">
          <Shield size={16} />
          Compliance Reports
        </h2>
        <button
          className="btn btn-sm btn-primary flex items-center gap-1"
          onClick={() => setShowEditor(true)}
          data-testid="create-custom-btn"
        >
          <Plus size={14} />
          Custom Template
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner size="md" />
          </div>
        )}

        {error && (
          <EmptyState
            icon={<AlertTriangle size={40} />}
            title="Error"
            description={error}
          />
        )}

        {/* Custom template editor */}
        {showEditor && (
          <CustomTemplateEditor
            onSave={handleSaveCustom}
            onCancel={() => setShowEditor(false)}
          />
        )}

        {/* Template cards */}
        {!loading && templates.length > 0 && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="template-grid">
            {templates.map((t) => (
              <TemplateCard
                key={t.name}
                template={t}
                onGenerate={() => handleGenerate(t)}
                onDelete={!t.builtin ? () => handleDeleteTemplate(t.name) : undefined}
                generating={generating === t.standard}
              />
            ))}
          </div>
        )}

        {/* Report viewer */}
        {report && (
          <ReportViewer report={report} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom template editor
// ---------------------------------------------------------------------------

function CustomTemplateEditor({
  onSave,
  onCancel,
}: {
  onSave: (template: ComplianceTemplate) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [standard, setStandard] = useState("");
  const [description, setDescription] = useState("");
  const [sections, setSections] = useState<TemplateSection[]>([]);

  const addSection = (type: SectionType) => {
    setSections([
      ...sections,
      {
        title: "",
        controlReference: "",
        type,
        queryScope: type === "query" ? "privilegedAccounts" : null,
        queryAttributes: type === "query"
          ? ["sAMAccountName", "displayName", "lastLogonTimestamp"]
          : null,
        content: type === "static" ? "" : null,
      },
    ]);
  };

  const updateSection = (index: number, updates: Partial<TemplateSection>) => {
    const updated = [...sections];
    updated[index] = { ...updated[index], ...updates };
    setSections(updated);
  };

  const removeSection = (index: number) => {
    setSections(sections.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    onSave({
      name,
      standard,
      version: "1.0",
      description,
      sections,
      builtin: false,
    });
  };

  return (
    <div
      className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4 space-y-3"
      data-testid="custom-template-editor"
    >
      <h3 className="text-caption font-semibold text-[var(--color-text-primary)]">
        Create Custom Template
      </h3>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Name</label>
          <input
            className="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 py-1.5 text-caption"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="custom-name"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Standard</label>
          <input
            className="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 py-1.5 text-caption"
            value={standard}
            onChange={(e) => setStandard(e.target.value)}
            placeholder="e.g., ISO 27001"
            data-testid="custom-standard"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Description</label>
          <input
            className="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 py-1.5 text-caption"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="custom-description"
          />
        </div>
      </div>

      {/* Sections */}
      {sections.map((section, i) => (
        <div key={i} className="rounded border border-[var(--color-border-subtle)] p-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
              Section {i + 1} ({section.type})
            </span>
            <button className="text-[var(--color-error)]" onClick={() => removeSection(i)}>
              <Trash2 size={12} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 py-1 text-caption"
              placeholder="Section title"
              value={section.title}
              onChange={(e) => updateSection(i, { title: e.target.value })}
            />
            <input
              className="rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 py-1 text-caption"
              placeholder="Control reference (e.g., ISO 27001 A.9)"
              value={section.controlReference}
              onChange={(e) => updateSection(i, { controlReference: e.target.value })}
            />
          </div>
          {section.type === "query" && (
            <select
              className="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 py-1 text-caption"
              value={section.queryScope ?? ""}
              onChange={(e) => updateSection(i, { queryScope: e.target.value })}
            >
              {QUERY_SCOPES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          )}
          {section.type === "static" && (
            <textarea
              className="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 py-1 text-caption"
              placeholder="Static content / recommendations"
              value={section.content ?? ""}
              onChange={(e) => updateSection(i, { content: e.target.value })}
              rows={3}
            />
          )}
        </div>
      ))}

      <div className="flex gap-2">
        <button
          className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1 text-caption hover:bg-[var(--color-surface-hover)] transition-colors"
          onClick={() => addSection("query")}
        >
          + Data Section
        </button>
        <button
          className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1 text-caption hover:bg-[var(--color-surface-hover)] transition-colors"
          onClick={() => addSection("static")}
        >
          + Recommendations
        </button>
      </div>

      <div className="flex justify-end gap-2">
        <button
          className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption hover:bg-[var(--color-surface-hover)] transition-colors"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={handleSave}
          disabled={!name.trim() || !standard.trim() || sections.length === 0}
          data-testid="save-custom-btn"
        >
          Save Template
        </button>
      </div>
    </div>
  );
}
