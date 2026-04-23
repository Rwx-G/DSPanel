import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadPersistedLanguage } from "./i18n";
import { LoginDialog } from "@/components/dialogs/LoginDialog";
import {
  NavigationProvider,
  useNavigation,
} from "@/contexts/NavigationContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { NotificationHost } from "@/components/common/NotificationHost";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { DialogProvider } from "@/contexts/DialogContext";
import { useTheme } from "@/hooks/useTheme";
import { AppShell } from "@/components/layout/AppShell";
import { UserLookup } from "@/pages/UserLookup";
import { ComputerLookup } from "@/pages/ComputerLookup";
import { HomePage } from "@/pages/HomePage";
import { PasswordGenerator } from "@/pages/PasswordGenerator";
import { UserComparison } from "@/pages/UserComparison";
import { NtfsAnalyzer } from "@/pages/NtfsAnalyzer";
import { GroupManagement } from "@/pages/GroupManagement";
import { BulkOperations } from "@/pages/BulkOperations";
import { GroupHygiene } from "@/pages/GroupHygiene";
import { PresetManagement } from "@/pages/PresetManagement";
import { OnboardingWizard } from "@/pages/OnboardingWizard";
import { Offboarding } from "@/pages/Offboarding";
import { RecycleBin } from "@/pages/RecycleBin";
import { ContactLookup } from "@/pages/ContactLookup";
import { PrinterLookup } from "@/pages/PrinterLookup";
import { InfrastructureHealth } from "@/pages/InfrastructureHealth";
import { ReplicationStatus } from "@/pages/ReplicationStatus";
import { DnsKerberosValidation } from "@/pages/DnsKerberosValidation";
import { TopologyView } from "@/pages/TopologyView";
import { SecurityDashboard } from "@/pages/SecurityDashboard";
import { RiskScoreDashboard } from "@/pages/RiskScore";
import { AttackDetection } from "@/pages/AttackDetection";
import { EscalationPaths } from "@/pages/EscalationPaths";
import { AutomatedCleanup } from "@/pages/AutomatedCleanup";
import { ComplianceReports } from "@/pages/ComplianceReports";
import { AuditLog } from "@/pages/AuditLog";
import { GpoViewer } from "@/pages/GpoViewer";
import { Settings } from "@/pages/Settings";

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
  connection_error?: string | null;
}

export interface AppStatus {
  isConnected: boolean;
  domainName: string | null;
  connectionError: string | null;
  permissionLevel: string;
  authenticatedUser: string;
  username: string;
  computerName: string;
  platform: string;
  userGroups: string[];
  appVersion: string;
}

