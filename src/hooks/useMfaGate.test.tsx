import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderHook,
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { useState, type ReactNode } from "react";
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
    await act(async () => {
      void result.current.checkMfa("PasswordReset");
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

  it("shows MFA dialog and returns true when user verifies successfully", async () => {
    // A component that triggers checkMfa and reports the result
    function MfaTestHarness() {
      const { checkMfa } = useMfaGate();
      const [result, setResult] = useState<string>("pending");

      return (
        <div>
          <button
            data-testid="trigger-mfa"
            onClick={async () => {
              const allowed = await checkMfa("PasswordReset");
              setResult(allowed ? "allowed" : "denied");
            }}
          >
            Trigger MFA
          </button>
          <span data-testid="mfa-result">{result}</span>
        </div>
      );
    }

    // mfa_is_configured -> true, mfa_requires -> true, mfa_verify -> true
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "mfa_is_configured") return true as never;
      if (cmd === "mfa_requires") return true as never;
      if (cmd === "mfa_verify") return true as never;
      return null as never;
    });

    render(
      <TestProviders>
        <MfaTestHarness />
      </TestProviders>,
    );

    // Trigger the MFA check
    fireEvent.click(screen.getByTestId("trigger-mfa"));

    // Wait for the MFA dialog to appear
    await waitFor(() => {
      expect(screen.getByTestId("mfa-dialog")).toBeInTheDocument();
    });

    // Type a valid code
    const input = screen.getByTestId("mfa-code-input");
    fireEvent.change(input, { target: { value: "123456" } });

    // Click Verify
    fireEvent.click(screen.getByTestId("mfa-verify"));

    // Wait for the dialog to close and result to be "allowed"
    await waitFor(() => {
      expect(screen.getByTestId("mfa-result")).toHaveTextContent("allowed");
    });
  });

  it("shows MFA dialog and returns false when user cancels", async () => {
    function MfaTestHarness() {
      const { checkMfa } = useMfaGate();
      const [result, setResult] = useState<string>("pending");

      return (
        <div>
          <button
            data-testid="trigger-mfa"
            onClick={async () => {
              const allowed = await checkMfa("PasswordReset");
              setResult(allowed ? "allowed" : "denied");
            }}
          >
            Trigger MFA
          </button>
          <span data-testid="mfa-result">{result}</span>
        </div>
      );
    }

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "mfa_is_configured") return true as never;
      if (cmd === "mfa_requires") return true as never;
      return null as never;
    });

    render(
      <TestProviders>
        <MfaTestHarness />
      </TestProviders>,
    );

    fireEvent.click(screen.getByTestId("trigger-mfa"));

    await waitFor(() => {
      expect(screen.getByTestId("mfa-dialog")).toBeInTheDocument();
    });

    // Click Cancel
    fireEvent.click(screen.getByTestId("mfa-cancel"));

    await waitFor(() => {
      expect(screen.getByTestId("mfa-result")).toHaveTextContent("denied");
    });
  });
});
