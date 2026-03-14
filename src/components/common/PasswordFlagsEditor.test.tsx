import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { PasswordFlagsEditor } from "./PasswordFlagsEditor";
import { DialogProvider } from "@/contexts/DialogContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { NotificationHost } from "@/components/common/NotificationHost";
import type { DirectoryUser } from "@/types/directory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

let mockLevel = "AccountOperator";

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    level: mockLevel as
      | "ReadOnly"
      | "HelpDesk"
      | "AccountOperator"
      | "DomainAdmin",
    groups: [],
    loading: false,
    hasPermission: (required: string) => {
      const levels = ["ReadOnly", "HelpDesk", "AccountOperator", "DomainAdmin"];
      return levels.indexOf(mockLevel) >= levels.indexOf(required);
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

describe("PasswordFlagsEditor", () => {
  const onRefresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockLevel = "AccountOperator";
    // Default mock: get_cannot_change_password returns false
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_cannot_change_password") return Promise.resolve(false);
      return Promise.resolve(undefined);
    }) as typeof invoke);
  });

  it("renders with correct initial state", () => {
    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });
    expect(screen.getByTestId("password-flags-editor")).toBeInTheDocument();
    expect(
      screen.getByTestId("password-never-expires-checkbox"),
    ).not.toBeChecked();
  });

  it("reflects password never expires flag from user", () => {
    render(
      <PasswordFlagsEditor
        user={makeUser({ passwordNeverExpires: true })}
        onRefresh={onRefresh}
      />,
      { wrapper: TestProviders },
    );
    expect(screen.getByTestId("password-never-expires-checkbox")).toBeChecked();
  });

  it("save button is always visible but disabled when unchanged", () => {
    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });
    const btn = screen.getByTestId("save-flags-btn");
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("save button becomes enabled when flag is changed", () => {
    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });
    fireEvent.click(screen.getByTestId("password-never-expires-checkbox"));
    expect(screen.getByTestId("save-flags-btn")).toBeEnabled();
  });

  it("save button becomes disabled again when flag is reset to original", () => {
    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });
    fireEvent.click(screen.getByTestId("password-never-expires-checkbox"));
    expect(screen.getByTestId("save-flags-btn")).toBeEnabled();

    fireEvent.click(screen.getByTestId("password-never-expires-checkbox"));
    expect(screen.getByTestId("save-flags-btn")).toBeDisabled();
  });

  it("shows dry-run preview on save", async () => {
    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });

    fireEvent.click(screen.getByTestId("password-never-expires-checkbox"));
    fireEvent.click(screen.getByTestId("save-flags-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("dryrun-dialog")).toBeInTheDocument();
    });
  });

  it("calls set_password_flags after confirming dry-run", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_cannot_change_password") return Promise.resolve(false);
      return Promise.resolve(undefined);
    }) as typeof invoke);

    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });

    fireEvent.click(screen.getByTestId("password-never-expires-checkbox"));
    fireEvent.click(screen.getByTestId("save-flags-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("dryrun-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("dryrun-execute"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("set_password_flags", {
        userDn: "CN=John Doe,OU=Users,DC=example,DC=com",
        passwordNeverExpires: true,
        userCannotChangePassword: false,
      });
    });
  });

  it("does not call invoke when dry-run is cancelled", async () => {
    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });

    fireEvent.click(screen.getByTestId("password-never-expires-checkbox"));
    fireEvent.click(screen.getByTestId("save-flags-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("dryrun-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("dryrun-cancel"));

    await waitFor(() => {
      expect(screen.queryByTestId("dryrun-dialog")).not.toBeInTheDocument();
    });

    // set_password_flags should NOT have been called (get_cannot_change_password is OK)
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "set_password_flags",
      expect.anything(),
    );
  });

  it("disables checkbox for ReadOnly users", () => {
    mockLevel = "ReadOnly";
    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });
    expect(
      screen.getByTestId("password-never-expires-checkbox"),
    ).toBeDisabled();
  });

  it("renders user cannot change password checkbox", () => {
    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });
    expect(
      screen.getByTestId("user-cannot-change-password-checkbox"),
    ).toBeInTheDocument();
  });

  it("fetches DACL-based cannot change password flag on mount", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_cannot_change_password") return Promise.resolve(true);
      return Promise.resolve(undefined);
    }) as typeof invoke);

    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_cannot_change_password", {
        userDn: "CN=John Doe,OU=Users,DC=example,DC=com",
      });
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("user-cannot-change-password-checkbox"),
      ).toBeChecked();
    });
  });

  it("handles error when fetching cannot change password flag", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_cannot_change_password")
        return Promise.reject("LDAP error");
      return Promise.resolve(undefined);
    }) as typeof invoke);

    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("user-cannot-change-password-checkbox"),
      ).not.toBeChecked();
    });
  });

  it("enables save button when user cannot change password checkbox is toggled", async () => {
    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });

    // Wait for initial DACL fetch to complete
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "get_cannot_change_password",
        expect.anything(),
      );
    });

    fireEvent.click(screen.getByTestId("user-cannot-change-password-checkbox"));
    expect(screen.getByTestId("save-flags-btn")).toBeEnabled();
  });

  it("includes userCannotChangePassword in dry-run preview", async () => {
    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "get_cannot_change_password",
        expect.anything(),
      );
    });

    fireEvent.click(screen.getByTestId("user-cannot-change-password-checkbox"));
    fireEvent.click(screen.getByTestId("save-flags-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("dryrun-dialog")).toBeInTheDocument();
    });

    // Verify dry-run shows the flag change (in the dryrun dialog, not the label)
    const dryrunDialog = screen.getByTestId("dryrun-dialog");
    expect(dryrunDialog).toHaveTextContent("User Cannot Change Password");
  });

  it("shows error notification on save failure", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_cannot_change_password") return Promise.resolve(false);
      if (cmd === "set_password_flags")
        return Promise.reject("Permission denied");
      return Promise.resolve(undefined);
    }) as typeof invoke);

    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "get_cannot_change_password",
        expect.anything(),
      );
    });

    fireEvent.click(screen.getByTestId("password-never-expires-checkbox"));
    fireEvent.click(screen.getByTestId("save-flags-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("dryrun-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("dryrun-execute"));

    await waitFor(() => {
      expect(screen.getByText("Permission denied")).toBeInTheDocument();
    });
  });

  it("shows generic error on save failure with non-string error", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_cannot_change_password") return Promise.resolve(false);
      if (cmd === "set_password_flags")
        return Promise.reject(new Error("fail"));
      return Promise.resolve(undefined);
    }) as typeof invoke);

    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "get_cannot_change_password",
        expect.anything(),
      );
    });

    fireEvent.click(screen.getByTestId("password-never-expires-checkbox"));
    fireEvent.click(screen.getByTestId("save-flags-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("dryrun-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("dryrun-execute"));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to update password flags"),
      ).toBeInTheDocument();
    });
  });

  it("calls onRefresh after successful save", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_cannot_change_password") return Promise.resolve(false);
      return Promise.resolve(undefined);
    }) as typeof invoke);

    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "get_cannot_change_password",
        expect.anything(),
      );
    });

    fireEvent.click(screen.getByTestId("password-never-expires-checkbox"));
    fireEvent.click(screen.getByTestId("save-flags-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("dryrun-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("dryrun-execute"));

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it("disables user cannot change password checkbox for ReadOnly users", () => {
    mockLevel = "ReadOnly";
    render(<PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />, {
      wrapper: TestProviders,
    });
    expect(
      screen.getByTestId("user-cannot-change-password-checkbox"),
    ).toBeDisabled();
  });
});
