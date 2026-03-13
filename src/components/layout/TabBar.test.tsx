import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { type ReactNode } from "react";
import {
  NavigationProvider,
  useNavigation,
  resetTabIdCounter,
} from "@/contexts/NavigationContext";
import { TabBar } from "./TabBar";

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

  it("should render empty tab bar by default", () => {
    renderWithNavigation(<TabBar />);
    expect(screen.getByTestId("tab-bar")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("should render a tab when opened", () => {
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

    expect(screen.getByTestId("tab-users")).toBeInTheDocument();
  });

  it("should show close button on tabs", () => {
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

  it("should mark opened tab as active", () => {
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

    expect(screen.getByTestId("tab-users")).toHaveAttribute(
      "aria-selected",
      "true",
    );
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
          <button
            data-testid="open-computers"
            onClick={() => openTab("Computers", "computers")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));
    fireEvent.click(screen.getByTestId("open-computers"));

    // Computers is active
    expect(screen.getByTestId("tab-computers")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Click users tab
    fireEvent.click(screen.getByTestId("tab-users"));
    expect(screen.getByTestId("tab-users")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("tab-computers")).toHaveAttribute(
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

  it("should close tab on middle-click", () => {
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
});
