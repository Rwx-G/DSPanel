import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { PasswordResetDialog } from "./PasswordResetDialog";
import { DialogProvider } from "@/contexts/DialogContext";
import { NotificationProvider } from "@/contexts/NotificationContext";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <NotificationProvider>
      <DialogProvider>{children}</DialogProvider>
    </NotificationProvider>
  );
}

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("PasswordResetDialog", () => {
  const defaultProps = {
    userDn: "CN=John Doe,OU=Users,DC=example,DC=com",
    displayName: "John Doe",
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders dialog with user display name", () => {
    render(<PasswordResetDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    expect(screen.getByTestId("password-reset-dialog")).toBeInTheDocument();
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    // "Reset Password" appears as both the header and button text
    expect(screen.getAllByText("Reset Password").length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("defaults to auto-generate mode", () => {
    render(<PasswordResetDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    expect(screen.getByTestId("mode-generate")).toHaveClass("text-white");
    expect(screen.getByTestId("generate-btn")).toBeInTheDocument();
  });

  it("switches to manual mode on click", () => {
    render(<PasswordResetDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    fireEvent.click(screen.getByTestId("mode-manual"));
    expect(screen.getByTestId("password-input-wrapper")).toBeInTheDocument();
  });

  it("has must-change-at-next-logon checked by default", () => {
    render(<PasswordResetDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    const checkbox = screen.getByTestId("must-change-checkbox");
    expect(checkbox).toBeChecked();
  });

  it("can toggle must-change-at-next-logon", () => {
    render(<PasswordResetDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    const checkbox = screen.getByTestId("must-change-checkbox");
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("shows password validation in manual mode", () => {
    render(<PasswordResetDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    fireEvent.click(screen.getByTestId("mode-manual"));
    const input = screen
      .getByTestId("password-input-wrapper")
      .querySelector("input")!;
    fireEvent.change(input, { target: { value: "weak" } });
    expect(screen.getByTestId("password-validation")).toBeInTheDocument();
  });

  it("disables reset button when manual password is invalid", () => {
    render(<PasswordResetDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    fireEvent.click(screen.getByTestId("mode-manual"));
    const input = screen
      .getByTestId("password-input-wrapper")
      .querySelector("input")!;
    fireEvent.change(input, { target: { value: "weak" } });
    expect(screen.getByTestId("reset-btn")).toBeDisabled();
  });

  it("enables reset button when manual password is valid", () => {
    render(<PasswordResetDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    fireEvent.click(screen.getByTestId("mode-manual"));
    const input = screen
      .getByTestId("password-input-wrapper")
      .querySelector("input")!;
    fireEvent.change(input, { target: { value: "StrongP@ss1" } });
    expect(screen.getByTestId("reset-btn")).not.toBeDisabled();
  });

  it("calls generate_password on generate click", async () => {
    mockInvoke.mockResolvedValueOnce("GeneratedP@ss1" as never);
    render(<PasswordResetDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    fireEvent.click(screen.getByTestId("generate-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "generate_password",
        expect.objectContaining({
          length: 20,
          includeUppercase: true,
        }),
      );
    });

    expect(screen.getByTestId("generated-password")).toHaveTextContent(
      "GeneratedP@ss1",
    );
  });

  it("calls reset_password on reset click with generated password", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "generate_password") return Promise.resolve("GenPass123!");
      if (cmd === "reset_password") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    }) as typeof invoke);

    render(<PasswordResetDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    fireEvent.click(screen.getByTestId("generate-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("generated-password")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("reset-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("reset_password", {
        userDn: "CN=John Doe,OU=Users,DC=example,DC=com",
        newPassword: "GenPass123!",
        mustChangeAtNextLogon: true,
      });
    });
  });

  it("shows result view with copyable password on success", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "generate_password") return Promise.resolve("Success123!");
      if (cmd === "reset_password") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    }) as typeof invoke);

    render(<PasswordResetDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    fireEvent.click(screen.getByTestId("generate-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("generated-password")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("reset-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("password-reset-result")).toBeInTheDocument();
    });

    expect(screen.getByTestId("result-password")).toHaveTextContent(
      "Success123!",
    );
    expect(screen.getByText("Password Reset Successful")).toBeInTheDocument();
  });

  it("shows error message on reset failure", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "generate_password") return Promise.resolve("Pass123!");
      if (cmd === "reset_password")
        return Promise.reject('{"userMessage":"Policy violation"}');
      return Promise.resolve(undefined);
    }) as typeof invoke);

    render(<PasswordResetDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    fireEvent.click(screen.getByTestId("generate-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("generated-password")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("reset-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeInTheDocument();
    });

    expect(screen.getByTestId("error-message")).toHaveTextContent(
      "Policy violation",
    );
  });

  it("calls onClose when cancel is clicked", () => {
    render(<PasswordResetDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    fireEvent.click(screen.getByTestId("cancel-btn"));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("calls onSuccess after successful reset", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "generate_password") return Promise.resolve("Pass1234!");
      if (cmd === "reset_password") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    }) as typeof invoke);

    render(<PasswordResetDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    fireEvent.click(screen.getByTestId("generate-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("generated-password")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("reset-btn"));

    await waitFor(() => {
      expect(defaultProps.onSuccess).toHaveBeenCalled();
    });
  });
});
