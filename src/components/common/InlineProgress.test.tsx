import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InlineProgress } from "./InlineProgress";

describe("InlineProgress", () => {
  it("renders when active", () => {
    render(<InlineProgress />);
    expect(screen.getByTestId("inline-progress")).toBeInTheDocument();
  });

  it("renders nothing when not active", () => {
    render(<InlineProgress active={false} />);
    expect(screen.queryByTestId("inline-progress")).not.toBeInTheDocument();
  });

  it("renders indeterminate bar when no progress provided", () => {
    render(<InlineProgress />);
    const bar = screen.getByTestId("inline-progress-bar");
    expect(bar.className).toContain("animate-pulse");
  });

  it("renders determinate bar with correct width", () => {
    render(<InlineProgress progress={60} />);
    const bar = screen.getByTestId("inline-progress-bar");
    expect(bar.style.width).toBe("60%");
    expect(bar.className).not.toContain("animate-pulse");
  });

  it("clamps progress to 0-100 range", () => {
    render(<InlineProgress progress={200} />);
    const bar = screen.getByTestId("inline-progress-bar");
    expect(bar.style.width).toBe("100%");
  });

  it("clamps negative progress to 0", () => {
    render(<InlineProgress progress={-50} />);
    const bar = screen.getByTestId("inline-progress-bar");
    expect(bar.style.width).toBe("0%");
  });

  it("renders status message when provided", () => {
    render(<InlineProgress statusMessage="Processing..." />);
    expect(screen.getByTestId("inline-progress-message")).toHaveTextContent(
      "Processing...",
    );
  });

  it("does not render status message when not provided", () => {
    render(<InlineProgress />);
    expect(
      screen.queryByTestId("inline-progress-message"),
    ).not.toBeInTheDocument();
  });
});
