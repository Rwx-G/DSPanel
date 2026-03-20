import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { usePresetPath } from "./usePresetPath";
import { NotificationProvider } from "@/contexts/NotificationContext";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function wrapper({ children }: { children: ReactNode }) {
  return createElement(NotificationProvider, null, children);
}

describe("usePresetPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads path on mount", async () => {
    mockInvoke.mockResolvedValueOnce("\\\\server\\presets" as never);

    const { result } = renderHook(() => usePresetPath(), { wrapper });

    await waitFor(() => {
      expect(result.current.path).toBe("\\\\server\\presets");
    });

    expect(result.current.valid).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("get_preset_path");
  });

  it("handles null path on mount", async () => {
    mockInvoke.mockResolvedValueOnce(null as never);

    const { result } = renderHook(() => usePresetPath(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.path).toBeNull();
    expect(result.current.valid).toBeNull();
  });

  it("setPath calls set_preset_path and updates state", async () => {
    mockInvoke
      .mockResolvedValueOnce(null as never) // initial load
      .mockResolvedValueOnce(undefined as never); // set call

    const { result } = renderHook(() => usePresetPath(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success = false;
    await act(async () => {
      success = await result.current.setPath("C:\\presets");
    });

    expect(success).toBe(true);
    expect(result.current.path).toBe("C:\\presets");
    expect(result.current.valid).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("set_preset_path", {
      path: "C:\\presets",
    });
  });

  it("setPath returns false on error", async () => {
    mockInvoke
      .mockResolvedValueOnce(null as never) // initial load
      .mockRejectedValueOnce(new Error("Invalid path") as never);

    const { result } = renderHook(() => usePresetPath(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success = true;
    await act(async () => {
      success = await result.current.setPath("/bad/path");
    });

    expect(success).toBe(false);
    expect(result.current.valid).toBe(false);
  });

  it("testPath calls test_preset_path", async () => {
    mockInvoke
      .mockResolvedValueOnce(null as never) // initial load
      .mockResolvedValueOnce(true as never); // test call

    const { result } = renderHook(() => usePresetPath(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let testResult = false;
    await act(async () => {
      testResult = await result.current.testPath("C:\\presets");
    });

    expect(testResult).toBe(true);
    expect(result.current.valid).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("test_preset_path", {
      path: "C:\\presets",
    });
  });

  it("testPath returns false for invalid path", async () => {
    mockInvoke
      .mockResolvedValueOnce(null as never) // initial load
      .mockResolvedValueOnce(false as never); // test call

    const { result } = renderHook(() => usePresetPath(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let testResult = true;
    await act(async () => {
      testResult = await result.current.testPath("/nonexistent");
    });

    expect(testResult).toBe(false);
    expect(result.current.valid).toBe(false);
  });
});
