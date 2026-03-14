import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useUserBrowse } from "./useUserBrowse";
import type { DirectoryEntry } from "@/types/directory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function makeEntry(
  sam: string,
  display: string,
  attrs: Record<string, string[]> = {},
): DirectoryEntry {
  return {
    distinguishedName: `CN=${display},OU=Users,DC=example,DC=com`,
    samAccountName: sam,
    displayName: display,
    objectClass: "user",
    attributes: {
      givenName: [display.split(" ")[0]],
      sn: [display.split(" ")[1] ?? ""],
      mail: [`${sam}@example.com`],
      department: ["IT"],
      title: ["Engineer"],
      userAccountControl: ["512"],
      lockoutTime: ["0"],
      lastLogon: ["2026-03-12T08:00:00Z"],
      pwdLastSet: ["2026-02-01T10:00:00Z"],
      memberOf: ["CN=Domain Users,CN=Users,DC=example,DC=com"],
      badPwdCount: ["0"],
      whenCreated: ["2024-01-01T00:00:00Z"],
      whenChanged: ["2026-03-01T00:00:00Z"],
      ...attrs,
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

describe("useUserBrowse", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("loads first page on mount", async () => {
    const entries = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("asmith", "Alice Smith"),
    ];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(entries));

    const { result } = renderHook(() => useUserBrowse());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.mode).toBe("browse");
    expect(mockInvoke).toHaveBeenCalledWith("browse_users", {
      page: 0,
      pageSize: 50,
    });
  });

  it("shows loading state initially", () => {
    mockInvoke.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useUserBrowse());
    expect(result.current.loading).toBe(true);
  });

  it("handles browse error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("LDAP failed"));

    const { result } = renderHook(() => useUserBrowse());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("LDAP failed");
    expect(result.current.items).toHaveLength(0);
  });

  it("loads more pages in browse mode", async () => {
    const page0 = [makeEntry("a", "Alice"), makeEntry("b", "Bob")];
    const page1 = [makeEntry("c", "Carol")];

    mockInvoke.mockResolvedValueOnce(makeBrowseResult(page0, true));

    const { result } = renderHook(() => useUserBrowse());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasMore).toBe(true);
    expect(result.current.items).toHaveLength(2);

    mockInvoke.mockResolvedValueOnce(makeBrowseResult(page1, false));

    await act(async () => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.loadingMore).toBe(false);
    });

    expect(result.current.items).toHaveLength(3);
    expect(result.current.hasMore).toBe(false);
  });

  it("filters client-side with 1-2 char filter", async () => {
    const entries = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("asmith", "Alice Smith"),
      makeEntry("bw", "Bob Wilson"),
    ];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(entries));

    const { result } = renderHook(() => useUserBrowse());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.setFilterText("jo");
    });

    expect(result.current.mode).toBe("browse");
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].samAccountName).toBe("jdoe");
  });

  it("switches to server search with 3+ char filter", async () => {
    const browseEntries = [makeEntry("jdoe", "John Doe")];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(browseEntries));

    const { result } = renderHook(() => useUserBrowse());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const searchResults = [makeEntry("asmith", "Alice Smith")];
    mockInvoke.mockResolvedValueOnce(searchResults);

    await act(async () => {
      result.current.setFilterText("ali");
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.mode).toBe("search");
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].samAccountName).toBe("asmith");
    expect(mockInvoke).toHaveBeenCalledWith("search_users", { query: "ali" });
  });

  it("returns to browse mode when filter cleared", async () => {
    const entries = [makeEntry("jdoe", "John Doe")];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(entries));

    const { result } = renderHook(() => useUserBrowse());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Apply then clear filter
    await act(async () => {
      result.current.setFilterText("jo");
    });

    await act(async () => {
      result.current.setFilterText("");
    });

    expect(result.current.mode).toBe("browse");
    expect(result.current.items).toHaveLength(1);
  });

  it("auto-selects when search returns single result", async () => {
    const browseEntries = [makeEntry("a", "Alice"), makeEntry("b", "Bob")];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(browseEntries));

    const { result } = renderHook(() => useUserBrowse());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockInvoke.mockResolvedValueOnce([makeEntry("jdoe", "John Doe")]);

    await act(async () => {
      result.current.setFilterText("jdoe");
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.selectedItem).not.toBeNull();
    expect(result.current.selectedItem?.samAccountName).toBe("jdoe");
  });

  it("refresh resets state and reloads", async () => {
    const entries = [makeEntry("jdoe", "John Doe")];
    mockInvoke.mockResolvedValueOnce(makeBrowseResult(entries));

    const { result } = renderHook(() => useUserBrowse());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockInvoke.mockResolvedValueOnce(makeBrowseResult(entries));

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.filterText).toBe("");
    expect(result.current.mode).toBe("browse");
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});
