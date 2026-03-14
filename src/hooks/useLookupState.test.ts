import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useLookupState } from "./useLookupState";
import { type DirectoryEntry } from "@/types/directory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

function makeMockEntry(sam: string): DirectoryEntry {
  return {
    distinguishedName: `CN=${sam},DC=example,DC=com`,
    samAccountName: sam,
    displayName: null,
    objectClass: "user",
    attributes: {},
  };
}

const mapEntry = (entry: DirectoryEntry) => ({
  name: entry.samAccountName ?? "unknown",
});

describe("useLookupState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in initial state", () => {
    const { result } = renderHook(() =>
      useLookupState({ command: "search_users", mapEntry }),
    );

    expect(result.current.lookupState).toBe("initial");
    expect(result.current.searchResults).toEqual([]);
    expect(result.current.selectedItem).toBeNull();
    expect(result.current.searchValue).toBe("");
  });

  it("ignores empty queries", async () => {
    const { result } = renderHook(() =>
      useLookupState({ command: "search_users", mapEntry }),
    );

    await act(async () => {
      await result.current.handleSearch("   ");
    });

    expect(result.current.lookupState).toBe("initial");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("transitions to results on successful search", async () => {
    mockInvoke.mockResolvedValue([
      makeMockEntry("jdoe"),
      makeMockEntry("jsmith"),
    ]);

    const { result } = renderHook(() =>
      useLookupState({ command: "search_users", mapEntry }),
    );

    await act(async () => {
      await result.current.handleSearch("j");
    });

    expect(result.current.lookupState).toBe("results");
    expect(result.current.searchResults).toHaveLength(2);
    expect(mockInvoke).toHaveBeenCalledWith("search_users", { query: "j" });
  });

  it("auto-selects when single result", async () => {
    mockInvoke.mockResolvedValue([makeMockEntry("jdoe")]);

    const { result } = renderHook(() =>
      useLookupState({ command: "search_users", mapEntry }),
    );

    await act(async () => {
      await result.current.handleSearch("jdoe");
    });

    expect(result.current.selectedItem).toEqual({ name: "jdoe" });
  });

  it("transitions to empty when no results", async () => {
    mockInvoke.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useLookupState({ command: "search_users", mapEntry }),
    );

    await act(async () => {
      await result.current.handleSearch("nonexistent");
    });

    expect(result.current.lookupState).toBe("empty");
    expect(result.current.searchResults).toEqual([]);
  });

  it("transitions to error on failure", async () => {
    mockInvoke.mockRejectedValue(new Error("Connection refused"));

    const { result } = renderHook(() =>
      useLookupState({ command: "search_users", mapEntry }),
    );

    await act(async () => {
      await result.current.handleSearch("jdoe");
    });

    expect(result.current.lookupState).toBe("error");
    expect(result.current.errorMessage).toBe("Connection refused");
  });

  it("handles non-Error rejection", async () => {
    mockInvoke.mockRejectedValue("string error");

    const { result } = renderHook(() =>
      useLookupState({ command: "search_users", mapEntry }),
    );

    await act(async () => {
      await result.current.handleSearch("jdoe");
    });

    expect(result.current.lookupState).toBe("error");
    expect(result.current.errorMessage).toBe("Search failed");
  });

  it("retries the last query", async () => {
    mockInvoke.mockResolvedValue([makeMockEntry("jdoe")]);

    const { result } = renderHook(() =>
      useLookupState({ command: "search_users", mapEntry }),
    );

    await act(async () => {
      await result.current.handleSearch("jdoe");
    });

    mockInvoke.mockClear();
    mockInvoke.mockResolvedValue([makeMockEntry("jdoe")]);

    await act(async () => {
      result.current.handleRetry();
    });

    expect(mockInvoke).toHaveBeenCalledWith("search_users", { query: "jdoe" });
  });

  it("does nothing on retry without prior query", () => {
    const { result } = renderHook(() =>
      useLookupState({ command: "search_users", mapEntry }),
    );

    act(() => {
      result.current.handleRetry();
    });

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("updates searchValue", () => {
    const { result } = renderHook(() =>
      useLookupState({ command: "search_users", mapEntry }),
    );

    act(() => {
      result.current.setSearchValue("test");
    });

    expect(result.current.searchValue).toBe("test");
  });

  it("allows manual item selection", async () => {
    mockInvoke.mockResolvedValue([
      makeMockEntry("a"),
      makeMockEntry("b"),
    ]);

    const { result } = renderHook(() =>
      useLookupState({ command: "search_users", mapEntry }),
    );

    await act(async () => {
      await result.current.handleSearch("test");
    });

    act(() => {
      result.current.setSelectedItem({ name: "b" });
    });

    expect(result.current.selectedItem).toEqual({ name: "b" });
  });
});
