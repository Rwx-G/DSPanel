import {
  User,
  Users,
  Monitor,
  KeyRound,
  Settings,
  Home,
  GitCompareArrows,
  FolderSearch,
  Layers,
  ShieldAlert,
  Trash2,
  Contact,
  Printer,
  Activity,
  GitBranch,
  Globe,
  Network,
  Shield,
  Gauge,
  Radar,
  Route,
  Sparkles,
  ClipboardList,
  Info,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@/contexts/NavigationContext";
import { usePermissions } from "@/hooks/usePermissions";
import { type SidebarModule } from "@/types/navigation";
import { About } from "@/pages/About";

const ICON_MAP: Record<string, LucideIcon> = {
  home: Home,
  user: User,
  computer: Monitor,
  key: KeyRound,
  settings: Settings,
  compare: GitCompareArrows,
  "users-group": Users,
  "folder-search": FolderSearch,
  layers: Layers,
  "shield-alert": ShieldAlert,
  "recycle-bin": Trash2,
  contact: Contact,
  printer: Printer,
  activity: Activity,
  "git-branch": GitBranch,
  globe: Globe,
  network: Network,
  shield: Shield,
  gauge: Gauge,
  radar: Radar,
  route: Route,
  sparkles: Sparkles,
  "clipboard-list": ClipboardList,
  info: Info,
};

const MODULES: SidebarModule[] = [
  {
    id: "users",
    label: "User Lookup",
    icon: "user",
    group: "Directory",
    requiredLevel: "ReadOnly",
  },
  {
    id: "user-comparison",
    label: "User Comparison",
    icon: "compare",
    group: "Directory",
    requiredLevel: "ReadOnly",
  },
  {
    id: "groups",
    label: "Group Management",
    icon: "users-group",
    group: "Directory",
    requiredLevel: "ReadOnly",
  },
  {
    id: "group-hygiene",
    label: "Group Hygiene",
    icon: "shield-alert",
    group: "Directory",
    requiredLevel: "AccountOperator",
  },
  {
    id: "bulk-operations",
    label: "Groups Bulk Operation",
    icon: "layers",
    group: "Directory",
    requiredLevel: "AccountOperator",
  },
  {
    id: "computers",
    label: "Computer Lookup",
    icon: "computer",
    group: "Directory",
    requiredLevel: "ReadOnly",
  },
  {
    id: "contacts",
    label: "Contacts",
    icon: "contact",
    group: "Directory",
    requiredLevel: "ReadOnly",
  },
  {
    id: "printers",
    label: "Printers",
    icon: "printer",
    group: "Directory",
    requiredLevel: "ReadOnly",
  },
  {
    id: "recycle-bin",
    label: "Recycle Bin",
    icon: "recycle-bin",
    group: "Directory",
    requiredLevel: "Admin",
  },
  {
    id: "automated-cleanup",
    label: "Automated Cleanup",
    icon: "sparkles",
    group: "Directory",
    requiredLevel: "DomainAdmin",
  },
  {
    id: "infrastructure-health",
    label: "Infrastructure Health",
    icon: "activity",
    group: "Infrastructure",
    requiredLevel: "Admin",
  },
  {
    id: "replication-status",
    label: "Replication Status",
    icon: "git-branch",
    group: "Infrastructure",
    requiredLevel: "Admin",
  },
  {
    id: "dns-kerberos",
    label: "DNS & Kerberos",
    icon: "globe",
    group: "Infrastructure",
    requiredLevel: "Admin",
  },
  {
    id: "topology",
    label: "AD Topology",
    icon: "network",
    group: "Infrastructure",
    requiredLevel: "Admin",
  },
  {
    id: "gpo-viewer",
    label: "GPO Viewer",
    icon: "shield",
    group: "Infrastructure",
    requiredLevel: "Admin",
  },
  {
    id: "security-dashboard",
    label: "Privileged Accounts",
    icon: "shield",
    group: "Security",
    requiredLevel: "Admin",
  },
  {
    id: "risk-score",
    label: "Risk Score",
    icon: "gauge",
    group: "Security",
    requiredLevel: "Admin",
  },
  {
    id: "attack-detection",
    label: "Attack Detection",
    icon: "radar",
    group: "Security",
    requiredLevel: "DomainAdmin",
  },
  {
    id: "escalation-paths",
    label: "Escalation Paths",
    icon: "route",
    group: "Security",
    requiredLevel: "Admin",
  },
  {
    id: "compliance-reports",
    label: "Compliance Reports",
    icon: "shield",
    group: "Security",
    requiredLevel: "DomainAdmin",
  },
  {
    id: "ntfs-analyzer",
    label: "NTFS Analyzer",
    icon: "folder-search",
    group: "Tools",
    requiredLevel: "ReadOnly",
  },
  {
    id: "password-generator",
    label: "Password Generator",
    icon: "key",
    group: "Tools",
    requiredLevel: "ReadOnly",
  },
  {
    id: "presets",
    label: "Preset Management",
    icon: "settings",
    group: "Workflows",
    requiredLevel: "AccountOperator",
  },
  {
    id: "onboarding",
    label: "Onboarding",
    icon: "user",
    group: "Workflows",
    requiredLevel: "AccountOperator",
  },
  {
    id: "offboarding",
    label: "Offboarding",
    icon: "user",
    group: "Workflows",
    requiredLevel: "AccountOperator",
  },
  {
    id: "audit-log",
    label: "Activity Journal",
    icon: "clipboard-list",
    group: "Settings",
    requiredLevel: "ReadOnly",
  },
  {
    id: "settings",
    label: "Settings",
    icon: "settings",
    group: "Settings",
    requiredLevel: "ReadOnly",
  },
  {
    id: "about",
    label: "About",
    icon: "info",
    group: "Settings",
    requiredLevel: "ReadOnly",
  },
];

interface SidebarProps {
  expanded: boolean;
  onToggle: () => void;
}

export function Sidebar({ expanded, onToggle }: SidebarProps) {
  const { t } = useTranslation(["sidebar", "common"]);
  const { openTab, activeTabId, openTabs, goHome } = useNavigation();
  const { hasPermission } = usePermissions();
  const [showAbout, setShowAbout] = useState(false);
  const activeModuleId = openTabs.find((t) => t.id === activeTabId)?.moduleId;

  const GROUP_LABEL_KEYS: Record<string, string> = {
    Directory: "directory",
    Infrastructure: "infrastructure",
    Security: "security",
    Tools: "tools",
    Workflows: "workflows",
    Settings: "settings",
  };

  const MODULE_LABEL_KEYS: Record<string, string> = {
    users: "userLookup",
    "user-comparison": "userComparison",
    groups: "groupManagement",
    "group-hygiene": "groupHygiene",
    "bulk-operations": "bulkOperations",
    computers: "computerLookup",
    contacts: "contacts",
    printers: "printers",
    "recycle-bin": "recycleBin",
    "automated-cleanup": "automatedCleanup",
    "infrastructure-health": "infrastructureHealth",
    "replication-status": "replicationStatus",
    "dns-kerberos": "dnsKerberos",
    topology: "adTopology",
    "gpo-viewer": "gpoViewer",
    "security-dashboard": "privilegedAccounts",
    "risk-score": "riskScore",
    "attack-detection": "attackDetection",
    "escalation-paths": "escalationPaths",
    "compliance-reports": "complianceReports",
    "ntfs-analyzer": "ntfsAnalyzer",
    "password-generator": "passwordGenerator",
    presets: "presetManagement",
    onboarding: "onboarding",
    offboarding: "offboarding",
    "audit-log": "activityJournal",
    settings: "settings",
    about: "about",
  };

  const groups = MODULES.filter((mod) => hasPermission(mod.requiredLevel)).reduce(
    (acc, mod) => {
      if (!acc[mod.group]) acc[mod.group] = [];
      acc[mod.group].push(mod);
      return acc;
    },
    {} as Record<string, SidebarModule[]>,
  );

  return (
    <aside
      className="flex shrink-0 flex-col overflow-hidden border-r border-[var(--color-border-default)] bg-[var(--color-sidebar-bg)] transition-[width] duration-300 ease-in-out"
      style={{
        width: expanded
          ? "var(--sidebar-width-expanded)"
          : "var(--sidebar-width-collapsed)",
      }}
      data-testid="sidebar"
    >
      {/* Header / Toggle */}
      <div
        className={`flex h-12 items-center border-b border-[var(--color-border-default)] px-2 ${!expanded ? "justify-center" : ""}`}
      >
        {expanded && (
          <button
            className="flex-1 truncate px-2 text-left text-body font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-primary)] transition-colors duration-150"
            onClick={goHome}
            title={t("sidebar:goToHome")}
          >
            {t("sidebar:appTitle")}
          </button>
        )}
        <button
          className="btn btn-ghost flex h-8 w-8 shrink-0 items-center justify-center rounded-md p-0"
          onClick={onToggle}
          aria-label={expanded ? t("sidebar:collapseSidebar") : t("sidebar:expandSidebar")}
          data-testid="sidebar-toggle"
        >
          <span className="text-[16px] leading-none text-[var(--color-text-secondary)]">
            {expanded ? "\u276E" : "\u276F"}
          </span>
        </button>
      </div>

      {/* Navigation */}
      <nav
        aria-label={t("sidebar:mainNavigation")}
        className="flex-1 overflow-y-auto overflow-x-hidden py-2"
      >
        {Object.entries(groups).map(([groupName, modules], groupIndex) => (
          <div
            key={groupName}
            className="mb-1"
            role="group"
            aria-label={t(`sidebar:${GROUP_LABEL_KEYS[groupName] ?? groupName.toLowerCase()}`)}
          >
            {expanded && (
              <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-sidebar-group-label)]">
                {t(`sidebar:${GROUP_LABEL_KEYS[groupName] ?? groupName.toLowerCase()}`)}
              </div>
            )}
            {/* Separator in collapsed mode - skip for first group (header border-b is enough) */}
            {!expanded && groupIndex > 0 && (
              <div className="mx-2 my-1 border-b border-[var(--color-border-default)]" />
            )}
            {modules.map((mod) => {
              const IconComp = ICON_MAP[mod.icon] ?? User;
              const isActive = activeModuleId === mod.id;

              return (
                <button
                  key={mod.id}
                  className={`group relative mx-2 mb-0.5 flex w-[calc(100%-16px)] items-center gap-3 rounded-md px-3 py-2 text-left text-body transition-colors duration-150 ${
                    isActive
                      ? "bg-[var(--color-sidebar-item-active)] font-medium text-[var(--color-primary)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-sidebar-item-hover)] hover:text-[var(--color-text-primary)]"
                  } ${!expanded ? "justify-center px-0" : ""}`}
                  onClick={() => {
                    if (mod.id === "about") {
                      setShowAbout(true);
                    } else {
                      openTab(t(`sidebar:${MODULE_LABEL_KEYS[mod.id] ?? mod.id}`), mod.id, mod.icon);
                    }
                  }}
                  title={expanded ? undefined : t(`sidebar:${MODULE_LABEL_KEYS[mod.id] ?? mod.id}`)}
                  data-testid={`sidebar-item-${mod.id}`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--color-primary)]" />
                  )}
                  <IconComp size={18} className="shrink-0" />
                  {expanded && <span className="truncate">{t(`sidebar:${MODULE_LABEL_KEYS[mod.id] ?? mod.id}`)}</span>}
                  {/* Tooltip for collapsed mode */}
                  {!expanded && (
                    <span className="pointer-events-none absolute left-full z-50 ml-2 whitespace-nowrap rounded-md bg-[var(--color-surface-elevated)] px-2.5 py-1.5 text-caption font-medium text-[var(--color-text-primary)] opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
                      {t(`sidebar:${MODULE_LABEL_KEYS[mod.id] ?? mod.id}`)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {showAbout && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAbout(false);
          }}
          data-testid="about-dialog-overlay"
        >
          <div className="w-[420px] rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] shadow-xl">
            <About />
            <div className="border-t border-[var(--color-border-default)] px-4 py-3 text-right">
              <button
                onClick={() => setShowAbout(false)}
                className="btn btn-sm btn-primary"
                data-testid="about-dialog-close"
              >
                {t("common:close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
