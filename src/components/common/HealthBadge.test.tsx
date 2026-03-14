import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HealthBadge } from "./HealthBadge";
import type { AccountHealthStatus } from "@/types/health";

function makeStatus(
  overrides: Partial<AccountHealthStatus> = {},
): AccountHealthStatus {
  return {
    level: "Healthy",
    activeFlags: [],
    ...overrides,
  };
}

describe("HealthBadge", () => {
  it("renders with Healthy level", () => {
    render(<HealthBadge healthStatus={makeStatus()} />);
    const badge = screen.getByTestId("health-badge");
    expect(badge).toHaveAttribute("data-level", "Healthy");
    expect(badge).toHaveTextContent("Healthy");
  });

  it("renders issue count for Warning level", () => {
    render(
      <HealthBadge
        healthStatus={makeStatus({
          level: "Warning",
          activeFlags: [
            {
              name: "PasswordNeverExpires",
              severity: "Warning",
              description: "Password never expires",
            },
          ],
        })}
      />,
    );
    const badge = screen.getByTestId("health-badge");
    expect(badge).toHaveAttribute("data-level", "Warning");
    expect(badge).toHaveTextContent("1 issue");
  });

  it("renders plural issues for multiple flags", () => {
    render(
      <HealthBadge
        healthStatus={makeStatus({
          level: "Critical",
          activeFlags: [
            {
              name: "Disabled",
              severity: "Critical",
              description: "Disabled",
            },
            { name: "Locked", severity: "Critical", description: "Locked" },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("health-badge")).toHaveTextContent("2 issues");
  });

  it("shows tooltip on hover", () => {
    render(
      <HealthBadge
        healthStatus={makeStatus({
          level: "Warning",
          activeFlags: [
            {
              name: "Inactive30Days",
              severity: "Warning",
              description: "No logon in 30 days",
            },
          ],
        })}
      />,
    );

    expect(screen.queryByTestId("health-tooltip")).not.toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByTestId("health-badge"));
    expect(screen.getByTestId("health-tooltip")).toBeInTheDocument();
    expect(screen.getByTestId("health-flag-Inactive30Days")).toHaveTextContent(
      "Inactive30Days",
    );
  });

  it("hides tooltip on mouse leave", () => {
    render(
      <HealthBadge
        healthStatus={makeStatus({
          level: "Info",
          activeFlags: [
            {
              name: "NeverLoggedOn",
              severity: "Info",
              description: "Never logged on",
            },
          ],
        })}
      />,
    );

    fireEvent.mouseEnter(screen.getByTestId("health-badge"));
    expect(screen.getByTestId("health-tooltip")).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByTestId("health-badge"));
    expect(screen.queryByTestId("health-tooltip")).not.toBeInTheDocument();
  });

  it("shows 'No issues detected' in tooltip for Healthy status", () => {
    render(<HealthBadge healthStatus={makeStatus()} />);
    fireEvent.mouseEnter(screen.getByTestId("health-badge"));
    expect(screen.getByText("No issues detected")).toBeInTheDocument();
  });

  it("renders Critical level badge", () => {
    render(
      <HealthBadge
        healthStatus={makeStatus({
          level: "Critical",
          activeFlags: [
            {
              name: "Disabled",
              severity: "Critical",
              description: "Account disabled",
            },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("health-badge")).toHaveAttribute(
      "data-level",
      "Critical",
    );
  });

  it("renders Info level badge", () => {
    render(
      <HealthBadge
        healthStatus={makeStatus({
          level: "Info",
          activeFlags: [
            {
              name: "NeverLoggedOn",
              severity: "Info",
              description: "Never used",
            },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("health-badge")).toHaveAttribute(
      "data-level",
      "Info",
    );
  });

  it("shows tooltip on focus and hides on blur", () => {
    render(
      <HealthBadge
        healthStatus={makeStatus({
          level: "Warning",
          activeFlags: [
            {
              name: "TestFlag",
              severity: "Warning",
              description: "Test description",
            },
          ],
        })}
      />,
    );

    const badge = screen.getByTestId("health-badge");
    fireEvent.focus(badge);
    expect(screen.getByTestId("health-tooltip")).toBeInTheDocument();

    fireEvent.blur(badge);
    expect(screen.queryByTestId("health-tooltip")).not.toBeInTheDocument();
  });

  it("has correct aria-label for healthy status", () => {
    render(<HealthBadge healthStatus={makeStatus()} />);
    expect(screen.getByTestId("health-badge")).toHaveAttribute(
      "aria-label",
      "Health: Healthy",
    );
  });

  it("has correct aria-label for status with issues", () => {
    render(
      <HealthBadge
        healthStatus={makeStatus({
          level: "Warning",
          activeFlags: [
            { name: "Flag1", severity: "Warning", description: "d1" },
            { name: "Flag2", severity: "Warning", description: "d2" },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("health-badge")).toHaveAttribute(
      "aria-label",
      "Health: Warning, 2 issues",
    );
  });

  it("has correct aria-label for single issue", () => {
    render(
      <HealthBadge
        healthStatus={makeStatus({
          level: "Critical",
          activeFlags: [
            { name: "Flag1", severity: "Critical", description: "d" },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("health-badge")).toHaveAttribute(
      "aria-label",
      "Health: Critical, 1 issue",
    );
  });
});
