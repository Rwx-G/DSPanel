import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DialogShell } from "@/components/dialogs/DialogShell";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { useMfaGate } from "@/hooks/useMfaGate";
import { useTranslation } from "react-i18next";

/**
 * Shared dialog shape for Epic 14 quick-fix actions that follow the
 * "explanatory body + I-have-verified checkbox + Confirm" pattern. Used
 * by Story 14.4 (ClearPasswordNotRequired) and Story 14.6
 * (DisableUnconstrainedDelegation). Story 14.5 (ManageSpns) uses a
 * different shape (per-SPN selection list, no acknowledgement checkbox)
 * and so does not consume this component.
 *
 * The i18n contract is the AcknowledgeQuickFixI18nKeys interface below.
 * Every consumer must provide the same 8 keys under its `tBaseKey` so the
 * shape stays uniform for translators.
 */

/**
 * The 8 i18n keys every acknowledge-style quick-fix dialog must provide
 * under its `quickFix.<actionName>` namespace. Documented as a TypeScript
 * interface so a future quick-fix dialog refactored onto this component
 * has a compile-time-style checklist (we cannot enforce the contract on
 * the i18n JSON itself, so this interface is the source of truth).
 */
export interface AcknowledgeQuickFixI18nKeys {
  /** Inline button label rendered next to the indicator badge */
  fixButton: string;
  /** ARIA label for the inline Fix button */
  fixButtonAriaLabel: string;
  /** Dialog title shown in the header bar */
  title: string;
  /** Multi-paragraph explanatory body (whitespace-pre-line) */
  body: string;
  /** Acknowledgement checkbox label, e.g. "I have verified..." */
  checkboxLabel: string;
  /** Primary action button label, e.g. "Clear flag" */
  confirmButton: string;
  /** Notification message on success, supports {{name}} interpolation */
  successNotification: string;
  /** Notification message on failure, supports {{error}} interpolation */
  failureNotification: string;
}

interface AcknowledgeQuickFixDialogProps {
  /**
   * i18n base key, e.g. `"userDetail:quickFix.clearPasswordNotRequired"`.
   * The 8 keys defined by AcknowledgeQuickFixI18nKeys are read relative
   * to this base.
   */
  tBaseKey: string;
  /** i18n namespaces useTranslation should load (e.g. `["userDetail", "common"]`) */
  tNamespaces: string[];
  /** Subject identifier rendered under the title (user displayName or computer name) */
  subjectName: string;
  /** Tauri command to invoke after the operator confirms */
  invokeCommand: string;
  /** Arguments object passed to the Tauri command */
  invokeArgs: Record<string, unknown>;
  /** Action name passed to useMfaGate(...).checkMfa */
  mfaActionName: string;
  /** data-testid applied to the DialogShell root */
  dialogTestId: string;
  /** DialogShell maxWidth (defaults to "md" via DialogShell) */
  maxWidth?: "sm" | "md" | "lg";
  /** When true, the body container caps its height and scrolls (for long bodies) */
  scrollableBody?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AcknowledgeQuickFixDialog({
  tBaseKey,
  tNamespaces,
  subjectName,
  invokeCommand,
  invokeArgs,
  mfaActionName,
  dialogTestId,
  maxWidth,
  scrollableBody = false,
  onClose,
  onSuccess,
}: AcknowledgeQuickFixDialogProps) {
  const { t } = useTranslation(tNamespaces);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { checkMfa } = useMfaGate();

  const handleConfirm = useCallback(async () => {
    if (!acknowledged) return;

    const mfaAllowed = await checkMfa(mfaActionName);
    if (!mfaAllowed) return;

    setLoading(true);
    setError(null);
    try {
      await invoke(invokeCommand, invokeArgs);
      onSuccess();
    } catch (e) {
      const msg = typeof e === "string" ? e : "Operation failed";
      try {
        const parsed: { userMessage?: string; message?: string } = JSON.parse(msg);
        setError(parsed.userMessage ?? parsed.message ?? msg);
      } catch {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [acknowledged, invokeCommand, invokeArgs, mfaActionName, checkMfa, onSuccess]);

  const bodyClassName = scrollableBody
    ? "px-4 py-3 space-y-3 max-h-[60vh] overflow-y-auto"
    : "px-4 py-3 space-y-3";

  return (
    <DialogShell
      onClose={onClose}
      maxWidth={maxWidth}
      ariaLabel={t(`${tBaseKey}.title`)}
      dialogTestId={dialogTestId}
    >
      <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          {t(`${tBaseKey}.title`)}
        </h2>
        <p className="text-caption text-[var(--color-text-secondary)]">
          {subjectName}
        </p>
      </div>

      <div className={bodyClassName}>
        <p className="text-body text-[var(--color-text-primary)] whitespace-pre-line">
          {t(`${tBaseKey}.body`)}
        </p>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 rounded border-[var(--color-border-default)]"
            data-testid="acknowledge-checkbox"
          />
          <span className="text-body text-[var(--color-text-primary)]">
            {t(`${tBaseKey}.checkboxLabel`)}
          </span>
        </label>

        {error && (
          <p
            className="text-caption text-[var(--color-error)]"
            data-testid="error-message"
          >
            {error}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-border-subtle)]">
        <button
          className="btn btn-secondary"
          onClick={onClose}
          data-testid="cancel-btn"
          disabled={loading}
        >
          {t("common:cancel")}
        </button>
        <button
          className="btn btn-primary"
          onClick={handleConfirm}
          disabled={!acknowledged || loading}
          data-testid="confirm-btn"
        >
          {loading ? (
            <LoadingSpinner size={16} />
          ) : (
            t(`${tBaseKey}.confirmButton`)
          )}
        </button>
      </div>
    </DialogShell>
  );
}
