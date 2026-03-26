import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CopyButton } from "@/components/common/CopyButton";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import {
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  RefreshCw,
  Info,
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface HibpResult {
  isBreached: boolean;
  breachCount: number;
  checked: boolean;
}

export function PasswordGenerator() {
  const { t } = useTranslation(["passwordGenerator", "common"]);
  const [length, setLength] = useState(20);
  const [includeUppercase, setIncludeUppercase] = useState(true);
  const [includeLowercase, setIncludeLowercase] = useState(true);
  const [includeDigits, setIncludeDigits] = useState(true);
  const [includeSpecial, setIncludeSpecial] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);

  const [password, setPassword] = useState("");
  const [hibpResult, setHibpResult] = useState<HibpResult | null>(null);
  const [checkingHibp, setCheckingHibp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
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
    }
  }, [
    length,
    includeUppercase,
    includeLowercase,
    includeDigits,
    includeSpecial,
    excludeAmbiguous,
  ]);

  // Generate on mount and whenever options change
  useEffect(() => {
    generate();
  }, [generate]);

  const handleCheckHibp = useCallback(async () => {
    if (!password) return;
    setCheckingHibp(true);
    try {
      const result = await invoke<HibpResult>("check_password_hibp", {
        password,
      });
      setHibpResult(result);
    } catch {
      setHibpResult({ isBreached: false, breachCount: 0, checked: false });
    } finally {
      setCheckingHibp(false);
    }
  }, [password]);

  const strengthLabel = getStrengthLabel(length, t);

  return (
    <div
      className="h-full overflow-y-auto"
      data-testid="password-generator-page"
    >
      <div className="mx-auto w-full max-w-xl px-6 py-8 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-subtle)]">
            <KeyRound size={20} className="text-[var(--color-primary)]" />
          </div>
          <div>
            <h2 className="text-h3 text-[var(--color-text-primary)]">
              {t("pageTitle")}
            </h2>
            <p className="text-caption text-[var(--color-text-secondary)]">
              {t("pageDescription")}
            </p>
          </div>
        </div>

        {/* Password display - always visible, fixed layout */}
        <div
          className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4 space-y-3"
          data-testid="password-result"
        >
          <div className="flex items-start gap-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] px-4 py-3 min-h-[76px]">
            {password ? (
              <code className="flex-1 text-lg font-mono text-[var(--color-text-primary)] select-all break-all tracking-wide leading-relaxed">
                {password}
              </code>
            ) : (
              <span className="flex-1 text-body text-[var(--color-text-disabled)] italic">
                {t("generating")}
              </span>
            )}
            {password && <CopyButton text={password} />}
          </div>

          <div className="flex items-center gap-2">
            <button
              className="btn btn-primary btn-sm"
              onClick={generate}
              data-testid="generate-btn"
            >
              <RefreshCw size={14} />
              {t("regenerate")}
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={handleCheckHibp}
              disabled={checkingHibp || !password}
              data-testid="check-hibp-btn"
            >
              {checkingHibp ? (
                <LoadingSpinner size={14} />
              ) : (
                <>
                  <ShieldCheck size={14} />
                  {t("checkBreachDb")}
                </>
              )}
            </button>
            <HibpInfoTooltip />
          </div>

          {/* HIBP result - fixed height slot to prevent layout shift */}
          <div
            className="min-h-[28px] flex items-center"
            data-testid="hibp-result-slot"
          >
            {hibpResult ? (
              <HibpStatusBadge result={hibpResult} />
            ) : (
              <span className="text-caption text-[var(--color-text-disabled)]">
                {t("clickToCheck")}
              </span>
            )}
          </div>

          {error && (
            <p
              className="text-caption text-[var(--color-error)]"
              data-testid="error-message"
            >
              {error}
            </p>
          )}
        </div>

        {/* Options card */}
        <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-5 space-y-4">
          {/* Length slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-body font-medium text-[var(--color-text-primary)]">
                {t("length")}
              </label>
              <div className="flex items-center gap-2">
                <span
                  className="text-body font-mono font-semibold text-[var(--color-primary)] tabular-nums"
                  data-testid="length-value"
                >
                  {length}
                </span>
                <span
                  className={`text-caption px-1.5 py-0.5 rounded-full ${strengthLabel.class}`}
                >
                  {strengthLabel.text}
                </span>
              </div>
            </div>
            <input
              type="range"
              min={8}
              max={64}
              value={length}
              onChange={(e) => setLength(Number(e.target.value))}
              className="w-full accent-[var(--color-primary)]"
              data-testid="length-slider"
            />
            <div className="flex justify-between text-caption text-[var(--color-text-secondary)]">
              <span>8</span>
              <span>64</span>
            </div>
          </div>

          {/* Character options */}
          <div className="space-y-1.5">
            <p className="text-caption font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
              {t("characterSets")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <CheckboxOption
                label={t("uppercase")}
                checked={includeUppercase}
                onChange={setIncludeUppercase}
                testId="opt-uppercase"
              />
              <CheckboxOption
                label={t("lowercase")}
                checked={includeLowercase}
                onChange={setIncludeLowercase}
                testId="opt-lowercase"
              />
              <CheckboxOption
                label={t("digits")}
                checked={includeDigits}
                onChange={setIncludeDigits}
                testId="opt-digits"
              />
              <CheckboxOption
                label={t("special")}
                checked={includeSpecial}
                onChange={setIncludeSpecial}
                testId="opt-special"
              />
            </div>
            <CheckboxOption
              label={t("excludeAmbiguous")}
              checked={excludeAmbiguous}
              onChange={setExcludeAmbiguous}
              testId="opt-ambiguous"
            />
          </div>
        </div>

        {/* Best practices card */}
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-bg)] p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Info size={16} className="text-[var(--color-info)] shrink-0" />
            <p className="text-caption font-semibold text-[var(--color-text-primary)]">
              {t("bestPracticesTitle")}
            </p>
          </div>
          <ul className="text-caption text-[var(--color-text-secondary)] space-y-1 ml-6 list-disc">
            <li>
              Use at least <strong>20 characters</strong> for administrative
              accounts (16 minimum for standard users)
            </li>
            <li>
              Include <strong>3+ character categories</strong> (uppercase,
              lowercase, digits, special)
            </li>
            <li>Never reuse passwords across different accounts or services</li>
            <li>
              Use the <strong>breach check</strong> to verify the password has
              not appeared in known data breaches (HIBP k-anonymity - your
              password never leaves your machine)
            </li>
            <li>
              Enable <strong>"Must change at next logon"</strong> when resetting
              passwords for other users
            </li>
            <li>
              Avoid dictionary words, personal info, or common patterns (abc123,
              qwerty)
            </li>
            <li>
              Consider using a password manager for storing generated passwords
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function getStrengthLabel(length: number, t: (key: string) => string): { text: string; class: string } {
  if (length >= 24)
    return {
      text: t("excellent"),
      class: "bg-[var(--color-success-bg)] text-[var(--color-success)]",
    };
  if (length >= 20)
    return { text: t("strong"), class: "bg-[var(--color-info-bg)] text-[var(--color-info)]" };
  if (length >= 16)
    return { text: t("good"), class: "bg-[var(--color-success-bg)] text-[var(--color-success)]" };
  if (length >= 12)
    return { text: t("fair"), class: "bg-[var(--color-warning-bg)] text-[var(--color-warning)]" };
  return { text: t("weak"), class: "bg-[var(--color-error-bg)] text-[var(--color-error)]" };
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
    <label className="flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--color-surface-hover)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="checkbox"
        data-testid={testId}
      />
      <span className="text-body text-[var(--color-text-primary)]">
        {label}
      </span>
    </label>
  );
}

