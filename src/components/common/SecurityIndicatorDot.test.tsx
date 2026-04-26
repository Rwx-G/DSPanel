import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SecurityIndicatorDot } from "./SecurityIndicatorDot";
import type {
  SecurityIndicatorSet,
  SecurityIndicator,
} from "@/types/securityIndicators";

function indicator(
  overrides: Partial<SecurityIndicator> = {},
): SecurityIndicator {
  return {
    kind: "Kerberoastable",
    severity: "Warning",
    descriptionKey: "securityIndicators.Kerberoastable",
    ...overrides,
  };
}

function set(
  overrides: Partial<SecurityIndicatorSet> = {},
): SecurityIndicatorSet {
  return {
    indicators: [indicator()],
    highestSeverity: "Warning",
    ...overrides,
  };
}

describe("SecurityIndicatorDot", () => {
  it("renders nothing when the set is empty", () => {
    const { container } = render(
      <SecurityIndicatorDot
        indicators={{ indicators: [], highestSeverity: "Healthy" }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the dot for a Warning-only set", () => {
    render(<SecurityIndicatorDot indicators={set()} />);
    const dot = screen.getByTestId("security-indicator-dot");
    expect(dot).toHaveAttribute("data-severity", "Warning");
    expect(dot).toHaveAttribute("data-count", "1");
  });

  it("renders the dot for a Critical set with the alert shield icon", () => {
    render(
      <SecurityIndicatorDot
        indicators={set({
          indicators: [
            indicator({ kind: "PasswordNotRequired", severity: "Critical" }),
          ],
          highestSeverity: "Critical",
        })}
      />,
    );
    expect(screen.getByTestId("security-indicator-dot")).toHaveAttribute(
      "data-severity",
      "Critical",
    );
  });

  it("opens the popover on hover and lists every indicator", async () => {
    render(
      <SecurityIndicatorDot
        indicators={set({
          indicators: [
            indicator({ kind: "Kerberoastable", severity: "Warning" }),
            indicator({ kind: "PasswordNotRequired", severity: "Critical" }),
          ],
          highestSeverity: "Critical",
        })}
      />,
    );

    expect(
      screen.queryByTestId("security-indicator-tooltip"),
    ).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId("security-indicator-dot"));
    await waitFor(() => {
      expect(
        screen.getByTestId("security-indicator-tooltip"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("security-indicator-row-Kerberoastable"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("security-indicator-row-PasswordNotRequired"),
      ).toBeInTheDocument();
    });
  });

  it("closes the popover on mouse leave", async () => {
    render(<SecurityIndicatorDot indicators={set()} />);
    const dot = screen.getByTestId("security-indicator-dot");

    fireEvent.mouseEnter(dot);
    await waitFor(() => {
      expect(
        screen.getByTestId("security-indicator-tooltip"),
      ).toBeInTheDocument();
    });

    fireEvent.mouseLeave(dot);
    await waitFor(() => {
      expect(
        screen.queryByTestId("security-indicator-tooltip"),
      ).not.toBeInTheDocument();
    });
  });

  it("opens on focus and closes on blur for keyboard users", async () => {
    render(<SecurityIndicatorDot indicators={set()} />);
    const dot = screen.getByTestId("security-indicator-dot");

    fireEvent.focus(dot);
    await waitFor(() => {
      expect(
        screen.getByTestId("security-indicator-tooltip"),
      ).toBeInTheDocument();
    });

    fireEvent.blur(dot);
    await waitFor(() => {
      expect(
        screen.queryByTestId("security-indicator-tooltip"),
      ).not.toBeInTheDocument();
    });
  });

  it("closes the popover when Escape is pressed", async () => {
    render(<SecurityIndicatorDot indicators={set()} />);
    const dot = screen.getByTestId("security-indicator-dot");

    fireEvent.mouseEnter(dot);
    await waitFor(() => {
      expect(
        screen.getByTestId("security-indicator-tooltip"),
      ).toBeInTheDocument();
    });

    fireEvent.keyDown(dot, { key: "Escape" });
    await waitFor(() => {
      expect(
        screen.queryByTestId("security-indicator-tooltip"),
      ).not.toBeInTheDocument();
    });
  });

  it("toggles the popover when Enter or Space is pressed", async () => {
    render(<SecurityIndicatorDot indicators={set()} />);
    const dot = screen.getByTestId("security-indicator-dot");

    fireEvent.keyDown(dot, { key: "Enter" });
    await waitFor(() => {
      expect(
        screen.getByTestId("security-indicator-tooltip"),
      ).toBeInTheDocument();
    });
    fireEvent.keyDown(dot, { key: " " });
    await waitFor(() => {
      expect(
        screen.queryByTestId("security-indicator-tooltip"),
      ).not.toBeInTheDocument();
    });
  });

  it("exposes a count-aware aria-label", () => {
    render(
      <SecurityIndicatorDot
        indicators={set({
          indicators: [
            indicator({ kind: "Kerberoastable" }),
            indicator({ kind: "PasswordNeverExpires" }),
            indicator({ kind: "AsRepRoastable", severity: "Critical" }),
          ],
          highestSeverity: "Critical",
        })}
      />,
    );
    const dot = screen.getByTestId("security-indicator-dot");
    expect(dot.getAttribute("aria-label")).toContain("3");
  });

  it("renders the popover header text", async () => {
    render(<SecurityIndicatorDot indicators={set()} />);
    fireEvent.mouseEnter(screen.getByTestId("security-indicator-dot"));
    await waitFor(() => {
      expect(
        screen.getByText("Security indicators"),
      ).toBeInTheDocument();
    });
  });

  it("does not navigate or trigger an action on click", () => {
    render(<SecurityIndicatorDot indicators={set()} />);
    const dot = screen.getByTestId("security-indicator-dot");
    fireEvent.click(dot);
    expect(dot).toBeInTheDocument();
  });
});
