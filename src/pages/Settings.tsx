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
import {
  changeLanguage,
  supportedLanguages,
  type LanguageCode,
} from "../i18n";
import { useNavigation } from "@/contexts/NavigationContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { OUPicker } from "@/components/form/OUPicker";
import { useOUTree } from "@/hooks/useOUTree";
import { useTranslation } from "react-i18next";

/** Tab definitions for the settings page. */
const TABS = [
  { id: "connection", label: "connection", icon: Link },
  { id: "presets", label: "presets", icon: FolderOpen },
  { id: "permissions", label: "permissions", icon: Shield },
  { id: "security", label: "common:security", icon: Lock },
  { id: "reports", label: "reports", icon: FileText },
  { id: "appearance", label: "appearance", icon: Palette },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface AppSettings {
  disabledOu?: string | null;
  graphTenantId?: string | null;
  graphClientId?: string | null;
  privilegedGroups?: string[] | null;
  cleanupRules?: unknown[] | null;
  auditRetentionDays?: number | null;
  riskWeights?: {
    privilegedHygiene?: number;
    passwordPolicy?: number;
    staleAccounts?: number;
    kerberosSecurity?: number;
    dangerousConfigs?: number;
    infrastructureHardening?: number;
    gpoSecurity?: number;
    trustSecurity?: number;
    certificateSecurity?: number;
  } | null;
  attackDetectionConfig?: {
    bruteForceThreshold?: number;
    kerberoastingThreshold?: number;
    excludedIps?: string[];
    excludedAccounts?: string[];
  } | null;
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
    language?: string | null;
  } | null;
  update?: {
    checkFrequency?: string | null;
    skippedVersion?: string | null;
    lastCheckTimestamp?: string | null;
  } | null;
}

