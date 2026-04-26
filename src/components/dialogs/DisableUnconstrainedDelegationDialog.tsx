import { AcknowledgeQuickFixDialog } from "@/components/dialogs/AcknowledgeQuickFixDialog";

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
 *
 * Implementation delegates to AcknowledgeQuickFixDialog so the schema and
 * presentation stay aligned with Story 14.4's matching dialog. The body
 * is long enough to warrant the scrollable variant.
 */
export function DisableUnconstrainedDelegationDialog({
  computerDn,
  computerName,
  onClose,
  onSuccess,
}: DisableUnconstrainedDelegationDialogProps) {
  return (
    <AcknowledgeQuickFixDialog
      tBaseKey="computerDetail:quickFix.disableUnconstrainedDelegation"
      tNamespaces={["computerDetail", "common"]}
      subjectName={computerName}
      invokeCommand="disable_unconstrained_delegation"
      invokeArgs={{ computerDn }}
      mfaActionName="DisableUnconstrainedDelegation"
      dialogTestId="disable-unconstrained-delegation-dialog"
      maxWidth="lg"
      scrollableBody
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}
