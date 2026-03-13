import { useEffect, useCallback } from "react";
import { useNavigation } from "@/contexts/NavigationContext";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { Breadcrumbs } from "./Breadcrumbs";
import { StatusBar, type StatusBarProps } from "./StatusBar";

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

  // Auto-collapse sidebar on narrow windows
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 900) {
        setSidebarExpanded(false);
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize(); // Check on mount

    return () => window.removeEventListener("resize", handleResize);
  }, [setSidebarExpanded]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ctrl+B: toggle sidebar
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
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
    [toggleSidebar, activeTabId, closeTab, openTabs, activateTab],
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
      <div className="flex flex-1 overflow-hidden">
        <Sidebar expanded={sidebarExpanded} onToggle={toggleSidebar} />
        <main className="flex flex-1 flex-col overflow-hidden">
          <Breadcrumbs />
          <TabBar />
          <div className="flex-1 overflow-auto p-4">{children}</div>
        </main>
      </div>
      <StatusBar {...statusBarProps} />
    </div>
  );
}
