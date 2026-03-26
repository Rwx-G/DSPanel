import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Settings as SettingsIcon,
  Link,
  FolderOpen,
  Shield,
  Lock,
  FileText,
  Palette,
} from "lucide-react";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { GraphSettings } from "@/components/common/GraphSettings";
import { PresetSettings } from "@/components/common/PresetSettings";
import { PermissionMappingSettings } from "@/components/common/PermissionMappingSettings";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import { useNavigation } from "@/contexts/NavigationContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { OUPicker } from "@/components/form/OUPicker";
import { useOUTree } from "@/hooks/useOUTree";

/** Tab definitions for the settings page. */
const TABS = [
  { id: "connection", label: "Connection", icon: Link },
  { id: "presets", label: "Presets", icon: FolderOpen },
  { id: "permissions", label: "Permissions", icon: Shield },
  { id: "security", label: "Security", icon: Lock },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "appearance", label: "Appearance", icon: Palette },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface AppSettings {
  disabledOu?: string | null;
  graphTenantId?: string | null;
  graphClientId?: string | null;
  privilegedGroups?: string[] | null;
  cleanupRules?: unknown[] | null;
  auditRetentionDays?: number | null;
  connection?: {
    domainOverride?: string | null;
    preferredDc?: string | null;
  } | null;
  reports?: {
    defaultFormat?: string | null;
    defaultExportPath?: string | null;
  } | null;
  appearance?: {
    theme?: string | null;
  } | null;
  update?: {
    checkFrequency?: string | null;
    skippedVersion?: string | null;
    lastCheckTimestamp?: string | null;
  } | null;
}

