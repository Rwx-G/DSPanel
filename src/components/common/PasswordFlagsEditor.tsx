import { useState, useCallback, useMemo } from "react";
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
  // User Cannot Change Password is read-only (DACL modification not yet implemented)
  const userCannotChangePassword = false;

  const [saving, setSaving] = useState(false);

  const isDirty = useMemo(
    () => passwordNeverExpires !== user.passwordNeverExpires,
    [passwordNeverExpires, user.passwordNeverExpires],
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

    if (changes.length === 0) return;

    const confirmed = await showDryRunPreview(changes);
    if (!confirmed) return;

    setSaving(true);
    try {
      await invoke("set_password_flags", {
        userDn: user.distinguishedName,
        passwordNeverExpires,
        userCannotChangePassword: false,
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

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={userCannotChangePassword}
          disabled
          className="rounded border-[var(--color-border-default)] opacity-50"
          data-testid="user-cannot-change-password-checkbox"
        />
        <span className="text-body text-[var(--color-text-secondary)]">
          User Cannot Change Password
        </span>
        <span className="text-caption text-[var(--color-text-secondary)] italic">
          (requires DACL - not yet supported)
        </span>
      </label>

      <PermissionGate requiredLevel="AccountOperator">
        {isDirty && (
          <button
            className="btn-primary text-caption"
            onClick={handleSave}
            disabled={saving}
            data-testid="save-flags-btn"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        )}
      </PermissionGate>
    </div>
  );
}
