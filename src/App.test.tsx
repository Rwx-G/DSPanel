import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { resetTabIdCounter } from "@/contexts/NavigationContext";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
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

    expect(screen.getByTestId("status-version")).toHaveTextContent("v0.2.0");
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
      expect(screen.getAllByText("CORP.LOCAL").length).toBeGreaterThanOrEqual(1);
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
});
