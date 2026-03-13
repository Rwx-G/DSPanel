import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { resetTabIdCounter } from "@/contexts/NavigationContext";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockedInvoke = vi.mocked(invoke);

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTabIdCounter();
  });

  it("should render the app shell with all layout zones", async () => {
    mockedInvoke.mockResolvedValue("DSPanel" as never);

    render(<App />);

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("tab-bar")).toBeInTheDocument();
    expect(screen.getByTestId("breadcrumbs")).toBeInTheDocument();
    expect(screen.getByTestId("status-bar")).toBeInTheDocument();
  });

  it("should show 'Backend connected' when invoke succeeds", async () => {
    mockedInvoke.mockResolvedValue("DSPanel" as never);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Backend connected")).toBeInTheDocument();
    });
  });

  it("should show 'Connecting to backend...' initially", () => {
    mockedInvoke.mockImplementation(() => new Promise(() => {}));

    render(<App />);

    expect(screen.getByText("Connecting to backend...")).toBeInTheDocument();
  });

  it("should show 'Connecting to backend...' when invoke fails", async () => {
    mockedInvoke.mockRejectedValue(new Error("connection failed") as never);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Connecting to backend...")).toBeInTheDocument();
    });
  });

  it("should show Connected status when backend is ready", async () => {
    mockedInvoke.mockResolvedValue("DSPanel" as never);

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

  it("should call get_app_title on mount", () => {
    mockedInvoke.mockImplementation(() => new Promise(() => {}));

    render(<App />);

    expect(mockedInvoke).toHaveBeenCalledWith("get_app_title");
  });

  it("should call get_permission_level on mount", () => {
    mockedInvoke.mockImplementation(() => new Promise(() => {}));

    render(<App />);

    expect(mockedInvoke).toHaveBeenCalledWith("get_permission_level");
  });
});
