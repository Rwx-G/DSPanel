import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiffViewer, type DiffLine } from "./DiffViewer";

const testLines: DiffLine[] = [
  { type: "unchanged", content: "line 1", oldLineNumber: 1, newLineNumber: 1 },
  { type: "removed", content: "old line 2", oldLineNumber: 2 },
  { type: "added", content: "new line 2", newLineNumber: 2 },
  { type: "unchanged", content: "line 3", oldLineNumber: 3, newLineNumber: 3 },
];

describe("DiffViewer", () => {
  it("should render the diff viewer", () => {
    render(<DiffViewer lines={testLines} />);
    expect(screen.getByTestId("diff-viewer")).toBeInTheDocument();
  });

  it("should show empty state when no lines", () => {
    render(<DiffViewer lines={[]} />);
    expect(screen.getByTestId("diff-viewer-empty")).toHaveTextContent(
      "No differences",
    );
  });

  it("should default to inline mode", () => {
    render(<DiffViewer lines={testLines} />);
    expect(screen.getByTestId("diff-inline")).toBeInTheDocument();
  });

  it("should render all lines in inline mode", () => {
    render(<DiffViewer lines={testLines} />);
    expect(screen.getByTestId("diff-line-0")).toBeInTheDocument();
    expect(screen.getByTestId("diff-line-1")).toBeInTheDocument();
    expect(screen.getByTestId("diff-line-2")).toBeInTheDocument();
    expect(screen.getByTestId("diff-line-3")).toBeInTheDocument();
  });

  it("should show line type as data attribute", () => {
    render(<DiffViewer lines={testLines} />);
    expect(screen.getByTestId("diff-line-0")).toHaveAttribute(
      "data-type",
      "unchanged",
    );
    expect(screen.getByTestId("diff-line-1")).toHaveAttribute(
      "data-type",
      "removed",
    );
    expect(screen.getByTestId("diff-line-2")).toHaveAttribute(
      "data-type",
      "added",
    );
  });

  it("should switch to side-by-side mode", () => {
    render(<DiffViewer lines={testLines} />);
    fireEvent.click(screen.getByTestId("diff-mode-side-by-side"));
    expect(screen.getByTestId("diff-side-by-side")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-inline")).not.toBeInTheDocument();
  });

  it("should switch back to inline mode", () => {
    render(<DiffViewer lines={testLines} defaultMode="side-by-side" />);
    fireEvent.click(screen.getByTestId("diff-mode-inline"));
    expect(screen.getByTestId("diff-inline")).toBeInTheDocument();
  });

  it("should render mode toggle buttons", () => {
    render(<DiffViewer lines={testLines} />);
    expect(screen.getByTestId("diff-mode-inline")).toBeInTheDocument();
    expect(screen.getByTestId("diff-mode-side-by-side")).toBeInTheDocument();
  });

  it("should start in side-by-side mode when specified", () => {
    render(<DiffViewer lines={testLines} defaultMode="side-by-side" />);
    expect(screen.getByTestId("diff-side-by-side")).toBeInTheDocument();
  });

  it("should render left and right panels in side-by-side mode", () => {
    render(<DiffViewer lines={testLines} defaultMode="side-by-side" />);
    expect(screen.getByTestId("diff-panel-left")).toBeInTheDocument();
    expect(screen.getByTestId("diff-panel-right")).toBeInTheDocument();
  });

  it("should synchronize scroll between panels", () => {
    render(<DiffViewer lines={testLines} defaultMode="side-by-side" />);
    const leftPanel = screen.getByTestId("diff-panel-left");
    const rightPanel = screen.getByTestId("diff-panel-right");

    // Simulate left panel scroll
    Object.defineProperty(leftPanel, "scrollTop", {
      value: 100,
      writable: true,
    });
    fireEvent.scroll(leftPanel);

    // Right panel should sync
    expect(rightPanel.scrollTop).toBe(100);
  });

  it("should synchronize scroll from right to left panel", () => {
    render(<DiffViewer lines={testLines} defaultMode="side-by-side" />);
    const leftPanel = screen.getByTestId("diff-panel-left");
    const rightPanel = screen.getByTestId("diff-panel-right");

    Object.defineProperty(rightPanel, "scrollTop", {
      value: 50,
      writable: true,
    });
    fireEvent.scroll(rightPanel);

    expect(leftPanel.scrollTop).toBe(50);
  });
});
