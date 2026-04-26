import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { ManageSpnsDialog, type RemoveSpnsResult } from "./ManageSpnsDialog";
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
  userDn: "CN=SvcSql,DC=example,DC=com",
  displayName: "Service SQL",
  currentSpns: [
    "MSSQLSvc/db.corp.local:1433",
    "HTTP/web1.corp.local",
    "HOST/dc01.corp.local",
  ],
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

function mockHappyPath(result?: RemoveSpnsResult) {
  mockInvoke.mockImplementation(((cmd: string) => {
    if (cmd === "mfa_is_configured") return Promise.resolve(false);
    if (cmd === "remove_user_spns") {
      return Promise.resolve(
        result ?? {
          removed: ["HTTP/web1.corp.local"],
          kept: ["MSSQLSvc/db.corp.local:1433", "HOST/dc01.corp.local"],
          blockedSystem: [],
        },
      );
    }
    return Promise.resolve(null);
  }) as typeof invoke);
}

describe("ManageSpnsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHappyPath();
  });

  it("renders the dialog with title and display name", () => {
    render(<ManageSpnsDialog {...defaultProps} />, { wrapper: TestProviders });
    expect(screen.getByTestId("manage-spns-dialog")).toBeInTheDocument();
    expect(screen.getByText("Service SQL")).toBeInTheDocument();
  });

  it("body explains Kerberoasting and references servicePrincipalName", () => {
    render(<ManageSpnsDialog {...defaultProps} />, { wrapper: TestProviders });
    // The body is rendered with whitespace-pre-line; the multi-paragraph
    // string is one node so we check the dialog's text content directly.
    const dialog = screen.getByTestId("manage-spns-dialog");
    expect(dialog.textContent).toMatch(/Kerberoasting/i);
    expect(dialog.textContent).toMatch(/Service Principal Names/i);
  });

  it("groups SPNs into removable and system sections", () => {
    render(<ManageSpnsDialog {...defaultProps} />, { wrapper: TestProviders });

    // Removable SPNs have checkboxes
    expect(
      screen.getByTestId("spn-checkbox-MSSQLSvc/db.corp.local:1433"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("spn-checkbox-HTTP/web1.corp.local"),
    ).toBeInTheDocument();

    // System SPN appears in the read-only section, NOT as a checkbox
    expect(
      screen.queryByTestId("spn-checkbox-HOST/dc01.corp.local"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("system-spn-row-HOST/dc01.corp.local"),
    ).toBeInTheDocument();
  });

  it("system SPN row has the system-spn tooltip", () => {
    render(<ManageSpnsDialog {...defaultProps} />, { wrapper: TestProviders });
    const row = screen.getByTestId("system-spn-row-HOST/dc01.corp.local");
    const title = row.getAttribute("title") ?? "";
    expect(title.toLowerCase()).toContain("system");
  });

  it("disables Confirm until at least one removable SPN is checked", () => {
    render(<ManageSpnsDialog {...defaultProps} />, { wrapper: TestProviders });
    const confirmBtn = screen.getByTestId("confirm-btn");
    expect(confirmBtn).toBeDisabled();

    fireEvent.click(screen.getByTestId("spn-checkbox-HTTP/web1.corp.local"));
    expect(confirmBtn).not.toBeDisabled();

    // Unchecking re-disables
    fireEvent.click(screen.getByTestId("spn-checkbox-HTTP/web1.corp.local"));
    expect(confirmBtn).toBeDisabled();
  });

  it("calls remove_user_spns with the selected SPNs on confirm", async () => {
    const onSuccess = vi.fn();
    render(<ManageSpnsDialog {...defaultProps} onSuccess={onSuccess} />, {
      wrapper: TestProviders,
    });

    fireEvent.click(screen.getByTestId("spn-checkbox-HTTP/web1.corp.local"));
    fireEvent.click(screen.getByTestId("confirm-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("remove_user_spns", {
        userDn: "CN=SvcSql,DC=example,DC=com",
        spnsToRemove: ["HTTP/web1.corp.local"],
      });
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it("forwards multiple selections in spnsToRemove", async () => {
    render(<ManageSpnsDialog {...defaultProps} />, { wrapper: TestProviders });

    fireEvent.click(screen.getByTestId("spn-checkbox-HTTP/web1.corp.local"));
    fireEvent.click(
      screen.getByTestId("spn-checkbox-MSSQLSvc/db.corp.local:1433"),
    );
    fireEvent.click(screen.getByTestId("confirm-btn"));

    await waitFor(() => {
      const call = mockInvoke.mock.calls.find(
        ([cmd]) => cmd === "remove_user_spns",
      );
      expect(call).toBeTruthy();
      const args = call?.[1] as { spnsToRemove: string[] };
      expect(args.spnsToRemove).toHaveLength(2);
      expect(args.spnsToRemove).toContain("HTTP/web1.corp.local");
      expect(args.spnsToRemove).toContain("MSSQLSvc/db.corp.local:1433");
    });
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(<ManageSpnsDialog {...defaultProps} onClose={onClose} />, {
      wrapper: TestProviders,
    });
    fireEvent.click(screen.getByTestId("cancel-btn"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("displays an error message when the Tauri command fails", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "mfa_is_configured") return Promise.resolve(false);
      if (cmd === "remove_user_spns") return Promise.reject("Permission denied");
      return Promise.resolve(null);
    }) as typeof invoke);

    const onSuccess = vi.fn();
    render(<ManageSpnsDialog {...defaultProps} onSuccess={onSuccess} />, {
      wrapper: TestProviders,
    });

    fireEvent.click(screen.getByTestId("spn-checkbox-HTTP/web1.corp.local"));
    fireEvent.click(screen.getByTestId("confirm-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toHaveTextContent(
        "Permission denied",
      );
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("does not call remove_user_spns when MFA is denied", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "mfa_is_configured") return Promise.resolve(true);
      if (cmd === "mfa_requires") return Promise.reject("MFA check failed");
      if (cmd === "remove_user_spns") return Promise.resolve();
      return Promise.resolve(null);
    }) as typeof invoke);

    const onSuccess = vi.fn();
    render(<ManageSpnsDialog {...defaultProps} onSuccess={onSuccess} />, {
      wrapper: TestProviders,
    });

    fireEvent.click(screen.getByTestId("spn-checkbox-HTTP/web1.corp.local"));
    fireEvent.click(screen.getByTestId("confirm-btn"));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "remove_user_spns",
      expect.anything(),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("renders empty state when the user has no SPNs at all", () => {
    render(
      <ManageSpnsDialog {...defaultProps} currentSpns={[]} />,
      { wrapper: TestProviders },
    );
    expect(screen.getByTestId("empty-spns")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-btn")).toBeDisabled();
  });

  it("renders 'no removable' message when all SPNs are system", () => {
    render(
      <ManageSpnsDialog
        {...defaultProps}
        currentSpns={["HOST/dc01.corp.local", "ldap/dc01.corp.local"]}
      />,
      { wrapper: TestProviders },
    );
    expect(screen.getByTestId("empty-removable")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-btn")).toBeDisabled();
  });
});
