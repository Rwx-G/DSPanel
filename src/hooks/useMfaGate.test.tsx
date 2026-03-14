import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { type ReactNode } from "react";
import { useMfaGate } from "./useMfaGate";
import { DialogProvider } from "@/contexts/DialogContext";
import { NotificationProvider } from "@/contexts/NotificationContext";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <NotificationProvider>
      <DialogProvider>{children}</DialogProvider>
    </NotificationProvider>
  );
}

describe("useMfaGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows action when MFA is not configured", async () => {
    mockInvoke.mockResolvedValueOnce(false as never); // mfa_is_configured

    const { result } = renderHook(() => useMfaGate(), {
      wrapper: TestProviders,
    });

    let allowed: boolean | undefined;
    await act(async () => {
      allowed = await result.current.checkMfa("PasswordReset");
    });

    expect(allowed).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("mfa_is_configured");
  });

  it("allows action when MFA is configured but not required for this action", async () => {
    mockInvoke
      .mockResolvedValueOnce(true as never) // mfa_is_configured
      .mockResolvedValueOnce(false as never); // mfa_requires

    const { result } = renderHook(() => useMfaGate(), {
      wrapper: TestProviders,
    });

    let allowed: boolean | undefined;
    await act(async () => {
      allowed = await result.current.checkMfa("SomeAction");
    });

    expect(allowed).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("mfa_requires", {
      action: "SomeAction",
    });
  });

  it("allows action when invoke throws (fallback to allow)", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("network error") as never);

    const { result } = renderHook(() => useMfaGate(), {
      wrapper: TestProviders,
    });

    let allowed: boolean | undefined;
    await act(async () => {
      allowed = await result.current.checkMfa("PasswordReset");
    });

    expect(allowed).toBe(true);
  });

  it("returns checkMfa function", () => {
    const { result } = renderHook(() => useMfaGate(), {
      wrapper: TestProviders,
    });
    expect(typeof result.current.checkMfa).toBe("function");
  });
});
