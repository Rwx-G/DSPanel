import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useComparison } from "./useComparison";
import type { DirectoryEntry } from "@/types/directory";
import type { GroupComparisonResult } from "@/types/comparison";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function makeEntry(sam: string): DirectoryEntry {
  return {
    distinguishedName: `CN=${sam},OU=Users,DC=example,DC=com`,
    samAccountName: sam,
    displayName: sam,
    objectClass: "user",
    attributes: {},
  };
}

const comparisonResult: GroupComparisonResult = {
  sharedGroups: ["CN=Shared,DC=example,DC=com"],
  onlyAGroups: ["CN=OnlyA,DC=example,DC=com"],
  onlyBGroups: ["CN=OnlyB,DC=example,DC=com"],
  totalA: 2,
  totalB: 2,
};

describe("useComparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- selectUserA ---

  it("selectUserA sets userA on success", async () => {
    const entry = makeEntry("alice");
    mockInvoke.mockResolvedValueOnce(entry as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.selectUserA("alice");
    });

    expect(result.current.userA).toEqual(entry);
    expect(result.current.error).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith("get_user", {
      samAccountName: "alice",
    });
  });

  it("selectUserA sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("network error") as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.selectUserA("alice");
    });

    expect(result.current.userA).toBeNull();
    expect(result.current.error).toBe(
      "Failed to load user A: Error: network error",
    );
  });

  it("selectUserA clears previous comparison result", async () => {
    const entryA = makeEntry("alice");
    const entryB = makeEntry("bob");
    mockInvoke
      .mockResolvedValueOnce(entryA as never)
      .mockResolvedValueOnce(entryB as never)
      .mockResolvedValueOnce(comparisonResult as never)
      .mockResolvedValueOnce(makeEntry("charlie") as never);

    const { result } = renderHook(() => useComparison());

    // Set up both users and compare
    await act(async () => {
      await result.current.selectUserA("alice");
    });
    await act(async () => {
      await result.current.selectUserB("bob");
    });
    await act(async () => {
      await result.current.compare();
    });
    expect(result.current.comparisonResult).not.toBeNull();

    // Selecting a new userA should clear the comparison
    await act(async () => {
      await result.current.selectUserA("charlie");
    });
    expect(result.current.comparisonResult).toBeNull();
  });

  // --- selectUserB ---

  it("selectUserB sets userB on success", async () => {
    const entry = makeEntry("bob");
    mockInvoke.mockResolvedValueOnce(entry as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.selectUserB("bob");
    });

    expect(result.current.userB).toEqual(entry);
    expect(result.current.error).toBeNull();
  });

  it("selectUserB sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("timeout") as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.selectUserB("bob");
    });

    expect(result.current.userB).toBeNull();
    expect(result.current.error).toBe("Failed to load user B: Error: timeout");
  });

  // --- compare ---

  it("compare sets error when users not selected", async () => {
    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.compare();
    });

    expect(result.current.error).toBe(
      "Please select both users before comparing.",
    );
    expect(result.current.comparisonResult).toBeNull();
  });

  it("compare sets error when only userA is selected", async () => {
    mockInvoke.mockResolvedValueOnce(makeEntry("alice") as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.selectUserA("alice");
    });
    await act(async () => {
      await result.current.compare();
    });

    expect(result.current.error).toBe(
      "Please select both users before comparing.",
    );
  });

  it("compare succeeds with both users selected", async () => {
    mockInvoke
      .mockResolvedValueOnce(makeEntry("alice") as never)
      .mockResolvedValueOnce(makeEntry("bob") as never)
      .mockResolvedValueOnce(comparisonResult as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.selectUserA("alice");
    });
    await act(async () => {
      await result.current.selectUserB("bob");
    });
    await act(async () => {
      await result.current.compare();
    });

    expect(result.current.comparisonResult).toEqual(comparisonResult);
    expect(result.current.isComparing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("compare sets error on invoke failure", async () => {
    mockInvoke
      .mockResolvedValueOnce(makeEntry("alice") as never)
      .mockResolvedValueOnce(makeEntry("bob") as never)
      .mockRejectedValueOnce(new Error("LDAP error") as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.selectUserA("alice");
    });
    await act(async () => {
      await result.current.selectUserB("bob");
    });
    await act(async () => {
      await result.current.compare();
    });

    expect(result.current.error).toBe("Comparison failed: Error: LDAP error");
    expect(result.current.isComparing).toBe(false);
  });

  // --- reset ---

  it("reset clears all state", async () => {
    mockInvoke
      .mockResolvedValueOnce(makeEntry("alice") as never)
      .mockResolvedValueOnce(makeEntry("bob") as never)
      .mockResolvedValueOnce(comparisonResult as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.selectUserA("alice");
    });
    await act(async () => {
      await result.current.selectUserB("bob");
    });
    await act(async () => {
      await result.current.compare();
    });
    act(() => {
      result.current.setFilter("test");
    });

    // Verify state is populated
    expect(result.current.userA).not.toBeNull();
    expect(result.current.userB).not.toBeNull();
    expect(result.current.comparisonResult).not.toBeNull();
    expect(result.current.filter).toBe("test");

    act(() => {
      result.current.reset();
    });

    expect(result.current.userA).toBeNull();
    expect(result.current.userB).toBeNull();
    expect(result.current.comparisonResult).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.filter).toBe("");
  });

  // --- filteredGroups ---

  it("filteredGroups returns empty when no comparison result", () => {
    const { result } = renderHook(() => useComparison());
    expect(result.current.filteredGroups).toEqual([]);
  });

  it("filteredGroups filters by text (case-insensitive)", async () => {
    mockInvoke
      .mockResolvedValueOnce(makeEntry("alice") as never)
      .mockResolvedValueOnce(makeEntry("bob") as never)
      .mockResolvedValueOnce(comparisonResult as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.selectUserA("alice");
    });
    await act(async () => {
      await result.current.selectUserB("bob");
    });
    await act(async () => {
      await result.current.compare();
    });

    // All 3 groups visible without filter
    expect(result.current.filteredGroups).toHaveLength(3);

    // Filter by "onlya" - should match OnlyA
    act(() => {
      result.current.setFilter("onlya");
    });
    expect(result.current.filteredGroups).toHaveLength(1);
    expect(result.current.filteredGroups[0].category).toBe("onlyA");
  });

  it("filteredGroups sorts by category", async () => {
    mockInvoke
      .mockResolvedValueOnce(makeEntry("alice") as never)
      .mockResolvedValueOnce(makeEntry("bob") as never)
      .mockResolvedValueOnce(comparisonResult as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.selectUserA("alice");
    });
    await act(async () => {
      await result.current.selectUserB("bob");
    });
    await act(async () => {
      await result.current.compare();
    });

    act(() => {
      result.current.setSortField("category");
    });

    const categories = result.current.filteredGroups.map((g) => g.category);
    expect(categories).toEqual(["shared", "onlyA", "onlyB"]);
  });

  it("filteredGroups sorts descending", async () => {
    mockInvoke
      .mockResolvedValueOnce(makeEntry("alice") as never)
      .mockResolvedValueOnce(makeEntry("bob") as never)
      .mockResolvedValueOnce(comparisonResult as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.selectUserA("alice");
    });
    await act(async () => {
      await result.current.selectUserB("bob");
    });
    await act(async () => {
      await result.current.compare();
    });

    act(() => {
      result.current.setSortDirection("desc");
    });

    const names = result.current.filteredGroups.map((g) => g.name);
    // Default sort is by name asc: OnlyA, OnlyB, Shared
    // desc should reverse: Shared, OnlyB, OnlyA
    expect(names).toEqual(["Shared", "OnlyB", "OnlyA"]);
  });

  it("filteredGroups sorts by category descending", async () => {
    mockInvoke
      .mockResolvedValueOnce(makeEntry("alice") as never)
      .mockResolvedValueOnce(makeEntry("bob") as never)
      .mockResolvedValueOnce(comparisonResult as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.selectUserA("alice");
    });
    await act(async () => {
      await result.current.selectUserB("bob");
    });
    await act(async () => {
      await result.current.compare();
    });

    act(() => {
      result.current.setSortField("category");
      result.current.setSortDirection("desc");
    });

    const categories = result.current.filteredGroups.map((g) => g.category);
    expect(categories).toEqual(["onlyB", "onlyA", "shared"]);
  });

  // --- prefill ---

  it("prefill loads both users and compares", async () => {
    const entryA = makeEntry("alice");
    const entryB = makeEntry("bob");
    mockInvoke
      .mockResolvedValueOnce([entryA] as never) // search_users alice
      .mockResolvedValueOnce([entryB] as never) // search_users bob
      .mockResolvedValueOnce(comparisonResult as never); // compare_users

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.prefill("alice", "bob");
    });

    expect(result.current.userA).toEqual(entryA);
    expect(result.current.userB).toEqual(entryB);
    expect(result.current.comparisonResult).toEqual(comparisonResult);
    expect(result.current.error).toBeNull();
  });

  it("prefill sets error when user A not found", async () => {
    const entryB = makeEntry("bob");
    mockInvoke
      .mockResolvedValueOnce([] as never) // search_users alice - empty
      .mockResolvedValueOnce([entryB] as never); // search_users bob

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.prefill("alice", "bob");
    });

    expect(result.current.error).toBe("User not found: alice");
  });

  it("prefill sets error when user B not found", async () => {
    const entryA = makeEntry("alice");
    mockInvoke
      .mockResolvedValueOnce([entryA] as never)
      .mockResolvedValueOnce([] as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.prefill("alice", "bob");
    });

    expect(result.current.error).toBe("User not found: bob");
  });

  it("prefill sets error when both users not found", async () => {
    mockInvoke
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.prefill("alice", "bob");
    });

    expect(result.current.error).toBe("User not found: alice, bob");
  });

  it("prefill sets error on search_users invoke failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("LDAP down") as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.prefill("alice", "bob");
    });

    expect(result.current.error).toBe("Failed to load users: Error: LDAP down");
  });

  it("prefill sets error when comparison invoke fails", async () => {
    const entryA = makeEntry("alice");
    const entryB = makeEntry("bob");
    mockInvoke
      .mockResolvedValueOnce([entryA] as never)
      .mockResolvedValueOnce([entryB] as never)
      .mockRejectedValueOnce(new Error("compare fail") as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.prefill("alice", "bob");
    });

    expect(result.current.error).toBe("Comparison failed: Error: compare fail");
    expect(result.current.isComparing).toBe(false);
  });

  it("prefill uses first result when exact match not found", async () => {
    // The search returns an entry whose samAccountName does not match the query
    const fallbackEntry = makeEntry("alice.smith");
    mockInvoke
      .mockResolvedValueOnce([fallbackEntry] as never)
      .mockResolvedValueOnce([] as never);

    const { result } = renderHook(() => useComparison());
    await act(async () => {
      await result.current.prefill("alice", "bob");
    });

    // userA should be the fallback (first result), but no samAccountName match
    // entryA has samAccountName "alice.smith", entryB is null (empty array)
    // Since entryA has samAccountName but entryB is null, error is set
    expect(result.current.userA).toEqual(fallbackEntry);
    expect(result.current.error).toBe("User not found: bob");
  });
});
