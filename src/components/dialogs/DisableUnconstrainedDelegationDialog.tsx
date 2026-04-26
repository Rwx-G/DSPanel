import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DialogShell } from "@/components/dialogs/DialogShell";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { useMfaGate } from "@/hooks/useMfaGate";
import { useTranslation } from "react-i18next";

interface DisableUnconstrainedDelegationDialogProps {
  computerDn: string;
  computerName: string;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Story 14.6 quick-fix dialog. Confirms the operator wants to clear the
 * `TRUSTED_FOR_DELEGATION` (0x80000) bit from the computer's
 * `userAccountControl`. The body explains the attack vector (golden ticket
 * via TGT capture), recommends migration to constrained delegation, and
 * lists risks to legitimate Kerberos double-hop services so the operator
 * can make an informed decision before clicking through.
 *
 * The confirm button stays disabled until the operator ticks the
 * "I have verified no production service requires this" checkbox so the
 * blast radius is actively acknowledged.
 *
 * Wraps the IPC call in `useMfaGate("DisableUnconstrainedDelegation")` so
 * the verification dialog appears when the action requires MFA per the
 * operator's settings.
 */
export function DisableUnconstrainedDelegationDialog({
  computerDn,
  computerName,
  onClose,
  onSuccess,
}: DisableUnconstrainedDelegationDialogProps) {
  const { t } = useTranslation(["computerDetail", "common"]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { checkMfa } = useMfaGate();

  const handleConfirm = useCallback(async () => {
    if (!acknowledged) return;

    const mfaAllowed = await checkMfa("DisableUnconstrainedDelegation");
    if (!mfaAllowed) return;

    setLoading(true);
    setError(null);
    try {
      await invoke("disable_unconstrained_delegation", { computerDn });
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
  }, [acknowledged, computerDn, checkMfa, onSuccess]);

  return (
    <DialogShell
      onClose={onClose}
      maxWidth="lg"
      ariaLabel={t(
        "computerDetail:quickFix.disableUnconstrainedDelegation.title",
      )}
      dialogTestId="disable-unconstrained-delegation-dialog"
    >
      <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          {t("computerDetail:quickFix.disableUnconstrainedDelegation.title")}
        </h2>
        <p className="text-caption text-[var(--color-text-secondary)]">
          {computerName}
        </p>
      </div>

      <div className="px-4 py-3 space-y-3 max-h-[60vh] overflow-y-auto">
        <p className="text-body text-[var(--color-text-primary)] whitespace-pre-line">
          {t("computerDetail:quickFix.disableUnconstrainedDelegation.body")}
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
            {t(
              "computerDetail:quickFix.disableUnconstrainedDelegation.checkboxLabel",
            )}
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
            t(
              "computerDetail:quickFix.disableUnconstrainedDelegation.confirmButton",
            )
          )}
        </button>
      </div>
    </DialogShell>
  );
}
