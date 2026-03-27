import { useState, useCallback, useMemo, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDialog } from "@/contexts/DialogContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { usePermissions } from "@/hooks/usePermissions";
import { type DirectoryUser } from "@/types/directory";
import { extractErrorMessage } from "@/utils/errorMapping";
import { type DryRunChange } from "@/components/dialogs/DryRunPreviewDialog";
import { useTranslation } from "react-i18next";

interface PasswordFlagsEditorProps {
  user: DirectoryUser;
  onRefresh: () => void;
}

export function PasswordFlagsEditor({
  user,
  onRefresh,
}: PasswordFlagsEditorProps) {
  const { t } = useTranslation(["components", "common"]);
  const { hasPermission } = usePermissions();
  const { showDryRunPreview } = useDialog();
  const { notify } = useNotifications();

  const [passwordNeverExpires, setPasswordNeverExpires] = useState(
    user.passwordNeverExpires,
  );
  const [userCannotChangePassword, setUserCannotChangePassword] =
    useState(false);
  const [adCannotChangePassword, setAdCannotChangePassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const [cannotChangePasswordUnavailable, setCannotChangePasswordUnavailable] =
    useState(false);

  // Fetch the DACL-based "Cannot Change Password" flag and reset state on user change
  useEffect(() => {
    setPasswordNeverExpires(user.passwordNeverExpires);

    let cancelled = false;
    invoke<boolean>("get_cannot_change_password", {
      userDn: user.distinguishedName,
    })
      .then((value) => {
        if (!cancelled) {
          setAdCannotChangePassword(value);
          setUserCannotChangePassword(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAdCannotChangePassword(false);
          setUserCannotChangePassword(false);
          setCannotChangePasswordUnavailable(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user.distinguishedName, user.passwordNeverExpires, refreshCount]);

  const isDirty = useMemo(
    () =>
      passwordNeverExpires !== user.passwordNeverExpires ||
      userCannotChangePassword !== adCannotChangePassword,
    [
      passwordNeverExpires,
      user.passwordNeverExpires,
      userCannotChangePassword,
      adCannotChangePassword,
    ],
  );

  const canEdit = hasPermission("AccountOperator");

  const handleSave = useCallback(async () => {
    const changes: DryRunChange[] = [];

    if (passwordNeverExpires !== user.passwordNeverExpires) {
      changes.push({
        type: "modify",
        targetName: "Password Never Expires",
        description: `${user.passwordNeverExpires ? "Yes" : "No"} -> ${passwordNeverExpires ? "Yes" : "No"}`,
      });
    }

    if (userCannotChangePassword !== adCannotChangePassword) {
      changes.push({
        type: "modify",
        targetName: "User Cannot Change Password",
        description: `${adCannotChangePassword ? "Yes" : "No"} -> ${userCannotChangePassword ? "Yes" : "No"}`,
      });
    }

    if (changes.length === 0) return;

    const confirmed = await showDryRunPreview(changes);
    if (!confirmed) return;

    setSaving(true);
    try {
      await invoke("set_password_flags", {
        userDn: user.distinguishedName,
        passwordNeverExpires,
        userCannotChangePassword,
      });
      notify("Password flags updated successfully", "success");
      setRefreshCount((c) => c + 1);
      onRefresh();
    } catch (e) {
      notify(extractErrorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }, [
    passwordNeverExpires,
    userCannotChangePassword,
    adCannotChangePassword,
    user,
    showDryRunPreview,
    notify,
    onRefresh,
  ]);

  return (
    <div className="space-y-2" data-testid="password-flags-editor">
      <h4 className="text-caption font-semibold text-[var(--color-text-primary)]">
        {t("components:passwordFlags.title")}
      </h4>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={passwordNeverExpires}
          onChange={(e) => setPasswordNeverExpires(e.target.checked)}
          disabled={!canEdit}
          className="rounded border-[var(--color-border-default)]"
          data-testid="password-never-expires-checkbox"
        />
        <span className="text-body text-[var(--color-text-primary)]">
          {t("components:passwordFlags.neverExpires")}
        </span>
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={userCannotChangePassword}
          onChange={(e) => setUserCannotChangePassword(e.target.checked)}
          disabled={!canEdit || cannotChangePasswordUnavailable}
          className="rounded border-[var(--color-border-default)]"
          data-testid="user-cannot-change-password-checkbox"
        />
        <span className="text-body text-[var(--color-text-primary)]">
          {t("components:passwordFlags.cannotChange")}
        </span>
        {cannotChangePasswordUnavailable && (
          <span className="text-caption text-[var(--color-text-secondary)]">
            {t("components:passwordFlags.insufficientPermissions")}
          </span>
        )}
      </label>

      <button
        className="btn btn-sm btn-primary text-caption"
        onClick={handleSave}
        disabled={!canEdit || !isDirty || saving}
        title={!canEdit ? t("components:passwordFlags.requiresAccountOperator") : undefined}
        data-testid="save-flags-btn"
      >
        {saving ? t("common:saving") : t("components:passwordFlags.saveChanges")}
      </button>
    </div>
  );
}
