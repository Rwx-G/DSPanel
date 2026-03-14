import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  NavigationProvider,
  useNavigation,
} from "@/contexts/NavigationContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { NotificationHost } from "@/components/common/NotificationHost";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { DialogProvider } from "@/contexts/DialogContext";
import { AppShell } from "@/components/layout/AppShell";
import { UserLookup } from "@/pages/UserLookup";
import { ComputerLookup } from "@/pages/ComputerLookup";
import { HomePage } from "@/pages/HomePage";
import { PasswordGenerator } from "@/pages/PasswordGenerator";
import { UserComparison } from "@/pages/UserComparison";
import { NtfsAnalyzer } from "@/pages/NtfsAnalyzer";

const APP_VERSION = __APP_VERSION__;

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
      .catch((e) => console.warn("Failed to get domain info:", e));

    invoke<boolean>("check_connection")
      .then((connected) => {
        setStatus((s) => ({ ...s, isConnected: connected }));
      })
      .catch((e) => console.warn("Failed to check connection:", e));

    invoke<string>("get_permission_level")
      .then((level) => {
        setStatus((s) => ({ ...s, permissionLevel: level }));
      })
      .catch((e) => console.warn("Failed to get permission level:", e));

    invoke<string>("get_current_username")
      .then((name) => {
        setStatus((s) => ({ ...s, username: name }));
      })
      .catch((e) => console.warn("Failed to get username:", e));

    invoke<string>("get_computer_name")
      .then((name) => {
        setStatus((s) => ({ ...s, computerName: name }));
      })
      .catch((e) => console.warn("Failed to get computer name:", e));

    invoke<string[]>("get_user_groups")
      .then((groups) => {
        setStatus((s) => ({ ...s, userGroups: groups }));
      })
      .catch((e) => console.warn("Failed to get user groups:", e));
  }, []);

  return (
    <ErrorBoundary>
      <NotificationProvider>
        <DialogProvider>
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
        </DialogProvider>
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
    case "user-comparison":
      return <UserComparison />;
    case "ntfs-analyzer":
      return <NtfsAnalyzer />;
    case "password-generator":
      return <PasswordGenerator />;
    default:
      return <HomePage status={status} />;
  }
}
