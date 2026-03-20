import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DialogShell } from "./DialogShell";

function renderShell(
  props: Partial<Parameters<typeof DialogShell>[0]> = {},
) {
  const defaultProps = {
    children: <p data-testid="child">Hello</p>,
    onClose: vi.fn(),
    ...props,
  };
  render(<DialogShell {...defaultProps} />);
  return defaultProps;
}

describe("DialogShell", () => {
  it("renders children", () => {
    renderShell();
    expect(screen.getByTestId("child")).toHaveTextContent("Hello");
  });

  it("applies max-w-md class by default", () => {
    renderShell();
    const dialog = screen.getByTestId("dialog");
    expect(dialog.className).toContain("max-w-md");
  });

  it("applies max-w-sm class when maxWidth is sm", () => {
    renderShell({ maxWidth: "sm" });
    const dialog = screen.getByTestId("dialog");
    expect(dialog.className).toContain("max-w-sm");
  });

  it("applies max-w-lg class when maxWidth is lg", () => {
    renderShell({ maxWidth: "lg" });
    const dialog = screen.getByTestId("dialog");
    expect(dialog.className).toContain("max-w-lg");
  });

  it("calls onClose when overlay clicked", () => {
    const props = renderShell();
    fireEvent.click(screen.getByTestId("dialog-overlay"));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose when dialog content clicked", () => {
    const props = renderShell();
    fireEvent.click(screen.getByTestId("dialog"));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("sets aria-modal on the dialog", () => {
    renderShell();
    const dialog = screen.getByTestId("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("sets aria-label when provided", () => {
    renderShell({ ariaLabel: "Test dialog" });
    const dialog = screen.getByTestId("dialog");
    expect(dialog).toHaveAttribute("aria-label", "Test dialog");
  });

  it("sets aria-labelledby when provided", () => {
    renderShell({ ariaLabelledBy: "title-id" });
    const dialog = screen.getByTestId("dialog");
    expect(dialog).toHaveAttribute("aria-labelledby", "title-id");
  });

  it("has dialog role", () => {
    renderShell();
    const dialog = screen.getByTestId("dialog");
    expect(dialog).toHaveAttribute("role", "dialog");
  });

  it("uses custom overlayTestId", () => {
    renderShell({ overlayTestId: "custom-overlay" });
    expect(screen.getByTestId("custom-overlay")).toBeInTheDocument();
  });

  it("uses custom dialogTestId", () => {
    renderShell({ dialogTestId: "custom-dialog" });
    expect(screen.getByTestId("custom-dialog")).toBeInTheDocument();
  });
});
