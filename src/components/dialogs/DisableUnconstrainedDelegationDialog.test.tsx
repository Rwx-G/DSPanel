import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { DisableUnconstrainedDelegationDialog } from "./DisableUnconstrainedDelegationDialog";
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
  computerDn: "CN=DC01,OU=Domain Controllers,DC=example,DC=com",
  computerName: "DC01",
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

function mockHappyPath() {
  mockInvoke.mockImplementation(((cmd: string) => {
    if (cmd === "mfa_is_configured") return Promise.resolve(false);
    if (cmd === "disable_unconstrained_delegation") return Promise.resolve();
    return Promise.resolve(null);
  }) as typeof invoke);
}

describe("DisableUnconstrainedDelegationDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHappyPath();
  });

  it("renders the dialog with title and computer name", () => {
    render(
      <DisableUnconstrainedDelegationDialog {...defaultProps} />,
      { wrapper: TestProviders },
    );
    expect(
      screen.getByTestId("disable-unconstrained-delegation-dialog"),
    ).toBeInTheDocument();
    expect(screen.getByText("DC01")).toBeInTheDocument();
  });

  it("body explains the attack vector (TGT capture / golden ticket)", () => {
    render(
      <DisableUnconstrainedDelegationDialog {...defaultProps} />,
      { wrapper: TestProviders },
    );
    const dialog = screen.getByTestId(
      "disable-unconstrained-delegation-dialog",
    );
    expect(dialog.textContent).toMatch(/TGT/i);
    expect(dialog.textContent?.toLowerCase()).toContain("golden ticket");
    expect(dialog.textContent).toMatch(/impersonate|impersonating/i);
  });

  it("body recommends migration to constrained delegation via msDS-AllowedToDelegateTo", () => {
    render(
      <DisableUnconstrainedDelegationDialog {...defaultProps} />,
      { wrapper: TestProviders },
    );
    const dialog = screen.getByTestId(
      "disable-unconstrained-delegation-dialog",
    );
    expect(dialog.textContent).toMatch(/constrained delegation/i);
    expect(dialog.textContent).toContain("msDS-AllowedToDelegateTo");
  });

  it("body warns about risks to double-hop services", () => {
    render(
      <DisableUnconstrainedDelegationDialog {...defaultProps} />,
      { wrapper: TestProviders },
    );
    const dialog = screen.getByTestId(
      "disable-unconstrained-delegation-dialog",
    );
    // Mention of at least one double-hop service example
    expect(dialog.textContent).toMatch(/SQL Server|IIS|SharePoint/);
    // Mention of "double-hop" or "double salto" depending on lang
    expect(dialog.textContent?.toLowerCase()).toContain("double");
  });

  it("disables the Confirm button until the acknowledgement checkbox is checked", () => {
    render(
      <DisableUnconstrainedDelegationDialog {...defaultProps} />,
      { wrapper: TestProviders },
    );
    const confirmBtn = screen.getByTestId("confirm-btn");
    expect(confirmBtn).toBeDisabled();

    fireEvent.click(screen.getByTestId("acknowledge-checkbox"));
    expect(confirmBtn).not.toBeDisabled();

    // Unchecking re-disables
    fireEvent.click(screen.getByTestId("acknowledge-checkbox"));
    expect(confirmBtn).toBeDisabled();
  });

  it("calls disable_unconstrained_delegation with the computer DN on confirm", async () => {
    const onSuccess = vi.fn();
    render(
      <DisableUnconstrainedDelegationDialog
        {...defaultProps}
        onSuccess={onSuccess}
      />,
      { wrapper: TestProviders },
    );

    fireEvent.click(screen.getByTestId("acknowledge-checkbox"));
    fireEvent.click(screen.getByTestId("confirm-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "disable_unconstrained_delegation",
        { computerDn: "CN=DC01,OU=Domain Controllers,DC=example,DC=com" },
      );
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(
      <DisableUnconstrainedDelegationDialog
        {...defaultProps}
        onClose={onClose}
      />,
      { wrapper: TestProviders },
    );
    fireEvent.click(screen.getByTestId("cancel-btn"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("displays an error message when the Tauri command fails", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "mfa_is_configured") return Promise.resolve(false);
      if (cmd === "disable_unconstrained_delegation") {
        return Promise.reject("Permission denied");
      }
      return Promise.resolve(null);
    }) as typeof invoke);

    const onSuccess = vi.fn();
    render(
      <DisableUnconstrainedDelegationDialog
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

  it("invokes the MFA gate before the Tauri command", async () => {
    let mfaCheckOrder = 0;
    let invokeCallOrder = 0;
    let counter = 0;
    mockInvoke.mockImplementation(((cmd: string) => {
      counter++;
      if (cmd === "mfa_is_configured") {
        mfaCheckOrder = counter;
        return Promise.resolve(false);
      }
      if (cmd === "disable_unconstrained_delegation") {
        invokeCallOrder = counter;
        return Promise.resolve();
      }
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <DisableUnconstrainedDelegationDialog {...defaultProps} />,
      { wrapper: TestProviders },
    );

    fireEvent.click(screen.getByTestId("acknowledge-checkbox"));
    fireEvent.click(screen.getByTestId("confirm-btn"));

    await waitFor(() => {
      expect(invokeCallOrder).toBeGreaterThan(0);
    });
    expect(mfaCheckOrder).toBeLessThan(invokeCallOrder);
  });

  it("does not call disable_unconstrained_delegation when MFA is denied", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "mfa_is_configured") return Promise.resolve(true);
      if (cmd === "mfa_requires") return Promise.reject("MFA check failed");
      if (cmd === "disable_unconstrained_delegation") return Promise.resolve();
      return Promise.resolve(null);
    }) as typeof invoke);

    const onSuccess = vi.fn();
    render(
      <DisableUnconstrainedDelegationDialog
        {...defaultProps}
        onSuccess={onSuccess}
      />,
      { wrapper: TestProviders },
    );

    fireEvent.click(screen.getByTestId("acknowledge-checkbox"));
    fireEvent.click(screen.getByTestId("confirm-btn"));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "disable_unconstrained_delegation",
      expect.anything(),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
