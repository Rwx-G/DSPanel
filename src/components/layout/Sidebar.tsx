import {
  User,
  Monitor,
  Settings,
  ChevronLeft,
  ChevronRight,
  Home,
  type LucideIcon,
} from "lucide-react";
import { useNavigation } from "@/contexts/NavigationContext";
import { type SidebarModule } from "@/types/navigation";

const ICON_MAP: Record<string, LucideIcon> = {
  home: Home,
  user: User,
  computer: Monitor,
  settings: Settings,
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
    id: "computers",
    label: "Computer Lookup",
    icon: "computer",
    group: "Directory",
    requiredLevel: "ReadOnly",
  },
];

interface SidebarProps {
  expanded: boolean;
  onToggle: () => void;
}

export function Sidebar({ expanded, onToggle }: SidebarProps) {
  const { openTab, activeTabId, openTabs } = useNavigation();
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
      className="flex flex-col border-r border-[var(--color-border-default)] bg-[var(--color-surface-card)] transition-[width] duration-[var(--transition-normal)]"
      style={{ width: expanded ? 220 : 48 }}
      data-testid="sidebar"
    >
      <button
        className="btn-ghost flex items-center justify-center p-2"
        onClick={onToggle}
        aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        data-testid="sidebar-toggle"
      >
        {expanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>

      <nav className="flex-1 overflow-y-auto">
        {Object.entries(groups).map(([groupName, modules]) => (
          <div key={groupName} className="mb-2">
            {expanded && (
              <div className="text-caption px-3 py-1 text-[var(--color-text-secondary)] uppercase tracking-wider">
                {groupName}
              </div>
            )}
            {modules.map((mod) => {
              const IconComp = ICON_MAP[mod.icon] ?? User;
              const isActive = activeModuleId === mod.id;

              return (
                <button
                  key={mod.id}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-[var(--transition-fast)] ${
                    isActive
                      ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
                      : "text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                  }`}
                  onClick={() => openTab(mod.label, mod.id, mod.icon)}
                  title={mod.label}
                  data-testid={`sidebar-item-${mod.id}`}
                >
                  <IconComp size={18} />
                  {expanded && (
                    <span className="text-body truncate">{mod.label}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
