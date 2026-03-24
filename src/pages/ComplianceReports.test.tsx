import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ComplianceReports } from "./ComplianceReports";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const mockTemplates = [
  {
    name: "GDPR Access Review",
    standard: "GDPR",
    version: "1.0",
    description: "Review of AD access controls for GDPR compliance",
    builtin: true,
    sections: [
      {
        title: "Privileged Access Summary",
        controlReference: "GDPR Art. 25",
        type: "query",
        queryScope: "privilegedAccounts",
        queryAttributes: ["sAMAccountName"],
        content: null,
      },
      {
        title: "Recommendations",
        controlReference: "GDPR Art. 32",
        type: "static",
        queryScope: null,
        queryAttributes: null,
        content: "Review quarterly.",
      },
    ],
  },
  {
    name: "PCI-DSS Auth Audit",
    standard: "PCI-DSS",
    version: "1.0",
    description: "PCI-DSS compliance audit",
    builtin: true,
    sections: [],
  },
];

const mockReport = {
  templateName: "GDPR Access Review",
  standard: "GDPR",
  version: "1.0",
  generatedAt: "2026-03-24 12:00:00",
  generator: "testadmin",
  sections: [
    {
      title: "Privileged Access Summary",
      controlReference: "GDPR Art. 25",
      sectionType: "query",
      headers: ["sAMAccountName"],
      rows: [["admin"], ["svc_sql"]],
      content: null,
      findingCount: 2,
    },
    {
      title: "Recommendations",
      controlReference: "GDPR Art. 32",
      sectionType: "static",
      headers: null,
      rows: null,
      content: "Review quarterly.",
      findingCount: null,
    },
  ],
};

describe("ComplianceReports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_compliance_templates") return Promise.resolve(mockTemplates);
      if (cmd === "generate_compliance_report") return Promise.resolve(mockReport);
      if (cmd === "export_compliance_report_html") return Promise.resolve("/tmp/report.html");
      if (cmd === "save_custom_template") return Promise.resolve(null);
      if (cmd === "delete_custom_template") return Promise.resolve(null);
      return Promise.resolve(null);
    });
  });

  it("renders template cards", async () => {
    render(<ComplianceReports />);
    await waitFor(() => {
      expect(screen.getByTestId("template-grid")).toBeInTheDocument();
    });
    expect(screen.getByText("GDPR Access Review")).toBeInTheDocument();
    expect(screen.getByText("PCI-DSS Auth Audit")).toBeInTheDocument();
  });

  it("shows standard badges on cards", async () => {
    render(<ComplianceReports />);
    await waitFor(() => {
      expect(screen.getByText("GDPR")).toBeInTheDocument();
      expect(screen.getByText("PCI-DSS")).toBeInTheDocument();
    });
  });

  it("shows control references on card", async () => {
    render(<ComplianceReports />);
    await waitFor(() => {
      expect(screen.getByText("GDPR Art. 25")).toBeInTheDocument();
    });
  });

  it("generates report on button click", async () => {
    render(<ComplianceReports />);
    await waitFor(() => {
      expect(screen.getByTestId("generate-GDPR")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("generate-GDPR"));

    await waitFor(() => {
      expect(screen.getByTestId("report-viewer")).toBeInTheDocument();
    });
    expect(screen.getByText("Privileged Access Summary")).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
  });

  it("shows export HTML button in report", async () => {
    render(<ComplianceReports />);
    await waitFor(() => {
      fireEvent.click(screen.getByTestId("generate-GDPR"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("export-report-html")).toBeInTheDocument();
    });
  });

  it("exports HTML report", async () => {
    render(<ComplianceReports />);
    await waitFor(() => {
      fireEvent.click(screen.getByTestId("generate-GDPR"));
    });

    await waitFor(() => {
      fireEvent.click(screen.getByTestId("export-report-html"));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "export_compliance_report_html",
        expect.objectContaining({
          report: mockReport,
        }),
      );
    });
  });

  it("shows static content sections", async () => {
    render(<ComplianceReports />);
    await waitFor(() => {
      fireEvent.click(screen.getByTestId("generate-GDPR"));
    });

    await waitFor(() => {
      expect(screen.getByText("Review quarterly.")).toBeInTheDocument();
    });
  });

  it("shows custom template button", async () => {
    render(<ComplianceReports />);
    await waitFor(() => {
      expect(screen.getByTestId("create-custom-btn")).toBeInTheDocument();
    });
  });

  it("opens custom template editor", async () => {
    render(<ComplianceReports />);
    await waitFor(() => {
      fireEvent.click(screen.getByTestId("create-custom-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("custom-template-editor")).toBeInTheDocument();
    });
  });

  it("does not show delete button for builtin templates", async () => {
    render(<ComplianceReports />);
    await waitFor(() => {
      expect(screen.getByTestId("template-grid")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("delete-template-GDPR Access Review")).not.toBeInTheDocument();
  });
});
