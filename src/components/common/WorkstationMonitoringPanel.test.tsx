import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { WorkstationMonitoringPanel } from "./WorkstationMonitoringPanel";
import { type SystemMetrics } from "@/types/system-metrics";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const sampleMetrics: SystemMetrics = {
  cpuUsagePercent: 45.5,
  totalMemoryMb: 16384,
  usedMemoryMb: 8192,
  disks: [
    { deviceId: "C:", totalGb: 200, freeGb: 80, usedPercent: 60 },
    { deviceId: "D:", totalGb: 500, freeGb: 350, usedPercent: 30 },
  ],
  services: [
    {
      name: "Spooler",
      displayName: "Print Spooler",
      state: "Running",
      startMode: "Auto",
    },
    {
      name: "wuauserv",
      displayName: "Windows Update",
      state: "Stopped",
      startMode: "Manual",
    },
  ],
  sessions: [
    { username: "DOMAIN\\jdoe", logonTime: "2026-03-21T08:00:00Z" },
  ],
  timestamp: "2026-03-21T12:00:00Z",
  errorMessage: null,
};

describe("WorkstationMonitoringPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<WorkstationMonitoringPanel hostname="PC001.example.com" />);
    expect(
      screen.getByText("Connecting to workstation..."),
    ).toBeInTheDocument();
  });

  it("displays hostname in header", async () => {
    mockInvoke.mockResolvedValueOnce(sampleMetrics);
    render(<WorkstationMonitoringPanel hostname="PC001.example.com" />);

    await waitFor(() => {
      expect(
        screen.getByText("Monitoring: PC001.example.com"),
      ).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows CPU usage", async () => {
    mockInvoke.mockResolvedValueOnce(sampleMetrics);
    render(<WorkstationMonitoringPanel hostname="PC001.example.com" />);

    await waitFor(() => {
      expect(screen.getByTestId("cpu-section")).toBeInTheDocument();
      expect(screen.getByText("46%")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows memory usage", async () => {
    mockInvoke.mockResolvedValueOnce(sampleMetrics);
    render(<WorkstationMonitoringPanel hostname="PC001.example.com" />);

    await waitFor(() => {
      expect(screen.getByTestId("memory-section")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows disk info", async () => {
    mockInvoke.mockResolvedValueOnce(sampleMetrics);
    render(<WorkstationMonitoringPanel hostname="PC001.example.com" />);

    await waitFor(() => {
      expect(screen.getByText("C:")).toBeInTheDocument();
      expect(screen.getByText("D:")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows services", async () => {
    mockInvoke.mockResolvedValueOnce(sampleMetrics);
    render(<WorkstationMonitoringPanel hostname="PC001.example.com" />);

    await waitFor(() => {
      expect(screen.getByText("Print Spooler")).toBeInTheDocument();
      expect(screen.getByText("Running")).toBeInTheDocument();
      expect(screen.getByText("Stopped")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows sessions", async () => {
    mockInvoke.mockResolvedValueOnce(sampleMetrics);
    render(<WorkstationMonitoringPanel hostname="PC001.example.com" />);

    await waitFor(() => {
      expect(screen.getByText("DOMAIN\\jdoe")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows error when workstation unreachable", async () => {
    mockInvoke.mockRejectedValueOnce("Host unreachable");
    render(<WorkstationMonitoringPanel hostname="PC001.example.com" />);

    await waitFor(() => {
      expect(screen.getByTestId("monitor-error")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("auto-refreshes at default interval", async () => {
    mockInvoke.mockResolvedValue(sampleMetrics);
    render(<WorkstationMonitoringPanel hostname="PC001.example.com" />);

    await waitFor(() => {
      expect(screen.getByText("46%")).toBeInTheDocument();
    }, { timeout: 5000 });

    vi.advanceTimersByTime(5000);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    }, { timeout: 5000 });
  });

  it("pause button stops auto-refresh", async () => {
    mockInvoke.mockResolvedValue(sampleMetrics);
    render(<WorkstationMonitoringPanel hostname="PC001.example.com" />);

    await waitFor(() => {
      expect(screen.getByText("46%")).toBeInTheDocument();
    }, { timeout: 5000 });

    fireEvent.click(screen.getByTestId("monitor-pause"));

    vi.advanceTimersByTime(10000);
    expect(mockInvoke).toHaveBeenCalledTimes(1); // only initial call
  });

  it("calls invoke with correct hostname", async () => {
    mockInvoke.mockResolvedValueOnce(sampleMetrics);
    render(<WorkstationMonitoringPanel hostname="PC001.example.com" />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_workstation_metrics", {
        hostname: "PC001.example.com",
      });
    }, { timeout: 5000 });
  });
});
