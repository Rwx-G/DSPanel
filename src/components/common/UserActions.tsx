import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePermissions } from "@/hooks/usePermissions";
import { useDialog } from "@/contexts/DialogContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useMfaGate } from "@/hooks/useMfaGate";
import { extractErrorMessage } from "@/utils/errorMapping";
import { type DirectoryUser } from "@/types/directory";
import { Unlock, Power, PowerOff, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";

interface UserActionsProps {
  user: DirectoryUser;
  onRefresh: () => void;
  onResetPassword: () => void;
}

export function UserActions({
  user,
  onRefresh,
  onResetPassword,
}: UserActionsProps) {
  const { t } = useTranslation(["components", "common"]);
  const { showConfirmation } = useDialog();
  const { notify } = useNotifications();
  const { checkMfa } = useMfaGate();
  const { hasPermission } = usePermissions();
  const canAct = hasPermission("HelpDesk");
  const [loading, setLoading] = useState<string | null>(null);

  const handleAction = useCallback(
    async (
      action: string,
      command: string,
      confirmMessage: string,
      mfaAction?: string,
    ) => {
      if (mfaAction) {
        const mfaAllowed = await checkMfa(mfaAction);
        if (!mfaAllowed) return;
      }

      const confirmed = await showConfirmation(
        `${action} Account`,
        confirmMessage,
      );
      if (!confirmed) return;

      setLoading(action);
      try {
        await invoke(command, { userDn: user.distinguishedName });
        notify(t("components:userActions.actionSuccess", { action, name: user.displayName }), "success");
        onRefresh();
      } catch (e) {
        notify(extractErrorMessage(e), "error");
      } finally {
        setLoading(null);
      }
    },
    [user, showConfirmation, notify, onRefresh, checkMfa],
  );

  const handleUnlock = useCallback(
    () =>
      handleAction(
        t("components:userActions.unlockAccount"),
        "unlock_account",
        t("components:userActions.unlockConfirm", { name: user.displayName, sam: user.samAccountName }),
      ),
    [handleAction, user],
  );

  const handleEnable = useCallback(
    () =>
      handleAction(
        t("components:userActions.enableAccount"),
        "enable_account",
        t("components:userActions.enableConfirm", { name: user.displayName, sam: user.samAccountName }),
      ),
    [handleAction, user],
  );

  const handleDisable = useCallback(
    () =>
      handleAction(
        t("components:userActions.disableAccount"),
        "disable_account",
        t("components:userActions.disableConfirm", { name: user.displayName, sam: user.samAccountName }),
        "AccountDisable",
      ),
    [handleAction, user],
  );

  return (
    <div className="flex items-center gap-2" data-testid="user-actions">
      <div className="group relative">
        <button
          className="btn btn-sm btn-primary flex items-center gap-1"
          onClick={onResetPassword}
          disabled={!canAct}
          data-testid="reset-password-btn"
        >
          <KeyRound size={12} />
          {t("components:userActions.resetPassword")}
        </button>
        {!canAct && (
          <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--color-surface-elevated)] px-2.5 py-1.5 text-caption font-medium text-[var(--color-text-primary)] opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
            {t("components:userActions.requiresHelpDesk")}
          </span>
        )}
      </div>

      {user.lockedOut && (
        <div className="group relative">
          <button
            className="btn btn-sm btn-secondary flex items-center gap-1"
            onClick={handleUnlock}
            disabled={!canAct || loading === "Unlock"}
            data-testid="unlock-btn"
          >
            <Unlock size={12} />
            {t("components:userActions.unlock")}
          </button>
          {!canAct && (
            <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--color-surface-elevated)] px-2.5 py-1.5 text-caption font-medium text-[var(--color-text-primary)] opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
              {t("components:userActions.requiresHelpDesk")}
            </span>
          )}
        </div>
      )}

      {user.enabled ? (
        <div className="group relative">
          <button
            className="btn btn-sm btn-secondary flex items-center gap-1 text-[var(--color-error)]"
            onClick={handleDisable}
            disabled={!canAct || loading === "Disable"}
            data-testid="disable-btn"
          >
            <PowerOff size={12} />
            {t("components:userActions.disable")}
          </button>
          {!canAct && (
            <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--color-surface-elevated)] px-2.5 py-1.5 text-caption font-medium text-[var(--color-text-primary)] opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
              {t("components:userActions.requiresHelpDesk")}
            </span>
          )}
        </div>
      ) : (
        <div className="group relative">
          <button
            className="btn btn-sm btn-secondary flex items-center gap-1 text-[var(--color-success)]"
            onClick={handleEnable}
            disabled={!canAct || loading === "Enable"}
            data-testid="enable-btn"
          >
            <Power size={12} />
            {t("components:userActions.enable")}
          </button>
          {!canAct && (
            <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--color-surface-elevated)] px-2.5 py-1.5 text-caption font-medium text-[var(--color-text-primary)] opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
              {t("components:userActions.requiresHelpDesk")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
