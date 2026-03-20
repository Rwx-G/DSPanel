import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface GraphSettingsState {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export function GraphSettings() {
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
      className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-primary)] p-4"
      data-testid="graph-settings"
    >
      <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
        Microsoft Graph Integration
      </h3>
      <p className="mb-3 text-caption text-[var(--color-text-secondary)]">
        Configure Azure AD App Registration for Exchange Online diagnostics.
        Requires <code>Mail.Read</code> and <code>User.Read.All</code>{" "}
        application permissions with admin consent.
      </p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
            Tenant ID
          </label>
          <input
            type="text"
            value={config.tenantId}
            onChange={(e) => {
              setConfig((c) => ({ ...c, tenantId: e.target.value }));
              setTestResult(null);
            }}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-input-bg)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-none"
            data-testid="graph-tenant-id"
          />
        </div>

        <div>
          <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
            Application (Client) ID
          </label>
          <input
            type="text"
            value={config.clientId}
            onChange={(e) => {
              setConfig((c) => ({ ...c, clientId: e.target.value }));
              setTestResult(null);
            }}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-input-bg)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-none"
            data-testid="graph-client-id"
          />
        </div>

        <div>
          <label className="mb-1 block text-caption text-[var(--color-text-secondary)]">
            Client Secret
          </label>
          <input
            type="password"
            value={secretTouched ? config.clientSecret : ""}
            onChange={(e) => {
              setSecretTouched(true);
              setConfig((c) => ({ ...c, clientSecret: e.target.value }));
              setTestResult(null);
            }}
            placeholder={hasStoredSecret && !secretTouched ? "Stored in OS credential store" : "Client secret value"}
            className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-input-bg)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-none"
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
          {testing ? "Testing..." : "Test Connection"}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn btn-sm btn-primary"
          data-testid="graph-save-btn"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {testResult !== null && (
        <div
          className={`mt-2 text-caption ${testResult ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}
          data-testid="graph-test-status"
        >
          {testResult
            ? "Connection successful."
            : "Connection failed. Check tenant ID, client ID, and client secret."}
        </div>
      )}
    </div>
  );
}
