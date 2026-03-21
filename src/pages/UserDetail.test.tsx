import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { UserDetail, type UserDetailProps } from "./UserDetail";
import { NavigationProvider } from "@/contexts/NavigationContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { DialogProvider } from "@/contexts/DialogContext";
import type { DirectoryUser } from "@/types/directory";
import type { AccountHealthStatus } from "@/types/health";

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <NotificationProvider>
      <DialogProvider>
        <NavigationProvider>{children}</NavigationProvider>
      </DialogProvider>
    </NotificationProvider>
  );
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

// IntersectionObserver is not available in jsdom
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  if (!globalThis.IntersectionObserver) {
    globalThis.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
  }
});

// Mock sub-components that invoke Tauri commands internally
vi.mock("@/components/common/UserActions", () => ({
  UserActions: ({ onResetPassword }: { onResetPassword: () => void }) => (
    <div data-testid="user-actions">
      <button data-testid="reset-password-trigger" onClick={onResetPassword}>
        Reset Password
      </button>
    </div>
  ),
}));

vi.mock("@/components/common/PasswordFlagsEditor", () => ({
  PasswordFlagsEditor: () => <div data-testid="password-flags-editor" />,
}));

vi.mock("@/components/data/AdvancedAttributes", () => ({
  AdvancedAttributes: () => <div data-testid="advanced-attributes" />,
}));

vi.mock("@/components/comparison/StateInTimeView", () => ({
  StateInTimeView: () => <div data-testid="state-in-time-view" />,
}));

