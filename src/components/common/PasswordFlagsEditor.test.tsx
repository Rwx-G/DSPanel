import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { PasswordFlagsEditor } from "./PasswordFlagsEditor";
import { DialogProvider } from "@/contexts/DialogContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import type { DirectoryUser } from "@/types/directory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

let mockLevel = "AccountOperator";

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    level: mockLevel as "ReadOnly" | "HelpDesk" | "AccountOperator" | "DomainAdmin",
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
      <DialogProvider>{children}</DialogProvider>
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
    ...overrides,
  };
}

describe("PasswordFlagsEditor", () => {
  const onRefresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockLevel = "AccountOperator";
  });

  it("renders with correct initial state", () => {
    render(
      <PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />,
      { wrapper: TestProviders },
    );
    expect(screen.getByTestId("password-flags-editor")).toBeInTheDocument();
    expect(screen.getByTestId("password-never-expires-checkbox")).not.toBeChecked();
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

  it("shows save button when flag is changed", () => {
    render(
      <PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />,
      { wrapper: TestProviders },
    );
    expect(screen.queryByTestId("save-flags-btn")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("password-never-expires-checkbox"));

    expect(screen.getByTestId("save-flags-btn")).toBeInTheDocument();
  });

  it("hides save button when flag is reset to original", () => {
    render(
      <PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />,
      { wrapper: TestProviders },
    );
    fireEvent.click(screen.getByTestId("password-never-expires-checkbox"));
    expect(screen.getByTestId("save-flags-btn")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("password-never-expires-checkbox"));
    expect(screen.queryByTestId("save-flags-btn")).not.toBeInTheDocument();
  });

  it("shows dry-run preview on save", async () => {
    render(
      <PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />,
      { wrapper: TestProviders },
    );

    fireEvent.click(screen.getByTestId("password-never-expires-checkbox"));
    fireEvent.click(screen.getByTestId("save-flags-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("dryrun-dialog")).toBeInTheDocument();
    });
  });

  it("calls set_password_flags after confirming dry-run", async () => {
    mockInvoke.mockResolvedValueOnce(undefined as never);

    render(
      <PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />,
      { wrapper: TestProviders },
    );

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
    render(
      <PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />,
      { wrapper: TestProviders },
    );

    fireEvent.click(screen.getByTestId("password-never-expires-checkbox"));
    fireEvent.click(screen.getByTestId("save-flags-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("dryrun-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("dryrun-cancel"));

    await waitFor(() => {
      expect(screen.queryByTestId("dryrun-dialog")).not.toBeInTheDocument();
    });

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("disables checkbox for ReadOnly users", () => {
    mockLevel = "ReadOnly";
    render(
      <PasswordFlagsEditor user={makeUser()} onRefresh={onRefresh} />,
      { wrapper: TestProviders },
    );
    expect(screen.getByTestId("password-never-expires-checkbox")).toBeDisabled();
  });
});
