import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  UserMinus,
  ChevronRight,
  ChevronLeft,
  Copy,
  Check,
  AlertTriangle,
  Info,
} from "lucide-react";
import { useErrorHandler } from "@/hooks/useErrorHandler";
import { useDialog } from "@/contexts/DialogContext";
import { useNavigation } from "@/contexts/NavigationContext";
import { PermissionGate } from "@/components/common/PermissionGate";
import { OUPicker } from "@/components/form/OUPicker";
import { useOUTree } from "@/hooks/useOUTree";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import type { DirectoryEntry } from "@/types/directory";
import { useTranslation } from "react-i18next";

type OffboardStep = "search" | "actions" | "preview" | "execute";

interface OffboardActions {
  disableAccount: boolean;
  removeGroups: boolean;
  moveToDisabledOU: boolean;
  setRandomPassword: boolean;
  disabledOU: string;
}

interface ActionResult {
  action: string;
  success: boolean;
  detail: string;
}

function OffboardingContent() {
  const { t } = useTranslation(["offboarding", "common"]);
  const { handleError } = useErrorHandler();
  const { showConfirmation } = useDialog();
  const { openTabs, activeTabId, clearTabData } = useNavigation();
  const { nodes: ouNodes, loading: ouLoading, error: ouError } = useOUTree({ silent: true });
  const [step, setStep] = useState<OffboardStep>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [user, setUser] = useState<DirectoryEntry | null>(null);
  const [userGroups, setUserGroups] = useState<string[]>([]);
  const [actions, setActions] = useState<OffboardActions>({
    disableAccount: true,
    removeGroups: true,
    moveToDisabledOU: false,
    setRandomPassword: true,
    disabledOU: "",
  });
  const [executing, setExecuting] = useState(false);
  const [results, setResults] = useState<ActionResult[]>([]);
  const [copied, setCopied] = useState(false);
  const [showSearchHelp, setShowSearchHelp] = useState(false);

  // Load default disabled OU from app settings
  useEffect(() => {
    invoke<{ disabledOu?: string | null }>("get_app_settings")
      .then((settings) => {
        if (settings.disabledOu) {
          setActions((prev) => ({ ...prev, disabledOU: settings.disabledOu ?? "" }));
        }
      })
      .catch(() => {});
  }, []);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const entry = await invoke<DirectoryEntry | null>("get_user", {
        samAccountName: searchQuery.trim(),
      });
      if (entry) {
        setUser(entry);
        const groups =
          entry.attributes?.memberOf?.filter(
            (g: string) => !g.toLowerCase().includes("cn=domain users"),
          ) ?? [];
        setUserGroups(groups);
        setStep("actions");
      } else {
        handleError(`User "${searchQuery}" not found`, "searching user");
      }
    } catch (err) {
      handleError(err, "searching user");
    } finally {
      setSearching(false);
    }
  }, [searchQuery, handleError]);

  // Auto-search when opened from User Lookup context menu
  const autoSearched = useRef(false);
  useEffect(() => {
    if (autoSearched.current) return;
    const activeTab = openTabs.find((t) => t.id === activeTabId);
    const offboardSam = activeTab?.data?.offboardSam as string | undefined;
    if (offboardSam && step === "search" && !user) {
      autoSearched.current = true;
      setSearchQuery(offboardSam);
      // Trigger search in next tick after state update
      setTimeout(async () => {
        try {
          const entry = await invoke<DirectoryEntry | null>("get_user", {
            samAccountName: offboardSam,
          });
          if (entry) {
            setUser(entry);
            const groups =
              entry.attributes?.memberOf?.filter(
                (g: string) => !g.toLowerCase().includes("cn=domain users"),
              ) ?? [];
            setUserGroups(groups);
            setStep("actions");
          }
        } catch (err) {
          handleError(err, "searching user");
        }
        if (activeTabId) clearTabData(activeTabId);
      }, 0);
    }
  }, [openTabs, activeTabId, clearTabData, step, user, handleError]);

  const hasAction =
    actions.disableAccount ||
    actions.removeGroups ||
    actions.moveToDisabledOU ||
    actions.setRandomPassword;

  const handleExecute = useCallback(async () => {
    if (!user) return;
    const selectedActions: string[] = [];
    if (actions.disableAccount) selectedActions.push("Disable account");
    if (actions.removeGroups) selectedActions.push(`Remove from ${userGroups.length} group(s)`);
    if (actions.setRandomPassword) selectedActions.push("Set random password");
    if (actions.moveToDisabledOU) selectedActions.push(`Move to ${actions.disabledOU}`);

    const confirmed = await showConfirmation(
      "Confirm Offboarding",
      `Execute offboarding for ${user.displayName ?? user.samAccountName}?`,
      selectedActions.map((a) => `- ${a}`).join("\n"),
    );
    if (!confirmed) return;

    setExecuting(true);
    const actionResults: ActionResult[] = [];
    const dn = user.distinguishedName;

    if (actions.disableAccount) {
      try {
        await invoke("disable_account", { userDn: dn });
        actionResults.push({
          action: "Disable Account",
          success: true,
          detail: "Account disabled",
        });
      } catch (err) {
        actionResults.push({
          action: "Disable Account",
          success: false,
          detail: String(err),
        });
      }
    }

    if (actions.removeGroups) {
      for (const groupDn of userGroups) {
        try {
          await invoke("remove_group_member", { groupDn, memberDn: dn });
          actionResults.push({
            action: "Remove from group",
            success: true,
            detail: groupDn,
          });
        } catch (err) {
          actionResults.push({
            action: "Remove from group",
            success: false,
            detail: `${groupDn}: ${err}`,
          });
        }
      }
    }

    if (actions.setRandomPassword) {
      try {
        const pw = Array.from(crypto.getRandomValues(new Uint8Array(24)))
          .map((b) =>
            "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&"
              .charAt(b % 62),
          )
          .join("");
        await invoke("reset_password", {
          userDn: dn,
          newPassword: pw,
          mustChangeAtNextLogon: false,
        });
        actionResults.push({
          action: "Set Random Password",
          success: true,
          detail: "Password reset to random value",
        });
      } catch (err) {
        actionResults.push({
          action: "Set Random Password",
          success: false,
          detail: String(err),
        });
      }
    }

    if (actions.moveToDisabledOU && actions.disabledOU.trim()) {
      try {
        await invoke("move_object", {
          objectDn: dn,
          targetContainerDn: actions.disabledOU.trim(),
        });
        actionResults.push({
          action: "Move to Disabled OU",
          success: true,
          detail: `Moved to ${actions.disabledOU}`,
        });
      } catch (err) {
        actionResults.push({
          action: "Move to Disabled OU",
          success: false,
          detail: String(err),
        });
      }
    }

    // Audit logging handled internally by the backend for each operation

    setResults(actionResults);
    setStep("execute");
    setExecuting(false);
  }, [user, actions, userGroups, showConfirmation]);

  const handleCopySummary = useCallback(async () => {
    const summary = results
      .map((r) => `[${r.success ? "OK" : "FAIL"}] ${r.action}: ${r.detail}`)
      .join("\n");
    const header = `Offboarding: ${user?.displayName ?? user?.samAccountName}\nDN: ${user?.distinguishedName}\n\n`;
    try {
      await navigator.clipboard.writeText(header + summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      handleError(err, "copying to clipboard");
    }
  }, [results, user, handleError]);

  const handleReset = useCallback(() => {
    setStep("search");
    setSearchQuery("");
    setUser(null);
    setUserGroups([]);
    setActions({
      disableAccount: true,
      removeGroups: true,
      moveToDisabledOU: false,
      setRandomPassword: true,
      disabledOU: "",
    });
    setResults([]);
  }, []);

  const stepIndex = ["search", "actions", "preview", "execute"].indexOf(step);

  return (
    <div className="flex h-full flex-col p-4" data-testid="offboarding-wizard">
      {/* Step indicator */}
      <div className="mb-4 flex items-center gap-2" data-testid="offboard-step-indicator">
        {[t("stepSearch"), t("stepActions"), t("stepPreview"), t("stepExecute")].map(
          (label, i) => (
            <div key={label} className="flex items-center gap-2">
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
                {label}
              </span>
              {i < 3 && (
                <ChevronRight
                  size={14}
                  className="text-[var(--color-text-secondary)]"
                />
              )}
            </div>
          ),
        )}
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
        {/* Step 1: Search */}
        {step === "search" && (
          <div className="mx-auto max-w-lg" data-testid="step-search">
            <label className="mb-1 flex items-center gap-1.5 text-caption font-semibold text-[var(--color-text-secondary)]">
              {t("enterSamAccountName")}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSearchHelp((v) => !v)}
                  onBlur={() => setTimeout(() => setShowSearchHelp(false), 150)}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  aria-label={t("whatIsSamAriaLabel")}
                >
                  <Info size={13} />
                </button>
                {showSearchHelp && (
                  <div className="absolute left-0 z-50 w-72 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3 shadow-lg top-full mt-1">
                    <p className="text-caption text-[var(--color-text-primary)]">
                      <strong>What:</strong> The sAMAccountName is the user login (e.g. jsmith).
                    </p>
                    <p className="mt-1 text-caption text-[var(--color-text-primary)]">
                      <strong>Where:</strong> In User Lookup, select a user - it is shown just below the display name with a copy button.
                    </p>
                  </div>
                )}
              </div>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="jsmith"
                className="flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                data-testid="offboard-search-input"
              />
              <button
                onClick={handleSearch}
                disabled={searching || !searchQuery.trim()}
                className="btn btn-sm btn-primary"
                data-testid="offboard-search-btn"
              >
                {searching ? <LoadingSpinner size={14} /> : t("common:search")}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Actions */}
        {step === "actions" && user && (
          <div className="mx-auto max-w-lg space-y-4" data-testid="step-actions">
            <div className="rounded-md bg-[var(--color-surface-hover)] p-3">
              <div className="text-body font-semibold text-[var(--color-text-primary)]">
                {user.displayName ?? user.samAccountName}
              </div>
              <div className="text-caption text-[var(--color-text-secondary)]">
                {user.distinguishedName}
              </div>
            </div>

            <div className="space-y-3">
              {[
                {
                  key: "disableAccount" as const,
                  label: t("disableAccount"),
                  desc: t("disableAccountDesc"),
                },
                {
                  key: "removeGroups" as const,
                  label: t("removeGroups", { count: userGroups.length }),
                  desc: t("removeGroupsDesc"),
                },
                {
                  key: "setRandomPassword" as const,
                  label: t("setRandomPassword"),
                  desc: t("setRandomPasswordDesc"),
                },
                {
                  key: "moveToDisabledOU" as const,
                  label: t("moveToDisabledOU"),
                  desc: t("moveToDisabledOUDesc"),
                },
              ].map(({ key, label, desc }) => (
                <label
                  key={key}
                  className="flex items-start gap-3 rounded-md border border-[var(--color-border-default)] p-3 cursor-pointer hover:bg-[var(--color-surface-hover)]"
                >
                  <input
                    type="checkbox"
                    checked={actions[key]}
                    onChange={(e) =>
                      setActions({ ...actions, [key]: e.target.checked })
                    }
                    className="mt-0.5"
                    data-testid={`action-${key}`}
                  />
                  <div>
                    <div className="text-body text-[var(--color-text-primary)]">
                      {label}
                    </div>
                    <div className="text-caption text-[var(--color-text-secondary)]">
                      {desc}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {actions.moveToDisabledOU && (
              <div>
                <label className="mb-1 block text-caption font-semibold text-[var(--color-text-secondary)]">
                  {t("disabledOULabel")}
                </label>
                <OUPicker
                  nodes={ouNodes}
                  selectedOU={actions.disabledOU}
                  onSelect={(dn) =>
                    setActions({ ...actions, disabledOU: dn })
                  }
                  loading={ouLoading}
                  error={ouError}
                />
              </div>
            )}
          </div>
        )}

        {/* Step 3: Preview */}
        {step === "preview" && user && (
          <div className="mx-auto max-w-lg space-y-3" data-testid="step-offboard-preview">
            <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
              {t("changesToApply", { name: user.displayName ?? user.samAccountName })}
            </h3>
            <div className="space-y-2 rounded-md bg-[var(--color-surface-hover)] p-3">
              {actions.disableAccount && (
                <div className="text-caption text-[var(--color-warning)]">
                  - {t("accountWillBeDisabled")}
                </div>
              )}
              {actions.removeGroups &&
                userGroups.map((g) => (
                  <div
                    key={g}
                    className="text-caption text-[var(--color-error)]"
                  >
                    - Remove from: {g}
                  </div>
                ))}
              {actions.setRandomPassword && (
                <div className="text-caption text-[var(--color-warning)]">
                  - {t("passwordWillBeReset")}
                </div>
              )}
              {actions.moveToDisabledOU && (
                <div className="text-caption text-[var(--color-warning)]">
                  - Move to: {actions.disabledOU}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 4: Results */}
        {step === "execute" && (
          <div className="mx-auto max-w-lg" data-testid="step-offboard-results">
            {executing ? (
              <LoadingSpinner message={t("executingOffboarding")} />
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  {results.every((r) => r.success) ? (
                    <Check
                      size={20}
                      className="text-[var(--color-success)]"
                    />
                  ) : (
                    <AlertTriangle
                      size={20}
                      className="text-[var(--color-warning)]"
                    />
                  )}
                  <span className="text-body font-semibold text-[var(--color-text-primary)]">
                    {results.filter((r) => r.success).length}/{results.length}{" "}
                    {t("actionsCompleted")}
                  </span>
                </div>

                <div
                  className="space-y-1 rounded-md bg-[var(--color-surface-hover)] p-3"
                  data-testid="offboard-summary"
                >
                  {results.map((r, i) => (
                    <div
                      key={i}
                      className={`text-caption ${r.success ? "text-[var(--color-success)]" : "text-[var(--color-error)]"}`}
                    >
                      [{r.success ? "OK" : "FAIL"}] {r.action}: {r.detail}
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleCopySummary}
                    className="btn btn-sm btn-secondary"
                    data-testid="btn-copy-offboard-summary"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {t("copySummary")}
                  </button>
                  <button
                    onClick={handleReset}
                    className="btn btn-sm btn-primary"
                    data-testid="btn-new-offboarding"
                  >
                    <UserMinus size={14} /> {t("newOffboarding")}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      {step !== "search" && step !== "execute" && (
        <div className="mt-4 flex justify-between">
          <button
            onClick={() =>
              setStep(
                step === "actions"
                  ? "search"
                  : step === "preview"
                    ? "actions"
                    : "search",
              )
            }
            className="btn btn-sm btn-secondary"
            data-testid="offboard-btn-back"
          >
            <ChevronLeft size={14} /> {t("common:back")}
          </button>
          {step === "preview" ? (
            <button
              onClick={handleExecute}
              disabled={executing}
              className="btn btn-sm btn-primary"
              data-testid="offboard-btn-execute"
            >
              <UserMinus size={14} /> {t("executeOffboarding")}
            </button>
          ) : (
            <button
              onClick={() => setStep("preview")}
              disabled={!hasAction}
              className="btn btn-sm btn-primary"
              data-testid="offboard-btn-next"
            >
              {t("common:next")} <ChevronRight size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Offboarding() {
  const { t } = useTranslation(["offboarding", "common"]);
  return (
    <PermissionGate
      requiredLevel="AccountOperator"
      fallback={
        <div className="flex h-full items-center justify-center p-8">
          <EmptyState
            title={t("common:accessDenied")}
            description={t("accessDeniedDescription")}
          />
        </div>
      }
    >
      <OffboardingContent />
    </PermissionGate>
  );
}
