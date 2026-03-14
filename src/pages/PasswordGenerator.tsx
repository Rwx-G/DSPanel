import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CopyButton } from "@/components/common/CopyButton";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";

interface HibpResult {
  isBreached: boolean;
  breachCount: number;
  checked: boolean;
}

export function PasswordGenerator() {
  const [length, setLength] = useState(16);
  const [includeUppercase, setIncludeUppercase] = useState(true);
  const [includeLowercase, setIncludeLowercase] = useState(true);
  const [includeDigits, setIncludeDigits] = useState(true);
  const [includeSpecial, setIncludeSpecial] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);

  const [password, setPassword] = useState<string | null>(null);
  const [hibpResult, setHibpResult] = useState<HibpResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingHibp, setCheckingHibp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHibpResult(null);
    try {
      const result = await invoke<string>("generate_password", {
        length,
        includeUppercase,
        includeLowercase,
        includeDigits,
        includeSpecial,
        excludeAmbiguous,
      });
      setPassword(result);
    } catch (e) {
      setError(typeof e === "string" ? e : "Failed to generate password");
    } finally {
      setLoading(false);
    }
  }, [
    length,
    includeUppercase,
    includeLowercase,
    includeDigits,
    includeSpecial,
    excludeAmbiguous,
  ]);

  const handleCheckHibp = useCallback(async () => {
    if (!password) return;
    setCheckingHibp(true);
    try {
      const result = await invoke<HibpResult>("check_password_hibp", {
        password,
      });
      setHibpResult(result);
    } catch (e) {
      setHibpResult({ isBreached: false, breachCount: 0, checked: false });
    } finally {
      setCheckingHibp(false);
    }
  }, [password]);

  return (
    <div
      className="max-w-lg space-y-4 p-4"
      data-testid="password-generator-page"
    >
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
        Password Generator
      </h2>

      <div className="space-y-3 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
        <div className="flex items-center gap-3">
          <label className="text-body text-[var(--color-text-primary)] min-w-[80px]">
            Length
          </label>
          <input
            type="range"
            min={8}
            max={64}
            value={length}
            onChange={(e) => setLength(Number(e.target.value))}
            className="flex-1"
            data-testid="length-slider"
          />
          <span
            className="text-body font-mono text-[var(--color-text-primary)] w-8 text-right"
            data-testid="length-value"
          >
            {length}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <CheckboxOption
            label="Uppercase (A-Z)"
            checked={includeUppercase}
            onChange={setIncludeUppercase}
            testId="opt-uppercase"
          />
          <CheckboxOption
            label="Lowercase (a-z)"
            checked={includeLowercase}
            onChange={setIncludeLowercase}
            testId="opt-lowercase"
          />
          <CheckboxOption
            label="Digits (0-9)"
            checked={includeDigits}
            onChange={setIncludeDigits}
            testId="opt-digits"
          />
          <CheckboxOption
            label="Special (!@#...)"
            checked={includeSpecial}
            onChange={setIncludeSpecial}
            testId="opt-special"
          />
          <CheckboxOption
            label="Exclude ambiguous (0OlI1)"
            checked={excludeAmbiguous}
            onChange={setExcludeAmbiguous}
            testId="opt-ambiguous"
          />
        </div>

        <button
          className="btn-primary w-full"
          onClick={handleGenerate}
          disabled={loading}
          data-testid="generate-btn"
        >
          {loading ? <LoadingSpinner size={16} /> : "Generate Password"}
        </button>
      </div>

      {error && (
        <p
          className="text-caption text-[var(--color-error)]"
          data-testid="error-message"
        >
          {error}
        </p>
      )}

      {password && (
        <div
          className="space-y-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4"
          data-testid="password-result"
        >
          <div className="flex items-center gap-2">
            <code className="flex-1 text-lg font-mono text-[var(--color-text-primary)] select-all break-all">
              {password}
            </code>
            <CopyButton text={password} />
          </div>

          <div className="flex items-center gap-2">
            <button
              className="btn-secondary text-caption"
              onClick={handleCheckHibp}
              disabled={checkingHibp}
              data-testid="check-hibp-btn"
            >
              {checkingHibp ? (
                <LoadingSpinner size={16} />
              ) : (
                "Check HIBP"
              )}
            </button>
            {hibpResult && (
              <HibpStatusBadge result={hibpResult} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CheckboxOption({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-[var(--color-border-default)]"
        data-testid={testId}
      />
      <span className="text-caption text-[var(--color-text-primary)]">
        {label}
      </span>
    </label>
  );
}

function HibpStatusBadge({ result }: { result: HibpResult }) {
  if (!result.checked) {
    return (
      <span
        className="inline-flex items-center rounded-full bg-[var(--color-surface-hover)] px-2 py-0.5 text-caption text-[var(--color-warning)]"
        data-testid="hibp-unchecked"
      >
        HIBP check unavailable
      </span>
    );
  }
  if (result.isBreached) {
    return (
      <span
        className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-caption text-[var(--color-error)]"
        data-testid="hibp-breached"
      >
        Found in {result.breachCount.toLocaleString()} breaches
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-caption text-[var(--color-success)]"
      data-testid="hibp-clean"
    >
      Not found in any breach
    </span>
  );
}
