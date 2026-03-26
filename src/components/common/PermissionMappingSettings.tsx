import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Plus, Search, AlertTriangle } from "lucide-react";
import { type PermissionLevel, PERMISSION_LEVELS } from "@/types/permissions";
import { usePermissions } from "@/hooks/usePermissions";
import type { DirectoryEntry } from "@/types/directory";
import { LoadingSpinner } from "./LoadingSpinner";
import { useTranslation } from "react-i18next";

/** Maps each PermissionLevel to a list of AD group DNs. */
interface PermissionMappings {
  mappings: Partial<Record<PermissionLevel, string[]>>;
}

/** Descriptive labels for each permission level. */
const LEVEL_LABELS: Record<PermissionLevel, string> = {
  ReadOnly: "Read Only",
  HelpDesk: "Help Desk",
  AccountOperator: "Account Operator",
  Admin: "Admin",
  DomainAdmin: "Domain Admin",
};

/** Descriptive hints for each permission level. */
const LEVEL_HINTS: Record<PermissionLevel, string> = {
  ReadOnly: "View-only access to directory data",
  HelpDesk: "Password resets and account unlocks",
  AccountOperator: "Group management and account modifications",
  Admin: "Full admin (object creation, OU management)",
  DomainAdmin: "Full access including security and infrastructure",
};

/** Extracts the CN from a DN string. */
function extractCn(dn: string): string {
  const first = dn.split(",")[0] ?? "";
  return first.startsWith("CN=") ? first.slice(3) : dn;
}