export function Settings() {
  const { openTabs, activeTabId, clearTabData } = useNavigation();
  const [activeTab, setActiveTab] = useState<TabId>("connection");
  const [settings, setSettings] = useState<AppSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const { notify } = useNotifications();
  const { nodes: ouNodes, loading: ouLoading, error: ouError } = useOUTree({ silent: true });

  const { applyTheme } = useTheme();

  // React to tab data passed via navigation (e.g. from Preset Management)
  useEffect(() => {
    const tab = openTabs.find(
      (t) => t.id === activeTabId && t.moduleId === "settings",
    );
    if (tab?.data?.tab) {
      const requested = tab.data.tab as string;
      if (TABS.some((t) => t.id === requested)) {
        setActiveTab(requested as TabId);
        clearTabData(tab.id);
      }
    }
  }, [openTabs, activeTabId, clearTabData]);

  // Load settings on mount
  useEffect(() => {
    invoke<AppSettings>("get_app_settings")
      .then((s) => setSettings(s))
      .catch((e) => notify(`Failed to load settings: ${e}`, "error"))
      .finally(() => setLoading(false));
  }, []);

  const updateField = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      setDirty(true);

    },
    [],
  );

  const updateNested = useCallback(
    (section: "connection" | "reports" | "appearance" | "update", key: string, value: string | null) => {
      setSettings((prev) => ({
        ...prev,
        [section]: { ...(prev[section] ?? {}), [key]: value || null },
      }));
      setDirty(true);

    },
    [],
  );

  const validate = useCallback(async (): Promise<boolean> => {
    const errors: Record<string, string> = {};
    const retention = settings.auditRetentionDays;
    if (retention !== null && retention !== undefined && retention < 30) {
      errors.auditRetentionDays = "Retention must be at least 30 days";
    }
    const exportPath = settings.reports?.defaultExportPath;
    if (exportPath) {
      try {
        const valid = await invoke<boolean>("test_preset_path", { path: exportPath });
        if (!valid) {
          errors.defaultExportPath = "Directory does not exist or is not accessible";
        }
      } catch {
        errors.defaultExportPath = "Could not verify directory";
      }
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [settings]);

  const handleSave = useCallback(async () => {
    if (!(await validate())) return;
    setSaving(true);
    try {
      await invoke("set_app_settings", { settings });
      setDirty(false);
      notify("Settings saved successfully", "success");
    } catch (e) {
      notify(`Failed to save settings: ${e}`, "error");
    } finally {
      setSaving(false);
    }
  }, [settings, validate, notify]);

  const handleResetDefaults = useCallback(() => {
    switch (activeTab) {
      case "connection":
        setSettings((prev) => ({
          ...prev,
          connection: { domainOverride: null, preferredDc: null },
          update: { ...prev.update, checkFrequency: "startup" },
        }));
        break;
      case "security":
        setSettings((prev) => ({
          ...prev,
          auditRetentionDays: 365,
          disabledOu: null,
        }));
        break;
      case "reports":
        setSettings((prev) => ({
          ...prev,
          reports: { defaultFormat: "CSV", defaultExportPath: null },
        }));
        break;
      case "appearance":
        setSettings((prev) => ({
          ...prev,
          appearance: { theme: "system" },
        }));
        // Apply system theme directly
        {
          const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
          applyTheme(systemTheme as ThemeMode);
        }
        break;
    }
    setDirty(true);
    setValidationErrors({});
  }, [activeTab]);

  const handleThemeChange = useCallback(
    (value: string) => {
      updateNested("appearance", "theme", value);
      if (value === "system") {
        const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
        applyTheme(systemTheme as ThemeMode);
      } else {
        applyTheme(value as ThemeMode);
      }
    },
    [applyTheme, updateNested],
  );

  const handlePickExportDir = useCallback(async () => {
    try {
      const path = await invoke<string | null>("pick_folder_dialog");
      if (path) {
        updateNested("reports", "defaultExportPath", path);
      }
    } catch (e) {
      console.warn("Folder picker failed:", e);
    }
  }, [updateNested]);

  if (loading) {
    return <LoadingSpinner message="Loading settings..." />;
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4" data-testid="settings-page">
      {/* Header */}
      <div className="flex items-center gap-2">
        <SettingsIcon size={20} className="text-[var(--color-text-primary)]" />
        <h1 className="text-heading font-semibold text-[var(--color-text-primary)]">Settings</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border-default)]">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-caption font-medium transition-colors ${
                isActive
                  ? "border-b-2 border-[var(--color-primary)] text-[var(--color-primary)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
              data-testid={`tab-${tab.id}`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "connection" && (
          <div className="space-y-4" data-testid="tab-content-connection">
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
              <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
                Domain Connection
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
                    Domain Override
                  </label>
                  <input
                    type="text"
                    value={settings.connection?.domainOverride ?? ""}
                    onChange={(e) => updateNested("connection", "domainOverride", e.target.value)}
                    placeholder="Leave empty for auto-detection"
                    className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none"
                    data-testid="setting-domain-override"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
                    Preferred Domain Controller
                  </label>
                  <input
                    type="text"
                    value={settings.connection?.preferredDc ?? ""}
                    onChange={(e) => updateNested("connection", "preferredDc", e.target.value)}
                    placeholder="Leave empty for auto-selection"
                    className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none"
                    data-testid="setting-preferred-dc"
                  />
                </div>
              </div>
            </div>
            <GraphSettings />
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
              <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
                Update Checks
              </h3>
              <div>
                <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
                  Check Frequency
                </label>
                <select
                  value={settings.update?.checkFrequency ?? "startup"}
                  onChange={(e) => updateNested("update", "checkFrequency", e.target.value)}
                  className="w-48 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                  data-testid="setting-update-frequency"
                >
                  <option value="startup">Every Startup</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="never">Never</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {activeTab === "presets" && (
          <div data-testid="tab-content-presets">
            <PresetSettings />
          </div>
        )}

        {activeTab === "permissions" && (
          <div data-testid="tab-content-permissions">
            <PermissionMappingSettings />
          </div>
        )}

        {activeTab === "security" && (
          <div className="space-y-4" data-testid="tab-content-security">
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
              <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
                Audit Log
              </h3>
              <div>
                <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
                  Retention Period (days)
                </label>
                <input
                  type="number"
                  min={30}
                  value={settings.auditRetentionDays ?? 365}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    updateField("auditRetentionDays", isNaN(val) ? null : val);
                  }}
                  className="w-48 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                  data-testid="setting-audit-retention"
                />
                {validationErrors.auditRetentionDays && (
                  <p
                    className="mt-1 text-caption text-[var(--color-error)]"
                    data-testid="validation-audit-retention"
                  >
                    {validationErrors.auditRetentionDays}
                  </p>
                )}
                <p className="mt-1 text-caption text-[var(--color-text-secondary)]">
                  Audit entries older than this will be purged at startup. Minimum: 30 days.
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
              <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
                Offboarding
              </h3>
              <div>
                <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
                  Disabled Users OU
                </label>
                {settings.disabledOu && (
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-caption text-[var(--color-text-primary)]" data-testid="setting-disabled-ou-value">
                      {settings.disabledOu}
                    </span>
                    <button
                      onClick={() => updateField("disabledOu", null)}
                      className="text-caption text-[var(--color-error)] hover:underline"
                      data-testid="setting-disabled-ou-clear"
                    >
                      Clear
                    </button>
                  </div>
                )}
                <div className="max-h-48 overflow-y-auto rounded-md border border-[var(--color-border-default)]" data-testid="setting-disabled-ou">
                  <OUPicker
                    nodes={ouNodes}
                    selectedOU={settings.disabledOu ?? undefined}
                    onSelect={(dn) => updateField("disabledOu", dn)}
                    loading={ouLoading}
                    error={ouError}
                  />
                </div>
                <p className="mt-1 text-caption text-[var(--color-text-secondary)]">
                  Target OU where disabled user accounts are moved during offboarding.
                  Select an OU or clear to skip the move step.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === "reports" && (
          <div className="space-y-4" data-testid="tab-content-reports">
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
              <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
                Export Defaults
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
                    Default Export Format
                  </label>
                  <select
                    value={settings.reports?.defaultFormat ?? "CSV"}
                    onChange={(e) => updateNested("reports", "defaultFormat", e.target.value)}
                    className="w-48 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                    data-testid="setting-export-format"
                  >
                    <option value="CSV">CSV</option>
                    <option value="PDF">PDF</option>
                    <option value="HTML">HTML</option>
                    <option value="XLSX">Excel (XLSX)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
                    Default Export Directory
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={settings.reports?.defaultExportPath ?? ""}
                      onChange={(e) =>
                        updateNested("reports", "defaultExportPath", e.target.value)
                      }
                      placeholder="Leave empty for system default"
                      className="flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none"
                      data-testid="setting-export-path"
                    />
                    <button
                      onClick={handlePickExportDir}
                      className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                      data-testid="setting-export-path-browse"
                    >
                      Browse...
                    </button>
                  </div>
                  {validationErrors.defaultExportPath && (
                    <p
                      className="mt-1 text-caption text-[var(--color-error)]"
                      data-testid="validation-export-path"
                    >
                      {validationErrors.defaultExportPath}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "appearance" && (
          <div className="space-y-4" data-testid="tab-content-appearance">
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
              <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
                Theme
              </h3>
              <div className="flex gap-3">
                {(["light", "dark", "system"] as const).map((mode) => {
                  const selected = (settings.appearance?.theme ?? "system") === mode;
                  return (
                    <button
                      key={mode}
                      onClick={() => handleThemeChange(mode)}
                      className={`rounded-lg border px-4 py-3 text-body font-medium transition-colors ${
                        selected
                          ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
                          : "border-[var(--color-border-default)] bg-[var(--color-surface-card)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                      }`}
                      data-testid={`theme-${mode}`}
                    >
                      {mode === "light" ? "Light" : mode === "dark" ? "Dark" : "System"}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-caption text-[var(--color-text-secondary)]">
                System follows your OS preference.
              </p>
            </div>
          </div>
        )}

      </div>

      {/* Save bar - shown for tabs that use AppSettings (not presets/permissions which save independently) */}
      {(activeTab === "connection" ||
        activeTab === "security" ||
        activeTab === "reports" ||
        activeTab === "appearance") && (
        <div className="flex items-center gap-2 border-t border-[var(--color-border-default)] pt-3">
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="btn btn-sm btn-primary"
            data-testid="settings-save"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
          <button
            onClick={handleResetDefaults}
            className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            data-testid="settings-reset"
          >
            Reset to Defaults
          </button>
          {dirty && (
            <span className="text-caption text-[var(--color-warning)]">Unsaved changes</span>
          )}
        </div>
      )}
    </div>
  );
}
