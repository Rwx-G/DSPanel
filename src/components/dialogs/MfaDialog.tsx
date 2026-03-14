import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DialogShell } from "@/components/dialogs/DialogShell";
import { ShieldCheck } from "lucide-react";

interface MfaDialogProps {
  onVerified: () => void;
  onCancel: () => void;
}

export function MfaDialog({ onVerified, onCancel }: MfaDialogProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleVerify = useCallback(async () => {
    if (code.length < 6) return;
    setLoading(true);
    setError(null);
    try {
      const valid = await invoke<boolean>("mfa_verify", { code });
      if (valid) {
        onVerified();
      } else {
        setError("Invalid code. Please try again.");
        setCode("");
        inputRef.current?.focus();
      }
    } catch (e) {
      setError(typeof e === "string" ? e : "Verification failed");
    } finally {
      setLoading(false);
    }
  }, [code, onVerified]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleVerify();
      } else if (e.key === "Escape") {
        onCancel();
      }
    },
    [handleVerify, onCancel],
  );

  return (
    <DialogShell
      onClose={onCancel}
      ariaLabel="MFA verification"
      dialogTestId="mfa-dialog"
      maxWidth="sm"
    >
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3">
        <ShieldCheck
          size={20}
          className="text-[var(--color-primary)]"
        />
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          MFA Verification Required
        </h2>
      </div>

      <div className="px-4 py-4 space-y-3">
        <p className="text-body text-[var(--color-text-secondary)]">
          Enter the 6-digit code from your authenticator app, or a backup code.
        </p>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          maxLength={8}
          value={code}
          onChange={(e) =>
            setCode(e.target.value.replace(/[^0-9]/g, ""))
          }
          onKeyDown={handleKeyDown}
          placeholder="000000"
          className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-2 text-center text-lg font-mono tracking-widest text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)] focus:ring-1 focus:ring-[var(--color-border-focus)]"
          data-testid="mfa-code-input"
          autoComplete="one-time-code"
        />
        {error && (
          <p
            className="text-caption text-[var(--color-error)] text-center"
            data-testid="mfa-error"
          >
            {error}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-4 py-3">
        <button
          className="btn-secondary"
          onClick={onCancel}
          data-testid="mfa-cancel"
        >
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={handleVerify}
          disabled={code.length < 6 || loading}
          data-testid="mfa-verify"
        >
          {loading ? "Verifying..." : "Verify"}
        </button>
      </div>
    </DialogShell>
  );
}