function HibpInfoTooltip() {
  const { t } = useTranslation(["passwordGenerator"]);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative" data-testid="hibp-info">
      <button
        className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
        onClick={() => setOpen(!open)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-label="About breach database"
        data-testid="hibp-info-btn"
      >
        <Info size={14} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3 shadow-lg"
          data-testid="hibp-info-popup"
        >
          <p className="text-caption font-semibold text-[var(--color-text-primary)] mb-1">
            {t("hibpTitle")}
          </p>
          <p className="text-caption text-[var(--color-text-secondary)] mb-2">
            Breach data is provided by <strong>haveibeenpwned.com</strong>, a
            free service created by Troy Hunt that aggregates data from publicly
            disclosed security breaches.
          </p>
          <p className="text-caption text-[var(--color-text-secondary)] mb-2">
            The database contains over <strong>14 billion</strong> compromised
            credentials from thousands of data breaches worldwide.
          </p>
          <div className="rounded-md bg-[var(--color-surface-bg)] p-2">
            <p className="text-caption text-[var(--color-success)] font-medium">
              Privacy: k-anonymity protocol
            </p>
            <p className="text-caption text-[var(--color-text-secondary)]">
              Only the first 5 characters of the password's SHA-1 hash are sent
              to the API. Your full password never leaves your machine.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function HibpStatusBadge({ result }: { result: HibpResult }) {
  const { t } = useTranslation(["passwordGenerator"]);
  if (!result.checked) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-hover)] px-3 py-1 text-caption text-[var(--color-warning)]"
        data-testid="hibp-unchecked"
      >
        <ShieldQuestion size={14} />
        {t("breachUnavailable")}
      </span>
    );
  }
  if (result.isBreached) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-error-bg)] px-3 py-1 text-caption font-medium text-[var(--color-error)]"
        data-testid="hibp-breached"
      >
        <ShieldAlert size={14} />
        {t("foundInBreaches", { count: result.breachCount })}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-caption font-medium text-[var(--color-success)]"
      data-testid="hibp-clean"
    >
      <ShieldCheck size={14} />
      {t("notFoundInBreaches")}
    </span>
  );
}
