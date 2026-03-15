import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useGroupBrowse } from "./useGroupBrowse";
import type { DirectoryEntry } from "@/types/directory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function makeGroupEntry(
  name: string,
  description = "desc",
): DirectoryEntry {
  return {
    distinguishedName: `CN=${name},OU=Groups,DC=example,DC=com`,
    samAccountName: name.toLowerCase(),
    displayName: name,
    objectClass: "group",
    attributes: {
      groupType: ["-2147483646"],
      description: [description],
    },
  };
}

function makeBrowseResult(entries: DirectoryEntry[], hasMore = false) {
  return {
    entries,
    totalCount: entries.length + (hasMore ? 50 : 0),
    hasMore,
  };
}

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

  describe("clientFilter", () => {
    it("filters by displayName", async () => {
      const entries = [
        makeGroupEntry("Developers", "Coding team"),
        makeGroupEntry("Finance", "Money team"),
      ];
      mockInvoke.mockImplementation((() =>
        Promise.resolve(makeBrowseResult(entries))) as typeof invoke);

      const { result } = renderHook(() => useGroupBrowse());

      await waitFor(() => {
        expect(result.current.items).toHaveLength(2);
      });

      // Type less than 3 chars to trigger client-side filter
      await act(async () => {
        result.current.setFilterText("De");
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0].displayName).toBe("Developers");
      });
    });

    it("filters by samAccountName", async () => {
      const entries = [
        makeGroupEntry("Developers", "Coding team"),
        makeGroupEntry("Finance", "Money team"),
      ];
      mockInvoke.mockImplementation((() =>
        Promise.resolve(makeBrowseResult(entries))) as typeof invoke);

      const { result } = renderHook(() => useGroupBrowse());

      await waitFor(() => {
        expect(result.current.items).toHaveLength(2);
      });

      await act(async () => {
        result.current.setFilterText("fi");
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0].samAccountName).toBe("finance");
      });
    });

    it("filters by description", async () => {
      const entries = [
        makeGroupEntry("TeamA", "Backend engineers"),
        makeGroupEntry("TeamB", "Frontend artists"),
      ];
      mockInvoke.mockImplementation((() =>
        Promise.resolve(makeBrowseResult(entries))) as typeof invoke);

      const { result } = renderHook(() => useGroupBrowse());

      await waitFor(() => {
        expect(result.current.items).toHaveLength(2);
      });

      await act(async () => {
        result.current.setFilterText("Ba");
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0].displayName).toBe("TeamA");
      });
    });

    it("filters case-insensitively", async () => {
      const entries = [
        makeGroupEntry("Developers", "Coding team"),
        makeGroupEntry("Finance", "Money team"),
      ];
      mockInvoke.mockImplementation((() =>
        Promise.resolve(makeBrowseResult(entries))) as typeof invoke);

      const { result } = renderHook(() => useGroupBrowse());

      await waitFor(() => {
        expect(result.current.items).toHaveLength(2);
      });

      await act(async () => {
        result.current.setFilterText("Co");
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0].displayName).toBe("Developers");
      });
    });
  });
});
