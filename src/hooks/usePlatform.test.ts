import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("usePlatform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module cache to clear the cached platform value
    vi.resetModules();
  });

  it("returns platform from invoke", async () => {
    mockInvoke.mockResolvedValueOnce("windows");

    const { usePlatform } = await import("./usePlatform");
    const { result } = renderHook(() => usePlatform());

    await waitFor(() => {
      expect(result.current).toBe("windows");
    });
    expect(mockInvoke).toHaveBeenCalledWith("get_platform");
  });

  it("returns 'unknown' on error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("fail"));

    const { usePlatform } = await import("./usePlatform");
    const { result } = renderHook(() => usePlatform());

    await waitFor(() => {
      expect(result.current).toBe("unknown");
    });
  });

  it("caches platform after first call", async () => {
    mockInvoke.mockResolvedValueOnce("linux");

    const mod = await import("./usePlatform");
    const { result: result1 } = renderHook(() => mod.usePlatform());

    await waitFor(() => {
      expect(result1.current).toBe("linux");
    });

    // Second render should use cache, no new invoke
    const callCount = mockInvoke.mock.calls.length;
    const { result: result2 } = renderHook(() => mod.usePlatform());

    expect(result2.current).toBe("linux");
    expect(mockInvoke.mock.calls.length).toBe(callCount);
  });
});
