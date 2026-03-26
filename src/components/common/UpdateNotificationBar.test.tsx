import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UpdateNotificationBar } from "./UpdateNotificationBar";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
const mockInvoke = vi.mocked(invoke);
const mockOpenUrl = vi.mocked(openUrl);

describe("UpdateNotificationBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when no update available", async () => {
    mockInvoke.mockResolvedValue(null);
    const { container } = render(<UpdateNotificationBar />);

    // Wait for the async check to complete
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("check_for_update");
    });

    expect(container.querySelector('[data-testid="update-notification-bar"]')).toBeNull();
  });

  it("renders notification bar when update available", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "check_for_update") {
        return Promise.resolve({
          version: "1.2.0",
          releaseUrl: "https://github.com/Rwx-G/DSPanel/releases/tag/v1.2.0",
          releaseNotes: "New features",
          publishedAt: "2026-03-25T10:00:00Z",
        });
      }
      return Promise.resolve();
    }) as typeof invoke);

    render(<UpdateNotificationBar />);

    await waitFor(() => {
      expect(screen.getByTestId("update-notification-bar")).toBeDefined();
    });
    expect(screen.getByText(/v1\.2\.0/)).toBeDefined();
  });

  it("download button opens release page", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "check_for_update") {
        return Promise.resolve({
          version: "1.2.0",
          releaseUrl: "https://github.com/Rwx-G/DSPanel/releases/tag/v1.2.0",
          releaseNotes: "",
          publishedAt: "",
        });
      }
      return Promise.resolve();
    }) as typeof invoke);

    render(<UpdateNotificationBar />);

    await waitFor(() => {
      expect(screen.getByTestId("update-download-btn")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("update-download-btn"));

    await waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalledWith(
        "https://github.com/Rwx-G/DSPanel/releases/tag/v1.2.0",
      );
    });
  });

  it("skip button calls skip_update_version and hides bar", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "check_for_update") {
        return Promise.resolve({
          version: "1.2.0",
          releaseUrl: "https://example.com",
          releaseNotes: "",
          publishedAt: "",
        });
      }
      return Promise.resolve();
    }) as typeof invoke);

    render(<UpdateNotificationBar />);

    await waitFor(() => {
      expect(screen.getByTestId("update-skip-btn")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("update-skip-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("skip_update_version", {
        version: "1.2.0",
      });
    });

    expect(screen.queryByTestId("update-notification-bar")).toBeNull();
  });

  it("remind later button hides bar without skipping", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "check_for_update") {
        return Promise.resolve({
          version: "1.2.0",
          releaseUrl: "https://example.com",
          releaseNotes: "",
          publishedAt: "",
        });
      }
      return Promise.resolve();
    }) as typeof invoke);

    render(<UpdateNotificationBar />);

    await waitFor(() => {
      expect(screen.getByTestId("update-remind-btn")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("update-remind-btn"));

    expect(screen.queryByTestId("update-notification-bar")).toBeNull();
    // Should NOT have called skip_update_version
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "skip_update_version",
      expect.any(Object),
    );
  });

  it("handles check_for_update failure silently", async () => {
    mockInvoke.mockRejectedValue(new Error("Network error"));

    const { container } = render(<UpdateNotificationBar />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("check_for_update");
    });

    expect(container.querySelector('[data-testid="update-notification-bar"]')).toBeNull();
  });
});
