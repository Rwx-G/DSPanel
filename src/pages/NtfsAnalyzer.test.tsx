import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NtfsAnalyzer } from "./NtfsAnalyzer";
import type { NtfsAnalysisResult } from "@/types/ntfs-analyzer";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const MOCK_RESULT: NtfsAnalysisResult = {
  paths: [
    {
      path: "\\\\server\\share",
      aces: [
        {
          trusteeSid: "S-1-5-21-100",
          trusteeDisplayName: "Admins",
          accessType: "Allow",
          permissions: ["FullControl"],
          isInherited: false,
        },
        {
          trusteeSid: "S-1-5-21-200",
          trusteeDisplayName: "Users",
          accessType: "Allow",
          permissions: ["Read"],
          isInherited: true,
        },
      ],
      error: null,
    },
    {
      path: "\\\\server\\share\\subfolder",
      aces: [
        {
          trusteeSid: "S-1-5-21-100",
          trusteeDisplayName: "Admins",
          accessType: "Deny",
          permissions: ["Write"],
          isInherited: false,
        },
      ],
      error: null,
    },
  ],
  conflicts: [
    {
      trusteeSid: "S-1-5-21-100",
      trusteeDisplayName: "Admins",
      allowPath: "\\\\server\\share",
      denyPath: "\\\\server\\share\\subfolder",
      allowPermissions: ["FullControl"],
      denyPermissions: ["Write"],
    },
  ],
  totalAces: 3,
  totalPathsScanned: 2,
  totalErrors: 0,
};

describe("NtfsAnalyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the page with input controls", () => {
    render(<NtfsAnalyzer />);
    expect(screen.getByTestId("ntfs-analyzer-page")).toBeInTheDocument();
    expect(screen.getByTestId("analyzer-path-input")).toBeInTheDocument();
    expect(screen.getByTestId("depth-selector")).toBeInTheDocument();
    expect(screen.getByTestId("analyze-button")).toBeInTheDocument();
  });

  it("analyze button is disabled with empty path", () => {
    render(<NtfsAnalyzer />);
    expect(screen.getByTestId("analyze-button")).toBeDisabled();
  });

  it("analyzes and displays results", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByTestId("analyzer-results")).toBeInTheDocument();
      expect(mockInvoke).toHaveBeenCalledWith("analyze_ntfs", {
        path: "\\\\server\\share",
        depth: 0,
      });
    });
  });

  it("displays conflicts when detected", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByTestId("conflict-panel")).toBeInTheDocument();
      expect(screen.getByTestId("conflict-0")).toBeInTheDocument();
    });
  });

  it("displays error on failure", async () => {
    mockInvoke.mockRejectedValueOnce("Path not found");

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByTestId("analyzer-error")).toBeInTheDocument();
    });
  });

  it("allows changing depth", () => {
    render(<NtfsAnalyzer />);

    const depthSelect = screen.getByTestId("depth-selector");
    fireEvent.change(depthSelect, { target: { value: "3" } });
    expect((depthSelect as HTMLSelectElement).value).toBe("3");
  });

  it("shows export CSV button after analysis", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByTestId("export-csv-btn")).toBeInTheDocument();
    });
  });

  it("shows explicit-only toggle", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByTestId("explicit-only-toggle")).toBeInTheDocument();
    });
  });

  it("analysis with no conflicts shows no conflict panel", async () => {
    const noConflicts = { ...MOCK_RESULT, conflicts: [] };
    mockInvoke.mockResolvedValueOnce(noConflicts);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByTestId("analyzer-results")).toBeInTheDocument();
      expect(screen.queryByTestId("conflict-panel")).not.toBeInTheDocument();
    });
  });
});
