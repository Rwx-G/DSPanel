import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import {
  NavigationProvider,
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
});
