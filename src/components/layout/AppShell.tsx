import { useEffect, useCallback, useRef } from "react";
import { useNavigation } from "@/contexts/NavigationContext";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { Breadcrumbs } from "./Breadcrumbs";
import { StatusBar, type StatusBarProps } from "./StatusBar";

const NARROW_BREAKPOINT = 900;

interface AppShellProps {
  statusBarProps: StatusBarProps;
  children: React.ReactNode;
}

export function AppShell({ statusBarProps, children }: AppShellProps) {
  const {
    sidebarExpanded,
    toggleSidebar,
    setSidebarExpanded,
    openTabs,
    activeTabId,
    activateTab,
    closeTab,
  } = useNavigation();

  // Track the user's explicit preference (not auto-collapse state)
  // Initialize from localStorage if available
  const userPrefersExpanded = useRef(
    (() => {
      try {
        const stored = localStorage.getItem("dspanel-sidebar-expanded");
        return stored !== null ? stored === "true" : true;
      } catch {
        return true;
      }
    })(),
  );

  const handleToggleSidebar = useCallback(() => {
    const newValue = !sidebarExpanded;
    userPrefersExpanded.current = newValue;
    try {
      localStorage.setItem("dspanel-sidebar-expanded", String(newValue));
    } catch {
      // localStorage unavailable
    }
    toggleSidebar();
  }, [sidebarExpanded, toggleSidebar]);

  // Auto-collapse on narrow windows, restore preference on wide
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < NARROW_BREAKPOINT) {
        setSidebarExpanded(false);
      } else {
        setSidebarExpanded(userPrefersExpanded.current);
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => window.removeEventListener("resize", handleResize);
  }, [setSidebarExpanded]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ctrl+B: toggle sidebar
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        handleToggleSidebar();
        return;
      }

      // Ctrl+W: close current tab
      if (e.ctrlKey && e.key === "w") {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab: next/previous tab
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const currentIndex = openTabs.findIndex((t) => t.id === activeTabId);
        if (currentIndex === -1) return;

        const nextIndex = e.shiftKey
          ? (currentIndex - 1 + openTabs.length) % openTabs.length
          : (currentIndex + 1) % openTabs.length;
        activateTab(openTabs[nextIndex].id);
        return;
      }

      // Ctrl+1-9: switch to tab by index
      if (e.ctrlKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (index < openTabs.length) {
          activateTab(openTabs[index].id);
        }
      }
    },
    [handleToggleSidebar, activeTabId, closeTab, openTabs, activateTab],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      className="flex h-screen flex-col bg-[var(--color-surface-bg)]"
      data-testid="app-shell"
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:rounded-md focus:bg-[var(--color-primary)] focus:px-4 focus:py-2 focus:text-white"
        data-testid="skip-to-main"
      >
        Skip to main content
      </a>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar expanded={sidebarExpanded} onToggle={handleToggleSidebar} />
        <main
          id="main-content"
          aria-label="Main content"
          className="flex flex-1 flex-col overflow-hidden"
        >
          <Breadcrumbs />
          <TabBar />
          <div className="flex-1 overflow-auto">{children}</div>
        </main>
      </div>
      <StatusBar {...statusBarProps} />
    </div>
  );
}
