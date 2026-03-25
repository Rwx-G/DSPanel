import {
  User,
  Users,
  Monitor,
  KeyRound,
  Settings,
  Home,
  Sun,
  Moon,
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
  type LucideIcon,
} from "lucide-react";
import { useNavigation } from "@/contexts/NavigationContext";
import { useTheme } from "@/hooks/useTheme";
import { type SidebarModule } from "@/types/navigation";

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
    requiredLevel: "DomainAdmin",
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
    requiredLevel: "DomainAdmin",
  },
  {
    id: "replication-status",
    label: "Replication Status",
    icon: "git-branch",
    group: "Infrastructure",
    requiredLevel: "DomainAdmin",
  },
  {
    id: "dns-kerberos",
    label: "DNS & Kerberos",
    icon: "globe",
    group: "Infrastructure",
    requiredLevel: "DomainAdmin",
  },
  {
    id: "topology",
    label: "AD Topology",
    icon: "network",
    group: "Infrastructure",
    requiredLevel: "DomainAdmin",
  },
  {
    id: "security-dashboard",
    label: "Privileged Accounts",
    icon: "shield",
    group: "Security",
    requiredLevel: "DomainAdmin",
  },
  {
    id: "risk-score",
    label: "Risk Score",
    icon: "gauge",
    group: "Security",
    requiredLevel: "DomainAdmin",
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
    requiredLevel: "DomainAdmin",
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
];

interface SidebarProps {
  expanded: boolean;
  onToggle: () => void;
}

export function Sidebar({ expanded, onToggle }: SidebarProps) {
  const { openTab, activeTabId, openTabs, goHome } = useNavigation();
  const { currentTheme: mode, toggleTheme } = useTheme();
  const activeModuleId = openTabs.find((t) => t.id === activeTabId)?.moduleId;

  const groups = MODULES.reduce(
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
            title="Go to Home"
          >
            DSPanel
          </button>
        )}
        <button
          className="btn btn-ghost flex h-8 w-8 shrink-0 items-center justify-center rounded-md p-0"
          onClick={onToggle}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          data-testid="sidebar-toggle"
        >
          <span className="text-[16px] leading-none text-[var(--color-text-secondary)]">
            {expanded ? "\u276E" : "\u276F"}
          </span>
        </button>
      </div>

      {/* Navigation */}
      <nav
        aria-label="Main navigation"
        className="flex-1 overflow-y-auto overflow-x-hidden py-2"
      >
        {Object.entries(groups).map(([groupName, modules], groupIndex) => (
          <div
            key={groupName}
            className="mb-1"
            role="group"
            aria-label={groupName}
          >
            {expanded && (
              <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-sidebar-group-label)]">
                {groupName}
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
                  onClick={() => openTab(mod.label, mod.id, mod.icon)}
                  title={expanded ? undefined : mod.label}
                  data-testid={`sidebar-item-${mod.id}`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--color-primary)]" />
                  )}
                  <IconComp size={18} className="shrink-0" />
                  {expanded && <span className="truncate">{mod.label}</span>}
                  {/* Tooltip for collapsed mode */}
                  {!expanded && (
                    <span className="pointer-events-none absolute left-full z-50 ml-2 whitespace-nowrap rounded-md bg-[var(--color-surface-elevated)] px-2.5 py-1.5 text-caption font-medium text-[var(--color-text-primary)] opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
                      {mod.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer - Theme toggle */}
      <div className="border-t border-[var(--color-border-default)] p-2">
        <button
          className={`group relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-body text-[var(--color-text-secondary)] transition-colors duration-150 hover:bg-[var(--color-sidebar-item-hover)] hover:text-[var(--color-text-primary)] ${!expanded ? "justify-center px-0" : ""}`}
          onClick={toggleTheme}
          title={
            expanded ? undefined : mode === "dark" ? "Light mode" : "Dark mode"
          }
          data-testid="theme-toggle"
        >
          {mode === "dark" ? (
            <Sun size={18} className="shrink-0" />
          ) : (
            <Moon size={18} className="shrink-0" />
          )}
          {expanded && (
            <span className="truncate">
              {mode === "dark" ? "Light mode" : "Dark mode"}
            </span>
          )}
          {!expanded && (
            <span className="pointer-events-none absolute left-full z-50 ml-2 whitespace-nowrap rounded-md bg-[var(--color-surface-elevated)] px-2.5 py-1.5 text-caption font-medium text-[var(--color-text-primary)] opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
              {mode === "dark" ? "Light mode" : "Dark mode"}
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}
