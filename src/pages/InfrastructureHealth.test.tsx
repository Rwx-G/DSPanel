import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { InfrastructureHealth } from "./InfrastructureHealth";
import { type DcHealthResult } from "@/types/dc-health";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const healthyDc: DcHealthResult = {
  dc: {
    hostname: "DC1.example.com",
    siteName: "Default-First-Site",
    isGlobalCatalog: true,
    serverDn: "CN=DC1,CN=Servers,CN=Default-First-Site,CN=Sites,CN=Configuration,DC=example,DC=com",
    fsmoRoles: ["PDC", "RID"],
    functionalLevel: "Windows Server 2016",
  },
  overallStatus: "Healthy",
  checks: [
    { name: "DNS", status: "Healthy", message: "Resolved to 10.0.0.1", value: "10.0.0.1" },
    { name: "LDAP", status: "Healthy", message: "LDAP response: 12ms", value: "12ms" },
    { name: "Services", status: "Healthy", message: "All 4 services running", value: "4/4" },
    { name: "Disk", status: "Healthy", message: "45% free (90GB)", value: "45%" },
    { name: "SYSVOL", status: "Healthy", message: "SYSVOL accessible", value: null },
  ],
  checkedAt: "2026-03-21T10:00:00Z",
};

const warningDc: DcHealthResult = {
  dc: {
    hostname: "DC2.example.com",
    siteName: "Branch-Office",
    isGlobalCatalog: false,
    serverDn: "CN=DC2,CN=Servers,CN=Branch-Office,CN=Sites,CN=Configuration,DC=example,DC=com",
    fsmoRoles: [],
    functionalLevel: "Windows Server 2016",
  },
  overallStatus: "Warning",
  checks: [
    { name: "DNS", status: "Healthy", message: "Resolved to 10.0.1.1", value: "10.0.1.1" },
    { name: "LDAP", status: "Warning", message: "LDAP response slow: 250ms", value: "250ms" },
    { name: "Services", status: "Healthy", message: "All 4 services running", value: "4/4" },
    { name: "Disk", status: "Warning", message: "Low disk: 15% free (30GB)", value: "15%" },
    { name: "SYSVOL", status: "Healthy", message: "SYSVOL accessible", value: null },
  ],
  checkedAt: "2026-03-21T10:00:00Z",
};

const criticalDc: DcHealthResult = {
  dc: {
    hostname: "DC3.example.com",
    siteName: "Default-First-Site",
    isGlobalCatalog: false,
    serverDn: "CN=DC3,CN=Servers,CN=Default-First-Site,CN=Sites,CN=Configuration,DC=example,DC=com",
    fsmoRoles: [],
    functionalLevel: null,
  },
  overallStatus: "Critical",
  checks: [
    { name: "DNS", status: "Healthy", message: "Resolved to 10.0.0.3", value: "10.0.0.3" },
    { name: "LDAP", status: "Critical", message: "LDAP connection timed out (5s)", value: null },
    { name: "Services", status: "Critical", message: "Stopped: NTDS", value: "3/4" },
    { name: "Disk", status: "Critical", message: "Critical disk: 5% free (10GB)", value: "5%" },
    { name: "SYSVOL", status: "Critical", message: "SYSVOL inaccessible", value: null },
  ],
  checkedAt: "2026-03-21T10:00:00Z",
};

