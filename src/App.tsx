import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { NavigationProvider } from "@/contexts/NavigationContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { NotificationHost } from "@/components/common/NotificationHost";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { AppShell } from "@/components/layout/AppShell";
import { Shield, Users, Monitor, Search } from "lucide-react";

const APP_VERSION = "0.2.0";

/** Installs a global handler for unhandled promise rejections. */
function installGlobalErrorHandlers() {
  window.addEventListener("unhandledrejection", (event) => {
    console.error("[Global] Unhandled promise rejection:", event.reason);
    event.preventDefault();
  });
}

export function App() {
  const [backendReady, setBackendReady] = useState(false);
  const [domainName, setDomainName] = useState<string | null>(null);
  const [domainController, setDomainController] = useState<string | null>(null);
  const [permissionLevel, setPermissionLevel] = useState("ReadOnly");

  useEffect(() => {
    installGlobalErrorHandlers();

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
    <ErrorBoundary>
      <NotificationProvider>
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
              className="flex h-full items-center justify-center p-8"
              data-testid="main-content"
            >
              <div className="w-full max-w-2xl">
                {/* Welcome header */}
                <div className="mb-8 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-primary-subtle)]">
                    <Shield size={32} className="text-[var(--color-primary)]" />
                  </div>
                  <h1 className="text-h2 text-[var(--color-text-primary)]">
                    DSPanel
                  </h1>
                  <p className="mt-1 text-body text-[var(--color-text-secondary)]">
                    Active Directory Management
                  </p>
                </div>

                {/* Quick actions grid */}
                <div className="grid grid-cols-3 gap-4">
                  <QuickAction
                    icon={<Users size={20} />}
                    title="User Lookup"
                    description="Search and inspect user accounts"
                  />
                  <QuickAction
                    icon={<Monitor size={20} />}
                    title="Computer Lookup"
                    description="Search and inspect computer accounts"
                  />
                  <QuickAction
                    icon={<Search size={20} />}
                    title="Quick Search"
                    description="Search across all directory objects"
                  />
                </div>

                {/* Status */}
                <p className="mt-6 text-center text-caption text-[var(--color-text-disabled)]">
                  {backendReady
                    ? "Backend connected"
                    : "Connecting to backend..."}
                </p>
              </div>
            </div>
          </AppShell>
        </NavigationProvider>
        <NotificationHost />
      </NotificationProvider>
    </ErrorBoundary>
  );
}

function QuickAction({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button className="flex flex-col items-center gap-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-5 text-center transition-all duration-200 hover:border-[var(--color-primary)] hover:shadow-md">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]">
        {icon}
      </div>
      <span className="text-body font-medium text-[var(--color-text-primary)]">
        {title}
      </span>
      <span className="text-caption text-[var(--color-text-secondary)]">
        {description}
      </span>
    </button>
  );
}
