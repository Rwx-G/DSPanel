import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { AttackDetection } from "./AttackDetection";
import type { AttackDetectionReport } from "@/types/security";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const mockReport: AttackDetectionReport = {
  alerts: [
    {
      attackType: "GoldenTicket",
      severity: "Critical",
      timestamp: "2026-03-23T09:15:00Z",
      source: "DC01.example.com",
      description: "TGT request with RC4-HMAC encryption for account 'admin'",
      recommendation:
        "Reset KRBTGT password twice with 12-hour interval. Investigate the source for compromise.",
      eventId: 4768,
      mitreRef: "T1558.001",
    },
    {
      attackType: "DCSync",
      severity: "Critical",
      timestamp: "2026-03-23T08:30:00Z",
      source: "WORKSTATION-42",
      description:
        "Directory replication requested by non-DC account 'hacker' - possible DCSync attack",
      recommendation:
        "Review replication permissions. Remove DS-Replication-Get-Changes rights from non-DC accounts. Investigate source IP.",
      eventId: 4662,
      mitreRef: "T1003.006",
    },
    {
      attackType: "Kerberoasting",
      severity: "High",
      timestamp: "2026-03-23T07:45:00Z",
      source: "10.0.0.50",
      description:
        "User 'attacker' requested 5 TGS tickets with RC4-HMAC for services: svc_sql, svc_web",
      recommendation:
        "Review service accounts with SPNs. Rotate passwords to 25+ char random. Enable AES encryption. Consider gMSA.",
      eventId: 4769,
      mitreRef: "T1558.003",
    },
    {
      attackType: "BruteForce",
      severity: "High",
      timestamp: "2026-03-23T07:00:00Z",
      source: "192.168.1.100",
      description:
        "15 failed logons from IP 192.168.1.100 (12 wrong password, 3 unknown user)",
      recommendation:
        "Investigate source IP. Consider blocking at firewall. Review affected accounts for compromise.",
      eventId: 4625,
      mitreRef: "T1110.001",
    },
    {
      attackType: "SuspiciousAccountActivity",
      severity: "Medium",
      timestamp: "2026-03-23T06:30:00Z",
      source: "SRV-APP01",
      description: "New account 'backdoor' created by 'admin'",
      recommendation:
        "Verify account creation was authorized. Review the account's group memberships and permissions.",
      eventId: 4720,
      mitreRef: "T1136.001",
    },
  ],
  timeWindowHours: 24,
  scannedAt: "2026-03-23T10:00:00Z",
  eventLogAccessible: true,
};

