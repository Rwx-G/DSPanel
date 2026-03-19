import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { UserActions } from "./UserActions";
import { DialogProvider } from "@/contexts/DialogContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { NotificationHost } from "@/components/common/NotificationHost";
import type { DirectoryUser } from "@/types/directory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    level: "HelpDesk" as const,
    groups: [],
    loading: false,
    hasPermission: (required: string) => {
      const levels = ["ReadOnly", "HelpDesk", "AccountOperator", "DomainAdmin"];
      return levels.indexOf("HelpDesk") >= levels.indexOf(required);
    },
  }),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <NotificationProvider>
      <DialogProvider>
        {children}
        <NotificationHost />
      </DialogProvider>
    </NotificationProvider>
  );
}

function makeUser(overrides: Partial<DirectoryUser> = {}): DirectoryUser {
  return {
    distinguishedName: "CN=John Doe,OU=Users,DC=example,DC=com",
    samAccountName: "jdoe",
    displayName: "John Doe",
    userPrincipalName: "jdoe@example.com",
    givenName: "John",
    surname: "Doe",
    email: "jdoe@example.com",
    department: "IT",
    title: "Engineer",
    organizationalUnit: "Users > Corp",
    enabled: true,
    lockedOut: false,
    accountExpires: null,
    passwordLastSet: "2026-03-01",
    passwordExpired: false,
    passwordNeverExpires: false,
    lastLogon: "2026-03-12",
    lastLogonWorkstation: "WS01",
    badPasswordCount: 0,
    whenCreated: "2024-01-01",
    whenChanged: "2026-03-01",
    memberOf: [],
    rawAttributes: {},
    ...overrides,
  };
}

