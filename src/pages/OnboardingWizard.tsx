import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  UserPlus,
  ChevronRight,
  ChevronLeft,
  Copy,
  Check,
  AlertTriangle,
} from "lucide-react";
import { usePresets } from "@/hooks/usePresets";
import { useErrorHandler } from "@/hooks/useErrorHandler";
import { useDialog } from "@/contexts/DialogContext";
import { PermissionGate } from "@/components/common/PermissionGate";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import type { Preset } from "@/types/preset";

type WizardStep = "details" | "preset" | "preview" | "execute";

const STEPS: { id: WizardStep; label: string }[] = [
  { id: "details", label: "User Details" },
  { id: "preset", label: "Preset Selection" },
  { id: "preview", label: "Preview" },
  { id: "execute", label: "Execute" },
];

function generateLogin(firstName: string, lastName: string): string {
  if (!firstName.trim() || !lastName.trim()) return "";
  return (
    firstName.trim().charAt(0).toLowerCase() +
    lastName.trim().toLowerCase().replace(/\s+/g, "")
  );
}

function generatePassword(): string {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*";
  let pw = "";
  const arr = new Uint8Array(20);
  crypto.getRandomValues(arr);
  for (const byte of arr) {
    pw += chars[byte % chars.length];
  }
  return pw;
}

interface UserDetails {
  firstName: string;
  lastName: string;
  displayName: string;
  login: string;
  password: string;
}

interface ExecutionResult {
  success: boolean;
  userDn: string | null;
  error: string | null;
  login: string;
  password: string;
  targetOu: string;
  groups: string[];
}

