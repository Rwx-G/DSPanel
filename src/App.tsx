import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { NavigationProvider } from "@/contexts/NavigationContext";
import { AppShell } from "@/components/layout/AppShell";

const APP_VERSION = "0.1.0";

export function App() {
  const [backendReady, setBackendReady] = useState(false);
  const [domainName, setDomainName] = useState<string | null>(null);
  const [domainController, setDomainController] = useState<string | null>(null);
  const [permissionLevel, setPermissionLevel] = useState("ReadOnly");

  useEffect(() => {
    invoke<string>("get_app_title")
      .then(() => {
        setBackendReady(true);
      })
      .catch(() => {
        setBackendReady(false);
      });

    invoke<string>("get_permission_level")
      .then((level) => {
        setPermissionLevel(level);
      })
      .catch(() => {});
  }, []);

  return (
    <NavigationProvider>
      <AppShell
        statusBarProps={{
          domainName,
          domainController,
          permissionLevel,
          isConnected: backendReady,
          appVersion: APP_VERSION,
        }}
      >
        <div
          className="flex h-full items-center justify-center"
          data-testid="main-content"
        >
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
              DSPanel
            </h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              {backendReady ? "Backend connected" : "Connecting to backend..."}
            </p>
          </div>
        </div>
      </AppShell>
    </NavigationProvider>
  );
}
