import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDialog } from "@/contexts/DialogContext";
import { MfaDialog } from "@/components/dialogs/MfaDialog";

/**
 * Hook that checks whether an action requires MFA and shows the verification
 * dialog if needed. Returns a function that resolves to true if the action
 * is allowed to proceed (MFA not required, or MFA verified successfully).
 */
export function useMfaGate() {
  const { showCustomDialog } = useDialog();

  const checkMfa = useCallback(
    async (actionName: string): Promise<boolean> => {
      try {
        const isConfigured = await invoke<boolean>("mfa_is_configured");
        if (!isConfigured) return true;

        const required = await invoke<boolean>("mfa_requires", {
          action: actionName,
        });
        if (!required) return true;

        const result = await showCustomDialog<boolean>((resolve) => (
          <MfaDialog
            onVerified={() => resolve(true)}
            onCancel={() => resolve(false)}
          />
        ));

        return result === true;
      } catch {
        return true;
      }
    },
    [showCustomDialog],
  );

  return { checkMfa };
}
