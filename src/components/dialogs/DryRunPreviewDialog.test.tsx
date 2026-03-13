import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DryRunPreviewDialog, type DryRunChange } from "./DryRunPreviewDialog";

const mockChanges: DryRunChange[] = [
  { type: "add", targetName: "user1", description: "Create new user" },
  { type: "modify", targetName: "user2", description: "Update email" },
  { type: "delete", targetName: "user3", description: "Remove account" },
];

function renderDialog(
  changes = mockChanges,
  overrides: Partial<{ onExecute: () => void; onCancel: () => void }> = {},
) {
  const props = {
    changes,
    onExecute: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<DryRunPreviewDialog {...props} />);
  return props;
}

describe("DryRunPreviewDialog", () => {
  it("renders title with change count", () => {
    renderDialog();
    expect(screen.getByTestId("dryrun-title")).toHaveTextContent(
      "Pending Changes (3)",
    );
  });

  it("renders all change entries", () => {
    renderDialog();
    expect(screen.getByTestId("dryrun-change-0")).toBeInTheDocument();
    expect(screen.getByTestId("dryrun-change-1")).toBeInTheDocument();
    expect(screen.getByTestId("dryrun-change-2")).toBeInTheDocument();
  });

  it("displays target name and description for each change", () => {
    renderDialog();
    const change0 = screen.getByTestId("dryrun-change-0");
    expect(change0).toHaveTextContent("user1");
    expect(change0).toHaveTextContent("Create new user");
  });

  it("calls onExecute when Execute button clicked", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByTestId("dryrun-execute"));
    expect(props.onExecute).toHaveBeenCalledOnce();
  });

  it("calls onCancel when Cancel button clicked", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByTestId("dryrun-cancel"));
    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel when overlay clicked", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByTestId("dryrun-overlay"));
    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it("does not call onCancel when dialog body clicked", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByTestId("dryrun-dialog"));
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel on Escape key", () => {
    const props = renderDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it("has dialog role and aria-modal", () => {
    renderDialog();
    const dialog = screen.getByTestId("dryrun-dialog");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("renders with empty changes list", () => {
    renderDialog([]);
    expect(screen.getByTestId("dryrun-title")).toHaveTextContent(
      "Pending Changes (0)",
    );
  });
});
