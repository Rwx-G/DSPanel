import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { RiskScoreDashboard } from "./RiskScore";
import type { RiskScoreResult, RiskScoreHistory } from "@/types/security";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const mockResult: RiskScoreResult = {
  totalScore: 72,
  zone: "Green",
  worstFactorName: "Privileged Accounts",
  worstFactorScore: 55,
  factors: [
    {
      id: "password-policy",
      name: "Password Policy",
      score: 85,
      weight: 30,
      explanation: "Password policies meet best practices.",
      recommendations: [],
    },
    {
      id: "privileged-accounts",
      name: "Privileged Accounts",
      score: 55,
      weight: 25,
      explanation: "Several privileged accounts have stale passwords.",
      recommendations: [
        "Rotate passwords for privileged accounts older than 90 days",
        "Remove unused admin accounts",
      ],
    },
    {
      id: "replication",
      name: "Replication Health",
      score: 90,
      weight: 20,
      explanation: "All domain controllers replicate correctly.",
      recommendations: [],
    },
    {
      id: "kerberos",
      name: "Kerberos Configuration",
      score: 60,
      weight: 25,
      explanation: "Some service accounts use weak encryption types.",
      recommendations: ["Migrate SPNs to AES-256 encryption"],
    },
  ],
  computedAt: "2026-03-23T10:00:00Z",
};

const mockHistory: RiskScoreHistory[] = [
  { date: "2026-02-21", totalScore: 65 },
  { date: "2026-02-28", totalScore: 68 },
  { date: "2026-03-07", totalScore: 70 },
  { date: "2026-03-14", totalScore: 71 },
  { date: "2026-03-21", totalScore: 72 },
];

function setupMocks(
  scoreResult: RiskScoreResult | Error = mockResult,
  historyResult: RiskScoreHistory[] | Error = mockHistory,
) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_risk_score") {
      if (scoreResult instanceof Error) return Promise.reject(scoreResult.message);
      return Promise.resolve(scoreResult);
    }
    if (cmd === "get_risk_score_history") {
      if (historyResult instanceof Error) return Promise.reject(historyResult.message);
      return Promise.resolve(historyResult);
    }
    return Promise.reject("Unknown command");
  });
}

describe("RiskScoreDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<RiskScoreDashboard />);
    expect(screen.getByText("Computing risk score...")).toBeInTheDocument();
  });

  it("renders risk score after loading", async () => {
    setupMocks();
    render(<RiskScoreDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("risk-score-value")).toBeInTheDocument();
    });

    expect(screen.getByTestId("risk-score-value")).toHaveTextContent("72");
  });

  it("displays correct zone label for Green zone", async () => {
    setupMocks();
    render(<RiskScoreDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("risk-zone-label")).toBeInTheDocument();
    });

    expect(screen.getByTestId("risk-zone-label")).toHaveTextContent("Good");
  });

  it("displays correct zone label for Red zone", async () => {
    const redResult: RiskScoreResult = {
      ...mockResult,
      totalScore: 25,
      zone: "Red",
    };
    setupMocks(redResult);
    render(<RiskScoreDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("risk-zone-label")).toBeInTheDocument();
    });

    expect(screen.getByTestId("risk-zone-label")).toHaveTextContent("Poor");
  });

  it("displays correct zone label for Orange zone", async () => {
    const orangeResult: RiskScoreResult = {
      ...mockResult,
      totalScore: 55,
      zone: "Orange",
    };
    setupMocks(orangeResult);
    render(<RiskScoreDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("risk-zone-label")).toBeInTheDocument();
    });

    expect(screen.getByTestId("risk-zone-label")).toHaveTextContent("Fair");
  });

  it("renders gauge SVG", async () => {
    setupMocks();
    render(<RiskScoreDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("risk-gauge")).toBeInTheDocument();
    });

    expect(screen.getByTestId("gauge-svg")).toBeInTheDocument();
  });

  it("renders factor breakdown with all factors", async () => {
    setupMocks();
    render(<RiskScoreDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("factor-breakdown")).toBeInTheDocument();
    });

    expect(screen.getByTestId("factor-card-password-policy")).toBeInTheDocument();
    expect(screen.getByTestId("factor-card-privileged-accounts")).toBeInTheDocument();
    expect(screen.getByTestId("factor-card-replication")).toBeInTheDocument();
    expect(screen.getByTestId("factor-card-kerberos")).toBeInTheDocument();
  });

  it("shows factor names and explanations", async () => {
    setupMocks();
    render(<RiskScoreDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Password Policy")).toBeInTheDocument();
    });

    expect(screen.getByText("Privileged Accounts")).toBeInTheDocument();
    expect(
      screen.getByText("Several privileged accounts have stale passwords."),
    ).toBeInTheDocument();
  });

  it("shows recommendations for factors below 70", async () => {
    setupMocks();
    render(<RiskScoreDashboard />);

    await waitFor(() => {
      expect(
        screen.getByText("Rotate passwords for privileged accounts older than 90 days"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("Migrate SPNs to AES-256 encryption"),
    ).toBeInTheDocument();
  });

  it("does not show recommendations for factors at or above 70", async () => {
    setupMocks();
    render(<RiskScoreDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("factor-card-password-policy")).toBeInTheDocument();
    });

    // Password Policy (score=85) should not have a recommendations section
    const policyCard = screen.getByTestId("factor-card-password-policy");
    expect(policyCard.querySelector("[class*='Recommendations']")).toBeNull();
  });

  it("renders trend sparkline with bars", async () => {
    setupMocks();
    render(<RiskScoreDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("trend-sparkline")).toBeInTheDocument();
    });

    const bars = screen.getAllByTestId("trend-bar");
    expect(bars).toHaveLength(5);
  });

  it("shows error state on failure", async () => {
    setupMocks(new Error("Connection failed"));
    render(<RiskScoreDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Risk Score Unavailable")).toBeInTheDocument();
    });
  });

  it("shows empty state when result is null", async () => {
    // Both calls resolve but score returns null-like (empty promise that resolves to null)
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_risk_score") return Promise.resolve(null);
      if (cmd === "get_risk_score_history") return Promise.resolve([]);
      return Promise.reject("Unknown command");
    });
    render(<RiskScoreDashboard />);

    await waitFor(() => {
      expect(screen.getByText("No Risk Data")).toBeInTheDocument();
    });
  });

  it("calls both commands on mount", async () => {
    setupMocks();
    render(<RiskScoreDashboard />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_risk_score");
    });

    expect(mockInvoke).toHaveBeenCalledWith("get_risk_score_history", { days: 30 });
  });

  it("calls refresh on button click", async () => {
    setupMocks();
    render(<RiskScoreDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("refresh-button"));

    // Initial load + refresh = 4 calls (2 per fetch)
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(4);
    });
  });

  it("shows trend dates at start and end", async () => {
    setupMocks();
    render(<RiskScoreDashboard />);

    await waitFor(() => {
      expect(screen.getByText("2026-02-21")).toBeInTheDocument();
    });

    expect(screen.getByText("2026-03-21")).toBeInTheDocument();
  });
});