export function App() {
  // Apply theme on mount (must be called in a component that always renders)
  useTheme();

  const [status, setStatus] = useState<AppStatus>({
    isConnected: false,
    domainName: null,
    connectionError: null,
    permissionLevel: "ReadOnly",
    authenticatedUser: "",
    username: "",
    computerName: "",
    platform: "",
    userGroups: [],
    appVersion: APP_VERSION,
  });
  const [needsLogin, setNeedsLogin] = useState(false);
  const [loginChecked, setLoginChecked] = useState(false);

  const refreshStatus = useCallback(() => {
    invoke<DomainInfo>("get_domain_info")
      .then((info) => {
        setStatus((s) => ({
          ...s,
          domainName: info.domain_name,
          isConnected: info.is_connected,
          connectionError: info.connection_error ?? null,
        }));
      })
      .catch((e) => console.warn("Failed to get domain info:", e));

    invoke<boolean>("check_connection")
      .then((connected) => {
        setStatus((s) => ({ ...s, isConnected: connected }));
        // Refresh the error kind after check_connection, which may have just
        // updated the provider's last_error_kind.
        invoke<DomainInfo>("get_domain_info")
          .then((info) =>
            setStatus((s) => ({
              ...s,
              connectionError: info.connection_error ?? null,
            })),
          )
          .catch(() => {});
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

    invoke<string>("get_authenticated_identity")
      .then((name) => {
        setStatus((s) => ({ ...s, authenticatedUser: name }));
      })
      .catch((e) => console.warn("Failed to get authenticated identity:", e));

    invoke<string>("get_computer_name")
      .then((name) => {
        setStatus((s) => ({ ...s, computerName: name }));
      })
      .catch((e) => console.warn("Failed to get computer name:", e));

    invoke<string>("get_platform")
      .then((platform) => {
        setStatus((s) => ({ ...s, platform }));
      })
      .catch((e) => console.warn("Failed to get platform:", e));

    invoke<string[]>("get_user_groups")
      .then((groups) => {
        setStatus((s) => ({ ...s, userGroups: groups }));
      })
      .catch((e) => console.warn("Failed to get user groups:", e));
  }, []);

  useEffect(() => {
    installGlobalErrorHandlers();
    loadPersistedLanguage();

    // Check if login prompt is needed
    invoke<boolean>("needs_credentials")
      .then((needs) => {
        setNeedsLogin(needs);
        setLoginChecked(true);
        if (!needs) {
          refreshStatus();
        }
      })
      .catch(() => {
        setLoginChecked(true);
        refreshStatus();
      });
  }, [refreshStatus]);

  // Show loading screen while checking credentials
  if (!loginChecked) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-[var(--color-surface-bg)]">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-primary)]/10">
          <svg className="h-7 w-7 animate-spin text-[var(--color-primary)]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <span className="text-body font-medium text-[var(--color-text-secondary)]">DSPanel</span>
      </div>
    );
  }

  if (needsLogin) {
    return (
      <LoginDialog
        onSuccess={() => {
          setNeedsLogin(false);
          refreshStatus();
        }}
      />
    );
  }

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

const MODULE_COMPONENTS: Record<
  string,
  React.ComponentType<Record<string, never>>
> = {
  users: UserLookup,
  computers: ComputerLookup,
  "user-comparison": UserComparison,
  groups: GroupManagement,
  "bulk-operations": BulkOperations,
  "group-hygiene": GroupHygiene,
  "ntfs-analyzer": NtfsAnalyzer,
  "password-generator": PasswordGenerator,
  presets: PresetManagement,
  onboarding: OnboardingWizard,
  offboarding: Offboarding,
  "recycle-bin": RecycleBin,
  contacts: ContactLookup,
  printers: PrinterLookup,
  "infrastructure-health": InfrastructureHealth,
  "replication-status": ReplicationStatus,
  "dns-kerberos": DnsKerberosValidation,
  topology: TopologyView,
  "security-dashboard": SecurityDashboard,
  "risk-score": RiskScoreDashboard,
  "attack-detection": AttackDetection,
  "escalation-paths": EscalationPaths,
  "automated-cleanup": AutomatedCleanup,
  "compliance-reports": ComplianceReports,
  "audit-log": AuditLog,
  "gpo-viewer": GpoViewer,
  settings: Settings,
};

function ModuleRouter({ status }: { status: AppStatus }) {
  const { openTabs, activeTabId } = useNavigation();
  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const activeModuleId = activeTab?.moduleId ?? "home";

  // Track which modules have been opened so they stay mounted
  const [mountedModules, setMountedModules] = useState<Set<string>>(new Set());

  if (activeModuleId !== "home" && !mountedModules.has(activeModuleId)) {
    setMountedModules((prev) => new Set(prev).add(activeModuleId));
  }

  // Unmount modules whose tabs have been closed
  const openModuleIds = new Set(openTabs.map((t) => t.moduleId));
  const activeMounted = Array.from(mountedModules).filter((m) =>
    openModuleIds.has(m),
  );
  if (activeMounted.length !== mountedModules.size) {
    setMountedModules(new Set(activeMounted));
  }

  return (
    <>
      {/* Home page - only render when active */}
      {activeModuleId === "home" && <HomePage status={status} />}

      {/* Keep all opened modules mounted, hide inactive ones */}
      {activeMounted.map((moduleId) => {
        const Component = MODULE_COMPONENTS[moduleId];
        if (!Component) return null;
        return (
          <div
            key={moduleId}
            className="h-full"
            style={{ display: activeModuleId === moduleId ? "block" : "none" }}
          >
            <Component />
          </div>
        );
      })}
    </>
  );
}
