import { useState, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DialogShell } from "@/components/dialogs/DialogShell";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { useMfaGate } from "@/hooks/useMfaGate";
import { isSystemSpn } from "@/utils/spn";
import { useTranslation } from "react-i18next";

/** Wire shape returned by the Rust `remove_user_spns` Tauri command. */
export interface RemoveSpnsResult {
  removed: string[];
  kept: string[];
  blockedSystem: string[];
}

interface ManageSpnsDialogProps {
  userDn: string;
  displayName: string;
  currentSpns: string[];
  onClose: () => void;
  onSuccess: (result: RemoveSpnsResult) => void;
}

/**
 * Story 14.5 quick-fix dialog. Lists every SPN registered on the user with
 * checkboxes for the removable ones. System SPNs (HOST/, ldap/, krbtgt/, etc.)
 * are shown read-only with a tooltip explaining why they cannot be removed.
 *
 * The frontend system-SPN guard (src/utils/spn.ts) hides them from the
 * selectable list as a usability convenience; the backend enforces the
 * same guard server-side as defense in depth.
 *
 * Wraps the IPC call in `useMfaGate("RemoveUserSpns")` so the verification
 * dialog appears when the action requires MFA per the operator's settings.
 */
export function ManageSpnsDialog({
  userDn,
  displayName,
  currentSpns,
  onClose,
  onSuccess,
}: ManageSpnsDialogProps) {
  const { t } = useTranslation(["userDetail", "common"]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { checkMfa } = useMfaGate();

  const { removable, system } = useMemo(() => {
    const removable: string[] = [];
    const system: string[] = [];
    for (const spn of currentSpns) {
      if (isSystemSpn(spn)) {
        system.push(spn);
      } else {
        removable.push(spn);
      }
    }
    removable.sort();
    system.sort();
    return { removable, system };
  }, [currentSpns]);

  const toggle = useCallback((spn: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(spn)) {
        next.delete(spn);
      } else {
        next.add(spn);
      }
      return next;
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (selected.size === 0) return;

    const mfaAllowed = await checkMfa("RemoveUserSpns");
    if (!mfaAllowed) return;

    setLoading(true);
    setError(null);
    try {
      const result = await invoke<RemoveSpnsResult>("remove_user_spns", {
        userDn,
        spnsToRemove: Array.from(selected),
      });
      onSuccess(result);
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
  }, [selected, userDn, checkMfa, onSuccess]);

  return (
    <DialogShell
      onClose={onClose}
      maxWidth="lg"
      ariaLabel={t("userDetail:quickFix.removeUserSpns.title")}
      dialogTestId="manage-spns-dialog"
    >
      <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          {t("userDetail:quickFix.removeUserSpns.title")}
        </h2>
        <p className="text-caption text-[var(--color-text-secondary)]">
          {displayName}
        </p>
      </div>

      <div className="px-4 py-3 space-y-4 max-h-[60vh] overflow-y-auto">
        <p className="text-body text-[var(--color-text-primary)] whitespace-pre-line">
          {t("userDetail:quickFix.removeUserSpns.body")}
        </p>

        {currentSpns.length === 0 && (
          <p
            className="text-caption text-[var(--color-text-secondary)]"
            data-testid="empty-spns"
          >
            {t("userDetail:quickFix.removeUserSpns.noSpnsAtAll")}
          </p>
        )}

        {removable.length > 0 && (
          <div className="space-y-1" data-testid="removable-section">
            <h3 className="text-caption font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
              {t("userDetail:quickFix.removeUserSpns.removableSectionHeader")}
            </h3>
            <ul className="space-y-1">
              {removable.map((spn) => (
                <li
                  key={spn}
                  className="flex items-center gap-2"
                  data-testid={`spn-row-${spn}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(spn)}
                    onChange={() => toggle(spn)}
                    className="rounded border-[var(--color-border-default)]"
                    data-testid={`spn-checkbox-${spn}`}
                    aria-label={spn}
                  />
                  <code className="text-caption font-mono text-[var(--color-text-primary)]">
                    {spn}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        )}

        {currentSpns.length > 0 && removable.length === 0 && (
          <p
            className="text-caption text-[var(--color-text-secondary)]"
            data-testid="empty-removable"
          >
            {t("userDetail:quickFix.removeUserSpns.noRemovableSpns")}
          </p>
        )}

        {system.length > 0 && (
          <div className="space-y-1" data-testid="system-section">
            <h3 className="text-caption font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
              {t("userDetail:quickFix.removeUserSpns.systemSectionHeader")}
            </h3>
            <ul className="space-y-1">
              {system.map((spn) => (
                <li
                  key={spn}
                  className="flex items-center gap-2 opacity-60"
                  title={t(
                    "userDetail:quickFix.removeUserSpns.systemSpnTooltip",
                  )}
                  data-testid={`system-spn-row-${spn}`}
                >
                  <span
                    className="inline-block h-3 w-3 shrink-0"
                    aria-hidden="true"
                  />
                  <code className="text-caption font-mono text-[var(--color-text-secondary)] line-through-none">
                    {spn}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        )}

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
          disabled={selected.size === 0 || loading}
          data-testid="confirm-btn"
        >
          {loading ? (
            <LoadingSpinner size={16} />
          ) : (
            t("userDetail:quickFix.removeUserSpns.confirmButton")
          )}
        </button>
      </div>
    </DialogShell>
  );
}