function OnboardingContent() {
  const { presets } = usePresets();
  const { handleError } = useErrorHandler();
  const { showConfirmation } = useDialog();
  const [step, setStep] = useState<WizardStep>("details");
  const [details, setDetails] = useState<UserDetails>({
    firstName: "",
    lastName: "",
    displayName: "",
    login: "",
    password: generatePassword(),
  });
  const [loginManual, setLoginManual] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const onboardingPresets = useMemo(
    () => presets.filter((p) => p.type === "Onboarding"),
    [presets],
  );

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const autoLogin = useMemo(
    () => generateLogin(details.firstName, details.lastName),
    [details.firstName, details.lastName],
  );

  const autoDisplayName = useMemo(() => {
    if (!details.firstName.trim() || !details.lastName.trim()) return "";
    return `${details.firstName.trim()} ${details.lastName.trim()}`;
  }, [details.firstName, details.lastName]);

  const currentLogin = loginManual ? details.login : autoLogin;
  const currentDisplayName = details.displayName || autoDisplayName;

  const canGoNext = useCallback((): boolean => {
    switch (step) {
      case "details":
        return !!(
          details.firstName.trim() &&
          details.lastName.trim() &&
          currentLogin &&
          details.password
        );
      case "preset":
        return selectedPreset !== null;
      case "preview":
        return true;
      default:
        return false;
    }
  }, [step, details, currentLogin, selectedPreset]);

  const handleNext = useCallback(() => {
    const idx = STEPS.findIndex((s) => s.id === step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].id);
  }, [step]);

  const handleBack = useCallback(() => {
    const idx = STEPS.findIndex((s) => s.id === step);
    if (idx > 0) setStep(STEPS[idx - 1].id);
  }, [step]);

  const handleExecute = useCallback(async () => {
    if (!selectedPreset) return;
    setExecuting(true);

    try {
      const attrs: Record<string, string[]> = {
        displayName: [currentDisplayName],
        givenName: [details.firstName.trim()],
        sn: [details.lastName.trim()],
      };
      for (const [k, v] of Object.entries(selectedPreset.attributes)) {
        attrs[k] = [v];
      }

      const userDn = await invoke<string>("create_user", {
        cn: currentDisplayName,
        containerDn: selectedPreset.targetOu,
        samAccountName: currentLogin,
        password: details.password,
        attributes: attrs,
      });

      // Add to groups - track failures for rollback
      const groupErrors: string[] = [];
      for (const groupDn of selectedPreset.groups) {
        try {
          await invoke("add_user_to_group", {
            userDn,
            groupDn,
          });
        } catch (err) {
          groupErrors.push(groupDn);
          handleError(err, `adding to group ${groupDn}`);
        }
      }

      // If some group additions failed, offer rollback
      if (groupErrors.length > 0) {
        const rollback = await showConfirmation(
          "Partial Failure",
          `User was created but ${groupErrors.length} group(s) could not be added. Delete the partially created user?`,
          `Failed groups:\n${groupErrors.join("\n")}`,
        );
        if (rollback) {
          try {
            await invoke("delete_group", { groupDn: userDn });
            setResult({
              success: false,
              userDn: null,
              error: `User deleted after partial failure (${groupErrors.length} group(s) could not be added).`,
              login: currentLogin,
              password: details.password,
              targetOu: selectedPreset.targetOu,
              groups: selectedPreset.groups,
            });
          } catch (delErr) {
            handleError(delErr, "deleting partially created user");
            setResult({
              success: false,
              userDn,
              error: `User created but ${groupErrors.length} group(s) failed. Rollback also failed - please delete ${userDn} manually.`,
              login: currentLogin,
              password: details.password,
              targetOu: selectedPreset.targetOu,
              groups: selectedPreset.groups,
            });
          }
          setStep("execute");
          return;
        }
        // User chose to keep the partially created account
      }

      setResult({
        success: true,
        userDn,
        error: null,
        login: currentLogin,
        password: details.password,
        targetOu: selectedPreset.targetOu,
        groups: selectedPreset.groups,
      });
      setStep("execute");
    } catch (err) {
      handleError(err, "creating user");
      setResult({
        success: false,
        userDn: null,
        error: String(err),
        login: currentLogin,
        password: details.password,
        targetOu: selectedPreset.targetOu,
        groups: selectedPreset.groups,
      });
      setStep("execute");
    } finally {
      setExecuting(false);
    }
  }, [selectedPreset, currentLogin, currentDisplayName, details, handleError, showConfirmation]);

  const handleCopy = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(label);
        setTimeout(() => setCopied(null), 2000);
      } catch (err) {
        handleError(err, "copying to clipboard");
      }
    },
    [handleError],
  );

  const handleReset = useCallback(() => {
    setStep("details");
    setDetails({
      firstName: "",
      lastName: "",
      displayName: "",
      login: "",
      password: generatePassword(),
    });
    setLoginManual(false);
    setSelectedPreset(null);
    setResult(null);
  }, []);

  return (
    <div className="flex h-full flex-col p-4" data-testid="onboarding-wizard">
      {/* Step indicator */}
      <div className="mb-4 flex items-center gap-2" data-testid="step-indicator">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-caption font-semibold ${
                i <= stepIndex
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
              }`}
            >
              {i + 1}
            </div>
            <span
              className={`text-caption ${
                i === stepIndex
                  ? "font-semibold text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-secondary)]"
              }`}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <ChevronRight
                size={14}
                className="text-[var(--color-text-secondary)]"
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-auto rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-primary)] p-4">
        {/* Step 1: User Details */}
        {step === "details" && (
          <div className="mx-auto max-w-lg space-y-4" data-testid="step-details">
            <div>
              <label className="mb-1 block text-caption font-semibold text-[var(--color-text-secondary)]">
                First Name *
              </label>
              <input
                type="text"
                value={details.firstName}
                onChange={(e) =>
                  setDetails({ ...details, firstName: e.target.value })
                }
                className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-input-bg)] px-3 py-1.5 text-body text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                data-testid="input-firstname"
              />
            </div>
            <div>
              <label className="mb-1 block text-caption font-semibold text-[var(--color-text-secondary)]">
                Last Name *
              </label>
              <input
                type="text"
                value={details.lastName}
                onChange={(e) =>
                  setDetails({ ...details, lastName: e.target.value })
                }
                className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-input-bg)] px-3 py-1.5 text-body text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                data-testid="input-lastname"
              />
            </div>
            <div>
              <label className="mb-1 block text-caption font-semibold text-[var(--color-text-secondary)]">
                Display Name
              </label>
              <input
                type="text"
                value={details.displayName}
                onChange={(e) =>
                  setDetails({ ...details, displayName: e.target.value })
                }
                placeholder={autoDisplayName}
                className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-input-bg)] px-3 py-1.5 text-body text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                data-testid="input-displayname"
              />
            </div>
            <div>
              <label className="mb-1 block text-caption font-semibold text-[var(--color-text-secondary)]">
                Login (sAMAccountName) *
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={loginManual ? details.login : autoLogin}
                  onChange={(e) => {
                    setLoginManual(true);
                    setDetails({ ...details, login: e.target.value });
                  }}
                  className="flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-input-bg)] px-3 py-1.5 text-body text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                  data-testid="input-login"
                />
                {loginManual && (
                  <button
                    onClick={() => setLoginManual(false)}
                    className="text-caption text-[var(--color-primary)] hover:underline"
                  >
                    Auto
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-caption font-semibold text-[var(--color-text-secondary)]">
                Password *
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={details.password}
                  onChange={(e) =>
                    setDetails({ ...details, password: e.target.value })
                  }
                  className="flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-input-bg)] px-3 py-1.5 text-body font-mono text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                  data-testid="input-password"
                />
                <button
                  onClick={() =>
                    setDetails({ ...details, password: generatePassword() })
                  }
                  className="btn btn-sm btn-secondary"
                  data-testid="btn-regenerate-password"
                >
                  Regenerate
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Preset Selection */}
        {step === "preset" && (
          <div className="mx-auto max-w-xl" data-testid="step-preset">
            {onboardingPresets.length === 0 ? (
              <EmptyState
                title="No onboarding presets"
                description="Create an onboarding preset in the Preset Management page first."
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {onboardingPresets.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => setSelectedPreset(preset)}
                    className={`rounded-lg border p-4 text-left transition-colors ${
                      selectedPreset?.name === preset.name
                        ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)]"
                        : "border-[var(--color-border-default)] hover:bg-[var(--color-surface-hover)]"
                    }`}
                    data-testid={`preset-card-${preset.name}`}
                  >
                    <div className="flex items-center gap-2 text-body font-semibold text-[var(--color-text-primary)]">
                      {preset.name}
                      {preset.integrityWarning && (
                        <AlertTriangle
                          size={14}
                          className="shrink-0 text-[var(--color-warning)]"
                          aria-label="Preset modified externally"
                        />
                      )}
                    </div>
                    {preset.integrityWarning && (
                      <div className="mt-1 text-caption text-[var(--color-warning)]">
                        Modified outside DSPanel - review before use
                      </div>
                    )}
                    <div className="mt-1 text-caption text-[var(--color-text-secondary)]">
                      {preset.description}
                    </div>
                    <div className="mt-2 text-caption text-[var(--color-text-secondary)]">
                      {preset.groups.length} group(s) - OU: {preset.targetOu}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Preview */}
        {step === "preview" && selectedPreset && (
          <div className="mx-auto max-w-lg space-y-3" data-testid="step-preview">
            <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
              Changes to apply
            </h3>
            <div className="space-y-2 rounded-md bg-[var(--color-surface-hover)] p-3">
              <div className="flex justify-between text-caption">
                <span className="text-[var(--color-text-secondary)]">
                  Login
                </span>
                <span className="font-mono text-[var(--color-text-primary)]">
                  {currentLogin}
                </span>
              </div>
              <div className="flex justify-between text-caption">
                <span className="text-[var(--color-text-secondary)]">
                  Display Name
                </span>
                <span className="text-[var(--color-text-primary)]">
                  {currentDisplayName}
                </span>
              </div>
              <div className="flex justify-between text-caption">
                <span className="text-[var(--color-text-secondary)]">
                  Target OU
                </span>
                <span className="text-[var(--color-text-primary)] truncate ml-4">
                  {selectedPreset.targetOu}
                </span>
              </div>
              <div className="flex justify-between text-caption">
                <span className="text-[var(--color-text-secondary)]">
                  Preset
                </span>
                <span className="text-[var(--color-text-primary)]">
                  {selectedPreset.name}
                </span>
              </div>
              {selectedPreset.groups.length > 0 && (
                <div>
                  <span className="text-caption text-[var(--color-text-secondary)]">
                    Groups:
                  </span>
                  <ul className="ml-4 mt-1 space-y-0.5">
                    {selectedPreset.groups.map((g) => (
                      <li
                        key={g}
                        className="text-caption text-[var(--color-success)]"
                      >
                        + {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {Object.keys(selectedPreset.attributes).length > 0 && (
                <div>
                  <span className="text-caption text-[var(--color-text-secondary)]">
                    Attributes:
                  </span>
                  <ul className="ml-4 mt-1 space-y-0.5">
                    {Object.entries(selectedPreset.attributes).map(
                      ([k, v]) => (
                        <li
                          key={k}
                          className="text-caption text-[var(--color-success)]"
                        >
                          + {k} = {v}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 4: Execute / Result */}
        {step === "execute" && (
          <div className="mx-auto max-w-lg" data-testid="step-execute">
            {executing && (
              <LoadingSpinner message="Creating user account..." />
            )}
            {result && !executing && (
              <div className="space-y-4">
                {result.success ? (
                  <>
                    <div className="flex items-center gap-2 text-[var(--color-success)]">
                      <Check size={20} />
                      <span className="text-body font-semibold">
                        User created successfully
                      </span>
                    </div>
                    <div
                      className="rounded-md bg-[var(--color-surface-hover)] p-4 font-mono text-caption space-y-1"
                      data-testid="onboarding-summary"
                    >
                      <div>Login: {result.login}</div>
                      <div>Password: {result.password}</div>
                      <div>DN: {result.userDn}</div>
                      <div>OU: {result.targetOu}</div>
                      {result.groups.map((g) => (
                        <div key={g}>Group: {g}</div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const summary = `Login: ${result.login}\nPassword: ${result.password}\nDN: ${result.userDn}\nOU: ${result.targetOu}\n${result.groups.map((g) => `Group: ${g}`).join("\n")}`;
                          handleCopy(summary, "summary");
                        }}
                        className="btn btn-sm btn-secondary"
                        data-testid="btn-copy-summary"
                      >
                        {copied === "summary" ? (
                          <Check size={14} />
                        ) : (
                          <Copy size={14} />
                        )}
                        Copy Summary
                      </button>
                      <button
                        onClick={() => handleCopy(result.password, "password")}
                        className="btn btn-sm btn-secondary"
                        data-testid="btn-copy-password"
                      >
                        {copied === "password" ? (
                          <Check size={14} />
                        ) : (
                          <Copy size={14} />
                        )}
                        Copy Password
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-[var(--color-danger)]">
                    <AlertTriangle size={20} />
                    <span className="text-body font-semibold">
                      Failed to create user
                    </span>
                  </div>
                )}
                <button
                  onClick={handleReset}
                  className="btn btn-sm btn-primary"
                  data-testid="btn-new-onboarding"
                >
                  <UserPlus size={14} />
                  Start New Onboarding
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      {step !== "execute" && (
        <div className="mt-4 flex justify-between">
          <button
            onClick={handleBack}
            disabled={stepIndex === 0}
            className="btn btn-sm btn-secondary"
            data-testid="btn-back"
          >
            <ChevronLeft size={14} /> Back
          </button>
          {step === "preview" ? (
            <button
              onClick={handleExecute}
              disabled={executing}
              className="btn btn-sm btn-primary"
              data-testid="btn-execute"
            >
              {executing ? (
                <LoadingSpinner size={14} />
              ) : (
                <UserPlus size={14} />
              )}
              Create User
            </button>
          ) : (
            <button
              onClick={handleNext}
              disabled={!canGoNext()}
              className="btn btn-sm btn-primary"
              data-testid="btn-next"
            >
              Next <ChevronRight size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function OnboardingWizard() {
  return (
    <PermissionGate
      requiredLevel="AccountOperator"
      fallback={
        <div className="flex h-full items-center justify-center p-8">
          <EmptyState
            title="Access Denied"
            description="Onboarding requires AccountOperator permission or higher."
          />
        </div>
      }
    >
      <OnboardingContent />
    </PermissionGate>
  );
}