export function Settings() {
  const { t } = useTranslation(["settings", "common"]);
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
      .catch((e) => notify(t("failedToLoad", { error: e }), "error"))
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
      notify(t("savedSuccessfully"), "success");
    } catch (e) {
      notify(t("failedToSave", { error: e }), "error");
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
          riskWeights: null,
          attackDetectionConfig: null,
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
          appearance: { theme: "system", language: "en" },
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

  const handleLanguageChange = useCallback(
    (lang: string) => {
      updateNested("appearance", "language", lang);
      changeLanguage(lang as LanguageCode);
    },
    [updateNested],
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
    return <LoadingSpinner message={t("loadingSettings")} />;
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4" data-testid="settings-page">
      {/* Header */}
      <div className="flex items-center gap-2">
        <SettingsIcon size={20} className="text-[var(--color-text-primary)]" />
        <h1 className="text-heading font-semibold text-[var(--color-text-primary)]">{t("pageTitle")}</h1>
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
              {t(tab.label)}
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
                {t("domainConnection")}
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
                    {t("domainOverride")}
                  </label>
                  <input
                    type="text"
                    value={settings.connection?.domainOverride ?? ""}
                    onChange={(e) => updateNested("connection", "domainOverride", e.target.value)}
                    placeholder={t("domainOverrideHint")}
                    className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none"
                    data-testid="setting-domain-override"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
                    {t("preferredDc")}
                  </label>
                  <input
                    type="text"
                    value={settings.connection?.preferredDc ?? ""}
                    onChange={(e) => updateNested("connection", "preferredDc", e.target.value)}
                    placeholder={t("preferredDcHint")}
                    className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none"
                    data-testid="setting-preferred-dc"
                  />
                </div>
              </div>
            </div>
            <GraphSettings />
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
              <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
                {t("updateChecks")}
              </h3>
              <div>
                <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
                  {t("checkFrequency")}
                </label>
                <select
                  value={settings.update?.checkFrequency ?? "startup"}
                  onChange={(e) => updateNested("update", "checkFrequency", e.target.value)}
                  className="w-48 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                  data-testid="setting-update-frequency"
                >
                  <option value="startup">{t("everyStartup")}</option>
                  <option value="daily">{t("daily")}</option>
                  <option value="weekly">{t("weekly")}</option>
                  <option value="never">{t("common:never")}</option>
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
                {t("auditLog")}
              </h3>
              <div>
                <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
                  {t("retentionPeriod")}
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
                  {t("retentionHint")}
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
              <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
                {t("offboarding")}
              </h3>
              <div>
                <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
                  {t("disabledUsersOu")}
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
                      {t("common:clear")}
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
                  {t("disabledUsersOuHint")}
                </p>
              </div>
            </div>

            {/* Risk Score Weights */}
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
              <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
                {t("riskScoreWeights")}
              </h3>
              <p className="mb-3 text-caption text-[var(--color-text-secondary)]">
                {t("riskWeightsHint")}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {([
                  ["privilegedHygiene", t("privilegedHygiene"), 15],
                  ["passwordPolicy", t("passwordPolicy"), 10],
                  ["staleAccounts", t("staleAccounts"), 10],
                  ["kerberosSecurity", t("kerberosSecurity"), 20],
                  ["dangerousConfigs", t("dangerousConfigs"), 10],
                  ["infrastructureHardening", t("infrastructureHardening"), 10],
                  ["gpoSecurity", t("gpoSecurity"), 10],
                  ["trustSecurity", t("trustSecurity"), 10],
                  ["certificateSecurity", t("certificateSecurity"), 5],
                ] as const).map(([key, label, defaultVal]) => (
                  <div key={key} className="flex items-center gap-2">
                    <label className="w-44 text-caption text-[var(--color-text-secondary)]">{label}</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={settings.riskWeights?.[key] ?? defaultVal}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setSettings((prev) => ({
                          ...prev,
                          riskWeights: {
                            ...{
                              privilegedHygiene: 15, passwordPolicy: 10, staleAccounts: 10,
                              kerberosSecurity: 20, dangerousConfigs: 10, infrastructureHardening: 10,
                              gpoSecurity: 10, trustSecurity: 10, certificateSecurity: 5,
                            },
                            ...prev.riskWeights,
                            [key]: isNaN(val) ? defaultVal : val,
                          },
                        }));
                        setDirty(true);
                      }}
                      className="w-20 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1 text-body text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                      data-testid={`setting-weight-${key}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Attack Detection Config */}
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
              <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
                {t("attackDetection")}
              </h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="w-44 text-caption text-[var(--color-text-secondary)]">{t("bruteForceThreshold")}</label>
                  <input
                    type="number"
                    min={1}
                    value={settings.attackDetectionConfig?.bruteForceThreshold ?? 10}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setSettings((prev) => ({
                        ...prev,
                        attackDetectionConfig: {
                          ...{ bruteForceThreshold: 10, kerberoastingThreshold: 3, excludedIps: [], excludedAccounts: [] },
                          ...prev.attackDetectionConfig,
                          bruteForceThreshold: isNaN(val) ? 10 : val,
                        },
                      }));
                      setDirty(true);
                    }}
                    className="w-20 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1 text-body text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                    data-testid="setting-brute-force-threshold"
                  />
                  <span className="text-caption text-[var(--color-text-secondary)]">{t("failedLoginsFromSameIp")}</span>
                </div>
                <div className="flex items-center gap-3">
                  <label className="w-44 text-caption text-[var(--color-text-secondary)]">{t("kerberoastingThreshold")}</label>
                  <input
                    type="number"
                    min={1}
                    value={settings.attackDetectionConfig?.kerberoastingThreshold ?? 3}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setSettings((prev) => ({
                        ...prev,
                        attackDetectionConfig: {
                          ...{ bruteForceThreshold: 10, kerberoastingThreshold: 3, excludedIps: [], excludedAccounts: [] },
                          ...prev.attackDetectionConfig,
                          kerberoastingThreshold: isNaN(val) ? 3 : val,
                        },
                      }));
                      setDirty(true);
                    }}
                    className="w-20 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1 text-body text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                    data-testid="setting-kerberoasting-threshold"
                  />
                  <span className="text-caption text-[var(--color-text-secondary)]">{t("tgsRequestsWithRc4")}</span>
                </div>
                <div>
                  <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
                    {t("excludedIps")}
                  </label>
                  <input
                    type="text"
                    value={(settings.attackDetectionConfig?.excludedIps ?? []).join(", ")}
                    onChange={(e) => {
                      const ips = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                      setSettings((prev) => ({
                        ...prev,
                        attackDetectionConfig: {
                          ...{ bruteForceThreshold: 10, kerberoastingThreshold: 3, excludedIps: [], excludedAccounts: [] },
                          ...prev.attackDetectionConfig,
                          excludedIps: ips,
                        },
                      }));
                      setDirty(true);
                    }}
                    placeholder={t("excludedIpsPlaceholder")}
                    className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none"
                    data-testid="setting-excluded-ips"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
                    {t("excludedAccounts")}
                  </label>
                  <input
                    type="text"
                    value={(settings.attackDetectionConfig?.excludedAccounts ?? []).join(", ")}
                    onChange={(e) => {
                      const accts = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                      setSettings((prev) => ({
                        ...prev,
                        attackDetectionConfig: {
                          ...{ bruteForceThreshold: 10, kerberoastingThreshold: 3, excludedIps: [], excludedAccounts: [] },
                          ...prev.attackDetectionConfig,
                          excludedAccounts: accts,
                        },
                      }));
                      setDirty(true);
                    }}
                    placeholder={t("excludedAccountsPlaceholder")}
                    className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none"
                    data-testid="setting-excluded-accounts"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "reports" && (
          <div className="space-y-4" data-testid="tab-content-reports">
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
              <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
                {t("exportDefaults")}
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
                    {t("defaultExportFormat")}
                  </label>
                  <select
                    value={settings.reports?.defaultFormat ?? "CSV"}
                    onChange={(e) => updateNested("reports", "defaultFormat", e.target.value)}
                    className="w-48 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                    data-testid="setting-export-format"
                  >
                    <option value="CSV">{t("common:csv")}</option>
                    <option value="PDF">{t("common:pdf")}</option>
                    <option value="HTML">{t("common:html")}</option>
                    <option value="XLSX">{t("common:excel")}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
                    {t("defaultExportDirectory")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={settings.reports?.defaultExportPath ?? ""}
                      onChange={(e) =>
                        updateNested("reports", "defaultExportPath", e.target.value)
                      }
                      placeholder={t("exportDirHint")}
                      className="flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none"
                      data-testid="setting-export-path"
                    />
                    <button
                      onClick={handlePickExportDir}
                      className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                      data-testid="setting-export-path-browse"
                    >
                      {t("common:browse")}
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
                {t("theme")}
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
                      {mode === "light" ? t("light") : mode === "dark" ? t("dark") : t("system")}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-caption text-[var(--color-text-secondary)]">
                {t("systemThemeHint")}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
              <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
                Language
              </h3>
              <select
                value={settings.appearance?.language ?? "en"}
                onChange={(e) => handleLanguageChange(e.target.value)}
                className="rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-2 text-body text-[var(--color-text-primary)]"
                data-testid="language-select"
              >
                {supportedLanguages.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
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
            {saving ? t("common:saving") : t("saveSettings")}
          </button>
          <button
            onClick={handleResetDefaults}
            className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            data-testid="settings-reset"
          >
            {t("resetToDefaults")}
          </button>
          {dirty && (
            <span className="text-caption text-[var(--color-warning)]">{t("common:unsavedChanges")}</span>
          )}
        </div>
      )}
    </div>
  );
}
