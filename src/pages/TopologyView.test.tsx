import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { TopologyView } from "./TopologyView";
import { type TopologyData } from "@/types/topology";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock canvas context
const mockContext = {
  clearRect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  fillText: vi.fn(),
  roundRect: vi.fn(),
  setLineDash: vi.fn(),
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  font: "",
  textAlign: "",
  textBaseline: "",
};

HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockContext);
HTMLCanvasElement.prototype.toBlob = vi.fn();

const sampleTopology: TopologyData = {
  sites: [
    {
      name: "Default-First-Site",
      location: null,
      dcs: [
        {
          hostname: "DC1.example.com",
          siteName: "Default-First-Site",
          isGc: true,
          isPdc: true,
        },
        {
          hostname: "DC2.example.com",
          siteName: "Default-First-Site",
          isGc: false,
          isPdc: false,
        },
      ],
    },
    {
      name: "Branch-Office",
      location: "Paris",
      dcs: [
        {
          hostname: "DC3.example.com",
          siteName: "Branch-Office",
          isGc: true,
          isPdc: false,
        },
      ],
    },
  ],
  replicationLinks: [
    {
      sourceDc: "DC1.example.com",
      targetDc: "DC2.example.com",
      status: "Healthy",
      lastSyncTime: "2026-03-21T12:00:00Z",
      errorCount: 0,
    },
    {
      sourceDc: "DC1.example.com",
      targetDc: "DC3.example.com",
      status: "Warning",
      lastSyncTime: "2026-03-21T10:00:00Z",
      errorCount: 1,
    },
  ],
  siteLinks: [
    {
      name: "DEFAULTIPSITELINK",
      sites: ["Default-First-Site", "Branch-Office"],
      cost: 100,
      replInterval: 180,
    },
  ],
};

describe("TopologyView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<TopologyView />);
    expect(screen.getByText("Loading AD topology...")).toBeInTheDocument();
  });

  it("displays topology canvas after loading", async () => {
    mockInvoke.mockResolvedValueOnce(sampleTopology);
    render(<TopologyView />);

    await waitFor(() => {
      expect(screen.getByTestId("topology-canvas")).toBeInTheDocument();
    });
  });

  it("shows site and DC counts in toolbar", async () => {
    mockInvoke.mockResolvedValueOnce(sampleTopology);
    render(<TopologyView />);

    await waitFor(() => {
      expect(screen.getByText("2 sites, 3 DCs")).toBeInTheDocument();
    });
  });

  it("shows error state when fetch fails", async () => {
    mockInvoke.mockRejectedValueOnce("Permission denied");
    render(<TopologyView />);

    await waitFor(() => {
      expect(screen.getByText("Topology Load Failed")).toBeInTheDocument();
    });
  });

  it("shows empty state when no sites", async () => {
    mockInvoke.mockResolvedValueOnce({
      sites: [],
      replicationLinks: [],
      siteLinks: [],
    });
    render(<TopologyView />);

    await waitFor(() => {
      expect(screen.getByText("No Topology Data")).toBeInTheDocument();
    });
  });

  it("refresh button triggers reload", async () => {
    mockInvoke.mockResolvedValue(sampleTopology);
    render(<TopologyView />);

    // Wait for initial load + canvas render
    await waitFor(() => {
      expect(screen.getByTestId("topology-canvas")).toBeInTheDocument();
    });

    const refreshBtn = screen.getByTestId("refresh-button");
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });

  it("calls invoke with correct command name", async () => {
    mockInvoke.mockResolvedValueOnce(sampleTopology);
    render(<TopologyView />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_topology");
    });
  });

  it("shows export PNG button when data is loaded", async () => {
    mockInvoke.mockResolvedValueOnce(sampleTopology);
    render(<TopologyView />);

    await waitFor(() => {
      expect(screen.getByTestId("export-png")).toBeInTheDocument();
    });
  });
});
