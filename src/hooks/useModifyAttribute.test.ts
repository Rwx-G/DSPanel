import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { useModifyAttribute } from "./useModifyAttribute";
import { NotificationProvider } from "@/contexts/NotificationContext";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function wrapper({ children }: { children: ReactNode }) {
  return createElement(NotificationProvider, null, children);
}

describe("useModifyAttribute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts with no pending changes", () => {
    const { result } = renderHook(() => useModifyAttribute(), { wrapper });
    expect(result.current.pendingChanges).toEqual([]);
    expect(result.current.saving).toBe(false);
  });

  it("stages a change", () => {
    const { result } = renderHook(() => useModifyAttribute(), { wrapper });

    act(() => {
      result.current.stageChange("department", "IT", "Engineering");
    });

    expect(result.current.pendingChanges).toHaveLength(1);
    expect(result.current.pendingChanges[0]).toEqual({
      attributeName: "department",
      oldValue: "IT",
      newValue: "Engineering",
    });
  });

  it("replaces existing staged change for same attribute", () => {
    const { result } = renderHook(() => useModifyAttribute(), { wrapper });

    act(() => {
      result.current.stageChange("department", "IT", "Engineering");
      result.current.stageChange("department", "IT", "Sales");
    });

    expect(result.current.pendingChanges).toHaveLength(1);
    expect(result.current.pendingChanges[0].newValue).toBe("Sales");
  });

  it("does not stage when old equals new", () => {
    const { result } = renderHook(() => useModifyAttribute(), { wrapper });

    act(() => {
      result.current.stageChange("department", "IT", "IT");
    });

    expect(result.current.pendingChanges).toHaveLength(0);
  });

  it("unstages a change", () => {
    const { result } = renderHook(() => useModifyAttribute(), { wrapper });

    act(() => {
      result.current.stageChange("department", "IT", "Engineering");
      result.current.stageChange("title", "Dev", "Senior Dev");
    });

    expect(result.current.pendingChanges).toHaveLength(2);

    act(() => {
      result.current.unstageChange("department");
    });

    expect(result.current.pendingChanges).toHaveLength(1);
    expect(result.current.pendingChanges[0].attributeName).toBe("title");
  });

  it("clears all changes", () => {
    const { result } = renderHook(() => useModifyAttribute(), { wrapper });

    act(() => {
      result.current.stageChange("department", "IT", "Engineering");
      result.current.stageChange("title", "Dev", "Senior Dev");
    });

    act(() => {
      result.current.clearChanges();
    });

    expect(result.current.pendingChanges).toHaveLength(0);
  });

  it("submits changes successfully", async () => {
    mockInvoke.mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useModifyAttribute(), { wrapper });

    act(() => {
      result.current.stageChange("department", "IT", "Engineering");
    });

    let success = false;
    await act(async () => {
      success = await result.current.submitChanges(
        "CN=User,DC=example,DC=com",
      );
    });

    expect(success).toBe(true);
    expect(result.current.pendingChanges).toHaveLength(0);
    expect(mockInvoke).toHaveBeenCalledWith("modify_attribute", {
      dn: "CN=User,DC=example,DC=com",
      attributeName: "department",
      values: ["Engineering"],
    });
  });

  it("handles submit failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Permission denied") as never);

    const { result } = renderHook(() => useModifyAttribute(), { wrapper });

    act(() => {
      result.current.stageChange("department", "IT", "Engineering");
    });

    let success = true;
    await act(async () => {
      success = await result.current.submitChanges(
        "CN=User,DC=example,DC=com",
      );
    });

    expect(success).toBe(false);
  });

  it("returns true when submitting with no changes", async () => {
    const { result } = renderHook(() => useModifyAttribute(), { wrapper });

    let success = false;
    await act(async () => {
      success = await result.current.submitChanges(
        "CN=User,DC=example,DC=com",
      );
    });

    expect(success).toBe(true);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("sends empty values array when clearing an attribute", async () => {
    mockInvoke.mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useModifyAttribute(), { wrapper });

    act(() => {
      result.current.stageChange("department", "IT", "");
    });

    await act(async () => {
      await result.current.submitChanges("CN=User,DC=example,DC=com");
    });

    expect(mockInvoke).toHaveBeenCalledWith("modify_attribute", {
      dn: "CN=User,DC=example,DC=com",
      attributeName: "department",
      values: [],
    });
  });
});
