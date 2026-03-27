import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

interface GraphSettingsState {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export function GraphSettings() {
  const { t } = useTranslation(["components", "common"]);
  const [config, setConfig] = useState<GraphSettingsState>({
    tenantId: "",
    clientId: "",
    clientSecret: "",
  });
  const [hasStoredSecret, setHasStoredSecret] = useState(false);
  const [secretTouched, setSecretTouched] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Load non-secret settings from app settings
    invoke<{
      disabledOu?: string | null;
      graphTenantId?: string | null;
      graphClientId?: string | null;
    }>("get_app_settings")
      .then((settings) => {
        setConfig((c) => ({
          ...c,
          tenantId: settings.graphTenantId ?? "",
          clientId: settings.graphClientId ?? "",
        }));
      })
      .catch((e) => console.warn("Failed to load settings:", e));

    // Check if a secret exists in the credential store (don't retrieve the value)
    invoke<string | null>("get_credential", { key: "graph_client_secret" })
      .then((secret) => {
        if (secret) {
          setHasStoredSecret(true);
        }
      })
      .catch((e) => console.warn("Failed to check credential:", e));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setTestResult(null);
    try {
      // Store secret in OS credential store if changed
      if (secretTouched) {
        if (config.clientSecret) {
          await invoke("store_credential", {
            key: "graph_client_secret",
            value: config.clientSecret,
          });
          setHasStoredSecret(true);
        } else {
          await invoke("delete_credential", {
            key: "graph_client_secret",
          });
          setHasStoredSecret(false);
        }
        setSecretTouched(false);
      }

      // Save non-secret settings (secret is NOT in this payload)
      const current = await invoke<Record<string, unknown>>("get_app_settings");
      await invoke("set_app_settings", {
        settings: {
          ...current,
          graphTenantId: config.tenantId || null,
          graphClientId: config.clientId || null,
        },
      });
    } catch (e) {
      console.error("Failed to save Graph settings:", e);
    } finally {
      setSaving(false);
    }
  }, [config, secretTouched]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Save first so backend has the config
      await handleSave();
      const result = await invoke<boolean>("test_graph_connection");
      setTestResult(result);
    } catch {
      setTestResult(false);
    } finally {
      setTesting(false);
    }
  }, [handleSave]);

  const isConfigured = config.tenantId.trim() !== "" && config.clientId.trim() !== "";

  return (
    <div
      className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4"
      data-testid="graph-settings"
    >
      <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
        {t("components:graphSettings.title")}
      </h3>
      <p className="mb-3 text-caption text-[var(--color-text-secondary)]">
        {t("components:graphSettings.description")}
      </p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
            {t("components:graphSettings.tenantId")}
          </label>
          <input
            type="text"
            value={config.tenantId}
            onChange={(e) => {
              setConfig((c) => ({ ...c, tenantId: e.target.value }));
              setTestResult(null);
            }}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none"
            data-testid="graph-tenant-id"
          />
        </div>

        <div>
          <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
            {t("components:graphSettings.clientId")}
          </label>
          <input
            type="text"
            value={config.clientId}
            onChange={(e) => {
              setConfig((c) => ({ ...c, clientId: e.target.value }));
              setTestResult(null);
            }}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none"
            data-testid="graph-client-id"
          />
        </div>

        <div>
          <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
            {t("components:graphSettings.clientSecret")}
          </label>
          <input
            type="password"
            value={secretTouched ? config.clientSecret : ""}
            onChange={(e) => {
              setSecretTouched(true);
              setConfig((c) => ({ ...c, clientSecret: e.target.value }));
              setTestResult(null);
            }}
            placeholder={hasStoredSecret && !secretTouched ? t("components:graphSettings.clientSecretStored") : t("components:graphSettings.clientSecretPlaceholder")}
            className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none"
            data-testid="graph-client-secret"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={handleTest}
          disabled={testing || !isConfigured}
          className="btn btn-sm btn-secondary"
          data-testid="graph-test-btn"
        >
          {testing ? t("common:testing") : t("components:graphSettings.testConnection")}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn btn-sm btn-primary"
          data-testid="graph-save-btn"
        >
          {saving ? t("common:saving") : t("common:save")}
        </button>
      </div>

      {testResult !== null && (
        <div
          className={`mt-2 text-caption ${testResult ? "text-[var(--color-success)]" : "text-[var(--color-error)]"}`}
          data-testid="graph-test-status"
        >
          {testResult
            ? t("components:graphSettings.connectionSuccess")
            : t("components:graphSettings.connectionFailed")}
        </div>
      )}
    </div>
  );
}