describe("AttackDetection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return "windows" for platform check, pending for everything else
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_platform") return Promise.resolve("windows");
      return new Promise(() => {});
    });
  });

  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<AttackDetection />);
    expect(screen.getByText("Scanning event logs...")).toBeInTheDocument();
  });

  it("calls detect_ad_attacks with default time window on mount", async () => {
    mockInvoke.mockImplementation((cmd: string) => cmd === "get_platform" ? Promise.resolve("windows") : Promise.resolve(mockReport));
    render(<AttackDetection />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("detect_ad_attacks", {
        timeWindowHours: 72,
      });
    });
  });

  it("renders alert cards after loading", async () => {
    mockInvoke.mockImplementation((cmd: string) => cmd === "get_platform" ? Promise.resolve("windows") : Promise.resolve(mockReport));
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getByTestId("attack-detection")).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        "TGT request with RC4-HMAC encryption for account 'admin'",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Directory replication requested by non-DC account 'hacker' - possible DCSync attack",
      ),
    ).toBeInTheDocument();
  });

  it("displays attack type badges including new types", async () => {
    mockInvoke.mockImplementation((cmd: string) => cmd === "get_platform" ? Promise.resolve("windows") : Promise.resolve(mockReport));
    render(<AttackDetection />);

    await waitFor(() => {
      // Check names appear in both the checks grid and alert cards
      expect(screen.getAllByText("Golden Ticket").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("DCSync").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Kerberoasting").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Brute Force").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Suspicious Account").length).toBeGreaterThan(0);
  });

  it("displays severity summary badges", async () => {
    mockInvoke.mockImplementation((cmd: string) => cmd === "get_platform" ? Promise.resolve("windows") : Promise.resolve(mockReport));
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getByTestId("alert-summary")).toBeInTheDocument();
    });

    expect(screen.getByText("2 Critical")).toBeInTheDocument();
    expect(screen.getByText("2 High")).toBeInTheDocument();
    expect(screen.getByText("1 Medium")).toBeInTheDocument();
  });

  it("displays MITRE ATT&CK reference badges", async () => {
    mockInvoke.mockImplementation((cmd: string) => cmd === "get_platform" ? Promise.resolve("windows") : Promise.resolve(mockReport));
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getAllByTestId("mitre-ref-badge").length).toBeGreaterThan(
        0,
      );
    });

    expect(screen.getByText("MITRE T1558.001")).toBeInTheDocument();
    expect(screen.getByText("MITRE T1003.006")).toBeInTheDocument();
    expect(screen.getByText("MITRE T1558.003")).toBeInTheDocument();
  });

  it("shows all checks as clear when no alerts", async () => {
    mockInvoke.mockImplementation((cmd: string) => cmd === "get_platform" ? Promise.resolve("windows") : Promise.resolve({
      alerts: [],
      timeWindowHours: 24,
      scannedAt: "2026-03-23T10:00:00Z",
      eventLogAccessible: true,
    }));
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getByTestId("checks-grid")).toBeInTheDocument();
    });

    // All 14 checks should show "Clear"
    const clearBadges = screen.getAllByText("Clear");
    expect(clearBadges.length).toBe(14);
  });

  it("shows error state on failure", async () => {
    mockInvoke.mockImplementation((cmd: string) => cmd === "get_platform" ? Promise.resolve("windows") : Promise.reject("Connection failed"));
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getByText("Detection Failed")).toBeInTheDocument();
    });
  });

  it("expands alert card to show recommendation", async () => {
    mockInvoke.mockImplementation((cmd: string) => cmd === "get_platform" ? Promise.resolve("windows") : Promise.resolve(mockReport));
    render(<AttackDetection />);

    await waitFor(() => {
      expect(
        screen.getAllByTestId("alert-card-toggle").length,
      ).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByTestId("alert-card-toggle")[0]);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Reset KRBTGT password twice with 12-hour interval. Investigate the source for compromise.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("changes time window and re-fetches", async () => {
    mockInvoke.mockImplementation((cmd: string) => cmd === "get_platform" ? Promise.resolve("windows") : Promise.resolve(mockReport));
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getByTestId("time-window-select")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("time-window-select"), {
      target: { value: "6" },
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("detect_ad_attacks", {
        timeWindowHours: 6,
      });
    });
  });

  it("scan button triggers re-fetch", async () => {
    mockInvoke.mockImplementation((cmd: string) => cmd === "get_platform" ? Promise.resolve("windows") : Promise.resolve(mockReport));
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getByTestId("scan-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("scan-button"));

    // Initial call + scan button call (excluding get_platform calls)
    await waitFor(() => {
      const attackCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "detect_ad_attacks",
      );
      expect(attackCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("displays source and event ID on alert cards", async () => {
    mockInvoke.mockImplementation((cmd: string) => cmd === "get_platform" ? Promise.resolve("windows") : Promise.resolve(mockReport));
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getByText("Source: DC01.example.com")).toBeInTheDocument();
    });
    expect(screen.getByText("Event 4768")).toBeInTheDocument();
    expect(screen.getByText("Source: WORKSTATION-42")).toBeInTheDocument();
  });

  it("handles alerts with null mitreRef", async () => {
    const reportWithNullMitre: AttackDetectionReport = {
      alerts: [
        {
          attackType: "PrivGroupChange",
          severity: "High",
          timestamp: "2026-03-23T09:00:00Z",
          source: "DC01",
          description: "Member added to security group",
          recommendation: "Verify the change.",
          eventId: 4728,
          mitreRef: null,
        },
      ],
      timeWindowHours: 24,
      scannedAt: "2026-03-23T10:00:00Z",
      eventLogAccessible: true,
    };
    mockInvoke.mockResolvedValue(reportWithNullMitre);
    render(<AttackDetection />);

    await waitFor(() => {
      expect(
        screen.getByText("Member added to security group"),
      ).toBeInTheDocument();
    });
    // No MITRE badge should be rendered
    expect(screen.queryByTestId("mitre-ref-badge")).not.toBeInTheDocument();
  });

  it("shows warning banner when event log is not accessible", async () => {
    const inaccessibleReport: AttackDetectionReport = {
      alerts: [],
      timeWindowHours: 24,
      scannedAt: "2026-03-23T10:00:00Z",
      eventLogAccessible: false,
    };
    mockInvoke.mockResolvedValue(inaccessibleReport);
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getByTestId("event-log-warning")).toBeInTheDocument();
    });
    expect(screen.getByText(/Cannot read Security Event Log/)).toBeInTheDocument();
    // All checks should show N/A instead of Clear
    const naLabels = screen.getAllByText("N/A");
    expect(naLabels.length).toBeGreaterThan(0);
  });

  it("shows Clear badges when event log is accessible and no alerts", async () => {
    const clearReport: AttackDetectionReport = {
      alerts: [],
      timeWindowHours: 24,
      scannedAt: "2026-03-23T10:00:00Z",
      eventLogAccessible: true,
    };
    mockInvoke.mockResolvedValue(clearReport);
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.queryByTestId("event-log-warning")).not.toBeInTheDocument();
    });
    const clearLabels = screen.getAllByText("Clear");
    expect(clearLabels.length).toBeGreaterThan(0);
  });
});
