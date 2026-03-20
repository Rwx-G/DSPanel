import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { usePresets } from "./usePresets";
import { NotificationProvider } from "@/contexts/NotificationContext";
import type { Preset } from "@/types/preset";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function wrapper({ children }: { children: ReactNode }) {
  return createElement(NotificationProvider, null, children);
}

const samplePresets: Preset[] = [
  {
    name: "Dev Onboarding",
    description: "Standard dev setup",
    type: "Onboarding",
    targetOu: "OU=Devs,DC=example,DC=com",
    groups: ["CN=Devs,DC=example,DC=com"],
    attributes: { department: "Engineering" },
  },
  {
    name: "Offboarding",
    description: "Standard offboarding",
    type: "Offboarding",
    targetOu: "OU=Disabled,DC=example,DC=com",
    groups: [],
    attributes: {},
  },
];

describe("usePresets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads presets on mount", async () => {
    mockInvoke.mockResolvedValueOnce(samplePresets as never);

    const { result } = renderHook(() => usePresets(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.presets).toEqual(samplePresets);
    expect(result.current.error).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith("list_presets");
  });

  it("handles load error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Failed") as never);

    const { result } = renderHook(() => usePresets(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.presets).toEqual([]);
    expect(result.current.error).toBe("Failed to load presets");
  });

  it("savePreset calls invoke and reloads", async () => {
    mockInvoke
      .mockResolvedValueOnce([] as never) // initial load
      .mockResolvedValueOnce(undefined as never) // save
      .mockResolvedValueOnce(samplePresets as never); // reload after save

    const { result } = renderHook(() => usePresets(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success = false;
    await act(async () => {
      success = await result.current.savePreset(samplePresets[0]);
    });

    expect(success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("save_preset", {
      preset: samplePresets[0],
    });
  });

  it("savePreset returns false on error", async () => {
    mockInvoke
      .mockResolvedValueOnce([] as never) // initial load
      .mockRejectedValueOnce(new Error("Permission denied") as never);

    const { result } = renderHook(() => usePresets(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success = true;
    await act(async () => {
      success = await result.current.savePreset(samplePresets[0]);
    });

    expect(success).toBe(false);
  });

  it("deletePreset calls invoke and reloads", async () => {
    mockInvoke
      .mockResolvedValueOnce(samplePresets as never) // initial load
      .mockResolvedValueOnce(undefined as never) // delete
      .mockResolvedValueOnce([] as never); // reload after delete

    const { result } = renderHook(() => usePresets(), { wrapper });

    await waitFor(() => {
      expect(result.current.presets).toHaveLength(2);
    });

    let success = false;
    await act(async () => {
      success = await result.current.deletePreset("Dev Onboarding");
    });

    expect(success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("delete_preset", {
      name: "Dev Onboarding",
    });
  });

  it("deletePreset returns false on error", async () => {
    mockInvoke
      .mockResolvedValueOnce(samplePresets as never) // initial load
      .mockRejectedValueOnce(new Error("Not found") as never);

    const { result } = renderHook(() => usePresets(), { wrapper });

    await waitFor(() => {
      expect(result.current.presets).toHaveLength(2);
    });

    let success = true;
    await act(async () => {
      success = await result.current.deletePreset("Nonexistent");
    });

    expect(success).toBe(false);
  });

  it("reload re-fetches presets", async () => {
    mockInvoke
      .mockResolvedValueOnce([] as never) // initial load
      .mockResolvedValueOnce(samplePresets as never); // reload

    const { result } = renderHook(() => usePresets(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.presets).toEqual([]);

    await act(async () => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.presets).toEqual(samplePresets);
    });
  });
});
