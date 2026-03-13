import { describe, it, expect } from "vitest";
import { evaluateHealth } from "./healthcheck";
import type { DirectoryUser } from "@/types/directory";

function makeHealthyUser(
  overrides: Partial<DirectoryUser> = {},
): DirectoryUser {
  return {
    distinguishedName: "CN=John Doe,OU=Users,DC=example,DC=com",
    samAccountName: "jdoe",
    displayName: "John Doe",
    givenName: "John",
    surname: "Doe",
    email: "jdoe@example.com",
    department: "IT",
    title: "Engineer",
    organizationalUnit: "Users",
    enabled: true,
    lockedOut: false,
    accountExpires: null,
    passwordLastSet: "2026-03-01T10:00:00Z",
    passwordExpired: false,
    passwordNeverExpires: false,
    lastLogon: "2026-03-12T08:00:00Z",
    lastLogonWorkstation: "WORKSTATION01",
    badPasswordCount: 0,
    whenCreated: "2024-01-01T10:00:00Z",
    whenChanged: "2026-03-10T10:00:00Z",
    memberOf: [],
    ...overrides,
  };
}

const NOW = new Date("2026-03-13T12:00:00Z");

describe("evaluateHealth", () => {
  it("returns Healthy for a normal active user", () => {
    const result = evaluateHealth(makeHealthyUser(), NOW);
    expect(result.level).toBe("Healthy");
    expect(result.activeFlags).toHaveLength(0);
  });

  it("detects Disabled flag as Critical", () => {
    const result = evaluateHealth(makeHealthyUser({ enabled: false }), NOW);
    expect(result.level).toBe("Critical");
    const flag = result.activeFlags.find((f) => f.name === "Disabled");
    expect(flag).toBeDefined();
    expect(flag!.severity).toBe("Critical");
  });

  it("detects Locked flag as Critical", () => {
    const result = evaluateHealth(makeHealthyUser({ lockedOut: true }), NOW);
    expect(result.level).toBe("Critical");
    const flag = result.activeFlags.find((f) => f.name === "Locked");
    expect(flag).toBeDefined();
    expect(flag!.severity).toBe("Critical");
  });

  it("detects Expired account as Critical", () => {
    const result = evaluateHealth(
      makeHealthyUser({ accountExpires: "2026-01-01T00:00:00Z" }),
      NOW,
    );
    expect(result.level).toBe("Critical");
    expect(result.activeFlags.find((f) => f.name === "Expired")).toBeDefined();
  });

  it("does not flag account that expires in the future", () => {
    const result = evaluateHealth(
      makeHealthyUser({ accountExpires: "2027-01-01T00:00:00Z" }),
      NOW,
    );
    expect(
      result.activeFlags.find((f) => f.name === "Expired"),
    ).toBeUndefined();
  });

  it("detects PasswordExpired as Critical", () => {
    const result = evaluateHealth(
      makeHealthyUser({ passwordExpired: true }),
      NOW,
    );
    expect(result.level).toBe("Critical");
    expect(
      result.activeFlags.find((f) => f.name === "PasswordExpired"),
    ).toBeDefined();
  });

  it("detects PasswordNeverExpires as Warning", () => {
    const result = evaluateHealth(
      makeHealthyUser({ passwordNeverExpires: true }),
      NOW,
    );
    expect(result.level).toBe("Warning");
    expect(
      result.activeFlags.find((f) => f.name === "PasswordNeverExpires"),
    ).toBeDefined();
  });

  it("detects Inactive30Days as Warning", () => {
    const result = evaluateHealth(
      makeHealthyUser({ lastLogon: "2026-02-01T00:00:00Z" }),
      NOW,
    );
    expect(result.level).toBe("Warning");
    expect(
      result.activeFlags.find((f) => f.name === "Inactive30Days"),
    ).toBeDefined();
  });

  it("detects Inactive90Days as Critical (supersedes 30 days)", () => {
    const result = evaluateHealth(
      makeHealthyUser({ lastLogon: "2025-12-01T00:00:00Z" }),
      NOW,
    );
    expect(result.level).toBe("Critical");
    expect(
      result.activeFlags.find((f) => f.name === "Inactive90Days"),
    ).toBeDefined();
    expect(
      result.activeFlags.find((f) => f.name === "Inactive30Days"),
    ).toBeUndefined();
  });

  it("detects NeverLoggedOn as Info when created > 1 day ago", () => {
    const result = evaluateHealth(
      makeHealthyUser({
        lastLogon: null,
        whenCreated: "2024-01-01T00:00:00Z",
      }),
      NOW,
    );
    expect(result.level).toBe("Info");
    expect(
      result.activeFlags.find((f) => f.name === "NeverLoggedOn"),
    ).toBeDefined();
  });

  it("does not flag NeverLoggedOn when created today", () => {
    const result = evaluateHealth(
      makeHealthyUser({
        lastLogon: null,
        whenCreated: "2026-03-13T10:00:00Z",
      }),
      NOW,
    );
    expect(
      result.activeFlags.find((f) => f.name === "NeverLoggedOn"),
    ).toBeUndefined();
  });

  it("detects PasswordNeverChanged when pwdLastSet matches whenCreated", () => {
    const result = evaluateHealth(
      makeHealthyUser({
        passwordLastSet: "2024-01-01T10:00:00Z",
        whenCreated: "2024-01-01T10:00:30Z",
      }),
      NOW,
    );
    expect(
      result.activeFlags.find((f) => f.name === "PasswordNeverChanged"),
    ).toBeDefined();
  });

  it("does not flag PasswordNeverChanged when passwords differ by > 1 minute", () => {
    const result = evaluateHealth(
      makeHealthyUser({
        passwordLastSet: "2026-03-01T10:00:00Z",
        whenCreated: "2024-01-01T10:00:00Z",
      }),
      NOW,
    );
    expect(
      result.activeFlags.find((f) => f.name === "PasswordNeverChanged"),
    ).toBeUndefined();
  });

  it("combines multiple flags and takes worst severity", () => {
    const result = evaluateHealth(
      makeHealthyUser({
        enabled: false,
        passwordNeverExpires: true,
        lockedOut: true,
      }),
      NOW,
    );
    expect(result.level).toBe("Critical");
    expect(result.activeFlags.length).toBeGreaterThanOrEqual(3);
  });

  it("Warning + Warning stays Warning", () => {
    const result = evaluateHealth(
      makeHealthyUser({
        passwordNeverExpires: true,
        lastLogon: "2026-02-01T00:00:00Z",
      }),
      NOW,
    );
    expect(result.level).toBe("Warning");
    expect(result.activeFlags).toHaveLength(2);
  });

  it("handles null passwordLastSet gracefully", () => {
    const result = evaluateHealth(
      makeHealthyUser({ passwordLastSet: null }),
      NOW,
    );
    expect(
      result.activeFlags.find((f) => f.name === "PasswordNeverChanged"),
    ).toBeUndefined();
  });

  it("handles boundary: exactly 30 days inactive", () => {
    const thirtyDaysAgo = new Date(NOW);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const result = evaluateHealth(
      makeHealthyUser({ lastLogon: thirtyDaysAgo.toISOString() }),
      NOW,
    );
    expect(
      result.activeFlags.find((f) => f.name === "Inactive30Days"),
    ).toBeDefined();
  });

  it("handles boundary: exactly 90 days inactive", () => {
    const ninetyDaysAgo = new Date(NOW);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const result = evaluateHealth(
      makeHealthyUser({ lastLogon: ninetyDaysAgo.toISOString() }),
      NOW,
    );
    expect(
      result.activeFlags.find((f) => f.name === "Inactive90Days"),
    ).toBeDefined();
  });
});
