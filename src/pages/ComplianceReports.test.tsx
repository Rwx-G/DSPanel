import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ComplianceReports } from "./ComplianceReports";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const mockScan = {
  scannedAt: "2026-03-24 12:00:00",
  generator: "testadmin",
  totalAccountsScanned: 2500,
  globalScore: 55,
  totalFindings: 150,
  frameworkScores: [
    { standard: "GDPR", score: 55, totalChecks: 5, checksWithFindings: 3, controlRefs: ["Art. 32"] },
    { standard: "HIPAA", score: 65, totalChecks: 5, checksWithFindings: 2, controlRefs: ["164.312"] },
    { standard: "PCI-DSS v4.0", score: 40, totalChecks: 6, checksWithFindings: 4, controlRefs: ["Req. 7"] },
  ],
  checks: [
    {
      checkId: "privileged_accounts",
      title: "Privileged Accounts",
      description: "Accounts with admin privileges.",
      severity: "High",
      findingCount: 12,
      headers: ["Username", "Display Name"],
      rows: [["admin", "Administrator"], ["svc_sql", "SQL Service"]],
      frameworks: [
        { standard: "GDPR", controlRef: "Art. 32(2)" },
        { standard: "HIPAA", controlRef: "164.312(a)(1)" },
      ],
      remediation: "Review all privileged accounts quarterly.",
    },
    {
      checkId: "password_not_required",
      title: "Password Not Required",
      description: "Accounts with PASSWD_NOTREQD flag.",
      severity: "Critical",
      findingCount: 2,
      headers: ["Username"],
      rows: [["testuser1"], ["testuser2"]],
      frameworks: [
        { standard: "GDPR", controlRef: "Art. 32(1)(b)" },
        { standard: "PCI-DSS v4.0", controlRef: "Req. 8.3.1" },
      ],
      remediation: "Get-ADUser -Filter {PasswordNotRequired -eq $true} | Set-ADUser -PasswordNotRequired $false",
    },
    {
      checkId: "reversible_encryption",
      title: "Reversible Encryption",
      description: "Accounts with reversible encryption.",
      severity: "Critical",
      findingCount: 0,
      headers: ["Username"],
      rows: [],
      frameworks: [{ standard: "GDPR", controlRef: "Art. 32(1)(a)" }],
      remediation: "No action needed.",
    },
  ],
};

describe("ComplianceReports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "run_compliance_scan") return Promise.resolve(mockScan);
      if (cmd === "export_compliance_framework_report") return Promise.resolve("/tmp/report.html");
      if (cmd === "export_table") return Promise.resolve(null);
      return Promise.resolve(null);
    });
  });

  it("renders empty state before scan", () => {
    render(<ComplianceReports />);
    expect(screen.getByText(/Run a compliance scan/)).toBeInTheDocument();
  });

  it("shows scan button", () => {
    render(<ComplianceReports />);
    expect(screen.getByTestId("scan-button")).toBeInTheDocument();
  });

  it("runs scan and shows global score", async () => {
    render(<ComplianceReports />);
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByText("55/100")).toBeInTheDocument();
    });
    expect(screen.getByText("Global Compliance Score")).toBeInTheDocument();
  });

  it("shows framework score cards", async () => {
    render(<ComplianceReports />);
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("framework-grid")).toBeInTheDocument();
    });
    expect(screen.getByText("GDPR")).toBeInTheDocument();
    expect(screen.getByText("HIPAA")).toBeInTheDocument();
  });

  it("shows checks list", async () => {
    render(<ComplianceReports />);
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("checks-list")).toBeInTheDocument();
    });
    expect(screen.getByText("Privileged Accounts")).toBeInTheDocument();
    expect(screen.getByText("Password Not Required (PASSWD_NOTREQD)")).toBeInTheDocument();
  });

  it("shows finding count and severity on checks", async () => {
    render(<ComplianceReports />);
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByText("12")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Critical").length).toBeGreaterThan(0);
    expect(screen.getAllByText("High").length).toBeGreaterThan(0);
  });

  it("shows Clear for checks with zero findings", async () => {
    render(<ComplianceReports />);
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByText("Clear")).toBeInTheDocument();
    });
  });

  it("expands check to show details", async () => {
    render(<ComplianceReports />);
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("check-privileged_accounts")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Privileged Accounts"));

    await waitFor(() => {
      expect(screen.getByText("Accounts with admin privileges.")).toBeInTheDocument();
      expect(screen.getByText("Art. 32(2)")).toBeInTheDocument();
      expect(screen.getByText("admin")).toBeInTheDocument();
    });
  });

  it("shows framework chips in expanded check", async () => {
    render(<ComplianceReports />);
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      fireEvent.click(screen.getByText("Privileged Accounts"));
    });

    await waitFor(() => {
      expect(screen.getByText("164.312(a)(1)")).toBeInTheDocument();
    });
  });

  it("exports framework report on card click", async () => {
    render(<ComplianceReports />);
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("export-fw-GDPR")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("export-fw-GDPR"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "export_compliance_framework_report",
        expect.objectContaining({ framework: "GDPR" }),
      );
    });
  });

  it("shows metadata in global score", async () => {
    render(<ComplianceReports />);
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByText(/2500 accounts scanned/)).toBeInTheDocument();
      expect(screen.getByText(/150 findings/)).toBeInTheDocument();
    });
  });
});
