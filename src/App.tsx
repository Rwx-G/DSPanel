import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  NavigationProvider,
  useNavigation,
} from "@/contexts/NavigationContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { NotificationHost } from "@/components/common/NotificationHost";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { AppShell } from "@/components/layout/AppShell";
import { UserLookup } from "@/pages/UserLookup";
import { ComputerLookup } from "@/pages/ComputerLookup";
import { HomePage } from "@/pages/HomePage";

const APP_VERSION = "0.2.0";

/** Installs a global handler for unhandled promise rejections. */
function installGlobalErrorHandlers() {
  window.addEventListener("unhandledrejection", (event) => {
    console.error("[Global] Unhandled promise rejection:", event.reason);
    event.preventDefault();
  });
}

interface DomainInfo {
  domain_name: string | null;
  is_connected: boolean;
}

export interface AppStatus {
  isConnected: boolean;
  domainName: string | null;
  permissionLevel: string;
  username: string;
  computerName: string;
  userGroups: string[];
  appVersion: string;
}

export function App() {
  const [status, setStatus] = useState<AppStatus>({
    isConnected: false,
    domainName: null,
    permissionLevel: "ReadOnly",
    username: "",
    computerName: "",
    userGroups: [],
    appVersion: APP_VERSION,
  });

  useEffect(() => {
    installGlobalErrorHandlers();

    invoke<DomainInfo>("get_domain_info")
      .then((info) => {
        setStatus((s) => ({
          ...s,
          domainName: info.domain_name,
          isConnected: info.is_connected,
        }));
      })
      .catch(() => {});

    invoke<boolean>("check_connection")
      .then((connected) => {
        setStatus((s) => ({ ...s, isConnected: connected }));
      })
      .catch(() => {});

    invoke<string>("get_permission_level")
      .then((level) => {
        setStatus((s) => ({ ...s, permissionLevel: level }));
      })
      .catch(() => {});

    invoke<string>("get_current_username")
      .then((name) => {
        setStatus((s) => ({ ...s, username: name }));
      })
      .catch(() => {});

    invoke<string>("get_computer_name")
      .then((name) => {
        setStatus((s) => ({ ...s, computerName: name }));
      })
      .catch(() => {});

    invoke<string[]>("get_user_groups")
      .then((groups) => {
        setStatus((s) => ({ ...s, userGroups: groups }));
      })
      .catch(() => {});
  }, []);

  return (
    <ErrorBoundary>
      <NotificationProvider>
        <NavigationProvider>
          <AppShell
            statusBarProps={{
              domainName: status.domainName,
              domainController: null,
              permissionLevel: status.permissionLevel,
              isConnected: status.isConnected,
              appVersion: APP_VERSION,
            }}
          >
            <ModuleRouter status={status} />
          </AppShell>
        </NavigationProvider>
        <NotificationHost />
      </NotificationProvider>
    </ErrorBoundary>
  );
}

function ModuleRouter({ status }: { status: AppStatus }) {
  const { openTabs, activeTabId } = useNavigation();
  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const moduleId = activeTab?.moduleId ?? "home";

  switch (moduleId) {
    case "users":
      return <UserLookup />;
    case "computers":
      return <ComputerLookup />;
    default:
      return <HomePage status={status} />;
  }
}
