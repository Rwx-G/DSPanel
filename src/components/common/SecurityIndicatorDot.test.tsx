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

  // ---------------------------------------------------------------------------
  // Popover metadata enrichment (QA-14.3-003)
  // ---------------------------------------------------------------------------

  it("shows ConstrainedDelegation target SPNs inline in the popover", async () => {
    render(
      <SecurityIndicatorDot
        indicators={set({
          indicators: [
            indicator({
              kind: "ConstrainedDelegation",
              severity: "Warning",
              metadata: {
                target_spns: [
                  "MSSQLSvc/db.corp.local:1433",
                  "HTTP/web1.corp.local",
                ],
              },
            }),
          ],
          highestSeverity: "Warning",
        })}
      />,
    );
    fireEvent.mouseEnter(screen.getByTestId("security-indicator-dot"));

    await waitFor(() => {
      expect(
        screen.getByTestId("security-indicator-meta-ConstrainedDelegation"),
      ).toBeInTheDocument();
    });
    const meta = screen.getByTestId(
      "security-indicator-meta-ConstrainedDelegation",
    );
    expect(meta.textContent).toContain("MSSQLSvc/db.corp.local:1433");
    expect(meta.textContent).toContain("HTTP/web1.corp.local");
    // No truncation suffix when the list fits under the preview limit
    expect(meta.textContent).not.toMatch(/more/);
  });

  it("shows Rbcd allowed-principal SIDs inline in the popover", async () => {
    render(
      <SecurityIndicatorDot
        indicators={set({
          indicators: [
            indicator({
              kind: "Rbcd",
              severity: "Critical",
              metadata: {
                allowed_principals: [
                  "S-1-5-21-1-2-3-1100",
                  "S-1-5-21-1-2-3-1101",
                ],
              },
            }),
          ],
          highestSeverity: "Critical",
        })}
      />,
    );
    fireEvent.mouseEnter(screen.getByTestId("security-indicator-dot"));

    await waitFor(() => {
      expect(
        screen.getByTestId("security-indicator-meta-Rbcd"),
      ).toBeInTheDocument();
    });
    const meta = screen.getByTestId("security-indicator-meta-Rbcd");
    expect(meta.textContent).toContain("S-1-5-21-1-2-3-1100");
    expect(meta.textContent).toContain("S-1-5-21-1-2-3-1101");
  });

  it("truncates the metadata preview at 3 entries with a +N more suffix", async () => {
    render(
      <SecurityIndicatorDot
        indicators={set({
          indicators: [
            indicator({
              kind: "ConstrainedDelegation",
              severity: "Warning",
              metadata: {
                target_spns: [
                  "spn1/host",
                  "spn2/host",
                  "spn3/host",
                  "spn4/host",
                  "spn5/host",
                ],
              },
            }),
          ],
          highestSeverity: "Warning",
        })}
      />,
    );
    fireEvent.mouseEnter(screen.getByTestId("security-indicator-dot"));

    await waitFor(() => {
      expect(
        screen.getByTestId("security-indicator-meta-ConstrainedDelegation"),
      ).toBeInTheDocument();
    });
    const meta = screen.getByTestId(
      "security-indicator-meta-ConstrainedDelegation",
    );
    expect(meta.textContent).toContain("spn1/host");
    expect(meta.textContent).toContain("spn2/host");
    expect(meta.textContent).toContain("spn3/host");
    expect(meta.textContent).not.toContain("spn4/host");
    expect(meta.textContent).toMatch(/\+2 more/);
  });

  it("does not render a metadata line for indicator kinds without metadata", async () => {
    render(
      <SecurityIndicatorDot
        indicators={set({
          indicators: [
            indicator({ kind: "Kerberoastable", severity: "Warning" }),
          ],
          highestSeverity: "Warning",
        })}
      />,
    );
    fireEvent.mouseEnter(screen.getByTestId("security-indicator-dot"));

    await waitFor(() => {
      expect(
        screen.getByTestId("security-indicator-row-Kerberoastable"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("security-indicator-meta-Kerberoastable"),
    ).not.toBeInTheDocument();
  });

  it("hides the metadata line when the metadata array is empty", async () => {
    render(
      <SecurityIndicatorDot
        indicators={set({
          indicators: [
            indicator({
              kind: "Rbcd",
              severity: "Warning",
              metadata: { allowed_principals: [] },
            }),
          ],
          highestSeverity: "Warning",
        })}
      />,
    );
    fireEvent.mouseEnter(screen.getByTestId("security-indicator-dot"));

    await waitFor(() => {
      expect(
        screen.getByTestId("security-indicator-row-Rbcd"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("security-indicator-meta-Rbcd"),
    ).not.toBeInTheDocument();
  });
});