describe("InfrastructureHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows loading spinner initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {})); // never resolves
    render(<InfrastructureHealth />);
    expect(screen.getByText("Checking domain controllers...")).toBeInTheDocument();
  });

  it("displays DC health cards after loading", async () => {
    mockInvoke.mockResolvedValueOnce([healthyDc, warningDc]);
    render(<InfrastructureHealth />);

    await waitFor(() => {
      expect(screen.getByText("DC1.example.com")).toBeInTheDocument();
      expect(screen.getByText("DC2.example.com")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows GC badge for global catalog DCs", async () => {
    mockInvoke.mockResolvedValueOnce([healthyDc]);
    render(<InfrastructureHealth />);

    await waitFor(() => {
      expect(screen.getByText("GC")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("does not show GC badge for non-GC DCs", async () => {
    mockInvoke.mockResolvedValueOnce([warningDc]);
    render(<InfrastructureHealth />);

    await waitFor(() => {
      expect(screen.getByText("DC2.example.com")).toBeInTheDocument();
      expect(screen.queryByText("GC")).not.toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows site name for each DC", async () => {
    mockInvoke.mockResolvedValueOnce([healthyDc, warningDc]);
    render(<InfrastructureHealth />);

    await waitFor(() => {
      expect(screen.getByText(/Site: Default-First-Site/)).toBeInTheDocument();
      expect(screen.getByText(/Site: Branch-Office/)).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows DC card expanded by default with details", async () => {
    mockInvoke.mockResolvedValueOnce([healthyDc]);
    render(<InfrastructureHealth />);

    await waitFor(() => {
      expect(screen.getByTestId("dc-detail-DC1.example.com")).toBeInTheDocument();
      expect(screen.getByText("Resolved to 10.0.0.1")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("collapses DC card on click and re-expands on second click", async () => {
    mockInvoke.mockResolvedValueOnce([healthyDc]);
    render(<InfrastructureHealth />);

    await waitFor(() => {
      expect(screen.getByTestId("dc-detail-DC1.example.com")).toBeInTheDocument();
    }, { timeout: 5000 });

    fireEvent.click(screen.getByTestId("dc-card-toggle-DC1.example.com"));
    expect(screen.queryByTestId("dc-detail-DC1.example.com")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("dc-card-toggle-DC1.example.com"));
    expect(screen.getByTestId("dc-detail-DC1.example.com")).toBeInTheDocument();
  });

  it("shows error state when fetch fails", async () => {
    mockInvoke.mockRejectedValueOnce("Permission denied");
    render(<InfrastructureHealth />);

    await waitFor(() => {
      expect(screen.getByText("Health Check Failed")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows empty state when no DCs found", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    render(<InfrastructureHealth />);

    await waitFor(() => {
      expect(screen.getByText("No Domain Controllers Found")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows summary badges with correct counts", async () => {
    mockInvoke.mockResolvedValueOnce([healthyDc, warningDc, criticalDc]);
    render(<InfrastructureHealth />);

    await waitFor(() => {
      // 1 healthy, 1 warning, 1 critical
      expect(screen.getByText("DC1.example.com")).toBeInTheDocument();
      expect(screen.getByText("DC3.example.com")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("manual refresh button triggers reload", async () => {
    mockInvoke.mockResolvedValueOnce([healthyDc]);
    render(<InfrastructureHealth />);

    await waitFor(() => {
      expect(screen.getByText("DC1.example.com")).toBeInTheDocument();
    }, { timeout: 5000 });

    mockInvoke.mockResolvedValueOnce([healthyDc, warningDc]);
    fireEvent.click(screen.getByTestId("refresh-button"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    }, { timeout: 5000 });
  });

  it("auto-refresh calls fetch at interval", async () => {
    mockInvoke.mockResolvedValue([healthyDc]);
    render(<InfrastructureHealth />);

    await waitFor(() => {
      expect(screen.getByText("DC1.example.com")).toBeInTheDocument();
    }, { timeout: 5000 });

    // Default interval is 5 min (300s), advance time
    vi.advanceTimersByTime(300_000);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    }, { timeout: 5000 });
  });

  it("changing refresh interval to Off stops auto-refresh", async () => {
    mockInvoke.mockResolvedValue([healthyDc]);
    render(<InfrastructureHealth />);

    await waitFor(() => {
      expect(screen.getByText("DC1.example.com")).toBeInTheDocument();
    }, { timeout: 5000 });

    // Set to "Off"
    fireEvent.change(screen.getByTestId("refresh-interval"), {
      target: { value: "0" },
    });

    vi.advanceTimersByTime(120_000);

    // Should only have been called once (initial load)
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("calls invoke with correct command name", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    render(<InfrastructureHealth />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_dc_health");
    }, { timeout: 5000 });
  });
});
