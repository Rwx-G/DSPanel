import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DialogShell } from "@/components/dialogs/DialogShell";
import { CopyButton } from "@/components/common/CopyButton";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { ShieldCheck } from "lucide-react";

interface MfaSetupResult {
  secretBase32: string;
  qrUri: string;
  backupCodes: string[];
}

interface MfaSetupDialogProps {
  onComplete: () => void;
  onCancel: () => void;
}

type SetupStep = "init" | "verify" | "backup";

export function MfaSetupDialog({ onComplete, onCancel }: MfaSetupDialogProps) {
  const [step, setStep] = useState<SetupStep>("init");
  const [setupResult, setSetupResult] = useState<MfaSetupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSetup = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<MfaSetupResult>("mfa_setup");
      setSetupResult(result);
      setStep("verify");
    } catch (e) {
      setError(typeof e === "string" ? e : "Failed to set up MFA");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleVerify = useCallback(async () => {
    if (verifyCode.length < 6) return;
    setVerifyError(null);
    try {
      const valid = await invoke<boolean>("mfa_verify", { code: verifyCode });
      if (valid) {
        setStep("backup");
      } else {
        setVerifyError(
          "Invalid code. Please check your authenticator app and try again.",
        );
        setVerifyCode("");
      }
    } catch (e) {
      setVerifyError(typeof e === "string" ? e : "Verification failed");
    }
  }, [verifyCode]);

  if (step === "init") {
    return (
      <DialogShell
        onClose={onCancel}
        ariaLabel="MFA Setup"
        dialogTestId="mfa-setup-dialog"
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3">
          <ShieldCheck size={20} className="text-[var(--color-primary)]" />
          <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
            Set Up MFA
          </h2>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-body text-[var(--color-text-secondary)]">
            Add an extra layer of security by enabling TOTP-based multi-factor
            authentication. You will need an authenticator app (Google
            Authenticator, Authy, etc.).
          </p>
          {error && (
            <p
              className="text-caption text-[var(--color-error)]"
              data-testid="setup-error"
            >
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-4 py-3">
          <button
            className="btn btn-secondary"
            onClick={onCancel}
            data-testid="setup-cancel"
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSetup}
            disabled={loading}
            data-testid="setup-begin"
          >
            {loading ? <LoadingSpinner size={16} /> : "Begin Setup"}
          </button>
        </div>
      </DialogShell>
    );
  }

  if (step === "verify" && setupResult) {
    return (
      <DialogShell
        onClose={onCancel}
        ariaLabel="MFA Verify Setup"
        dialogTestId="mfa-setup-verify"
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3">
          <ShieldCheck size={20} className="text-[var(--color-primary)]" />
          <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
            Step 1: Scan QR Code
          </h2>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-body text-[var(--color-text-secondary)]">
            Scan this QR code with your authenticator app, or enter the secret
            manually:
          </p>
          <div
            className="flex justify-center p-2 bg-white rounded-lg"
            data-testid="qr-container"
          >
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setupResult.qrUri)}`}
              alt="MFA QR Code"
              width={200}
              height={200}
              data-testid="qr-image"
            />
          </div>
          <div className="flex items-center gap-2 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] px-3 py-2">
            <code
              className="flex-1 text-caption font-mono break-all"
              data-testid="secret-display"
            >
              {setupResult.secretBase32}
            </code>
            <CopyButton text={setupResult.secretBase32} />
          </div>
          <p className="text-body text-[var(--color-text-secondary)]">
            Enter the 6-digit code from your authenticator app to verify:
          </p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={verifyCode}
            onChange={(e) =>
              setVerifyCode(e.target.value.replace(/[^0-9]/g, ""))
            }
            placeholder="000000"
            className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-2 text-center text-lg font-mono tracking-widest text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)] focus:ring-1 focus:ring-[var(--color-border-focus)]"
            data-testid="verify-code-input"
          />
          {verifyError && (
            <p
              className="text-caption text-[var(--color-error)] text-center"
              data-testid="verify-error"
            >
              {verifyError}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-4 py-3">
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleVerify}
            disabled={verifyCode.length < 6}
            data-testid="verify-btn"
          >
            Verify
          </button>
        </div>
      </DialogShell>
    );
  }

  if (step === "backup" && setupResult) {
    return (
      <DialogShell
        onClose={onComplete}
        ariaLabel="MFA Backup Codes"
        dialogTestId="mfa-setup-backup"
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3">
          <ShieldCheck size={20} className="text-[var(--color-success)]" />
          <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
            Step 2: Save Backup Codes
          </h2>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-body text-[var(--color-text-primary)]">
            MFA has been set up successfully! Save these backup codes in a safe
            place. Each code can only be used once.
          </p>
          <div
            className="grid grid-cols-2 gap-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] p-3"
            data-testid="backup-codes"
          >
            {setupResult.backupCodes.map((code, i) => (
              <code
                key={i}
                className="text-body font-mono text-center text-[var(--color-text-primary)]"
              >
                {code}
              </code>
            ))}
          </div>
          <CopyButton text={setupResult.backupCodes.join("\n")} />
        </div>
        <div className="flex justify-end border-t border-[var(--color-border-subtle)] px-4 py-3">
          <button
            className="btn btn-primary"
            onClick={onComplete}
            data-testid="setup-complete"
          >
            Done
          </button>
        </div>
      </DialogShell>
    );
  }

  return null;
}
