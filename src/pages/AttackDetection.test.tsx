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
      description: "Suspicious TGT with abnormally long lifetime detected",
      recommendation: "Rotate the KRBTGT account password twice and investigate the source host.",
      eventId: 4769,
    },
    {
      attackType: "DCSync",
      severity: "High",
      timestamp: "2026-03-23T08:30:00Z",
      source: "WORKSTATION-42",
      description: "Non-DC host requested directory replication",
      recommendation: "Review replication permissions and check the source machine for compromise.",
      eventId: 4662,
    },
    {
      attackType: "AbnormalKerberos",
      severity: "Medium",
      timestamp: "2026-03-23T07:00:00Z",
      source: "SRV-APP01",
      description: "Kerberos ticket request with unusual encryption type",
      recommendation: "Verify the application configuration and check for downgrade attacks.",
      eventId: null,
    },
  ],
  timeWindowHours: 24,
  scannedAt: "2026-03-23T10:00:00Z",
};

describe("AttackDetection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<AttackDetection />);
    expect(screen.getByText("Scanning event logs...")).toBeInTheDocument();
  });

  it("calls detect_ad_attacks with default time window on mount", async () => {
    mockInvoke.mockResolvedValue(mockReport);
    render(<AttackDetection />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("detect_ad_attacks", {
        timeWindowHours: 24,
      });
    });
  });

  it("renders alert cards after loading", async () => {
    mockInvoke.mockResolvedValue(mockReport);
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getByTestId("attack-detection")).toBeInTheDocument();
    });

    expect(screen.getByText("Suspicious TGT with abnormally long lifetime detected")).toBeInTheDocument();
    expect(screen.getByText("Non-DC host requested directory replication")).toBeInTheDocument();
    expect(screen.getByText("Kerberos ticket request with unusual encryption type")).toBeInTheDocument();
  });

  it("displays attack type badges", async () => {
    mockInvoke.mockResolvedValue(mockReport);
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getByText("Golden Ticket")).toBeInTheDocument();
    });
    expect(screen.getByText("DCSync")).toBeInTheDocument();
    expect(screen.getByText("Abnormal Kerberos")).toBeInTheDocument();
  });

  it("displays severity summary badges", async () => {
    mockInvoke.mockResolvedValue(mockReport);
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getByTestId("alert-summary")).toBeInTheDocument();
    });

    expect(screen.getByText("1 Critical")).toBeInTheDocument();
    expect(screen.getByText("1 High")).toBeInTheDocument();
    expect(screen.getByText("1 Medium")).toBeInTheDocument();
  });

  it("shows empty state when no alerts", async () => {
    mockInvoke.mockResolvedValue({
      alerts: [],
      timeWindowHours: 24,
      scannedAt: "2026-03-23T10:00:00Z",
    });
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getByText("No Attack Indicators Found")).toBeInTheDocument();
    });
    expect(
      screen.getByText("No suspicious activity detected in the last 24 hours."),
    ).toBeInTheDocument();
  });

  it("shows error state on failure", async () => {
    mockInvoke.mockRejectedValue("Connection failed");
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getByText("Detection Failed")).toBeInTheDocument();
    });
  });

  it("expands alert card to show recommendation", async () => {
    mockInvoke.mockResolvedValue(mockReport);
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getAllByTestId("alert-card-toggle").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByTestId("alert-card-toggle")[0]);

    await waitFor(() => {
      expect(
        screen.getByText("Rotate the KRBTGT account password twice and investigate the source host."),
      ).toBeInTheDocument();
    });
  });

  it("changes time window and re-fetches", async () => {
    mockInvoke.mockResolvedValue(mockReport);
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
    mockInvoke.mockResolvedValue(mockReport);
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getByTestId("scan-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("scan-button"));

    // Initial call + scan button call
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });

  it("displays source and event ID on alert cards", async () => {
    mockInvoke.mockResolvedValue(mockReport);
    render(<AttackDetection />);

    await waitFor(() => {
      expect(screen.getByText("Source: DC01.example.com")).toBeInTheDocument();
    });
    expect(screen.getByText("Event 4769")).toBeInTheDocument();
    expect(screen.getByText("Source: WORKSTATION-42")).toBeInTheDocument();
  });
});
