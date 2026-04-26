import { AcknowledgeQuickFixDialog } from "@/components/dialogs/AcknowledgeQuickFixDialog";

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
 *
 * Implementation delegates to AcknowledgeQuickFixDialog so the schema and
 * presentation stay aligned with Story 14.6's matching dialog.
 */
export function ClearPasswordNotRequiredDialog({
  userDn,
  displayName,
  onClose,
  onSuccess,
}: ClearPasswordNotRequiredDialogProps) {
  return (
    <AcknowledgeQuickFixDialog
      tBaseKey="userDetail:quickFix.clearPasswordNotRequired"
      tNamespaces={["userDetail", "common"]}
      subjectName={displayName}
      invokeCommand="clear_password_not_required"
      invokeArgs={{ userDn }}
      mfaActionName="ClearPasswordNotRequired"
      dialogTestId="clear-password-not-required-dialog"
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}
