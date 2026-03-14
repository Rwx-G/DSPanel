import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateHealth } from "./healthcheck";
import type { DirectoryUser } from "@/types/directory";
import type { AccountHealthStatus } from "@/types/health";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function makeHealthyUser(
  overrides: Partial<DirectoryUser> = {},
): DirectoryUser {
  return {
    distinguishedName: "CN=John Doe,OU=Users,DC=example,DC=com",
    samAccountName: "jdoe",
    displayName: "John Doe",
    userPrincipalName: "jdoe@example.com",
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

const HEALTHY_RESULT: AccountHealthStatus = {
  level: "Healthy",
  activeFlags: [],
};

const CRITICAL_RESULT: AccountHealthStatus = {
  level: "Critical",
  activeFlags: [
    { name: "Disabled", severity: "Critical", description: "Account is disabled" },
  ],
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("evaluateHealth", () => {
  it("calls evaluate_health_cmd Tauri command", async () => {
    mockInvoke.mockResolvedValue(HEALTHY_RESULT);
    const user = makeHealthyUser();
    await evaluateHealth(user);
    expect(mockInvoke).toHaveBeenCalledWith("evaluate_health_cmd", {
      input: {
        enabled: true,
        lockedOut: false,
        accountExpires: null,
        passwordLastSet: "2026-03-01T10:00:00Z",
        passwordExpired: false,
        passwordNeverExpires: false,
        lastLogon: "2026-03-12T08:00:00Z",
        whenCreated: "2024-01-01T10:00:00Z",
      },
    });
  });

  it("returns the health status from Rust backend", async () => {
    mockInvoke.mockResolvedValue(HEALTHY_RESULT);
    const result = await evaluateHealth(makeHealthyUser());
    expect(result.level).toBe("Healthy");
    expect(result.activeFlags).toHaveLength(0);
  });

  it("returns critical status for disabled user", async () => {
    mockInvoke.mockResolvedValue(CRITICAL_RESULT);
    const result = await evaluateHealth(makeHealthyUser({ enabled: false }));
    expect(result.level).toBe("Critical");
    expect(result.activeFlags[0].name).toBe("Disabled");
  });

  it("passes null accountExpires when not set", async () => {
    mockInvoke.mockResolvedValue(HEALTHY_RESULT);
    await evaluateHealth(makeHealthyUser({ accountExpires: null }));
    const call = mockInvoke.mock.calls[0];
    expect((call[1] as { input: { accountExpires: string | null } }).input.accountExpires).toBeNull();
  });

  it("passes null lastLogon when not set", async () => {
    mockInvoke.mockResolvedValue(HEALTHY_RESULT);
    await evaluateHealth(makeHealthyUser({ lastLogon: null }));
    const call = mockInvoke.mock.calls[0];
    expect((call[1] as { input: { lastLogon: string | null } }).input.lastLogon).toBeNull();
  });

  it("passes null passwordLastSet when not set", async () => {
    mockInvoke.mockResolvedValue(HEALTHY_RESULT);
    await evaluateHealth(makeHealthyUser({ passwordLastSet: null }));
    const call = mockInvoke.mock.calls[0];
    expect((call[1] as { input: { passwordLastSet: string | null } }).input.passwordLastSet).toBeNull();
  });

  it("passes empty string whenCreated as null", async () => {
    mockInvoke.mockResolvedValue(HEALTHY_RESULT);
    await evaluateHealth(makeHealthyUser({ whenCreated: "" }));
    const call = mockInvoke.mock.calls[0];
    expect((call[1] as { input: { whenCreated: string | null } }).input.whenCreated).toBeNull();
  });

  it("propagates invoke errors", async () => {
    mockInvoke.mockRejectedValue(new Error("IPC failed"));
    await expect(evaluateHealth(makeHealthyUser())).rejects.toThrow("IPC failed");
  });

  it("sends boolean fields correctly", async () => {
    mockInvoke.mockResolvedValue(HEALTHY_RESULT);
    await evaluateHealth(
      makeHealthyUser({
        enabled: false,
        lockedOut: true,
        passwordExpired: true,
        passwordNeverExpires: true,
      }),
    );
    const call = mockInvoke.mock.calls[0];
    const input = (call[1] as { input: Record<string, unknown> }).input;
    expect(input.enabled).toBe(false);
    expect(input.lockedOut).toBe(true);
    expect(input.passwordExpired).toBe(true);
    expect(input.passwordNeverExpires).toBe(true);
  });

  it("returns multi-flag results from backend", async () => {
    const multiResult: AccountHealthStatus = {
      level: "Critical",
      activeFlags: [
        { name: "Disabled", severity: "Critical", description: "Account is disabled" },
        { name: "PasswordNeverExpires", severity: "Warning", description: "Password is set to never expire" },
      ],
    };
    mockInvoke.mockResolvedValue(multiResult);
    const result = await evaluateHealth(
      makeHealthyUser({ enabled: false, passwordNeverExpires: true }),
    );
    expect(result.activeFlags).toHaveLength(2);
    expect(result.level).toBe("Critical");
  });
});
