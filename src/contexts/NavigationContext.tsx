import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { type TabItem, type BreadcrumbSegment } from "@/types/navigation";

interface NavigationState {
  openTabs: TabItem[];
  activeTabId: string | null;
  breadcrumbs: BreadcrumbSegment[];
  sidebarExpanded: boolean;
  navigateTo: (moduleId: string, title: string) => void;
  openTab: (title: string, moduleId: string, icon?: string) => TabItem;
  closeTab: (tabId: string) => void;
  closeAllTabs: () => void;
  activateTab: (tabId: string) => void;
  moveTab: (fromIndex: number, toIndex: number) => void;
  toggleSidebar: () => void;
  setSidebarExpanded: (expanded: boolean) => void;
}

const NavigationContext = createContext<NavigationState | null>(null);

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error("useNavigation must be used within NavigationProvider");
  }
  return ctx;
}

let tabIdCounter = 0;

function generateTabId(): string {
  tabIdCounter += 1;
  return `tab-${tabIdCounter}`;
}

// Exported for testing
export function resetTabIdCounter() {
  tabIdCounter = 0;
}

const HOME_TAB: TabItem = {
  id: "tab-home",
  title: "Home",
  moduleId: "home",
  icon: "home",
  isPinned: true,
};

interface NavigationProviderProps {
  children: ReactNode;
}

export function NavigationProvider({ children }: NavigationProviderProps) {
  const [openTabs, setOpenTabs] = useState<TabItem[]>([HOME_TAB]);
  const [activeTabId, setActiveTabId] = useState<string>("tab-home");
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbSegment[]>([
    { label: "Home", navigationTarget: "home" },
  ]);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);

  const openTab = useCallback(
    (title: string, moduleId: string, icon?: string): TabItem => {
      // Check if tab with same moduleId already exists
      const existing = openTabs.find((t) => t.moduleId === moduleId);
      if (existing) {
        setActiveTabId(existing.id);
        setBreadcrumbs([
          { label: "Home", navigationTarget: "home" },
          { label: title, navigationTarget: moduleId },
        ]);
        return existing;
      }

      const newTab: TabItem = {
        id: generateTabId(),
        title,
        moduleId,
        icon,
        isPinned: false,
      };

      setOpenTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
      setBreadcrumbs([
        { label: "Home", navigationTarget: "home" },
        { label: title, navigationTarget: moduleId },
      ]);

      return newTab;
    },
    [openTabs],
  );

  const navigateTo = useCallback(
    (moduleId: string, title: string) => {
      openTab(title, moduleId);
    },
    [openTab],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      setOpenTabs((prev) => {
        const tab = prev.find((t) => t.id === tabId);
        if (!tab || tab.isPinned) return prev;

        const filtered = prev.filter((t) => t.id !== tabId);

        // If we're closing the active tab, select adjacent
        if (tabId === activeTabId) {
          const closedIndex = prev.findIndex((t) => t.id === tabId);
          const newActiveIndex = Math.min(closedIndex, filtered.length - 1);
          const newActive = filtered[newActiveIndex];
          if (newActive) {
            setActiveTabId(newActive.id);
            setBreadcrumbs([
              { label: "Home", navigationTarget: "home" },
              ...(newActive.moduleId !== "home"
                ? [
                    {
                      label: newActive.title,
                      navigationTarget: newActive.moduleId,
                    },
                  ]
                : []),
            ]);
          }
        }

        return filtered;
      });
    },
    [activeTabId],
  );

  const closeAllTabs = useCallback(() => {
    setOpenTabs((prev) => prev.filter((t) => t.isPinned));
    setActiveTabId("tab-home");
    setBreadcrumbs([{ label: "Home", navigationTarget: "home" }]);
  }, []);

  const activateTab = useCallback(
    (tabId: string) => {
      const tab = openTabs.find((t) => t.id === tabId);
      if (tab) {
        setActiveTabId(tabId);
        setBreadcrumbs([
          { label: "Home", navigationTarget: "home" },
          ...(tab.moduleId !== "home"
            ? [{ label: tab.title, navigationTarget: tab.moduleId }]
            : []),
        ]);
      }
    },
    [openTabs],
  );

  const moveTab = useCallback((fromIndex: number, toIndex: number) => {
    setOpenTabs((prev) => {
      if (
        fromIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex < 0 ||
        toIndex >= prev.length
      ) {
        return prev;
      }
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarExpanded((prev) => !prev);
  }, []);

  return (
    <NavigationContext.Provider
      value={{
        openTabs,
        activeTabId,
        breadcrumbs,
        sidebarExpanded,
        navigateTo,
        openTab,
        closeTab,
        closeAllTabs,
        activateTab,
        moveTab,
        toggleSidebar,
        setSidebarExpanded,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}
