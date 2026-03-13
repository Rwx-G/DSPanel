import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { type ReactNode } from "react";
import {
  NavigationProvider,
  resetTabIdCounter,
} from "@/contexts/NavigationContext";
import { Sidebar } from "./Sidebar";

function renderWithNavigation(
  ui: ReactNode,
  props?: { expanded?: boolean; onToggle?: () => void },
) {
  const defaultProps = {
    expanded: true,
    onToggle: vi.fn(),
    ...props,
  };
  return {
    ...render(
      <NavigationProvider>
        <Sidebar {...defaultProps} />
      </NavigationProvider>,
    ),
    onToggle: defaultProps.onToggle,
  };
}

describe("Sidebar", () => {
  beforeEach(() => {
    resetTabIdCounter();
  });

  it("should render the sidebar", () => {
    renderWithNavigation(null);
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
  });

  it("should render sidebar toggle button", () => {
    render(
      <NavigationProvider>
        <Sidebar expanded={true} onToggle={vi.fn()} />
      </NavigationProvider>,
    );
    expect(screen.getByTestId("sidebar-toggle")).toBeInTheDocument();
  });

  it("should call onToggle when toggle button is clicked", () => {
    const onToggle = vi.fn();
    render(
      <NavigationProvider>
        <Sidebar expanded={true} onToggle={onToggle} />
      </NavigationProvider>,
    );
    fireEvent.click(screen.getByTestId("sidebar-toggle"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("should show module labels when expanded", () => {
    render(
      <NavigationProvider>
        <Sidebar expanded={true} onToggle={vi.fn()} />
      </NavigationProvider>,
    );
    expect(screen.getByText("User Lookup")).toBeInTheDocument();
    expect(screen.getByText("Computer Lookup")).toBeInTheDocument();
  });

  it("should hide module labels when collapsed but show tooltips", () => {
    render(
      <NavigationProvider>
        <Sidebar expanded={false} onToggle={vi.fn()} />
      </NavigationProvider>,
    );
    // Labels are hidden but tooltip spans still contain the text
    const userLabels = screen.getAllByText("User Lookup");
    // Only tooltip span should remain (no inline label)
    userLabels.forEach((el) => {
      expect(el.className).toContain("pointer-events-none");
    });
  });

  it("should show group headers when expanded", () => {
    render(
      <NavigationProvider>
        <Sidebar expanded={true} onToggle={vi.fn()} />
      </NavigationProvider>,
    );
    expect(screen.getByText("Directory")).toBeInTheDocument();
  });

  it("should hide group headers when collapsed", () => {
    render(
      <NavigationProvider>
        <Sidebar expanded={false} onToggle={vi.fn()} />
      </NavigationProvider>,
    );
    expect(screen.queryByText("Directory")).not.toBeInTheDocument();
  });

  it("should render module items", () => {
    render(
      <NavigationProvider>
        <Sidebar expanded={true} onToggle={vi.fn()} />
      </NavigationProvider>,
    );
    expect(screen.getByTestId("sidebar-item-users")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-item-computers")).toBeInTheDocument();
  });

  it("should open a tab when a module item is clicked", () => {
    render(
      <NavigationProvider>
        <Sidebar expanded={true} onToggle={vi.fn()} />
      </NavigationProvider>,
    );
    fireEvent.click(screen.getByTestId("sidebar-item-users"));
    // The sidebar item should now have active styling - we can check the class
    const item = screen.getByTestId("sidebar-item-users");
    expect(item.className).toContain("color-primary");
  });

  it("should set width via CSS variable when expanded", () => {
    render(
      <NavigationProvider>
        <Sidebar expanded={true} onToggle={vi.fn()} />
      </NavigationProvider>,
    );
    expect(screen.getByTestId("sidebar")).toHaveStyle({
      width: "var(--sidebar-width-expanded)",
    });
  });

  it("should set width via CSS variable when collapsed", () => {
    render(
      <NavigationProvider>
        <Sidebar expanded={false} onToggle={vi.fn()} />
      </NavigationProvider>,
    );
    expect(screen.getByTestId("sidebar")).toHaveStyle({
      width: "var(--sidebar-width-collapsed)",
    });
  });

  it("should have accessible label for expand", () => {
    render(
      <NavigationProvider>
        <Sidebar expanded={false} onToggle={vi.fn()} />
      </NavigationProvider>,
    );
    expect(screen.getByLabelText("Expand sidebar")).toBeInTheDocument();
  });

  it("should have accessible label for collapse", () => {
    render(
      <NavigationProvider>
        <Sidebar expanded={true} onToggle={vi.fn()} />
      </NavigationProvider>,
    );
    expect(screen.getByLabelText("Collapse sidebar")).toBeInTheDocument();
  });

  it("should have title attribute on module items when collapsed", () => {
    render(
      <NavigationProvider>
        <Sidebar expanded={false} onToggle={vi.fn()} />
      </NavigationProvider>,
    );
    expect(screen.getByTestId("sidebar-item-users")).toHaveAttribute(
      "title",
      "User Lookup",
    );
  });
});
