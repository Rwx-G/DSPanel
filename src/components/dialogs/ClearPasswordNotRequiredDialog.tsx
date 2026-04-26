import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DialogShell } from "@/components/dialogs/DialogShell";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { useMfaGate } from "@/hooks/useMfaGate";
import { useTranslation } from "react-i18next";

interface ClearPasswordNotRequiredDialogProps {
  userDn: string;
  displayName: string;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Story 14.4 quick-fix dialog. Confirms the operator wants to clear the
 * `PASSWORD_NOT_REQUIRED` flag from the user's `userAccountControl`. The
 * confirm button stays disabled until the operator ticks the
 * "I understand..." checkbox so the consequence (the user must comply with
 * the domain password policy at next logon) is actively acknowledged.
 *
 * Wraps the IPC call in `useMfaGate("ClearPasswordNotRequired")` so the
 * verification dialog appears when the action requires MFA per the
 * operator's settings.
 */
export function ClearPasswordNotRequiredDialog({
  userDn,
  displayName,
  onClose,
  onSuccess,
}: ClearPasswordNotRequiredDialogProps) {
  const { t } = useTranslation(["userDetail", "common"]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { checkMfa } = useMfaGate();

  const handleConfirm = useCallback(async () => {
    if (!acknowledged) return;

    const mfaAllowed = await checkMfa("ClearPasswordNotRequired");
    if (!mfaAllowed) return;

    setLoading(true);
    setError(null);
    try {
      await invoke("clear_password_not_required", { userDn });
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
  }, [acknowledged, userDn, checkMfa, onSuccess]);

  return (
    <DialogShell
      onClose={onClose}
      ariaLabel={t("userDetail:quickFix.clearPasswordNotRequired.title")}
      dialogTestId="clear-password-not-required-dialog"
    >
      <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          {t("userDetail:quickFix.clearPasswordNotRequired.title")}
        </h2>
        <p className="text-caption text-[var(--color-text-secondary)]">
          {displayName}
        </p>
      </div>

      <div className="px-4 py-3 space-y-3">
        <p className="text-body text-[var(--color-text-primary)] whitespace-pre-line">
          {t("userDetail:quickFix.clearPasswordNotRequired.body")}
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
            {t("userDetail:quickFix.clearPasswordNotRequired.checkboxLabel")}
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
            t("userDetail:quickFix.clearPasswordNotRequired.confirmButton")
          )}
        </button>
      </div>
    </DialogShell>
  );
}
