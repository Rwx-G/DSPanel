import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PermissionGate } from "@/components/common/PermissionGate";
import { useDialog } from "@/contexts/DialogContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useMfaGate } from "@/hooks/useMfaGate";
import { type DirectoryUser } from "@/types/directory";
import { Unlock, Power, PowerOff, KeyRound } from "lucide-react";

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
  const { showConfirmation } = useDialog();
  const { notify } = useNotifications();
  const { checkMfa } = useMfaGate();
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
        notify(`${action} successful for ${user.displayName}`, "success");
        onRefresh();
      } catch (e) {
        const msg = typeof e === "string" ? e : `${action} failed`;
        try {
          const parsed = JSON.parse(msg);
          notify(parsed.userMessage || parsed.message || msg, "error");
        } catch {
          notify(msg, "error");
        }
      } finally {
        setLoading(null);
      }
    },
    [user, showConfirmation, notify, onRefresh, checkMfa],
  );

  const handleUnlock = useCallback(
    () =>
      handleAction(
        "Unlock",
        "unlock_account",
        `Are you sure you want to unlock the account for ${user.displayName} (${user.samAccountName})?`,
      ),
    [handleAction, user],
  );

  const handleEnable = useCallback(
    () =>
      handleAction(
        "Enable",
        "enable_account",
        `Are you sure you want to enable the account for ${user.displayName} (${user.samAccountName})?`,
      ),
    [handleAction, user],
  );

  const handleDisable = useCallback(
    () =>
      handleAction(
        "Disable",
        "disable_account",
        `Are you sure you want to disable the account for ${user.displayName} (${user.samAccountName})? The user will no longer be able to log in.`,
        "AccountDisable",
      ),
    [handleAction, user],
  );

  return (
    <PermissionGate requiredLevel="HelpDesk">
      <div
        className="flex items-center gap-2"
        data-testid="user-actions"
      >
        <button
          className="btn btn-sm btn-primary flex items-center gap-1"
          onClick={onResetPassword}
          data-testid="reset-password-btn"
        >
          <KeyRound size={12} />
          Reset Password
        </button>

        {user.lockedOut && (
          <button
            className="btn btn-sm btn-secondary flex items-center gap-1"
            onClick={handleUnlock}
            disabled={loading === "Unlock"}
            data-testid="unlock-btn"
          >
            <Unlock size={12} />
            Unlock
          </button>
        )}

        {user.enabled ? (
          <button
            className="btn btn-sm btn-secondary flex items-center gap-1 text-[var(--color-error)]"
            onClick={handleDisable}
            disabled={loading === "Disable"}
            data-testid="disable-btn"
          >
            <PowerOff size={12} />
            Disable
          </button>
        ) : (
          <button
            className="btn btn-sm btn-secondary flex items-center gap-1 text-[var(--color-success)]"
            onClick={handleEnable}
            disabled={loading === "Enable"}
            data-testid="enable-btn"
          >
            <Power size={12} />
            Enable
          </button>
        )}
      </div>
    </PermissionGate>
  );
}
