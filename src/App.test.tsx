import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { App } from "./App";
import { resetTabIdCounter } from "@/contexts/NavigationContext";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock heavy page components so ModuleRouter tests stay fast and isolated
vi.mock("@/pages/UserLookup", () => ({
  UserLookup: () => <div data-testid="mock-user-lookup">UserLookup</div>,
}));
vi.mock("@/pages/ComputerLookup", () => ({
  ComputerLookup: () => (
    <div data-testid="mock-computer-lookup">ComputerLookup</div>
  ),
}));
vi.mock("@/pages/UserComparison", () => ({
  UserComparison: () => (
    <div data-testid="mock-user-comparison">UserComparison</div>
  ),
}));
vi.mock("@/pages/GroupManagement", () => ({
  GroupManagement: () => (
    <div data-testid="mock-group-management">GroupManagement</div>
  ),
}));
vi.mock("@/pages/BulkOperations", () => ({
  BulkOperations: () => (
    <div data-testid="mock-bulk-operations">BulkOperations</div>
  ),
}));
vi.mock("@/pages/GroupHygiene", () => ({
  GroupHygiene: () => <div data-testid="mock-group-hygiene">GroupHygiene</div>,
}));
vi.mock("@/pages/NtfsAnalyzer", () => ({
  NtfsAnalyzer: () => (
    <div data-testid="mock-ntfs-analyzer">NtfsAnalyzer</div>
  ),
}));
vi.mock("@/pages/PasswordGenerator", () => ({
  PasswordGenerator: () => (
    <div data-testid="mock-password-generator">PasswordGenerator</div>
  ),
}));

import { invoke } from "@tauri-apps/api/core";
const mockedInvoke = vi.mocked(invoke);

function mockInvokeResponses(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    get_domain_info: { domain_name: null, is_connected: false },
    check_connection: false,
    get_permission_level: "ReadOnly",
    get_current_username: "TestUser",
    get_computer_name: "TESTPC",
    get_user_groups: [],
    ...overrides,
  };
  mockedInvoke.mockImplementation((cmd: string) => {
    if (cmd in defaults) {
      return Promise.resolve(defaults[cmd] as never);
    }
    return Promise.resolve(undefined as never);
  });
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTabIdCounter();
  });

  it("should render the app shell with all layout zones", async () => {
    mockInvokeResponses();

    render(<App />);

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("tab-bar")).toBeInTheDocument();
    expect(screen.getByTestId("breadcrumbs")).toBeInTheDocument();
    expect(screen.getByTestId("status-bar")).toBeInTheDocument();
  });

  it("should show dashboard home page by default", async () => {
    mockInvokeResponses();

    render(<App />);

    expect(screen.getByTestId("main-content")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("should show Connected when AD is reachable", async () => {
    mockInvokeResponses({
      get_domain_info: { domain_name: "CORP.LOCAL", is_connected: true },
      check_connection: true,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("status-connection")).toHaveTextContent(
        "Connected",
      );
    });
  });

  it("should show Disconnected status initially", () => {
    mockedInvoke.mockImplementation(() => new Promise(() => {}));

    render(<App />);

    expect(screen.getByTestId("status-connection")).toHaveTextContent(
      "Disconnected",
    );
  });

  it("should display app version in status bar", () => {
    mockedInvoke.mockImplementation(() => new Promise(() => {}));

    render(<App />);

    expect(screen.getByTestId("status-version")).toHaveTextContent(
      `v${__APP_VERSION__}`,
    );
  });

  it("should display username on dashboard", async () => {
    mockInvokeResponses();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("TestUser")).toBeInTheDocument();
    });
  });

  it("should display domain name when connected", async () => {
    mockInvokeResponses({
      get_domain_info: { domain_name: "CORP.LOCAL", is_connected: true },
      check_connection: true,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText("CORP.LOCAL").length).toBeGreaterThanOrEqual(
        1,
      );
    });
  });

  it("should show disconnected warning when not connected", async () => {
    mockInvokeResponses();

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByText(/Not connected to Active Directory/),
      ).toBeInTheDocument();
    });
  });

  it("should call get_domain_info on mount", () => {
    mockedInvoke.mockImplementation(() => new Promise(() => {}));

    render(<App />);

    expect(mockedInvoke).toHaveBeenCalledWith("get_domain_info");
  });

  it("should call check_connection on mount", () => {
    mockedInvoke.mockImplementation(() => new Promise(() => {}));

    render(<App />);

    expect(mockedInvoke).toHaveBeenCalledWith("check_connection");
  });

  it("should call get_current_username on mount", () => {
    mockedInvoke.mockImplementation(() => new Promise(() => {}));

    render(<App />);

    expect(mockedInvoke).toHaveBeenCalledWith("get_current_username");
  });

  describe("ModuleRouter", () => {
    it("renders HomePage when no tab is active", () => {
      mockInvokeResponses();

      render(<App />);

      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(
        screen.queryByTestId("mock-user-lookup"),
      ).not.toBeInTheDocument();
    });

    it("renders the correct module component when a tab is opened", async () => {
      mockInvokeResponses();

      render(<App />);

      // Click the sidebar item for "users" to open that module
      fireEvent.click(screen.getByTestId("sidebar-item-users"));

      await waitFor(() => {
        expect(screen.getByTestId("mock-user-lookup")).toBeInTheDocument();
      });
    });

    it("keeps mounted modules visible with display:none for inactive", async () => {
      mockInvokeResponses();

      render(<App />);

      // Open users module
      fireEvent.click(screen.getByTestId("sidebar-item-users"));
      await waitFor(() => {
        expect(screen.getByTestId("mock-user-lookup")).toBeInTheDocument();
      });

      // Open password-generator module
      fireEvent.click(
        screen.getByTestId("sidebar-item-password-generator"),
      );
      await waitFor(() => {
        expect(
          screen.getByTestId("mock-password-generator"),
        ).toBeInTheDocument();
      });

      // Users module should still be in the DOM but hidden
      const usersContainer =
        screen.getByTestId("mock-user-lookup").closest(".h-full");
      expect(usersContainer).toHaveStyle({ display: "none" });

      // Password generator should be visible
      const pwdContainer = screen
        .getByTestId("mock-password-generator")
        .closest(".h-full");
      expect(pwdContainer).toHaveStyle({ display: "block" });
    });

    it("unmounts modules whose tabs were closed", async () => {
      mockInvokeResponses();

      render(<App />);

      // Open users module
      fireEvent.click(screen.getByTestId("sidebar-item-users"));
      await waitFor(() => {
        expect(screen.getByTestId("mock-user-lookup")).toBeInTheDocument();
      });

      // Close the tab - find the close button in the tab bar
      const closeBtn = screen.getByTestId("tab-close-users");
      fireEvent.click(closeBtn);

      await waitFor(() => {
        expect(
          screen.queryByTestId("mock-user-lookup"),
        ).not.toBeInTheDocument();
      });
    });
  });
});
