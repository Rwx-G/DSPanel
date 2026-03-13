import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DialogProvider, useDialog } from "./DialogContext";

function TestDialogConsumer() {
  const { showConfirmation, showWarning, showError, showDryRunPreview } =
    useDialog();

  return (
    <div>
      <button
        data-testid="show-confirm"
        onClick={async () => {
          const result = await showConfirmation(
            "Confirm?",
            "Do you want to proceed?",
            "Extra detail",
          );
          document.getElementById("result")!.textContent = String(result);
        }}
      >
        Confirm
      </button>
      <button
        data-testid="show-warning"
        onClick={() => showWarning("Warning", "Something is off")}
      >
        Warning
      </button>
      <button
        data-testid="show-error"
        onClick={() => showError("Error", "Something failed", "stack trace")}
      >
        Error
      </button>
      <button
        data-testid="show-dryrun"
        onClick={async () => {
          const result = await showDryRunPreview([
            { type: "add", targetName: "user1", description: "Create user" },
          ]);
          document.getElementById("result")!.textContent = String(result);
        }}
      >
        DryRun
      </button>
      <span id="result" data-testid="result" />
    </div>
  );
}

function renderWithDialog() {
  return render(
    <DialogProvider>
      <TestDialogConsumer />
    </DialogProvider>,
  );
}

describe("DialogContext", () => {
  it("throws when useDialog is used outside provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      render(<TestDialogConsumer />);
    }).toThrow("useDialog must be used within DialogProvider");
    spy.mockRestore();
  });

  it("shows confirmation dialog and resolves true on confirm", async () => {
    renderWithDialog();
    fireEvent.click(screen.getByTestId("show-confirm"));

    expect(screen.getByTestId("dialog-title")).toHaveTextContent("Confirm?");
    expect(screen.getByTestId("dialog-message")).toHaveTextContent(
      "Do you want to proceed?",
    );
    expect(screen.getByTestId("dialog-detail")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("result")).toHaveTextContent("true");
    });
    expect(screen.queryByTestId("confirmation-dialog")).not.toBeInTheDocument();
  });

  it("shows confirmation dialog and resolves false on cancel", async () => {
    renderWithDialog();
    fireEvent.click(screen.getByTestId("show-confirm"));
    fireEvent.click(screen.getByTestId("dialog-cancel"));

    await waitFor(() => {
      expect(screen.getByTestId("result")).toHaveTextContent("false");
    });
  });

  it("shows warning dialog with OK button only", async () => {
    renderWithDialog();
    fireEvent.click(screen.getByTestId("show-warning"));

    expect(screen.getByTestId("dialog-title")).toHaveTextContent("Warning");
    expect(screen.getByTestId("dialog-confirm")).toHaveTextContent("OK");
    expect(screen.queryByTestId("dialog-cancel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("dialog-confirm"));
    await waitFor(() => {
      expect(
        screen.queryByTestId("confirmation-dialog"),
      ).not.toBeInTheDocument();
    });
  });

  it("shows error dialog with detail section", async () => {
    renderWithDialog();
    fireEvent.click(screen.getByTestId("show-error"));

    expect(screen.getByTestId("dialog-title")).toHaveTextContent("Error");
    expect(screen.getByTestId("dialog-detail")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("dialog-confirm"));
    await waitFor(() => {
      expect(
        screen.queryByTestId("confirmation-dialog"),
      ).not.toBeInTheDocument();
    });
  });

  it("shows dry run preview and resolves true on execute", async () => {
    renderWithDialog();
    fireEvent.click(screen.getByTestId("show-dryrun"));

    expect(screen.getByTestId("dryrun-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("dryrun-change-0")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("dryrun-execute"));

    await waitFor(() => {
      expect(screen.getByTestId("result")).toHaveTextContent("true");
    });
  });

  it("shows dry run preview and resolves false on cancel", async () => {
    renderWithDialog();
    fireEvent.click(screen.getByTestId("show-dryrun"));
    fireEvent.click(screen.getByTestId("dryrun-cancel"));

    await waitFor(() => {
      expect(screen.getByTestId("result")).toHaveTextContent("false");
    });
  });
});
