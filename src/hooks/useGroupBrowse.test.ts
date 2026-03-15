import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useGroupBrowse } from "./useGroupBrowse";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("useGroupBrowse", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((() =>
      Promise.resolve({
        entries: [],
        totalCount: 0,
        hasMore: false,
      })) as typeof invoke);
  });

  it("returns the expected interface", async () => {
    const { result } = renderHook(() => useGroupBrowse());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current).toHaveProperty("items");
    expect(result.current).toHaveProperty("loading");
    expect(result.current).toHaveProperty("error");
    expect(result.current).toHaveProperty("hasMore");
    expect(result.current).toHaveProperty("filterText");
    expect(result.current).toHaveProperty("setFilterText");
    expect(result.current).toHaveProperty("loadMore");
    expect(result.current).toHaveProperty("selectedItem");
    expect(result.current).toHaveProperty("setSelectedItem");
    expect(result.current).toHaveProperty("refresh");
  });

  it("calls browse_groups on mount", async () => {
    renderHook(() => useGroupBrowse());

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("browse_groups", {
        page: 0,
        pageSize: 50,
      });
    });
  });
});
