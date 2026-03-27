import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { ExportToolbar } from "@/components/common/ExportToolbar";
import { SecurityDisclaimer } from "@/components/common/SecurityDisclaimer";
import { extractErrorMessage } from "@/utils/errorMapping";
import {
  Plus,
  Trash2,
  Play,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Search,
  ShieldAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";

// ---------------------------------------------------------------------------
// Types (mirror Rust models)
// ---------------------------------------------------------------------------

type CleanupCondition = "inactiveDays" | "neverLoggedOnCreatedDays" | "disabledDays";
type CleanupAction = "disable" | "move" | "delete";

interface CleanupRule {
  name: string;
  condition: CleanupCondition;
  thresholdDays: number;
  action: CleanupAction;
  targetOu: string | null;
  excludePatterns: string[] | null;
  excludeOus: string[] | null;
}

interface CleanupMatch {
  dn: string;
  displayName: string;
  samAccountName: string;
  currentState: string;
  proposedAction: string;
  action: CleanupAction;
  targetOu: string | null;
  selected: boolean;
}

interface CleanupDryRunResult {
  ruleName: string;
  matches: CleanupMatch[];
  totalCount: number;
}

interface CleanupExecutionResult {
  dn: string;
  displayName: string;
  action: CleanupAction;
  success: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONDITION_KEYS: Record<CleanupCondition, string> = {
  inactiveDays: "conditionInactive",
  neverLoggedOnCreatedDays: "conditionNeverLogged",
  disabledDays: "conditionDisabled",
};

const ACTION_KEYS: Record<CleanupAction, string> = {
  disable: "actionDisable",
  move: "actionMove",
  delete: "actionDelete",
};

const DEFAULT_RULE: CleanupRule = {
  name: "",
  condition: "inactiveDays",
  thresholdDays: 180,
  action: "disable",
  targetOu: null,
  excludePatterns: null,
  excludeOus: null,
};

// ---------------------------------------------------------------------------
// Rule Editor
// ---------------------------------------------------------------------------

function RuleEditor({
  rule,
  onChange,
  onSave,
  onCancel,
}: {
  rule: CleanupRule;
  onChange: (rule: CleanupRule) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(["automatedCleanup", "common"]);
  return (
    <div
      className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4 space-y-3"
      data-testid="rule-editor"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-caption font-medium text-[var(--color-text-secondary)] mb-1">
            {t("ruleName")}
          </label>
          <input
            className="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1.5 text-caption text-[var(--color-text-primary)]"
            value={rule.name}
            onChange={(e) => onChange({ ...rule, name: e.target.value })}
            placeholder={t("ruleNamePlaceholder")}
            data-testid="rule-name-input"
          />
        </div>
        <div>
          <label className="block text-caption font-medium text-[var(--color-text-secondary)] mb-1">
            {t("condition")}
          </label>
          <select
            className="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1.5 text-caption text-[var(--color-text-primary)]"
            value={rule.condition}
            onChange={(e) =>
              onChange({ ...rule, condition: e.target.value as CleanupCondition })
            }
            data-testid="rule-condition-select"
          >
            {Object.entries(CONDITION_KEYS).map(([value, key]) => (
              <option key={value} value={value}>
                {t(key)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-caption font-medium text-[var(--color-text-secondary)] mb-1">
            {t("threshold")}
          </label>
          <input
            type="number"
            className="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1.5 text-caption text-[var(--color-text-primary)]"
            value={rule.thresholdDays}
            onChange={(e) =>
              onChange({ ...rule, thresholdDays: Math.max(1, Number(e.target.value)) })
            }
            min={1}
            data-testid="rule-threshold-input"
          />
        </div>
        <div>
          <label className="block text-caption font-medium text-[var(--color-text-secondary)] mb-1">
            {t("action")}
          </label>
          <select
            className="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1.5 text-caption text-[var(--color-text-primary)]"
            value={rule.action}
            onChange={(e) =>
              onChange({ ...rule, action: e.target.value as CleanupAction })
            }
            data-testid="rule-action-select"
          >
            {Object.entries(ACTION_KEYS).map(([value, key]) => (
              <option key={value} value={value}>
                {t(key)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {rule.action === "move" && (
        <div>
          <label className="block text-caption font-medium text-[var(--color-text-secondary)] mb-1">
            {t("targetOu")}
          </label>
          <input
            className="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1.5 text-caption text-[var(--color-text-primary)]"
            value={rule.targetOu ?? ""}
            onChange={(e) =>
              onChange({ ...rule, targetOu: e.target.value || null })
            }
            placeholder={t("targetOuPlaceholder")}
            data-testid="rule-target-ou-input"
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-caption font-medium text-[var(--color-text-secondary)] mb-1">
            {t("excludePatterns")}
          </label>
          <input
            className="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1.5 text-caption text-[var(--color-text-primary)]"
            value={rule.excludePatterns?.join(", ") ?? ""}
            onChange={(e) => {
              const val = e.target.value.trim();
              onChange({
                ...rule,
                excludePatterns: val
                  ? val.split(",").map((s) => s.trim()).filter(Boolean)
                  : null,
              });
            }}
            placeholder={t("excludePatternsPlaceholder")}
            data-testid="rule-exclude-patterns"
          />
        </div>
        <div>
          <label className="block text-caption font-medium text-[var(--color-text-secondary)] mb-1">
            {t("excludeOus")}
          </label>
          <input
            className="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1.5 text-caption text-[var(--color-text-primary)]"
            value={rule.excludeOus?.join(", ") ?? ""}
            onChange={(e) => {
              const val = e.target.value.trim();
              onChange({
                ...rule,
                excludeOus: val
                  ? val.split(",").map((s) => s.trim()).filter(Boolean)
                  : null,
              });
            }}
            placeholder={t("excludeOusPlaceholder")}
            data-testid="rule-exclude-ous"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          onClick={onCancel}
          data-testid="rule-cancel-btn"
        >
          {t("common:cancel")}
        </button>
        <button
          className="btn btn-sm btn-primary flex items-center gap-1"
          onClick={onSave}
          disabled={!rule.name.trim()}
          data-testid="rule-save-btn"
        >
          {t("saveRule")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AutomatedCleanup() {
  const { t } = useTranslation(["automatedCleanup", "common"]);
  const [rules, setRules] = useState<CleanupRule[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [editingRule, setEditingRule] = useState<CleanupRule | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const [dryRunResult, setDryRunResult] = useState<CleanupDryRunResult | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunError, setDryRunError] = useState<string | null>(null);

  const [executing, setExecuting] = useState(false);
  const [executionResults, setExecutionResults] = useState<CleanupExecutionResult[] | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);

  // Load rules on first render
  const loadRules = useCallback(async () => {
    try {
      const loaded = await invoke<CleanupRule[]>("get_cleanup_rules");
      setRules(loaded);
      setRulesLoaded(true);
    } catch {
      setRulesLoaded(true);
    }
  }, []);

  if (!rulesLoaded) {
    loadRules();
  }

  const saveRules = async (newRules: CleanupRule[]) => {
    try {
      await invoke("save_cleanup_rules", { rules: newRules });
      setRules(newRules);
    } catch (err) {
      console.error("Failed to save rules:", err);
    }
  };

  const handleSaveRule = () => {
    if (!editingRule) return;
    const newRules = [...rules];
    if (editingIndex !== null) {
      newRules[editingIndex] = editingRule;
    } else {
      newRules.push(editingRule);
    }
    saveRules(newRules);
    setEditingRule(null);
    setEditingIndex(null);
  };

  const handleDeleteRule = (index: number) => {
    const newRules = rules.filter((_, i) => i !== index);
    saveRules(newRules);
  };

  const handleDryRun = async (rule: CleanupRule) => {
    setDryRunLoading(true);
    setDryRunError(null);
    setDryRunResult(null);
    setExecutionResults(null);
    setConfirmDelete(false);
    try {
      const result = await invoke<CleanupDryRunResult>("cleanup_dry_run", { rule });
      setDryRunResult(result);
    } catch (err) {
      setDryRunError(extractErrorMessage(err));
    } finally {
      setDryRunLoading(false);
    }
  };

  const toggleMatch = (index: number) => {
    if (!dryRunResult) return;
    const updated = { ...dryRunResult };
    updated.matches = [...updated.matches];
    updated.matches[index] = {
      ...updated.matches[index],
      selected: !updated.matches[index].selected,
    };
    setDryRunResult(updated);
  };

  const handleExecute = async () => {
    if (!dryRunResult) return;
    const selected = dryRunResult.matches.filter((m) => m.selected);
    if (selected.length === 0) return;

    // Require double confirmation for delete actions
    const hasDeletes = selected.some((m) => m.action === "delete");
    if (hasDeletes && !confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setExecuting(true);
    try {
      const results = await invoke<CleanupExecutionResult[]>("cleanup_execute", {
        matches: selected,
      });
      setExecutionResults(results);
      setDryRunResult(null);
      setConfirmDelete(false);
    } catch (err) {
      setDryRunError(extractErrorMessage(err));
    } finally {
      setExecuting(false);
    }
  };

  const selectedCount = dryRunResult?.matches.filter((m) => m.selected).length ?? 0;

  return (
    <div className="flex h-full flex-col" data-testid="automated-cleanup">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-2">
        <h2 className="flex items-center gap-1.5 text-body font-semibold text-[var(--color-text-primary)]">
          <ShieldAlert size={16} />
          {t("pageTitle")}
          <SecurityDisclaimer
            coverage="~40%"
            checks={t("disclaimer.checks")}
            limitations={t("disclaimer.limitations")}
            tools={t("disclaimer.tools")}
          />
        </h2>
        <button
          className="btn btn-sm btn-primary flex items-center gap-1"
          onClick={() => {
            setEditingRule({ ...DEFAULT_RULE });
            setEditingIndex(null);
          }}
          data-testid="add-rule-btn"
        >
          <Plus size={14} />
          {t("addRule")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Rule editor */}
        {editingRule && (
          <RuleEditor
            rule={editingRule}
            onChange={setEditingRule}
            onSave={handleSaveRule}
            onCancel={() => {
              setEditingRule(null);
              setEditingIndex(null);
            }}
          />
        )}

        {/* Rules list */}
        {rules.length === 0 && !editingRule && (
          <EmptyState
            icon={<ShieldAlert size={40} />}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        )}

        {rules.length > 0 && (
          <div className="space-y-2" data-testid="rules-list">
            {rules.map((rule, index) => (
              <div
                key={`${rule.name}-${index}`}
                className="flex items-center justify-between rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-4 py-2"
                data-testid={`rule-${index}`}
              >
                <div>
                  <div className="text-caption font-medium text-[var(--color-text-primary)]">
                    {rule.name}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-secondary)]">
                    {t(CONDITION_KEYS[rule.condition])} ({rule.thresholdDays}d) - {t(ACTION_KEYS[rule.action])}
                    {rule.action === "move" && rule.targetOu && ` to ${rule.targetOu}`}
                    {rule.excludePatterns && rule.excludePatterns.length > 0 && (
                      <span className="ml-2 text-[var(--color-text-disabled)]">
                        {t("excl")}: {rule.excludePatterns.join(", ")}
                      </span>
                    )}
                    {rule.excludeOus && rule.excludeOus.length > 0 && (
                      <span className="ml-2 text-[var(--color-text-disabled)]">
                        {t("exclOus")}: {rule.excludeOus.join(", ")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-1"
                    onClick={() => handleDryRun(rule)}
                    disabled={dryRunLoading}
                    data-testid={`run-rule-${index}`}
                  >
                    <Search size={12} />
                    {t("dryRun")}
                  </button>
                  <button
                    className="btn btn-sm p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    onClick={() => {
                      setEditingRule({ ...rule });
                      setEditingIndex(index);
                    }}
                    data-testid={`edit-rule-${index}`}
                  >
                    {t("common:edit")}
                  </button>
                  <button
                    className="btn btn-sm p-1 text-[var(--color-error)] hover:text-[var(--color-error)]"
                    onClick={() => handleDeleteRule(index)}
                    data-testid={`delete-rule-${index}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Dry-run loading */}
        {dryRunLoading && (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner />
          </div>
        )}

        {/* Dry-run error */}
        {dryRunError && (
          <EmptyState
            icon={<AlertTriangle size={40} />}
            title={t("dryRunFailed")}
            description={dryRunError}
          />
        )}

        {/* Dry-run results */}
        {dryRunResult && (
          <div
            className="space-y-3"
            data-testid="dry-run-results"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
                {t("dryRunTitle")}: {dryRunResult.ruleName} ({dryRunResult.totalCount} {t("matches")})
              </h3>
              <div className="flex items-center gap-2">
                <ExportToolbar<CleanupMatch>
                  columns={[
                    { key: "displayName", header: t("common:displayName") },
                    { key: "samAccountName", header: t("samAccount") },
                    { key: "currentState", header: t("currentState") },
                    { key: "proposedAction", header: t("proposedAction") },
                    { key: "dn", header: t("common:distinguishedName") },
                  ]}
                  data={dryRunResult.matches}
                  rowMapper={(m) => [
                    m.displayName,
                    m.samAccountName,
                    m.currentState,
                    m.proposedAction,
                    m.dn,
                  ]}
                  title={`Cleanup Dry Run - ${dryRunResult.ruleName}`}
                  filenameBase="cleanup-dry-run"
                />
                <button
                  className="btn btn-sm btn-primary flex items-center gap-1"
                  onClick={handleExecute}
                  disabled={executing || selectedCount === 0}
                  data-testid="execute-btn"
                >
                  <Play size={14} />
                  {confirmDelete
                    ? `${t("confirmDelete")} (${selectedCount})`
                    : executing
                      ? t("executing")
                      : `${t("common:execute")} (${selectedCount})`}
                </button>
              </div>
            </div>

            {confirmDelete && (
              <div
                className="flex items-center gap-2 rounded-lg border border-[var(--color-error)] bg-[var(--color-error)]/10 px-3 py-2 text-caption text-[var(--color-error)]"
                data-testid="delete-warning"
              >
                <AlertTriangle size={14} />
                <span>
                  {t("deleteWarning")}
                </span>
              </div>
            )}

            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]" data-testid="matches-table">
              <table className="w-full text-caption">
                <thead>
                  <tr className="border-b border-[var(--color-border-default)] text-left text-[var(--color-text-secondary)]">
                    <th className="px-3 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={dryRunResult.matches.every((m) => m.selected)}
                        onChange={(e) => {
                          const all = e.target.checked;
                          setDryRunResult({
                            ...dryRunResult,
                            matches: dryRunResult.matches.map((m) => ({
                              ...m,
                              selected: all,
                            })),
                          });
                        }}
                      />
                    </th>
                    <th className="px-3 py-2 font-medium">{t("common:displayName")}</th>
                    <th className="px-3 py-2 font-medium">{t("samAccount")}</th>
                    <th className="px-3 py-2 font-medium">{t("currentState")}</th>
                    <th className="px-3 py-2 font-medium">{t("proposedAction")}</th>
                  </tr>
                </thead>
                <tbody>
                  {dryRunResult.matches.map((match, i) => (
                    <tr
                      key={match.dn}
                      className="border-t border-[var(--color-border-subtle)]"
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={match.selected}
                          onChange={() => toggleMatch(i)}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-[var(--color-text-primary)]">
                        {match.displayName}
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-[var(--color-text-secondary)]">
                        {match.samAccountName}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                        {match.currentState}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            match.action === "delete"
                              ? "bg-[var(--color-error)]/10 text-[var(--color-error)]"
                              : match.action === "move"
                                ? "bg-[var(--color-info)]/10 text-[var(--color-info)]"
                                : "bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
                          }`}
                        >
                          {match.proposedAction}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Execution results */}
        {executionResults && (
          <div className="space-y-3" data-testid="execution-results">
            <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
              {t("executionResults")}
            </h3>
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]">
              <table className="w-full text-caption">
                <thead>
                  <tr className="border-b border-[var(--color-border-default)] text-left text-[var(--color-text-secondary)]">
                    <th className="px-3 py-2 font-medium">{t("account")}</th>
                    <th className="px-3 py-2 font-medium">{t("action")}</th>
                    <th className="px-3 py-2 text-center font-medium">{t("result")}</th>
                  </tr>
                </thead>
                <tbody>
                  {executionResults.map((r) => (
                    <tr key={r.dn} className="border-t border-[var(--color-border-subtle)]">
                      <td className="px-3 py-2 font-medium text-[var(--color-text-primary)]">
                        {r.displayName}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                        {t(ACTION_KEYS[r.action])}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.success ? (
                          <span className="inline-flex items-center gap-1 text-[var(--color-success)]">
                            <CheckCircle size={12} /> {t("common:ok")}
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 text-[var(--color-error)]"
                            title={r.error ?? ""}
                          >
                            <XCircle size={12} /> {t("common:fail")}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-caption text-[var(--color-text-secondary)]">
              {executionResults.filter((r) => r.success).length} / {executionResults.length} succeeded
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
