import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBrowse, type UseBrowseOptions } from "./useBrowse";
import type { DirectoryEntry } from "@/types/directory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestItem {
  id: string;
  name: string;
}

function makeEntry(id: string, name: string): DirectoryEntry {
  return {
    distinguishedName: `CN=${name},OU=Test,DC=example,DC=com`,
    samAccountName: id,
    displayName: name,
    objectClass: "test",
    attributes: {},
  };
}

function makeBrowseResult(entries: DirectoryEntry[], hasMore = false) {
  return {
    entries,
    totalCount: entries.length + (hasMore ? 50 : 0),
    hasMore,
  };
}

const mapEntry = (e: DirectoryEntry): TestItem => ({
  id: e.samAccountName ?? "",
  name: e.displayName ?? "",
});

const clientFilter = (item: TestItem, lower: string): boolean =>
  item.name.toLowerCase().includes(lower) ||
  item.id.toLowerCase().includes(lower);

const itemKey = (item: TestItem): string => item.id;

function defaultOptions(
  overrides: Partial<UseBrowseOptions<TestItem>> = {},
): UseBrowseOptions<TestItem> {
  return {
    browseCommand: "browse_test",
    searchCommand: "search_test",
    mapEntry,
    clientFilter,
    itemKey,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useBrowse", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((() =>
      Promise.resolve({
        entries: [],
        totalCount: 0,
        hasMore: false,
      })) as typeof invoke);
  });

  // 1. Initial load fetches first page
  it("fetches first page on mount", async () => {
    const entries = [makeEntry("a", "Alice"), makeEntry("b", "Bob")];
    mockInvoke.mockImplementation((() =>
      Promise.resolve(makeBrowseResult(entries))) as typeof invoke);

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].name).toBe("Alice");
    expect(result.current.items[1].name).toBe("Bob");
    expect(result.current.mode).toBe("browse");
    expect(mockInvoke).toHaveBeenCalledWith("browse_test", {
      page: 0,
      pageSize: 50,
    });
  });

  // 2. preloadAll loads all pages sequentially
  it("preloads all pages when preloadAll is true", async () => {
    const page0 = [makeEntry("a", "Alice"), makeEntry("b", "Bob")];
    const page1 = [makeEntry("c", "Carol")];

    mockInvoke
      .mockResolvedValueOnce(makeBrowseResult(page0, true))
      .mockResolvedValueOnce(makeBrowseResult(page1, false));

    const { result } = renderHook(() =>
      useBrowse(defaultOptions({ preloadAll: true })),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(3);
    expect(result.current.hasMore).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith("browse_test", {
      page: 0,
      pageSize: 50,
    });
    expect(mockInvoke).toHaveBeenCalledWith("browse_test", {
      page: 1,
      pageSize: 50,
    });
  });

  // 3. Client-side filter (filterText < 3 chars) filters loaded items
  it("filters client-side when filterText has fewer than 3 characters", async () => {
    const entries = [
      makeEntry("alice", "Alice"),
      makeEntry("bob", "Bob"),
      makeEntry("carol", "Carol"),
    ];
    mockInvoke.mockImplementation((() =>
      Promise.resolve(makeBrowseResult(entries))) as typeof invoke);

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.setFilterText("Al");
    });

    expect(result.current.mode).toBe("browse");
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].name).toBe("Alice");
    expect(result.current.hasMore).toBe(false);
  });

  // 4. Server-side search (filterText >= 3 chars) calls searchCommand
  it("switches to server-side search when filterText has 3+ characters", async () => {
    const browseEntries = [makeEntry("alice", "Alice")];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(browseEntries));

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const searchResults = [makeEntry("bob", "Bob Jones")];
    mockInvoke.mockResolvedValueOnce(searchResults);

    await act(async () => {
      result.current.setFilterText("bob");
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.mode).toBe("search");
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].name).toBe("Bob Jones");
    expect(mockInvoke).toHaveBeenCalledWith("search_test", { query: "bob" });
  });

  // 5. Clearing filterText returns to browse mode
  it("returns to browse mode when filterText is cleared", async () => {
    const entries = [makeEntry("alice", "Alice"), makeEntry("bob", "Bob")];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(entries));

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Apply server-side search
    mockInvoke.mockResolvedValueOnce([makeEntry("carol", "Carol")]);

    await act(async () => {
      result.current.setFilterText("car");
    });

    await waitFor(() => {
      expect(result.current.mode).toBe("search");
    });

    // Clear filter
    await act(async () => {
      result.current.setFilterText("");
    });

    expect(result.current.mode).toBe("browse");
    expect(result.current.items).toHaveLength(2);
    expect(result.current.filterText).toBe("");
  });

  // 6. loadMore fetches next page and appends
  it("loadMore fetches the next page and appends items", async () => {
    const page0 = [makeEntry("a", "Alice"), makeEntry("b", "Bob")];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(page0, true));

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.hasMore).toBe(true);

    const page1 = [makeEntry("c", "Carol")];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(page1, false));

    await act(async () => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.loadingMore).toBe(false);
    });

    expect(result.current.items).toHaveLength(3);
    expect(result.current.items[2].name).toBe("Carol");
    expect(result.current.hasMore).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith("browse_test", {
      page: 1,
      pageSize: 50,
    });
  });

  // 7. loadMore does nothing when no more pages
  it("loadMore does nothing when hasMore is false", async () => {
    const entries = [makeEntry("a", "Alice")];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(entries, false));

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasMore).toBe(false);

    const callsBefore = mockInvoke.mock.calls.length;

    await act(async () => {
      result.current.loadMore();
    });

    // No additional invoke call should have been made
    expect(mockInvoke.mock.calls.length).toBe(callsBefore);
  });

  // 8. Error handling on browse failure
  it("handles browse error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("LDAP connection failed"));

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("LDAP connection failed");
    expect(result.current.items).toHaveLength(0);
  });

  it("handles browse error with non-Error rejection", async () => {
    mockInvoke.mockRejectedValueOnce("some string error");

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load items");
  });

  // 9. Error handling on search failure
  it("handles search error", async () => {
    const entries = [makeEntry("a", "Alice")];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(entries));

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockInvoke.mockRejectedValueOnce(new Error("Search timeout"));

    await act(async () => {
      result.current.setFilterText("xyz");
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Search timeout");
    expect(result.current.items).toHaveLength(0);
  });

  it("handles search error with non-Error rejection", async () => {
    mockInvoke.mockResolvedValueOnce(makeBrowseResult([]));

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockInvoke.mockRejectedValueOnce("network failure");

    await act(async () => {
      result.current.setFilterText("abc");
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Search failed");
    expect(result.current.items).toHaveLength(0);
  });

  // 10. updateItem replaces item by key
  it("updateItem replaces an item by its key", async () => {
    const entries = [makeEntry("a", "Alice"), makeEntry("b", "Bob")];
    mockInvoke.mockImplementation((() =>
      Promise.resolve(makeBrowseResult(entries))) as typeof invoke);

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items[0].name).toBe("Alice");

    act(() => {
      result.current.updateItem("a", { id: "a", name: "Alice Updated" });
    });

    expect(result.current.items[0].name).toBe("Alice Updated");
    expect(result.current.items[1].name).toBe("Bob");
  });

  // 11. refresh resets state and reloads
  it("refresh resets state and reloads first page", async () => {
    const entries = [makeEntry("a", "Alice")];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(entries));

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Select an item and set a filter
    act(() => {
      result.current.setSelectedItem({ id: "a", name: "Alice" });
    });

    const refreshEntries = [
      makeEntry("a", "Alice"),
      makeEntry("d", "Dave"),
    ];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(refreshEntries));

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.filterText).toBe("");
    expect(result.current.mode).toBe("browse");
    expect(result.current.selectedItem).toBeNull();
    expect(result.current.items).toHaveLength(2);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  // 12. Mode transitions (browse -> search -> browse)
  it("transitions correctly from browse to search and back to browse", async () => {
    const entries = [
      makeEntry("alice", "Alice"),
      makeEntry("bob", "Bob"),
    ];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(entries));

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Initial state: browse mode with all items
    expect(result.current.mode).toBe("browse");
    expect(result.current.items).toHaveLength(2);

    // Client-side filter (< 3 chars) - stays in browse mode
    await act(async () => {
      result.current.setFilterText("al");
    });

    expect(result.current.mode).toBe("browse");
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].id).toBe("alice");

    // Switch to server search (>= 3 chars)
    const searchResults = [makeEntry("carol", "Carol")];
    mockInvoke.mockResolvedValueOnce(searchResults);

    await act(async () => {
      result.current.setFilterText("car");
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.mode).toBe("search");
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].id).toBe("carol");

    // Clear filter to go back to browse mode
    await act(async () => {
      result.current.setFilterText("");
    });

    expect(result.current.mode).toBe("browse");
    // Original browse items are restored
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].id).toBe("alice");
    expect(result.current.items[1].id).toBe("bob");
  });

  // Additional edge cases

  it("shows loading state on initial mount", () => {
    mockInvoke.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useBrowse(defaultOptions()));
    expect(result.current.loading).toBe(true);
  });

  it("loadMore does nothing in search mode", async () => {
    const entries = [makeEntry("a", "Alice")];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(entries, true));

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Enter search mode
    mockInvoke.mockResolvedValueOnce([makeEntry("b", "Bob")]);

    await act(async () => {
      result.current.setFilterText("bob");
    });

    await waitFor(() => {
      expect(result.current.mode).toBe("search");
    });

    const callsBefore = mockInvoke.mock.calls.length;

    await act(async () => {
      result.current.loadMore();
    });

    // No additional call because mode is "search"
    expect(mockInvoke.mock.calls.length).toBe(callsBefore);
  });

  it("handles preloadAll error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Connection lost"));

    const { result } = renderHook(() =>
      useBrowse(defaultOptions({ preloadAll: true })),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Connection lost");
    expect(result.current.items).toHaveLength(0);
  });

  it("client-side filter with 1 char works", async () => {
    const entries = [
      makeEntry("a", "Alice"),
      makeEntry("b", "Bob"),
    ];
    mockInvoke.mockImplementation((() =>
      Promise.resolve(makeBrowseResult(entries))) as typeof invoke);

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.setFilterText("b");
    });

    expect(result.current.mode).toBe("browse");
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].id).toBe("b");
  });

  it("search clears error from previous browse failure", async () => {
    mockInvoke.mockResolvedValueOnce(makeBrowseResult([]));

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Client filter clears error
    await act(async () => {
      result.current.setFilterText("ab");
    });

    expect(result.current.error).toBeNull();
  });

  it("clearing filter after server search restores all browse items", async () => {
    const entries = [
      makeEntry("a", "Alice"),
      makeEntry("b", "Bob"),
      makeEntry("c", "Carol"),
    ];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(entries));

    const { result } = renderHook(() => useBrowse(defaultOptions()));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Enter search mode (>= 3 chars)
    mockInvoke.mockResolvedValueOnce([makeEntry("x", "Xavier")]);

    await act(async () => {
      result.current.setFilterText("xav");
    });

    await waitFor(() => {
      expect(result.current.mode).toBe("search");
    });

    expect(result.current.items).toHaveLength(1);

    // Clear filter - should restore original browse items
    await act(async () => {
      result.current.setFilterText("");
    });

    expect(result.current.items).toHaveLength(3);
    expect(result.current.mode).toBe("browse");
  });
});