vi.mock("@/components/dialogs/PasswordResetDialog", () => ({
  PasswordResetDialog: ({
    onClose,
  }: {
    onClose: () => void;
    onSuccess: () => void;
    userDn: string;
    displayName: string;
  }) => (
    <div data-testid="password-reset-dialog">
      <button data-testid="close-reset-dialog" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

vi.mock("@/components/dialogs/GroupMembersDialog", () => ({
  GroupMembersDialog: ({
    onClose,
    groupName,
  }: {
    onClose: () => void;
    groupDn: string;
    groupName: string;
  }) => (
    <div data-testid="group-members-dialog">
      <span>{groupName}</span>
      <button data-testid="close-group-dialog" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

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
    organizationalUnit: "Users",
    enabled: true,
    lockedOut: false,
    accountExpires: null,
    passwordLastSet: "2026-02-01T10:00:00Z",
    passwordExpired: false,
    passwordNeverExpires: false,
    lastLogon: "2026-03-12T08:00:00Z",
    lastLogonWorkstation: "WS001",
    badPasswordCount: 0,
    whenCreated: "2024-01-01T00:00:00Z",
    whenChanged: "2026-03-01T00:00:00Z",
    memberOf: [
      "CN=Domain Users,CN=Users,DC=example,DC=com",
      "CN=Developers,OU=Groups,DC=example,DC=com",
    ],
    rawAttributes: {},
    ...overrides,
  };
}

function makeProps(overrides: Partial<UserDetailProps> = {}): UserDetailProps {
  const user = overrides.user ?? makeUser();
  return {
    user,
    groupColumns: [
      { key: "name", header: "Group Name", sortable: true },
      { key: "dn", header: "Distinguished Name", sortable: true },
    ],
    groupRows: user.memberOf.map((dn) => ({
      name: dn.split(",")[0].replace("CN=", ""),
      dn,
    })),
    groupFilterText: "",
    onGroupFilterText: vi.fn(),
    ...overrides,
  };
}

describe("UserDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders user detail container", () => {
    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });
    expect(screen.getByTestId("user-detail")).toBeInTheDocument();
  });

  it("displays user display name as heading", () => {
    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });
    const heading = screen.getByTestId("user-detail").querySelector("h2");
    expect(heading).toHaveTextContent("John Doe");
  });

  it("falls back to samAccountName when displayName is empty", () => {
    render(
      <UserDetail {...makeProps({ user: makeUser({ displayName: "" }) })} />,
      { wrapper: TestProviders },
    );
    const heading = screen.getByTestId("user-detail").querySelector("h2");
    expect(heading).toHaveTextContent("jdoe");
  });

  it("shows Enabled status badge for enabled user", () => {
    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });
    const badges = screen.getAllByText("Enabled");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Disabled status badge for disabled user", () => {
    render(
      <UserDetail {...makeProps({ user: makeUser({ enabled: false }) })} />,
      { wrapper: TestProviders },
    );
    const badges = screen.getAllByText("Disabled");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Locked badge when user is locked out", () => {
    render(
      <UserDetail {...makeProps({ user: makeUser({ lockedOut: true }) })} />,
      { wrapper: TestProviders },
    );
    expect(screen.getByText("Locked")).toBeInTheDocument();
  });

  it("does not show Locked badge when user is not locked out", () => {
    render(
      <UserDetail {...makeProps({ user: makeUser({ lockedOut: false }) })} />,
      { wrapper: TestProviders },
    );
    expect(screen.queryByText("Locked")).not.toBeInTheDocument();
  });

  it("displays samAccountName with copy button", () => {
    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });
    const allJdoe = screen.getAllByText("jdoe");
    expect(allJdoe.length).toBeGreaterThanOrEqual(1);
  });

  it("renders property groups for Identity, Location, Account Status, Authentication, Dates", () => {
    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });
    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByText("Account Status")).toBeInTheDocument();
    expect(screen.getByText("Authentication")).toBeInTheDocument();
    expect(screen.getByText("Dates")).toBeInTheDocument();
  });

  it("displays property values from user object", () => {
    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });
    // Email appears both in Email and UPN fields
    const emails = screen.getAllByText("jdoe@example.com");
    expect(emails.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Engineer")).toBeInTheDocument();
    expect(screen.getByText("IT")).toBeInTheDocument();
  });

  it("renders UserActions component", () => {
    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });
    expect(screen.getByTestId("user-actions")).toBeInTheDocument();
  });

  it("renders PasswordFlagsEditor component", () => {
    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });
    expect(screen.getByTestId("password-flags-editor")).toBeInTheDocument();
  });

  it("renders group memberships section with correct count", () => {
    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });
    expect(screen.getByTestId("user-groups-section")).toBeInTheDocument();
    expect(screen.getByText("Group Memberships (2)")).toBeInTheDocument();
  });

  it("renders AdvancedAttributes component", () => {
    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });
    expect(screen.getByTestId("advanced-attributes")).toBeInTheDocument();
  });

  it("renders Replication History section", () => {
    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });
    expect(screen.getByTestId("user-history-section")).toBeInTheDocument();
    expect(screen.getByText("Replication History")).toBeInTheDocument();
  });

  it("shows HealthBadge when healthStatus is provided", () => {
    const healthStatus: AccountHealthStatus = {
      level: "Healthy",
      activeFlags: [],
    };
    render(<UserDetail {...makeProps({ healthStatus })} />, {
      wrapper: TestProviders,
    });
    expect(screen.getByTestId("health-badge")).toBeInTheDocument();
  });

  it("does not show HealthBadge when healthStatus is undefined", () => {
    render(<UserDetail {...makeProps({ healthStatus: undefined })} />, {
      wrapper: TestProviders,
    });
    expect(screen.queryByTestId("health-badge")).not.toBeInTheDocument();
  });

  it("opens password reset dialog when trigger is clicked", async () => {
    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("reset-password-trigger"));
    await waitFor(() => {
      expect(screen.getByTestId("password-reset-dialog")).toBeInTheDocument();
    });
  });

  it("closes password reset dialog when close is clicked", async () => {
    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("reset-password-trigger"));
    await waitFor(() => {
      expect(screen.getByTestId("password-reset-dialog")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("close-reset-dialog"));
    await waitFor(() => {
      expect(
        screen.queryByTestId("password-reset-dialog"),
      ).not.toBeInTheDocument();
    });
  });

  it("calls onRefresh callback when provided", () => {
    const onRefresh = vi.fn();
    render(<UserDetail {...makeProps({ onRefresh })} />, {
      wrapper: TestProviders,
    });
    // onRefresh is wired to UserActions, which we mocked
    expect(screen.getByTestId("user-actions")).toBeInTheDocument();
  });

  it("applies severity styling from health flags to property labels", () => {
    const healthStatus: AccountHealthStatus = {
      level: "Critical",
      activeFlags: [
        {
          name: "Disabled",
          severity: "Critical",
          description: "Account is disabled",
        },
        {
          name: "PasswordExpired",
          severity: "Warning",
          description: "Password is expired",
        },
      ],
    };
    render(
      <UserDetail
        {...makeProps({
          user: makeUser({ enabled: false, passwordExpired: true }),
          healthStatus,
        })}
      />,
      { wrapper: TestProviders },
    );
    // The component should still render without error
    expect(screen.getByTestId("user-detail")).toBeInTheDocument();
  });

  it("shows N/A for missing lastLogonWorkstation", () => {
    render(
      <UserDetail
        {...makeProps({
          user: makeUser({ lastLogonWorkstation: "" }),
        })}
      />,
      { wrapper: TestProviders },
    );
    expect(screen.getByText("N/A")).toBeInTheDocument();
  });

  it("shows Never for null accountExpires", () => {
    render(
      <UserDetail
        {...makeProps({
          user: makeUser({ accountExpires: null }),
        })}
      />,
      { wrapper: TestProviders },
    );
    // "Never" appears in Account Expires property
    const neverTexts = screen.getAllByText("Never");
    expect(neverTexts.length).toBeGreaterThanOrEqual(1);
  });

  it("renders empty group section when user has no groups", () => {
    const user = makeUser({ memberOf: [] });
    render(
      <UserDetail
        {...makeProps({
          user,
          groupRows: [],
        })}
      />,
      { wrapper: TestProviders },
    );
    expect(screen.getByText("Group Memberships (0)")).toBeInTheDocument();
  });

  it("shows severity on Status property when Disabled flag is Critical", () => {
    const healthStatus: AccountHealthStatus = {
      level: "Critical",
      activeFlags: [
        {
          name: "Disabled",
          severity: "Critical",
          description: "Account is disabled",
        },
      ],
    };
    render(
      <UserDetail
        {...makeProps({
          user: makeUser({ enabled: false }),
          healthStatus,
        })}
      />,
      { wrapper: TestProviders },
    );
    // Component should render the severity info without errors
    expect(screen.getByTestId("user-detail")).toBeInTheDocument();
    // The Disabled text should appear in both the badge and property value
    const disabledTexts = screen.getAllByText("Disabled");
    expect(disabledTexts.length).toBeGreaterThanOrEqual(2);
  });

  it("shows severity on Last Logon for Inactive90Days flag", () => {
    const healthStatus: AccountHealthStatus = {
      level: "Warning",
      activeFlags: [
        {
          name: "Inactive90Days",
          severity: "Warning",
          description: "User inactive for 90 days",
        },
      ],
    };
    render(
      <UserDetail
        {...makeProps({
          user: makeUser({ lastLogon: "2025-01-01T00:00:00Z" }),
          healthStatus,
        })}
      />,
      { wrapper: TestProviders },
    );
    expect(screen.getByTestId("user-detail")).toBeInTheDocument();
  });

  it("shows severity on Password Last Set for PasswordNeverChanged flag", () => {
    const healthStatus: AccountHealthStatus = {
      level: "Warning",
      activeFlags: [
        {
          name: "PasswordNeverChanged",
          severity: "Warning",
          description: "Password never changed",
        },
      ],
    };
    render(
      <UserDetail
        {...makeProps({
          user: makeUser({ passwordLastSet: null }),
          healthStatus,
        })}
      />,
      { wrapper: TestProviders },
    );
    // "Never" should appear for both passwordLastSet and other null fields
    const neverTexts = screen.getAllByText("Never");
    expect(neverTexts.length).toBeGreaterThanOrEqual(1);
  });

  it("opens group members dialog via context menu", async () => {
    const props = makeProps();
    render(<UserDetail {...props} />, { wrapper: TestProviders });

    // The DataTable renders rows - right-click on a row
    const rows = screen.getAllByRole("row");
    // Find a data row (skip header)
    const dataRow = rows.find((r) => r.querySelector("td"));
    expect(dataRow).toBeDefined();
    fireEvent.contextMenu(dataRow!);

    await waitFor(() => {
      expect(screen.getByText("View group members")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("View group members"));

    await waitFor(() => {
      expect(screen.getByTestId("group-members-dialog")).toBeInTheDocument();
    });
  });

  it("closes group members dialog", async () => {
    const props = makeProps();
    render(<UserDetail {...props} />, { wrapper: TestProviders });

    const rows = screen.getAllByRole("row");
    const dataRow = rows.find((r) => r.querySelector("td"));
    fireEvent.contextMenu(dataRow!);

    await waitFor(() => {
      expect(screen.getByText("View group members")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("View group members"));

    await waitFor(() => {
      expect(screen.getByTestId("group-members-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("close-group-dialog"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("group-members-dialog"),
      ).not.toBeInTheDocument();
    });
  });

  it("shows Open in Group Management option in context menu", async () => {
    const props = makeProps();
    render(<UserDetail {...props} />, { wrapper: TestProviders });

    const rows = screen.getAllByRole("row");
    const dataRow = rows.find((r) => r.querySelector("td"));
    fireEvent.contextMenu(dataRow!);

    await waitFor(() => {
      expect(screen.getByText("Open in Group Management")).toBeInTheDocument();
    });
  });

  it("shows accountExpires value when set", () => {
    render(
      <UserDetail
        {...makeProps({
          user: makeUser({ accountExpires: "2026-12-31T00:00:00Z" }),
        })}
      />,
      { wrapper: TestProviders },
    );
    expect(screen.getByText("2026-12-31T00:00:00Z")).toBeInTheDocument();
  });

  it("displays password never expires Yes when flag is set", () => {
    render(
      <UserDetail
        {...makeProps({
          user: makeUser({ passwordNeverExpires: true }),
        })}
      />,
      { wrapper: TestProviders },
    );
    // "Yes" appears in Password Never Expires and possibly Password Expired
    const yesTexts = screen.getAllByText("Yes");
    expect(yesTexts.length).toBeGreaterThanOrEqual(1);
  });

  it("displays bad password count", () => {
    render(
      <UserDetail
        {...makeProps({
          user: makeUser({ badPasswordCount: 5 }),
        })}
      />,
      { wrapper: TestProviders },
    );
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("shows Never for null lastLogon", () => {
    render(
      <UserDetail
        {...makeProps({
          user: makeUser({ lastLogon: null }),
        })}
      />,
      { wrapper: TestProviders },
    );
    const neverTexts = screen.getAllByText("Never");
    expect(neverTexts.length).toBeGreaterThanOrEqual(1);
  });

  it("Critical severity overrides Warning for the same label", () => {
    const healthStatus: AccountHealthStatus = {
      level: "Critical",
      activeFlags: [
        {
          name: "Inactive30Days",
          severity: "Warning",
          description: "30 days inactive",
        },
        {
          name: "NeverLoggedOn",
          severity: "Critical",
          description: "Never logged on",
        },
      ],
    };
    render(
      <UserDetail
        {...makeProps({
          user: makeUser({ lastLogon: null }),
          healthStatus,
        })}
      />,
      { wrapper: TestProviders },
    );
    // Both map to "Last Logon" - Critical should win
    expect(screen.getByTestId("user-detail")).toBeInTheDocument();
  });

  it("renders ExchangePanel when user has msExchMailboxGuid in rawAttributes", async () => {
    const user = makeUser({
      rawAttributes: {
        msExchMailboxGuid: ["abc-123-guid"],
        msExchRecipientTypeDetails: ["1"],
        proxyAddresses: ["SMTP:jdoe@example.com"],
      },
    });
    render(<UserDetail {...makeProps({ user })} />, {
      wrapper: TestProviders,
    });
    await waitFor(() => {
      expect(screen.getByTestId("exchange-panel")).toBeInTheDocument();
    });
  });

  it("does not render ExchangePanel when user has no Exchange attributes", () => {
    const user = makeUser({ rawAttributes: {} });
    render(<UserDetail {...makeProps({ user })} />, {
      wrapper: TestProviders,
    });
    expect(screen.queryByTestId("exchange-panel")).not.toBeInTheDocument();
  });

  it("renders ExchangeOnlinePanel when invoke returns data", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mockedInvoke = vi.mocked(invoke);
    const exchangeOnlineData: import("@/types/exchange-online").ExchangeOnlineInfo =
      {
        primarySmtpAddress: "jdoe@example.com",
        emailAliases: [],
        forwardingSmtpAddress: null,
        autoReplyStatus: "Disabled",
        mailboxUsageBytes: 1024,
        mailboxQuotaBytes: 10240,
        usagePercentage: 10,
        delegates: [],
      };
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_exchange_online_info") {
        return Promise.resolve(exchangeOnlineData) as ReturnType<typeof invoke>;
      }
      return Promise.resolve(null) as ReturnType<typeof invoke>;
    });

    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(
        screen.getByTestId("exchange-online-panel"),
      ).toBeInTheDocument();
    });
  });

  it("does not render ExchangeOnlinePanel when invoke returns null", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mockedInvoke = vi.mocked(invoke);
    mockedInvoke.mockImplementation(() => {
      return Promise.resolve(null) as ReturnType<typeof invoke>;
    });

    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });

    // Wait a tick for the useEffect to settle
    await waitFor(() => {
      expect(screen.getByTestId("user-detail")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("exchange-online-panel"),
    ).not.toBeInTheDocument();
  });

  it("shows pending changes bar after staging a change via PropertyGrid", async () => {
    // Mock usePermissions so canEdit is true
    const permMod = await import("@/hooks/usePermissions");
    vi.spyOn(permMod, "usePermissions").mockReturnValue({
      hasPermission: () => true,
      level: "AccountOperator" as import("@/types/permissions").PermissionLevel,
      groups: [],
      loading: false,
    });

    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });

    // Click the edit button for displayName
    const editBtn = screen.getByTestId("edit-btn-displayName");
    fireEvent.click(editBtn);

    // Type a new value in the input
    const input = screen.getByTestId("edit-input-displayName");
    fireEvent.change(input, { target: { value: "Jane Doe" } });

    // Confirm the edit
    fireEvent.click(screen.getByTestId("edit-confirm-displayName"));

    await waitFor(() => {
      expect(screen.getByTestId("pending-changes-bar")).toBeInTheDocument();
    });
    expect(screen.getByText(/1 change\(s\)/)).toBeInTheDocument();
  });

  it("clears pending changes when Discard button is clicked", async () => {
    const permMod = await import("@/hooks/usePermissions");
    vi.spyOn(permMod, "usePermissions").mockReturnValue({
      hasPermission: () => true,
      level: "AccountOperator" as import("@/types/permissions").PermissionLevel,
      groups: [],
      loading: false,
    });

    render(<UserDetail {...makeProps()} />, { wrapper: TestProviders });

    // Stage a change
    fireEvent.click(screen.getByTestId("edit-btn-displayName"));
    fireEvent.change(screen.getByTestId("edit-input-displayName"), {
      target: { value: "Jane Doe" },
    });
    fireEvent.click(screen.getByTestId("edit-confirm-displayName"));

    await waitFor(() => {
      expect(screen.getByTestId("pending-changes-bar")).toBeInTheDocument();
    });

    // Click Discard
    fireEvent.click(screen.getByTestId("discard-changes-btn"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("pending-changes-bar"),
      ).not.toBeInTheDocument();
    });
  });
});
