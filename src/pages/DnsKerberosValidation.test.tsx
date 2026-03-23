import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { DnsKerberosValidation } from "./DnsKerberosValidation";
import { type DnsKerberosReport } from "@/types/dns-validation";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const sampleReport: DnsKerberosReport = {
  dnsResults: [
    {
      recordName: "_ldap._tcp.example.com",
      expectedHosts: ["DC1.example.com", "DC2.example.com"],
      actualHosts: ["DC1.example.com", "DC2.example.com"],
      missingHosts: [],
      extraHosts: [],
      status: "Pass",
    },
    {
      recordName: "_kerberos._tcp.example.com",
      expectedHosts: ["DC1.example.com", "DC2.example.com"],
      actualHosts: ["DC1.example.com"],
      missingHosts: ["DC2.example.com"],
      extraHosts: [],
      status: "Fail",
    },
  ],
  clockSkewResults: [
    {
      dcHostname: "DC1.example.com",
      dcTime: "2026-03-21T12:00:00Z",
      localTime: "2026-03-21T12:00:02Z",
      skewSeconds: 2,
      status: "Ok",
    },
    {
      dcHostname: "DC2.example.com",
      dcTime: "2026-03-21T12:05:00Z",
      localTime: "2026-03-21T12:00:00Z",
      skewSeconds: 300,
      status: "Warning",
    },
  ],
  checkedAt: "2026-03-21T12:00:00Z",
};

describe("DnsKerberosValidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs validation automatically on mount", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<DnsKerberosValidation />);
    expect(
      screen.getByText("Running DNS and Kerberos validation..."),
    ).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith(
      "get_dns_kerberos_validation",
      { thresholdSeconds: 300 },
    );
  });

  it("shows loading state during validation", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<DnsKerberosValidation />);
    expect(
      screen.getByText("Running DNS and Kerberos validation..."),
    ).toBeInTheDocument();
  });

  it("displays DNS results after validation", async () => {
    mockInvoke.mockResolvedValueOnce(sampleReport);
    render(<DnsKerberosValidation />);

    fireEvent.click(screen.getByTestId("run-button"));

    await waitFor(() => {
      expect(
        screen.getByText("_ldap._tcp.example.com"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("_kerberos._tcp.example.com"),
      ).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("displays clock skew results", async () => {
    mockInvoke.mockResolvedValueOnce(sampleReport);
    render(<DnsKerberosValidation />);

    fireEvent.click(screen.getByTestId("run-button"));

    await waitFor(() => {
      expect(screen.getByTestId("clock-skew-table")).toBeInTheDocument();
      expect(screen.getByText("2s")).toBeInTheDocument();
      expect(screen.getByText("300s")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows missing hosts for failed DNS records", async () => {
    mockInvoke.mockResolvedValueOnce(sampleReport);
    render(<DnsKerberosValidation />);

    fireEvent.click(screen.getByTestId("run-button"));

    await waitFor(() => {
      expect(
        screen.getByText("Missing: DC2.example.com"),
      ).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows error state when validation fails", async () => {
    mockInvoke.mockRejectedValueOnce("Permission denied");
    render(<DnsKerberosValidation />);

    fireEvent.click(screen.getByTestId("run-button"));

    await waitFor(() => {
      expect(screen.getByText("Validation Failed")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("calls invoke with threshold parameter", async () => {
    mockInvoke.mockResolvedValueOnce(sampleReport);
    render(<DnsKerberosValidation />);

    fireEvent.click(screen.getByTestId("run-button"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "get_dns_kerberos_validation",
        { thresholdSeconds: 300 },
      );
    }, { timeout: 5000 });
  });

  it("shows default Kerberos threshold label", () => {
    render(<DnsKerberosValidation />);
    expect(
      screen.getByText("Default Kerberos threshold: 5 min"),
    ).toBeInTheDocument();
  });

  it("shows export button after results are loaded", async () => {
    mockInvoke.mockResolvedValueOnce(sampleReport);
    render(<DnsKerberosValidation />);

    fireEvent.click(screen.getByTestId("run-button"));

    await waitFor(() => {
      expect(screen.getByTestId("export-button")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows summary counts after validation", async () => {
    mockInvoke.mockResolvedValueOnce(sampleReport);
    render(<DnsKerberosValidation />);

    fireEvent.click(screen.getByTestId("run-button"));

    await waitFor(() => {
      expect(screen.getByText(/1 pass/)).toBeInTheDocument();
      expect(screen.getByText(/1 fail/)).toBeInTheDocument();
      expect(screen.getByText(/1 ok/)).toBeInTheDocument();
      expect(screen.getByText(/1 issues/)).toBeInTheDocument();
    }, { timeout: 5000 });
  });
});
