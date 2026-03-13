import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmationDialog } from "./ConfirmationDialog";

function renderDialog(
  props: Partial<Parameters<typeof ConfirmationDialog>[0]> = {},
) {
  const defaultProps = {
    title: "Confirm Action",
    message: "Are you sure?",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...props,
  };
  render(<ConfirmationDialog {...defaultProps} />);
  return defaultProps;
}

describe("ConfirmationDialog", () => {
  it("renders title and message", () => {
    renderDialog();
    expect(screen.getByTestId("dialog-title")).toHaveTextContent(
      "Confirm Action",
    );
    expect(screen.getByTestId("dialog-message")).toHaveTextContent(
      "Are you sure?",
    );
  });

  it("renders confirm button with default label", () => {
    renderDialog();
    expect(screen.getByTestId("dialog-confirm")).toHaveTextContent("OK");
  });

  it("renders confirm button with custom label", () => {
    renderDialog({ confirmLabel: "Yes, delete" });
    expect(screen.getByTestId("dialog-confirm")).toHaveTextContent(
      "Yes, delete",
    );
  });

  it("does not render cancel button when no cancelLabel", () => {
    renderDialog();
    expect(screen.queryByTestId("dialog-cancel")).not.toBeInTheDocument();
  });

  it("renders cancel button when cancelLabel provided", () => {
    renderDialog({ cancelLabel: "No" });
    expect(screen.getByTestId("dialog-cancel")).toHaveTextContent("No");
  });

  it("calls onConfirm when confirm button clicked", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    expect(props.onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when cancel button clicked", () => {
    const props = renderDialog({ cancelLabel: "Cancel" });
    fireEvent.click(screen.getByTestId("dialog-cancel"));
    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel when overlay clicked", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByTestId("dialog-overlay"));
    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it("does not call onCancel when dialog body clicked", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByTestId("confirmation-dialog"));
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("calls onConfirm on Enter key", () => {
    const props = renderDialog();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(props.onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel on Escape key", () => {
    const props = renderDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it("renders detail section when detail provided", () => {
    renderDialog({ detail: "Stack trace here" });
    const detail = screen.getByTestId("dialog-detail");
    expect(detail).toBeInTheDocument();
    expect(detail).toHaveTextContent("Stack trace here");
  });

  it("does not render detail section when no detail", () => {
    renderDialog();
    expect(screen.queryByTestId("dialog-detail")).not.toBeInTheDocument();
  });

  it("renders info severity icon by default", () => {
    renderDialog();
    const dialog = screen.getByTestId("confirmation-dialog");
    const svg = dialog.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("has dialog role and aria-modal", () => {
    renderDialog();
    const dialog = screen.getByTestId("confirmation-dialog");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });
});
