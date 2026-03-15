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

  it("calls both mfa_is_configured and mfa_requires when MFA is needed", async () => {
    mockInvoke
      .mockResolvedValueOnce(true as never) // mfa_is_configured
      .mockResolvedValueOnce(true as never); // mfa_requires

    const { result } = renderHook(() => useMfaGate(), {
      wrapper: TestProviders,
    });

    // Start checkMfa - it will call showCustomDialog which opens a dialog.
    // The dialog promise never resolves in this test, but we can verify
    // both invoke calls were made before the dialog opened.
    let promise: Promise<boolean>;
    await act(async () => {
      promise = result.current.checkMfa("PasswordReset");
      // Allow the async invoke calls to settle
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockInvoke).toHaveBeenCalledWith("mfa_is_configured");
    expect(mockInvoke).toHaveBeenCalledWith("mfa_requires", {
      action: "PasswordReset",
    });
  });

  it("allows action when mfa_requires invoke fails", async () => {
    mockInvoke
      .mockResolvedValueOnce(true as never) // mfa_is_configured
      .mockRejectedValueOnce(new Error("command not found") as never); // mfa_requires

    const { result } = renderHook(() => useMfaGate(), {
      wrapper: TestProviders,
    });

    let allowed: boolean | undefined;
    await act(async () => {
      allowed = await result.current.checkMfa("SomeAction");
    });

    // Falls into catch block, returns true
    expect(allowed).toBe(true);
  });

  it("can be called multiple times", async () => {
    // First call: not configured
    mockInvoke.mockResolvedValueOnce(false as never);
    // Second call: not configured
    mockInvoke.mockResolvedValueOnce(false as never);

    const { result } = renderHook(() => useMfaGate(), {
      wrapper: TestProviders,
    });

    let allowed1: boolean | undefined;
    let allowed2: boolean | undefined;
    await act(async () => {
      allowed1 = await result.current.checkMfa("Action1");
    });
    await act(async () => {
      allowed2 = await result.current.checkMfa("Action2");
    });

    expect(allowed1).toBe(true);
    expect(allowed2).toBe(true);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});