export function PermissionMappingSettings() {
  const { t } = useTranslation(["components", "common"]);
  const { hasPermission } = usePermissions();
  const [mappings, setMappings] = useState<PermissionMappings>({ mappings: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Group search state
  const [searchLevel, setSearchLevel] = useState<PermissionLevel | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DirectoryEntry[]>([]);
  const [searching, setSearching] = useState(false);

  // Validation warnings (group DN -> exists)
  const [validationWarnings, setValidationWarnings] = useState<Record<string, boolean>>({});

  const isDomainAdmin = hasPermission("DomainAdmin");

  useEffect(() => {
    invoke<PermissionMappings>("get_permission_mappings")
      .then((m) => {
        setMappings(m);
        // Batch-validate all mapped groups
        const allGroups = Object.values(m.mappings ?? {}).flat();
        for (const groupDn of allGroups) {
          invoke<boolean>("validate_group_exists", { groupDn })
            .then((exists) => {
              setValidationWarnings((prev) => ({ ...prev, [groupDn]: exists }));
            })
            .catch(() => {
              setValidationWarnings((prev) => ({ ...prev, [groupDn]: false }));
            });
        }
      })
      .catch((e) => setError(`Failed to load permission mappings: ${e}`))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await invoke("set_permission_mappings", { mappings });
      setDirty(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(`Failed to save: ${e}`);
    } finally {
      setSaving(false);
    }
  }, [mappings]);

  const addGroup = useCallback(
    (level: PermissionLevel, groupDn: string) => {
      setMappings((prev) => {
        const current = prev.mappings[level] ?? [];
        if (current.includes(groupDn)) return prev;
        return {
          mappings: { ...prev.mappings, [level]: [...current, groupDn] },
        };
      });
      setDirty(true);
      setSearchLevel(null);
      setSearchQuery("");
      setSearchResults([]);
    },
    [],
  );

  const removeGroup = useCallback(
    (level: PermissionLevel, groupDn: string) => {
      setMappings((prev) => {
        const current = prev.mappings[level] ?? [];
        return {
          mappings: {
            ...prev.mappings,
            [level]: current.filter((g) => g !== groupDn),
          },
        };
      });
      setDirty(true);
    },
    [],
  );

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await invoke<DirectoryEntry[]>("search_groups", {
        query: searchQuery.trim(),
      });
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const validateGroup = useCallback(async (groupDn: string) => {
    try {
      const exists = await invoke<boolean>("validate_group_exists", { groupDn });
      setValidationWarnings((prev) => ({ ...prev, [groupDn]: exists }));
    } catch {
      setValidationWarnings((prev) => ({ ...prev, [groupDn]: false }));
    }
  }, []);

  if (!isDomainAdmin) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--color-text-secondary)]"
        data-testid="permission-mapping-access-denied"
      >
        <AlertTriangle size={24} />
        <p className="text-body">{t("components:permissionMapping.domainAdminRequired")}</p>
      </div>
    );
  }

  if (loading) {
    return <LoadingSpinner message="Loading permission mappings..." />;
  }

  return (
    <div className="space-y-4" data-testid="permission-mapping-settings">
      <p className="text-caption text-[var(--color-text-secondary)]">
        {t("components:permissionMapping.description")}
      </p>

      {error && (
        <div
          className="rounded-md border border-[var(--color-error)] bg-[var(--color-error-bg)] px-3 py-2 text-caption text-[var(--color-error)]"
          data-testid="permission-mapping-error"
        >
          {error}
        </div>
      )}

      {success && (
        <div
          className="rounded-md border border-[var(--color-success)] bg-[var(--color-success-bg)] px-3 py-2 text-caption text-[var(--color-success)]"
          data-testid="permission-mapping-success"
        >
          {t("components:permissionMapping.savedSuccessfully")}
        </div>
      )}

      <div className="space-y-3">
        {PERMISSION_LEVELS.map((level) => {
          const groups = mappings.mappings[level] ?? [];
          return (
            <div
              key={level}
              className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
              data-testid={`permission-level-${level}`}
            >
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <span className="text-body font-medium text-[var(--color-text-primary)]">
                    {LEVEL_LABELS[level]}
                  </span>
                  <span className="ml-2 text-caption text-[var(--color-text-secondary)]">
                    {LEVEL_HINTS[level]}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setSearchLevel(searchLevel === level ? null : level);
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                  className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1 text-caption text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  data-testid={`add-group-${level}`}
                >
                  <Plus size={14} className="inline" /> {t("components:permissionMapping.addGroup")}
                </button>
              </div>

              {/* Search panel */}
              {searchLevel === level && (
                <div
                  className="mb-2 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-2"
                  data-testid={`group-search-${level}`}
                >
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSearch();
                      }}
                      placeholder={t("components:permissionMapping.searchGroupsPlaceholder")}
                      className="flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1 text-caption text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none"
                      data-testid={`group-search-input-${level}`}
                      autoFocus
                    />
                    <button
                      onClick={handleSearch}
                      disabled={searching || !searchQuery.trim()}
                      className="btn btn-sm btn-primary px-2 py-1"
                      data-testid={`group-search-btn-${level}`}
                    >
                      {searching ? "..." : <Search size={14} />}
                    </button>
                  </div>
                  {searchResults.length > 0 && (
                    <div className="mt-2 max-h-32 overflow-y-auto">
                      {searchResults.map((group) => {
                        const alreadyMapped = groups.includes(group.distinguishedName);
                        return (
                          <button
                            key={group.distinguishedName}
                            onClick={() => addGroup(level, group.distinguishedName)}
                            disabled={alreadyMapped}
                            className={`w-full rounded px-2 py-1 text-left text-caption ${
                              alreadyMapped
                                ? "text-[var(--color-text-secondary)] cursor-not-allowed"
                                : "text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                            }`}
                          >
                            <span className="font-medium">
                              {group.displayName ?? group.samAccountName ?? extractCn(group.distinguishedName)}
                            </span>
                            <span className="ml-2 text-[var(--color-text-secondary)]">
                              {group.distinguishedName}
                            </span>
                            {alreadyMapped && (
                              <span className="ml-1 text-[var(--color-text-secondary)]">
                                {t("components:permissionMapping.alreadyMapped")}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Mapped groups list */}
              {groups.length === 0 ? (
                <p className="text-caption text-[var(--color-text-secondary)] italic">
                  {t("components:permissionMapping.noCustomGroups")}
                </p>
              ) : (
                <div className="space-y-1">
                  {groups.map((groupDn) => (
                    <div
                      key={groupDn}
                      className="flex items-center justify-between rounded-md bg-[var(--color-surface-card)] px-2 py-1"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {validationWarnings[groupDn] === false && (
                          <span title={t("components:permissionMapping.groupNotFoundInAd")}>
                            <AlertTriangle
                              size={14}
                              className="shrink-0 text-[var(--color-warning)]"
                            />
                          </span>
                        )}
                        <span className="truncate text-caption text-[var(--color-text-primary)]">
                          {extractCn(groupDn)}
                        </span>
                        <span className="truncate text-caption text-[var(--color-text-secondary)]">
                          {groupDn}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {validationWarnings[groupDn] === undefined && (
                          <button
                            onClick={() => validateGroup(groupDn)}
                            className="text-caption text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                            title={t("components:permissionMapping.validateGroupExists")}
                            data-testid={`validate-group-btn`}
                          >
                            <Search size={12} />
                          </button>
                        )}
                        <button
                          onClick={() => removeGroup(level, groupDn)}
                          className="text-[var(--color-text-secondary)] hover:text-[var(--color-error)] transition-colors"
                          title={t("components:permissionMapping.removeGroup")}
                          data-testid={`remove-group-btn`}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="btn btn-sm btn-primary"
          data-testid="permission-mapping-save"
        >
          {saving ? t("common:saving") : t("components:permissionMapping.saveMappings")}
        </button>
        {dirty && (
          <span className="text-caption text-[var(--color-warning)]">{t("common:unsavedChanges")}</span>
        )}
      </div>
    </div>
  );
}
