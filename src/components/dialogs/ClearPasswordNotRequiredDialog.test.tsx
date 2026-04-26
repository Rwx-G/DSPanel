import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { ClearPasswordNotRequiredDialog } from "./ClearPasswordNotRequiredDialog";
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

const defaultProps = {
  userDn: "CN=John Doe,OU=Users,DC=example,DC=com",
  displayName: "John Doe",
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

/**
 * Default mock that approves MFA (returns false for `mfa_is_configured`,
 * which short-circuits the gate to "allowed"), and resolves
 * `clear_password_not_required` successfully.
 */
function mockHappyPath() {
  mockInvoke.mockImplementation(((cmd: string) => {
    if (cmd === "mfa_is_configured") return Promise.resolve(false);
    if (cmd === "clear_password_not_required") return Promise.resolve();
    return Promise.resolve(null);
  }) as typeof invoke);
}

describe("ClearPasswordNotRequiredDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHappyPath();
  });

  it("renders the dialog with title and display name", () => {
    render(<ClearPasswordNotRequiredDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    expect(
      screen.getByTestId("clear-password-not-required-dialog"),
    ).toBeInTheDocument();
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    // Title appears in the header
    expect(
      screen.getAllByText(/Clear PasswordNotRequired flag/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("includes the bit identifier in the body for operator verification", () => {
    render(<ClearPasswordNotRequiredDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    expect(
      screen.getByText(/PASSWORD_NOT_REQUIRED is set on userAccountControl/),
    ).toBeInTheDocument();
    expect(screen.getByText(/0x0020/)).toBeInTheDocument();
  });

  it("disables the Confirm button until the checkbox is checked", () => {
    render(<ClearPasswordNotRequiredDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });
    const confirmBtn = screen.getByTestId("confirm-btn");
    expect(confirmBtn).toBeDisabled();

    fireEvent.click(screen.getByTestId("acknowledge-checkbox"));
    expect(confirmBtn).not.toBeDisabled();
  });

  it("calls clear_password_not_required with userDn on confirm", async () => {
    const onSuccess = vi.fn();
    render(
      <ClearPasswordNotRequiredDialog
        {...defaultProps}
        onSuccess={onSuccess}
      />,
      { wrapper: TestProviders },
    );

    fireEvent.click(screen.getByTestId("acknowledge-checkbox"));
    fireEvent.click(screen.getByTestId("confirm-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("clear_password_not_required", {
        userDn: "CN=John Doe,OU=Users,DC=example,DC=com",
      });
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(
      <ClearPasswordNotRequiredDialog {...defaultProps} onClose={onClose} />,
      { wrapper: TestProviders },
    );
    fireEvent.click(screen.getByTestId("cancel-btn"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does nothing when Confirm is clicked without acknowledgement (defense in depth)", async () => {
    const onSuccess = vi.fn();
    render(
      <ClearPasswordNotRequiredDialog
        {...defaultProps}
        onSuccess={onSuccess}
      />,
      { wrapper: TestProviders },
    );
    // Confirm is disabled at this point but verify the handler is also a no-op
    // even if disabled state were bypassed (defense in depth)
    const confirmBtn = screen.getByTestId("confirm-btn");
    fireEvent.click(confirmBtn);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "clear_password_not_required",
      expect.anything(),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("displays an error message when the Tauri command fails", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "mfa_is_configured") return Promise.resolve(false);
      if (cmd === "clear_password_not_required") {
        return Promise.reject("Permission denied");
      }
      return Promise.resolve(null);
    }) as typeof invoke);

    const onSuccess = vi.fn();
    render(
      <ClearPasswordNotRequiredDialog
        {...defaultProps}
        onSuccess={onSuccess}
      />,
      { wrapper: TestProviders },
    );

    fireEvent.click(screen.getByTestId("acknowledge-checkbox"));
    fireEvent.click(screen.getByTestId("confirm-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toHaveTextContent(
        "Permission denied",
      );
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("invokes the MFA gate with action='ClearPasswordNotRequired' before the Tauri command", async () => {
    let mfaCheckOrder = 0;
    let invokeCallOrder = 0;
    let counter = 0;
    mockInvoke.mockImplementation(((cmd: string, args?: unknown) => {
      counter++;
      if (cmd === "mfa_is_configured") {
        mfaCheckOrder = counter;
        return Promise.resolve(false);
      }
      if (cmd === "clear_password_not_required") {
        invokeCallOrder = counter;
        return Promise.resolve();
      }
      // Pass-through for any incidental calls
      void args;
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<ClearPasswordNotRequiredDialog {...defaultProps} />, {
      wrapper: TestProviders,
    });

    fireEvent.click(screen.getByTestId("acknowledge-checkbox"));
    fireEvent.click(screen.getByTestId("confirm-btn"));

    await waitFor(() => {
      expect(invokeCallOrder).toBeGreaterThan(0);
    });
    expect(mfaCheckOrder).toBeLessThan(invokeCallOrder);
  });

  it("does not call clear_password_not_required when MFA is required and user cancels", async () => {
    // mfa_is_configured = true + mfa_requires = true -> MFA dialog shown.
    // The DialogProvider in TestProviders does not auto-resolve; the gate
    // will hang. To test cancellation, we simulate by having mfa_requires
    // throw, which the hook treats as deny.
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "mfa_is_configured") return Promise.resolve(true);
      if (cmd === "mfa_requires") return Promise.reject("MFA check failed");
      if (cmd === "clear_password_not_required") return Promise.resolve();
      return Promise.resolve(null);
    }) as typeof invoke);

    const onSuccess = vi.fn();
    render(
      <ClearPasswordNotRequiredDialog
        {...defaultProps}
        onSuccess={onSuccess}
      />,
      { wrapper: TestProviders },
    );

    fireEvent.click(screen.getByTestId("acknowledge-checkbox"));
    fireEvent.click(screen.getByTestId("confirm-btn"));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "clear_password_not_required",
      expect.anything(),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
