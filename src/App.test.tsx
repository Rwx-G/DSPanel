import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockedInvoke = vi.mocked(invoke);

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render the app title from backend", async () => {
    mockedInvoke.mockResolvedValueOnce("DSPanel");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("DSPanel")).toBeInTheDocument();
    });

    expect(mockedInvoke).toHaveBeenCalledWith("get_app_title");
  });

  it("should show 'Backend connected' when invoke succeeds", async () => {
    mockedInvoke.mockResolvedValueOnce("DSPanel");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Backend connected")).toBeInTheDocument();
    });
  });

  it("should show 'Connecting to backend...' initially", () => {
    mockedInvoke.mockImplementation(() => new Promise(() => {}));

    render(<App />);

    expect(
      screen.getByText("Connecting to backend..."),
    ).toBeInTheDocument();
  });

  it("should show 'Connecting to backend...' when invoke fails", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("connection failed"));

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByText("Connecting to backend..."),
      ).toBeInTheDocument();
    });
  });
});
