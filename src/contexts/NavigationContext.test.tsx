import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { type ReactNode } from "react";
import {
  NavigationProvider,
  useNavigation,
  resetTabIdCounter,
} from "./NavigationContext";

function wrapper({ children }: { children: ReactNode }) {
  return <NavigationProvider>{children}</NavigationProvider>;
}

describe("useNavigation", () => {
  beforeEach(() => {
    resetTabIdCounter();
  });

  it("should throw when used outside provider", () => {
    expect(() => {
      renderHook(() => useNavigation());
    }).toThrow("useNavigation must be used within NavigationProvider");
  });

  it("should start with home tab", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    expect(result.current.openTabs).toHaveLength(1);
    expect(result.current.openTabs[0].moduleId).toBe("home");
    expect(result.current.openTabs[0].isPinned).toBe(true);
    expect(result.current.activeTabId).toBe("tab-home");
  });

  it("should start with home breadcrumb", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    expect(result.current.breadcrumbs).toHaveLength(1);
    expect(result.current.breadcrumbs[0].label).toBe("Home");
  });

  it("should start with sidebar expanded", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    expect(result.current.sidebarExpanded).toBe(true);
  });

  // --- openTab ---

  it("should open a new tab", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });

    act(() => {
      result.current.openTab("Users", "users", "user");
    });

    expect(result.current.openTabs).toHaveLength(2);
    expect(result.current.openTabs[1].title).toBe("Users");
    expect(result.current.openTabs[1].moduleId).toBe("users");
    expect(result.current.openTabs[1].isPinned).toBe(false);
    expect(result.current.activeTabId).toBe(result.current.openTabs[1].id);
  });

  it("should not duplicate tab for same moduleId", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });

    act(() => {
      result.current.openTab("Users", "users");
    });
    act(() => {
      result.current.openTab("Users", "users");
    });

    expect(result.current.openTabs).toHaveLength(2); // home + users
  });

  it("should activate existing tab when opening same moduleId", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });

    let tabId: string;
    act(() => {
      const tab = result.current.openTab("Users", "users");
      tabId = tab.id;
    });
    act(() => {
      result.current.openTab("Computers", "computers");
    });
    act(() => {
      result.current.openTab("Users", "users");
    });

    expect(result.current.activeTabId).toBe(tabId!);
  });

  // --- closeTab ---

  it("should close a non-pinned tab", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });

    act(() => {
      result.current.openTab("Users", "users");
    });
    act(() => {
      result.current.closeTab(result.current.openTabs[1].id);
    });

    expect(result.current.openTabs).toHaveLength(1);
    expect(result.current.openTabs[0].moduleId).toBe("home");
  });

  it("should not close a pinned tab", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });

    act(() => {
      result.current.closeTab("tab-home");
    });

    expect(result.current.openTabs).toHaveLength(1);
  });

  it("should select adjacent tab when closing active tab", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });

    act(() => {
      result.current.openTab("Users", "users");
    });
    act(() => {
      result.current.openTab("Computers", "computers");
    });

    const usersTabId = result.current.openTabs[1].id;
    act(() => {
      result.current.activateTab(usersTabId);
    });
    act(() => {
      result.current.closeTab(usersTabId);
    });

    // Should activate the tab at the same index or last
    expect(result.current.activeTabId).not.toBe(usersTabId);
  });

  // --- closeAllTabs ---

  it("should close all non-pinned tabs", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });

    act(() => {
      result.current.openTab("Users", "users");
    });
    act(() => {
      result.current.openTab("Computers", "computers");
    });
    act(() => {
      result.current.closeAllTabs();
    });

    expect(result.current.openTabs).toHaveLength(1);
    expect(result.current.openTabs[0].isPinned).toBe(true);
    expect(result.current.activeTabId).toBe("tab-home");
  });

  // --- activateTab ---

  it("should activate a tab by id", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });

    act(() => {
      result.current.openTab("Users", "users");
    });
    act(() => {
      result.current.openTab("Computers", "computers");
    });
    act(() => {
      result.current.activateTab(result.current.openTabs[1].id);
    });

    expect(result.current.activeTabId).toBe(result.current.openTabs[1].id);
  });

  it("should update breadcrumbs on tab activation", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });

    act(() => {
      result.current.openTab("Users", "users");
    });

    expect(result.current.breadcrumbs).toHaveLength(2);
    expect(result.current.breadcrumbs[1].label).toBe("Users");

    act(() => {
      result.current.activateTab("tab-home");
    });

    expect(result.current.breadcrumbs).toHaveLength(1);
    expect(result.current.breadcrumbs[0].label).toBe("Home");
  });

  // --- moveTab ---

  it("should reorder tabs", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });

    act(() => {
      result.current.openTab("Users", "users");
    });
    act(() => {
      result.current.openTab("Computers", "computers");
    });

    act(() => {
      result.current.moveTab(1, 2);
    });

    expect(result.current.openTabs[1].moduleId).toBe("computers");
    expect(result.current.openTabs[2].moduleId).toBe("users");
  });

  it("should handle invalid move indices gracefully", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });

    act(() => {
      result.current.moveTab(-1, 5);
    });

    expect(result.current.openTabs).toHaveLength(1); // No crash
  });

  // --- sidebar ---

  it("should toggle sidebar", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });

    act(() => {
      result.current.toggleSidebar();
    });

    expect(result.current.sidebarExpanded).toBe(false);

    act(() => {
      result.current.toggleSidebar();
    });

    expect(result.current.sidebarExpanded).toBe(true);
  });

  it("should set sidebar expanded state directly", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });

    act(() => {
      result.current.setSidebarExpanded(false);
    });

    expect(result.current.sidebarExpanded).toBe(false);
  });

  // --- navigateTo ---

  it("should navigate to a module by opening its tab", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });

    act(() => {
      result.current.navigateTo("users", "User Lookup");
    });

    expect(result.current.openTabs).toHaveLength(2);
    expect(result.current.openTabs[1].title).toBe("User Lookup");
    expect(result.current.activeTabId).toBe(result.current.openTabs[1].id);
  });
});
