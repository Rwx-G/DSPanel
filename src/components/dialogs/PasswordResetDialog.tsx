import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DialogShell } from "@/components/dialogs/DialogShell";
import { PasswordInput } from "@/components/form/PasswordInput";
import { CopyButton } from "@/components/common/CopyButton";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { useMfaGate } from "@/hooks/useMfaGate";
import { useTranslation } from "react-i18next";

interface HibpResult {
  isBreached: boolean;
  breachCount: number;
  checked: boolean;
}

interface PasswordResetDialogProps {
  userDn: string;
  displayName: string;
  onClose: () => void;
  onSuccess: () => void;
}

type ResetMode = "manual" | "generate";

interface PasswordValidation {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasDigit: boolean;
  hasSpecial: boolean;
}

function validatePassword(password: string): PasswordValidation {
  return {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasDigit: /[0-9]/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password),
  };
}

function isPasswordValid(validation: PasswordValidation): boolean {
  const categories = [
    validation.hasUppercase,
    validation.hasLowercase,
    validation.hasDigit,
    validation.hasSpecial,
  ].filter(Boolean).length;
  return validation.minLength && categories >= 3;
}

export function PasswordResetDialog({
  userDn,
  displayName,
  onClose,
  onSuccess,
}: PasswordResetDialogProps) {
  const { t } = useTranslation(["dialogs", "common"]);
  const [mode, setMode] = useState<ResetMode>("generate");
  const [manualPassword, setManualPassword] = useState("");
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(
    null,
  );
  const [mustChangeAtNextLogon, setMustChangeAtNextLogon] = useState(true);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultPassword, setResultPassword] = useState<string | null>(null);
  const [hibpResult, setHibpResult] = useState<HibpResult | null>(null);
  const { checkMfa } = useMfaGate();

  const validation = validatePassword(manualPassword);
  const manualValid = isPasswordValid(validation);

  const activePassword = mode === "manual" ? manualPassword : generatedPassword;
  const canReset = mode === "manual" ? manualValid : generatedPassword !== null;

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setHibpResult(null);
    try {
      const password = await invoke<string>("generate_password", {
        length: 20,
        includeUppercase: true,
        includeLowercase: true,
        includeDigits: true,
        includeSpecial: true,
        excludeAmbiguous: true,
      });
      setGeneratedPassword(password);
      // Auto-check HIBP after generation
      try {
        const hibp = await invoke<HibpResult>("check_password_hibp", {
          password,
        });
        setHibpResult(hibp);
      } catch {
        setHibpResult({ isBreached: false, breachCount: 0, checked: false });
      }
    } catch (e) {
      setError(typeof e === "string" ? e : "Failed to generate password");
    } finally {
      setGenerating(false);
    }
  }, []);

  const handleReset = useCallback(async () => {
    if (!activePassword) return;

    const mfaAllowed = await checkMfa("PasswordReset");
    if (!mfaAllowed) return;

    setLoading(true);
    setError(null);
    try {
      await invoke("reset_password", {
        userDn,
        newPassword: activePassword,
        mustChangeAtNextLogon,
      });
      setResultPassword(activePassword);
      onSuccess();
    } catch (e) {
      const msg = typeof e === "string" ? e : "Password reset failed";
      try {
        const parsed = JSON.parse(msg);
        setError(parsed.userMessage || parsed.message || msg);
      } catch {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [activePassword, userDn, mustChangeAtNextLogon, onSuccess, checkMfa]);

  if (resultPassword) {
    return (
      <DialogShell
        onClose={onClose}
        ariaLabel="Password reset result"
        dialogTestId="password-reset-result"
      >
        <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
          <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
            {t("dialogs:passwordReset.successTitle")}
          </h2>
        </div>
        <div className="px-4 py-3 space-y-3">
          <p className="text-body text-[var(--color-text-primary)]">
            {t("dialogs:passwordReset.successMessage", { name: displayName })}
          </p>
          <div className="flex items-center gap-2 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] px-3 py-2">
            <code
              className="flex-1 text-body font-mono text-[var(--color-text-primary)] select-all"
              data-testid="result-password"
            >
              {resultPassword}
            </code>
            <CopyButton text={resultPassword} />
          </div>
          {mustChangeAtNextLogon && (
            <p className="text-caption text-[var(--color-text-secondary)]">
              {t("dialogs:passwordReset.mustChangeAtLogon")}
            </p>
          )}
        </div>
        <div className="flex justify-end px-4 py-3 border-t border-[var(--color-border-subtle)]">
          <button
            className="btn btn-primary"
            onClick={onClose}
            data-testid="close-result"
          >
            {t("common:close")}
          </button>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell
      onClose={onClose}
      ariaLabel="Reset password"
      dialogTestId="password-reset-dialog"
    >
      <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          {t("dialogs:passwordReset.title")}
        </h2>
        <p className="text-caption text-[var(--color-text-secondary)]">
          {displayName}
        </p>
      </div>

      <div className="px-4 py-3 space-y-4">
        <div className="flex gap-2">
          <button
            className={`px-3 py-1 rounded-md text-caption font-medium transition-colors ${
              mode === "generate"
                ? "bg-[var(--color-primary)] text-white"
                : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
            }`}
            onClick={() => setMode("generate")}
            data-testid="mode-generate"
          >
            {t("dialogs:passwordReset.autoGenerate")}
          </button>
          <button
            className={`px-3 py-1 rounded-md text-caption font-medium transition-colors ${
              mode === "manual"
                ? "bg-[var(--color-primary)] text-white"
                : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
            }`}
            onClick={() => setMode("manual")}
            data-testid="mode-manual"
          >
            {t("dialogs:passwordReset.manualEntry")}
          </button>
        </div>

        {mode === "manual" ? (
          <div className="space-y-2">
            <PasswordInput
              value={manualPassword}
              onChange={(e) => setManualPassword(e.target.value)}
              placeholder={t("dialogs:passwordReset.enterNewPassword")}
              error={manualPassword.length > 0 && !manualValid}
              data-testid="manual-password-input"
            />
            {manualPassword.length > 0 && (
              <ul
                className="text-caption space-y-0.5"
                data-testid="password-validation"
              >
                <ValidationItem
                  label={t("dialogs:passwordReset.atLeast8Chars")}
                  valid={validation.minLength}
                />
                <ValidationItem
                  label={t("dialogs:passwordReset.uppercaseLetter")}
                  valid={validation.hasUppercase}
                />
                <ValidationItem
                  label={t("dialogs:passwordReset.lowercaseLetter")}
                  valid={validation.hasLowercase}
                />
                <ValidationItem label={t("dialogs:passwordReset.digit")} valid={validation.hasDigit} />
                <ValidationItem
                  label={t("dialogs:passwordReset.specialCharacter")}
                  valid={validation.hasSpecial}
                />
                <li
                  className={
                    isPasswordValid(validation)
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-text-secondary)]"
                  }
                >
                  {isPasswordValid(validation)
                    ? t("dialogs:passwordReset.meetsComplexity")
                    : t("dialogs:passwordReset.needsCategories")}
                </li>
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                className="btn btn-secondary"
                onClick={handleGenerate}
                disabled={generating}
                data-testid="generate-btn"
              >
                {generating ? (
                  <LoadingSpinner size={16} />
                ) : (
                  t("dialogs:passwordReset.generatePassword")
                )}
              </button>
            </div>
            {generatedPassword && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] px-3 py-2">
                  <code
                    className="flex-1 text-body font-mono text-[var(--color-text-primary)] select-all"
                    data-testid="generated-password"
                  >
                    {generatedPassword}
                  </code>
                  <CopyButton text={generatedPassword} />
                </div>
                {hibpResult && (
                  <div data-testid="hibp-status">
                    {!hibpResult.checked ? (
                      <span className="text-caption text-[var(--color-warning)]">
                        {t("dialogs:passwordReset.breachUnavailable")}
                      </span>
                    ) : hibpResult.isBreached ? (
                      <span className="text-caption text-[var(--color-error)]">
                        {t("dialogs:passwordReset.foundInBreaches", { count: hibpResult.breachCount })}
                      </span>
                    ) : (
                      <span className="text-caption text-[var(--color-success)]">
                        {t("dialogs:passwordReset.notInBreaches")}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={mustChangeAtNextLogon}
            onChange={(e) => setMustChangeAtNextLogon(e.target.checked)}
            className="rounded border-[var(--color-border-default)]"
            data-testid="must-change-checkbox"
          />
          <span className="text-body text-[var(--color-text-primary)]">
            {t("dialogs:passwordReset.mustChangeCheckbox")}
          </span>
        </label>

        {error && (
          <p
            className="text-caption text-[var(--color-error)]"
            data-testid="error-message"
          >
            {error}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-border-subtle)]">
        <button
          className="btn btn-secondary"
          onClick={onClose}
          data-testid="cancel-btn"
        >
          {t("common:cancel")}
        </button>
        <button
          className="btn btn-primary"
          onClick={handleReset}
          disabled={!canReset || loading}
          data-testid="reset-btn"
        >
          {loading ? <LoadingSpinner size={16} /> : t("dialogs:passwordReset.resetButton")}
        </button>
      </div>
    </DialogShell>
  );
}

function ValidationItem({ label, valid }: { label: string; valid: boolean }) {
  return (
    <li
      className={
        valid
          ? "text-[var(--color-success)]"
          : "text-[var(--color-text-secondary)]"
      }
    >
      {valid ? "\u2713" : "\u2717"} {label}
    </li>
  );
}
