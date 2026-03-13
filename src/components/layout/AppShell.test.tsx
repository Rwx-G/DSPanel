import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { type ReactNode } from "react";
import {
  NavigationProvider,
  resetTabIdCounter,
} from "@/contexts/NavigationContext";
import { AppShell } from "./AppShell";

const defaultStatusBarProps = {
  domainName: "CORP.LOCAL",
  domainController: "DC01",
  permissionLevel: "ReadOnly",
  isConnected: true,
  appVersion: "0.1.0",
};

function renderAppShell(children: ReactNode = <div>Content</div>) {
  return render(
    <NavigationProvider>
      <AppShell statusBarProps={defaultStatusBarProps}>{children}</AppShell>
    </NavigationProvider>,
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    resetTabIdCounter();
  });

  it("should render the app shell", () => {
    renderAppShell();
    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
  });

  it("should render children content", () => {
    renderAppShell(<div data-testid="child">Hello</div>);
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("should render the sidebar", () => {
    renderAppShell();
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
  });

  it("should render the tab bar", () => {
    renderAppShell();
    expect(screen.getByTestId("tab-bar")).toBeInTheDocument();
  });

  it("should render the breadcrumbs", () => {
    renderAppShell();
    expect(screen.getByTestId("breadcrumbs")).toBeInTheDocument();
  });

  it("should render the status bar", () => {
    renderAppShell();
    expect(screen.getByTestId("status-bar")).toBeInTheDocument();
  });

  it("should pass status bar props correctly", () => {
    renderAppShell();
    expect(screen.getByTestId("status-connection")).toHaveTextContent(
      "Connected",
    );
    expect(screen.getByTestId("status-version")).toHaveTextContent("v0.1.0");
  });

  // Keyboard shortcuts

  it("should toggle sidebar on Ctrl+B", () => {
    renderAppShell();
    const sidebar = screen.getByTestId("sidebar");
    expect(sidebar).toHaveStyle({ width: "var(--sidebar-width-expanded)" });

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(sidebar).toHaveStyle({ width: "var(--sidebar-width-collapsed)" });

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(sidebar).toHaveStyle({ width: "var(--sidebar-width-expanded)" });
  });

  it("should close active tab on Ctrl+W", () => {
    function TestContent() {
      return <div>Content</div>;
    }

    const { container } = render(
      <NavigationProvider>
        <AppShell statusBarProps={defaultStatusBarProps}>
          <TestContent />
        </AppShell>
      </NavigationProvider>,
    );

    // Open a tab via sidebar
    fireEvent.click(screen.getByTestId("sidebar-item-users"));
    expect(screen.getByTestId("tab-users")).toBeInTheDocument();

    // Close it with Ctrl+W
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(screen.queryByTestId("tab-users")).not.toBeInTheDocument();
  });

  it("should not close pinned tab on Ctrl+W", () => {
    renderAppShell();
    // Home tab is active and pinned
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(screen.getByTestId("tab-home")).toBeInTheDocument();
  });

  it("should switch tabs on Ctrl+1-9", () => {
    render(
      <NavigationProvider>
        <AppShell statusBarProps={defaultStatusBarProps}>
          <div>Content</div>
        </AppShell>
      </NavigationProvider>,
    );

    // Open a tab
    fireEvent.click(screen.getByTestId("sidebar-item-users"));

    // Ctrl+1 should go to first tab (home)
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(screen.getByTestId("tab-home")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Ctrl+2 should go to second tab (users)
    fireEvent.keyDown(window, { key: "2", ctrlKey: true });
    expect(screen.getByTestId("tab-users")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // Auto-collapse on narrow window

  it("should auto-collapse sidebar on narrow window", () => {
    // Set narrow window
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 800,
    });

    renderAppShell();

    // Trigger resize
    fireEvent(window, new Event("resize"));

    expect(screen.getByTestId("sidebar")).toHaveStyle({
      width: "var(--sidebar-width-collapsed)",
    });
  });

  it("should keep sidebar expanded on wide window", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1200,
    });

    renderAppShell();

    fireEvent(window, new Event("resize"));

    expect(screen.getByTestId("sidebar")).toHaveStyle({
      width: "var(--sidebar-width-expanded)",
    });
  });
});