describe("UserActions", () => {
  const onRefresh = vi.fn();
  const onResetPassword = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders reset password button", () => {
    render(
      <UserActions
        user={makeUser()}
        onRefresh={onRefresh}
        onResetPassword={onResetPassword}
      />,
      { wrapper: TestProviders },
    );
    expect(screen.getByTestId("reset-password-btn")).toBeInTheDocument();
  });

  it("calls onResetPassword when reset password button clicked", () => {
    render(
      <UserActions
        user={makeUser()}
        onRefresh={onRefresh}
        onResetPassword={onResetPassword}
      />,
      { wrapper: TestProviders },
    );
    fireEvent.click(screen.getByTestId("reset-password-btn"));
    expect(onResetPassword).toHaveBeenCalled();
  });

  it("shows unlock button when account is locked", () => {
    render(
      <UserActions
        user={makeUser({ lockedOut: true })}
        onRefresh={onRefresh}
        onResetPassword={onResetPassword}
      />,
      { wrapper: TestProviders },
    );
    expect(screen.getByTestId("unlock-btn")).toBeInTheDocument();
  });

  it("does not show unlock button when account is not locked", () => {
    render(
      <UserActions
        user={makeUser({ lockedOut: false })}
        onRefresh={onRefresh}
        onResetPassword={onResetPassword}
      />,
      { wrapper: TestProviders },
    );
    expect(screen.queryByTestId("unlock-btn")).not.toBeInTheDocument();
  });

  it("shows disable button when account is enabled", () => {
    render(
      <UserActions
        user={makeUser({ enabled: true })}
        onRefresh={onRefresh}
        onResetPassword={onResetPassword}
      />,
      { wrapper: TestProviders },
    );
    expect(screen.getByTestId("disable-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("enable-btn")).not.toBeInTheDocument();
  });

  it("shows enable button when account is disabled", () => {
    render(
      <UserActions
        user={makeUser({ enabled: false })}
        onRefresh={onRefresh}
        onResetPassword={onResetPassword}
      />,
      { wrapper: TestProviders },
    );
    expect(screen.getByTestId("enable-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("disable-btn")).not.toBeInTheDocument();
  });

  it("shows confirmation dialog when unlock is clicked", async () => {
    render(
      <UserActions
        user={makeUser({ lockedOut: true })}
        onRefresh={onRefresh}
        onResetPassword={onResetPassword}
      />,
      { wrapper: TestProviders },
    );
    fireEvent.click(screen.getByTestId("unlock-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("confirmation-dialog")).toBeInTheDocument();
    });

    expect(screen.getByTestId("dialog-message")).toHaveTextContent(
      "unlock the account for John Doe",
    );
  });

  it("calls unlock_account when confirmed", async () => {
    mockInvoke.mockResolvedValueOnce(undefined as never);

    render(
      <UserActions
        user={makeUser({ lockedOut: true })}
        onRefresh={onRefresh}
        onResetPassword={onResetPassword}
      />,
      { wrapper: TestProviders },
    );

    fireEvent.click(screen.getByTestId("unlock-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("confirmation-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("unlock_account", {
        userDn: "CN=John Doe,OU=Users,DC=example,DC=com",
      });
    });
  });

  it("calls onRefresh after successful action", async () => {
    mockInvoke.mockResolvedValueOnce(undefined as never);

    render(
      <UserActions
        user={makeUser({ lockedOut: true })}
        onRefresh={onRefresh}
        onResetPassword={onResetPassword}
      />,
      { wrapper: TestProviders },
    );

    fireEvent.click(screen.getByTestId("unlock-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("confirmation-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it("does not proceed when confirmation is cancelled", async () => {
    render(
      <UserActions
        user={makeUser({ lockedOut: true })}
        onRefresh={onRefresh}
        onResetPassword={onResetPassword}
      />,
      { wrapper: TestProviders },
    );

    fireEvent.click(screen.getByTestId("unlock-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("confirmation-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("dialog-cancel"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("confirmation-dialog"),
      ).not.toBeInTheDocument();
    });

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("calls enable_account when enable is confirmed", async () => {
    mockInvoke.mockResolvedValueOnce(undefined as never);

    render(
      <UserActions
        user={makeUser({ enabled: false })}
        onRefresh={onRefresh}
        onResetPassword={onResetPassword}
      />,
      { wrapper: TestProviders },
    );

    fireEvent.click(screen.getByTestId("enable-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("confirmation-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("enable_account", {
        userDn: "CN=John Doe,OU=Users,DC=example,DC=com",
      });
    });
  });

  it("calls disable_account when disable is confirmed", async () => {
    mockInvoke.mockResolvedValueOnce(undefined as never);

    render(
      <UserActions
        user={makeUser({ enabled: true })}
        onRefresh={onRefresh}
        onResetPassword={onResetPassword}
      />,
      { wrapper: TestProviders },
    );

    fireEvent.click(screen.getByTestId("disable-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("confirmation-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("disable_account", {
        userDn: "CN=John Doe,OU=Users,DC=example,DC=com",
      });
    });
  });

  it("shows error notification on action failure with string error", async () => {
    mockInvoke.mockRejectedValueOnce("Insufficient permissions" as never);

    render(
      <UserActions
        user={makeUser({ lockedOut: true })}
        onRefresh={onRefresh}
        onResetPassword={onResetPassword}
      />,
      { wrapper: TestProviders },
    );

    fireEvent.click(screen.getByTestId("unlock-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("confirmation-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => {
      expect(screen.getByText("Insufficient permissions")).toBeInTheDocument();
    });
  });

  it("shows extracted error message on action failure with Error object", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("network") as never);

    render(
      <UserActions
        user={makeUser({ lockedOut: true })}
        onRefresh={onRefresh}
        onResetPassword={onResetPassword}
      />,
      { wrapper: TestProviders },
    );

    fireEvent.click(screen.getByTestId("unlock-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("confirmation-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => {
      expect(screen.getByText("network")).toBeInTheDocument();
    });
  });

  it("shows parsed JSON error message when error is backend JSON", async () => {
    mockInvoke.mockRejectedValueOnce(
      JSON.stringify({ kind: "permission_denied", message: "Access denied", user_message: "Access denied by policy", retryable: false }) as never,
    );

    render(
      <UserActions
        user={makeUser({ lockedOut: true })}
        onRefresh={onRefresh}
        onResetPassword={onResetPassword}
      />,
      { wrapper: TestProviders },
    );

    fireEvent.click(screen.getByTestId("unlock-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("confirmation-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => {
      expect(screen.getByText("Access denied by policy")).toBeInTheDocument();
    });
  });
});
