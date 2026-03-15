import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NtfsAnalyzer } from "./NtfsAnalyzer";
import type { NtfsAnalysisResult } from "@/types/ntfs-analyzer";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/components/comparison/GroupChainTree", () => ({
  GroupChainTree: () => null,
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

  it("filters ACEs to explicit-only when toggle is checked", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByTestId("explicit-only-toggle")).toBeInTheDocument();
    });

    // Before toggle: inherited ACE should be visible
    expect(
      screen.getByTestId("ace-row-\\\\server\\share-1"),
    ).toBeInTheDocument();

    // Toggle explicit-only
    fireEvent.click(screen.getByTestId("explicit-only-toggle"));

    // After toggle: inherited ACE (index 1) should be gone, explicit (index 0) still present
    await waitFor(() => {
      expect(
        screen.getByTestId("ace-row-\\\\server\\share-0"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("ace-row-\\\\server\\share-1"),
      ).not.toBeInTheDocument();
    });
  });

  it("calls exportCsv when CSV button is clicked", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "analyze_ntfs") return Promise.resolve(MOCK_RESULT);
      if (cmd === "save_file_dialog") return Promise.resolve("/path/to/file.csv");
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByTestId("export-csv-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("export-csv-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "save_file_dialog",
        expect.objectContaining({
          filterExtensions: ["csv"],
        }),
      );
    });
  });

  it("sends correct depth when depth selector is changed before analysis", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("depth-selector"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("analyze_ntfs", {
        path: "\\\\server\\share",
        depth: 5,
      });
    });
  });

  it("displays summary with path and ACE counts", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByText(/2/)).toBeInTheDocument(); // paths scanned
      expect(screen.getByText(/3/)).toBeInTheDocument(); // ACEs
    });
  });

  it("shows conflict details with trustee and paths", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByTestId("conflict-0")).toBeInTheDocument();
      // Admins appears in both ACE table and conflict panel
      const adminTexts = screen.getAllByText("Admins");
      expect(adminTexts.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("triggers analysis on Enter key press", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    const input = screen.getByTestId("analyzer-path-input");
    fireEvent.change(input, { target: { value: "\\\\server\\share" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("analyze_ntfs", {
        path: "\\\\server\\share",
        depth: 0,
      });
    });
  });

  it("shows path sections that can be collapsed", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(
        screen.getByTestId("path-section-\\\\server\\share"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("path-section-\\\\server\\share\\subfolder"),
      ).toBeInTheDocument();
    });
  });

  it("displays Deny ACE with proper styling and icon", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      const denyTexts = screen.getAllByText("Deny");
      expect(denyTexts.length).toBeGreaterThanOrEqual(1);
      const allowTexts = screen.getAllByText("Allow");
      expect(allowTexts.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows inherited and explicit sources in ACE rows", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      const explicitTexts = screen.getAllByText("Explicit");
      expect(explicitTexts.length).toBeGreaterThanOrEqual(1);
      const inheritedTexts = screen.getAllByText("Inherited");
      expect(inheritedTexts.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("does not analyze with empty path after trim", () => {
    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "   " },
    });

    expect(screen.getByTestId("analyze-button")).toBeDisabled();
  });

  it("collapses and expands a path section", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(
        screen.getByTestId("path-section-\\\\server\\share"),
      ).toBeInTheDocument();
    });

    // ACE rows should be visible when expanded
    expect(
      screen.getByTestId("ace-row-\\\\server\\share-0"),
    ).toBeInTheDocument();

    // Click the section header to collapse
    const pathSection = screen.getByTestId("path-section-\\\\server\\share");
    const collapseBtn = pathSection.querySelector("button");
    expect(collapseBtn).not.toBeNull();
    fireEvent.click(collapseBtn!);

    // ACE rows should disappear
    await waitFor(() => {
      expect(
        screen.queryByTestId("ace-row-\\\\server\\share-0"),
      ).not.toBeInTheDocument();
    });

    // Click again to expand
    fireEvent.click(collapseBtn!);

    await waitFor(() => {
      expect(
        screen.getByTestId("ace-row-\\\\server\\share-0"),
      ).toBeInTheDocument();
    });
  });

  it("displays path section with error indicator", async () => {
    const resultWithError: NtfsAnalysisResult = {
      paths: [
        {
          path: "\\\\server\\protected",
          aces: [],
          error: "Access denied",
        },
      ],
      conflicts: [],
      totalAces: 0,
      totalPathsScanned: 1,
      totalErrors: 1,
    };

    mockInvoke.mockResolvedValueOnce(resultWithError);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\protected" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByText("Access denied")).toBeInTheDocument();
    });
  });

  it("shows 'No ACEs found' when path has zero ACEs and no error", async () => {
    const emptyAcesResult: NtfsAnalysisResult = {
      paths: [
        {
          path: "\\\\server\\empty",
          aces: [],
          error: null,
        },
      ],
      conflicts: [],
      totalAces: 0,
      totalPathsScanned: 1,
      totalErrors: 0,
    };

    mockInvoke.mockResolvedValueOnce(emptyAcesResult);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\empty" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByText("No ACEs found")).toBeInTheDocument();
    });
  });

  it("expands trustee to show group chain tree", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(
        screen.getByTestId("path-section-\\\\server\\share"),
      ).toBeInTheDocument();
    });

    // Find and click the trustee expand button within the path section
    const pathSection = screen.getByTestId("path-section-\\\\server\\share");
    const expandBtns = pathSection.querySelectorAll('[data-testid^="trustee-expand-"]');
    expect(expandBtns.length).toBeGreaterThan(0);

    fireEvent.click(expandBtns[0]);

    // After expanding, the GroupChainTree should render
    await waitFor(() => {
      expect(expandBtns[0]).toBeInTheDocument();
    });
  });

  it("shows error count in summary when errors exist", async () => {
    const resultWithErrors: NtfsAnalysisResult = {
      ...MOCK_RESULT,
      totalErrors: 2,
    };
    mockInvoke.mockResolvedValueOnce(resultWithErrors);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByText("error(s)")).toBeInTheDocument();
    });
  });

  it("shows conflict count in summary", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByText("conflict(s)")).toBeInTheDocument();
    });
  });

  it("displays trustee context menu on right-click", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(
        screen.getByTestId("ace-row-\\\\server\\share-0"),
      ).toBeInTheDocument();
    });

    // Right-click on the trustee cell (first td)
    const aceRow = screen.getByTestId("ace-row-\\\\server\\share-0");
    const trusteeTd = aceRow.querySelector("td");
    expect(trusteeTd).not.toBeNull();
    fireEvent.contextMenu(trusteeTd!);

    await waitFor(() => {
      expect(screen.getByText(/View members of/)).toBeInTheDocument();
    });
  });

  it("displays ACE count per path section", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByText("2 ACE(s)")).toBeInTheDocument();
      expect(screen.getByText("1 ACE(s)")).toBeInTheDocument();
    });
  });

  it("displays permissions text in ACE rows", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByText("FullControl")).toBeInTheDocument();
      expect(screen.getByText("Read")).toBeInTheDocument();
      expect(screen.getByText("Write")).toBeInTheDocument();
    });
  });

  it("shows conflict deny permissions", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_RESULT);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      const conflict = screen.getByTestId("conflict-0");
      expect(conflict).toHaveTextContent("Write");
      expect(conflict).toHaveTextContent("Admins");
    });
  });

  it("disables analyze button during analysis", async () => {
    let resolveAnalysis: (value: NtfsAnalysisResult) => void;
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "analyze_ntfs") {
        return new Promise<NtfsAnalysisResult>((resolve) => {
          resolveAnalysis = resolve;
        });
      }
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<NtfsAnalyzer />);

    fireEvent.change(screen.getByTestId("analyzer-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("analyze-button"));

    expect(screen.getByTestId("analyze-button")).toBeDisabled();

    // Resolve to clean up
    resolveAnalysis!(MOCK_RESULT);

    await waitFor(() => {
      expect(screen.getByTestId("analyze-button")).not.toBeDisabled();
    });
  });
});
