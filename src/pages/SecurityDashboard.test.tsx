import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SecurityDashboard } from "./SecurityDashboard";
import type { PrivilegedAccountsReport } from "@/types/security";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/utils/csvExport", () => ({
  exportTableToCsv: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const mockReport: PrivilegedAccountsReport = {
  accounts: [
    {
      distinguishedName: "CN=Admin,OU=Users,DC=example,DC=com",
      samAccountName: "admin",
      displayName: "Administrator",
      privilegedGroups: ["Domain Admins"],
      lastLogon: "2026-03-20T10:00:00Z",
      passwordAgeDays: 120,
      passwordExpiryDate: null,
      enabled: true,
      passwordNeverExpires: true,
      alerts: [
        {
          severity: "Critical",
          message: "Password not changed for 120 days",
          alertType: "password_age",
        },
        {
          severity: "High",
          message: "Password set to never expire on privileged account",
          alertType: "password_never_expires",
        },
      ],
    },
    {
      distinguishedName: "CN=ServiceAccount,OU=Users,DC=example,DC=com",
      samAccountName: "svc-backup",
      displayName: "Backup Service",
      privilegedGroups: ["Enterprise Admins"],
      lastLogon: null,
      passwordAgeDays: 10,
      passwordExpiryDate: null,
      enabled: true,
      passwordNeverExpires: false,
      alerts: [
        {
          severity: "Medium",
          message: "Account has never logged on",
          alertType: "never_logged_on",
        },
      ],
    },
  ],
  summary: {
    critical: 1,
    high: 1,
    medium: 1,
    info: 0,
  },
  scannedAt: "2026-03-23T10:00:00Z",
};

describe("SecurityDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<SecurityDashboard />);
    expect(screen.getByText("Scanning privileged accounts...")).toBeInTheDocument();
  });

  it("renders accounts table after loading", async () => {
    mockInvoke.mockResolvedValue(mockReport);
    render(<SecurityDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("privileged-accounts-table")).toBeInTheDocument();
    });

    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("svc-backup")).toBeInTheDocument();
  });

  it("displays alert summary badges", async () => {
    mockInvoke.mockResolvedValue(mockReport);
    render(<SecurityDashboard />);

    await waitFor(() => {
      expect(screen.getByText("1 Critical")).toBeInTheDocument();
    });
    expect(screen.getByText("1 High")).toBeInTheDocument();
    expect(screen.getByText("1 Medium")).toBeInTheDocument();
    expect(screen.getByText("2 accounts")).toBeInTheDocument();
  });

  it("shows error state on failure", async () => {
    mockInvoke.mockRejectedValue("Connection failed");
    render(<SecurityDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Scan Failed")).toBeInTheDocument();
    });
  });

  it("shows empty state when no accounts", async () => {
    mockInvoke.mockResolvedValue({
      accounts: [],
      summary: { critical: 0, high: 0, medium: 0, info: 0 },
      scannedAt: "2026-03-23T10:00:00Z",
    });
    render(<SecurityDashboard />);

    await waitFor(() => {
      expect(screen.getByText("No Privileged Accounts Found")).toBeInTheDocument();
    });
  });

  it("expands account row on click", async () => {
    mockInvoke.mockResolvedValue(mockReport);
    render(<SecurityDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("account-row-admin")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("account-row-admin"));

    await waitFor(() => {
      expect(screen.getByText(/CN=Admin,OU=Users/)).toBeInTheDocument();
    });
  });

  it("calls refresh on button click", async () => {
    mockInvoke.mockResolvedValue(mockReport);
    render(<SecurityDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("refresh-button"));
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("has CSV export button", async () => {
    mockInvoke.mockResolvedValue(mockReport);
    render(<SecurityDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("export-csv-button")).toBeInTheDocument();
    });
  });

  it("calls get_privileged_accounts on mount", async () => {
    mockInvoke.mockResolvedValue(mockReport);
    render(<SecurityDashboard />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_privileged_accounts");
    });
  });

  it("displays severity badges for each alert", async () => {
    mockInvoke.mockResolvedValue(mockReport);
    render(<SecurityDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("privileged-accounts-table")).toBeInTheDocument();
    });

    // The first account has Critical and High badges
    const criticalBadges = screen.getAllByText("Critical");
    expect(criticalBadges.length).toBeGreaterThan(0);
  });
});
