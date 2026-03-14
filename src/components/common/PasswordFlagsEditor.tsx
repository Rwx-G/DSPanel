import { useState, useCallback, useMemo, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PermissionGate } from "@/components/common/PermissionGate";
import { useDialog } from "@/contexts/DialogContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { usePermissions } from "@/hooks/usePermissions";
import { type DirectoryUser } from "@/types/directory";
import { type DryRunChange } from "@/components/dialogs/DryRunPreviewDialog";

interface PasswordFlagsEditorProps {
  user: DirectoryUser;
  onRefresh: () => void;
}

export function PasswordFlagsEditor({
  user,
  onRefresh,
}: PasswordFlagsEditorProps) {
  const { hasPermission } = usePermissions();
  const { showDryRunPreview } = useDialog();
  const { notify } = useNotifications();

  const [passwordNeverExpires, setPasswordNeverExpires] = useState(
    user.passwordNeverExpires,
  );
  // userCannotChangePassword lives in the DACL, not a simple LDAP attribute.
  // The initial value is unknown (defaults to false) until a dedicated query
  // is implemented. Tracked as a known limitation.
  const initialCannotChange = false;
  const [userCannotChangePassword, setUserCannotChangePassword] = useState(initialCannotChange);
  const [saving, setSaving] = useState(false);

  // Reset local state when a different user is selected
  useEffect(() => {
    setPasswordNeverExpires(user.passwordNeverExpires);
    setUserCannotChangePassword(initialCannotChange);
  }, [user.distinguishedName, user.passwordNeverExpires]);

  const isDirty = useMemo(
    () =>
      passwordNeverExpires !== user.passwordNeverExpires ||
      userCannotChangePassword !== initialCannotChange,
    [passwordNeverExpires, user.passwordNeverExpires, userCannotChangePassword],
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

    if (userCannotChangePassword !== initialCannotChange) {
      changes.push({
        type: "modify",
        targetName: "User Cannot Change Password",
        description: `${initialCannotChange ? "Yes" : "No"} -> ${userCannotChangePassword ? "Yes" : "No"}`,
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
      onRefresh();
    } catch (e) {
      const msg = typeof e === "string" ? e : "Failed to update password flags";
      try {
        const parsed = JSON.parse(msg);
        notify(parsed.userMessage || parsed.message || msg, "error");
      } catch {
        notify(msg, "error");
      }
    } finally {
      setSaving(false);
    }
  }, [
    passwordNeverExpires,
    user,
    showDryRunPreview,
    notify,
    onRefresh,
  ]);

  return (
    <div
      className="space-y-2"
      data-testid="password-flags-editor"
    >
      <h4 className="text-caption font-semibold text-[var(--color-text-primary)]">
        Password Flags
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
          Password Never Expires
        </span>
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={userCannotChangePassword}
          onChange={(e) => setUserCannotChangePassword(e.target.checked)}
          disabled={!canEdit}
          className="rounded border-[var(--color-border-default)]"
          data-testid="user-cannot-change-password-checkbox"
        />
        <span className="text-body text-[var(--color-text-primary)]">
          User Cannot Change Password
        </span>
      </label>

      <PermissionGate requiredLevel="AccountOperator">
        <button
          className="btn btn-sm btn-primary text-caption"
          onClick={handleSave}
          disabled={!isDirty || saving}
          data-testid="save-flags-btn"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </PermissionGate>
    </div>
  );
}
