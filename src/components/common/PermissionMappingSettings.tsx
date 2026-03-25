import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Plus, Search, AlertTriangle } from "lucide-react";
import { type PermissionLevel, PERMISSION_LEVELS } from "@/types/permissions";
import { usePermissions } from "@/hooks/usePermissions";
import type { DirectoryEntry } from "@/types/directory";
import { LoadingSpinner } from "./LoadingSpinner";

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
        <p className="text-body">DomainAdmin access required to manage permission mappings.</p>
      </div>
    );
  }

  if (loading) {
    return <LoadingSpinner message="Loading permission mappings..." />;
  }

  return (
    <div className="space-y-4" data-testid="permission-mapping-settings">
      <p className="text-caption text-[var(--color-text-secondary)]">
        Map AD security groups to DSPanel permission levels. When a user belongs to multiple mapped
        groups, the highest level wins. Default detection (RID-based + DSPanel-* groups) remains
        active alongside custom mappings.
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
          Permission mappings saved successfully.
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
                  <Plus size={14} className="inline" /> Add Group
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
                      placeholder="Search AD groups by name..."
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
                        const alreadyMapped = groups.includes(group.distinguished_name);
                        return (
                          <button
                            key={group.distinguished_name}
                            onClick={() => addGroup(level, group.distinguished_name)}
                            disabled={alreadyMapped}
                            className={`w-full rounded px-2 py-1 text-left text-caption ${
                              alreadyMapped
                                ? "text-[var(--color-text-secondary)] cursor-not-allowed"
                                : "text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                            }`}
                          >
                            <span className="font-medium">
                              {group.display_name ?? group.sam_account_name ?? extractCn(group.distinguished_name)}
                            </span>
                            <span className="ml-2 text-[var(--color-text-secondary)]">
                              {group.distinguished_name}
                            </span>
                            {alreadyMapped && (
                              <span className="ml-1 text-[var(--color-text-secondary)]">
                                (already mapped)
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
                  No custom groups mapped. Default detection applies.
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
                          <AlertTriangle
                            size={14}
                            className="shrink-0 text-[var(--color-warning)]"
                            title="Group not found in AD"
                          />
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
                            title="Validate group exists in AD"
                            data-testid={`validate-group-btn`}
                          >
                            <Search size={12} />
                          </button>
                        )}
                        <button
                          onClick={() => removeGroup(level, groupDn)}
                          className="text-[var(--color-text-secondary)] hover:text-[var(--color-error)] transition-colors"
                          title="Remove group"
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
          {saving ? "Saving..." : "Save Mappings"}
        </button>
        {dirty && (
          <span className="text-caption text-[var(--color-warning)]">Unsaved changes</span>
        )}
      </div>
    </div>
  );
}
