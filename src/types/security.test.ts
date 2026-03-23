import { describe, it, expect } from "vitest";
import type {
  AlertSeverity,
  SecurityAlert,
  PrivilegedAccountInfo,
  AlertSummary,
  PrivilegedAccountsReport,
} from "./security";

describe("Security types", () => {
  it("AlertSeverity accepts valid values", () => {
    const severities: AlertSeverity[] = ["Critical", "High", "Medium", "Info"];
    expect(severities).toHaveLength(4);
  });

  it("SecurityAlert structure is correct", () => {
    const alert: SecurityAlert = {
      severity: "Critical",
      message: "Password older than 90 days",
      alertType: "password_age",
    };
    expect(alert.severity).toBe("Critical");
    expect(alert.alertType).toBe("password_age");
  });

  it("PrivilegedAccountInfo structure is correct", () => {
    const account: PrivilegedAccountInfo = {
      distinguishedName: "CN=Admin,DC=example,DC=com",
      samAccountName: "admin",
      displayName: "Administrator",
      privilegedGroups: ["Domain Admins"],
      lastLogon: "2026-03-20T10:00:00Z",
      passwordAgeDays: 45,
      passwordExpiryDate: null,
      enabled: true,
      passwordNeverExpires: false,
      alerts: [],
    };
    expect(account.samAccountName).toBe("admin");
    expect(account.enabled).toBe(true);
    expect(account.alerts).toHaveLength(0);
  });

  it("AlertSummary structure is correct", () => {
    const summary: AlertSummary = {
      critical: 2,
      high: 1,
      medium: 3,
      info: 0,
    };
    expect(summary.critical).toBe(2);
    expect(summary.high).toBe(1);
  });

  it("PrivilegedAccountsReport structure is correct", () => {
    const report: PrivilegedAccountsReport = {
      accounts: [],
      summary: { critical: 0, high: 0, medium: 0, info: 0 },
      scannedAt: "2026-03-23T10:00:00Z",
    };
    expect(report.accounts).toHaveLength(0);
    expect(report.scannedAt).toBe("2026-03-23T10:00:00Z");
  });
});
