import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useRef, useEffect, type ReactNode } from "react";
import {
  NavigationProvider,
  useNavigation,
  resetTabIdCounter,
} from "@/contexts/NavigationContext";
import { Breadcrumbs } from "./Breadcrumbs";

function renderWithNavigation(ui: ReactNode) {
  return render(<NavigationProvider>{ui}</NavigationProvider>);
}

// Helper to set up navigation state via the context
function TestHarness() {
  return <Breadcrumbs />;
}

/**
 * Wrapper that opens a tab so breadcrumbs show a module entry.
 * Uses useRef guard to prevent infinite loop.
 */
function TabOpener({
  children,
  moduleId,
  label,
}: {
  children: ReactNode;
  moduleId: string;
  label: string;
}) {
  const { openTab } = useNavigation();
  const opened = useRef(false);

  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      openTab(label, moduleId);
    }
  }, [openTab, moduleId, label]);

  return <>{children}</>;
}

describe("Breadcrumbs", () => {
  beforeEach(() => {
    resetTabIdCounter();
  });

  it("should render the breadcrumbs container", () => {
    renderWithNavigation(<TestHarness />);
    expect(screen.getByTestId("breadcrumbs")).toBeInTheDocument();
  });

  it("should show Home breadcrumb by default", () => {
    renderWithNavigation(<TestHarness />);
    expect(screen.getByTestId("breadcrumb-home")).toHaveTextContent("Home");
  });

  it("should show a single breadcrumb when on home", () => {
    renderWithNavigation(<TestHarness />);
    const breadcrumbs = screen.getByTestId("breadcrumbs");
    const buttons = breadcrumbs.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
  });

  it("should not show chevron separator for the first item", () => {
    renderWithNavigation(<TestHarness />);
    const breadcrumbs = screen.getByTestId("breadcrumbs");
    const svgs = breadcrumbs.querySelectorAll("svg");
    expect(svgs).toHaveLength(0);
  });

  it("navigates when a breadcrumb button is clicked", async () => {
    render(
      <NavigationProvider>
        <TabOpener moduleId="users" label="User Lookup">
          <Breadcrumbs />
        </TabOpener>
      </NavigationProvider>,
    );

    // After opening the tab, breadcrumbs should show Home and the module
    await waitFor(() => {
      expect(screen.getByTestId("breadcrumb-home")).toBeInTheDocument();
      expect(screen.getByTestId("breadcrumb-users")).toBeInTheDocument();
    });

    // Click the Home breadcrumb to navigate back
    fireEvent.click(screen.getByTestId("breadcrumb-home"));

    // After clicking Home, the module breadcrumb should no longer appear
    await waitFor(() => {
      expect(
        screen.queryByTestId("breadcrumb-users"),
      ).not.toBeInTheDocument();
    });
  });
});
