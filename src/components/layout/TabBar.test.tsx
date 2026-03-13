import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { type ReactNode } from "react";
import {
  NavigationProvider,
  useNavigation,
  resetTabIdCounter,
} from "@/contexts/NavigationContext";
import { TabBar } from "./TabBar";

function wrapper({ children }: { children: ReactNode }) {
  return <NavigationProvider>{children}</NavigationProvider>;
}

function renderWithNavigation(ui: ReactNode) {
  return render(<NavigationProvider>{ui}</NavigationProvider>);
}

describe("TabBar", () => {
  beforeEach(() => {
    resetTabIdCounter();
  });

  it("should render the tab bar", () => {
    renderWithNavigation(<TabBar />);
    expect(screen.getByTestId("tab-bar")).toBeInTheDocument();
  });

  it("should have tablist role", () => {
    renderWithNavigation(<TabBar />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("should render the home tab", () => {
    renderWithNavigation(<TabBar />);
    expect(screen.getByTestId("tab-home")).toBeInTheDocument();
  });

  it("should mark home tab as active by default", () => {
    renderWithNavigation(<TabBar />);
    const homeTab = screen.getByTestId("tab-home");
    expect(homeTab).toHaveAttribute("aria-selected", "true");
  });

  it("should not show close button on pinned tabs", () => {
    renderWithNavigation(<TabBar />);
    expect(screen.queryByTestId("tab-close-home")).not.toBeInTheDocument();
  });

  it("should render multiple tabs when opened", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));

    expect(screen.getByTestId("tab-home")).toBeInTheDocument();
    expect(screen.getByTestId("tab-users")).toBeInTheDocument();
  });

  it("should show close button on non-pinned tabs", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));

    expect(screen.getByTestId("tab-close-users")).toBeInTheDocument();
  });

  it("should switch active tab on click", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));
    fireEvent.click(screen.getByTestId("tab-home"));

    expect(screen.getByTestId("tab-home")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("tab-users")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("should close tab when close button is clicked", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));
    fireEvent.click(screen.getByTestId("tab-close-users"));

    expect(screen.queryByTestId("tab-users")).not.toBeInTheDocument();
  });

  it("should display tab title", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("User Lookup", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));

    expect(screen.getByTestId("tab-users")).toHaveTextContent("User Lookup");
  });

  it("should close tab on middle-click for non-pinned tabs", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));

    const tabEl = screen.getByTestId("tab-users");
    act(() => {
      tabEl.dispatchEvent(
        new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      );
    });

    expect(screen.queryByTestId("tab-users")).not.toBeInTheDocument();
  });

  it("should not close pinned tab on middle-click", () => {
    renderWithNavigation(<TabBar />);

    const homeTab = screen.getByTestId("tab-home");
    act(() => {
      homeTab.dispatchEvent(
        new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      );
    });

    expect(screen.getByTestId("tab-home")).toBeInTheDocument();
  });
});
