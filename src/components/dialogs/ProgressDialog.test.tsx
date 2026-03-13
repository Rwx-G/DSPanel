import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProgressDialog } from "./ProgressDialog";

function renderProgress(
  props: Partial<Parameters<typeof ProgressDialog>[0]> = {},
) {
  const defaultProps = {
    statusMessage: "Loading data...",
    ...props,
  };
  render(<ProgressDialog {...defaultProps} />);
  return defaultProps;
}

describe("ProgressDialog", () => {
  it("renders status message", () => {
    renderProgress();
    expect(screen.getByTestId("progress-message")).toHaveTextContent(
      "Loading data...",
    );
  });

  it("renders overlay and dialog", () => {
    renderProgress();
    expect(screen.getByTestId("progress-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("progress-dialog")).toBeInTheDocument();
  });

  it("has dialog role and aria-modal", () => {
    renderProgress();
    const dialog = screen.getByTestId("progress-dialog");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("renders determinate progress bar with percentage", () => {
    renderProgress({ percentage: 45 });
    const bar = screen.getByTestId("progress-bar");
    expect(bar.style.width).toBe("45%");
    expect(screen.getByTestId("progress-percentage")).toHaveTextContent("45%");
  });

  it("clamps percentage to 0-100 range", () => {
    renderProgress({ percentage: 150 });
    const bar = screen.getByTestId("progress-bar");
    expect(bar.style.width).toBe("100%");
  });

  it("clamps negative percentage to 0", () => {
    renderProgress({ percentage: -10 });
    const bar = screen.getByTestId("progress-bar");
    expect(bar.style.width).toBe("0%");
  });

  it("renders indeterminate progress bar without percentage text", () => {
    renderProgress({ isIndeterminate: true });
    const bar = screen.getByTestId("progress-bar");
    expect(bar.className).toContain("animate-pulse");
    expect(screen.queryByTestId("progress-percentage")).not.toBeInTheDocument();
  });

  it("does not render cancel button by default", () => {
    renderProgress();
    expect(screen.queryByTestId("progress-cancel")).not.toBeInTheDocument();
  });

  it("renders cancel button when cancellable with onCancel", () => {
    renderProgress({ cancellable: true, onCancel: vi.fn() });
    expect(screen.getByTestId("progress-cancel")).toBeInTheDocument();
  });

  it("calls onCancel when cancel button clicked", () => {
    const onCancel = vi.fn();
    renderProgress({ cancellable: true, onCancel });
    fireEvent.click(screen.getByTestId("progress-cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel on Escape key when cancellable", () => {
    const onCancel = vi.fn();
    renderProgress({ cancellable: true, onCancel });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does not respond to Escape when not cancellable", () => {
    const onCancel = vi.fn();
    renderProgress({ cancellable: false, onCancel });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
