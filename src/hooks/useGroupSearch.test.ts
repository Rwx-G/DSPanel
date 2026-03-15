import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGroupSearch } from "./useGroupSearch";
import type { DirectoryEntry } from "@/types/directory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function makeGroupEntry(
  dn: string,
  displayName: string | null = null,
  description?: string,
): DirectoryEntry {
  return {
    distinguishedName: dn,
    samAccountName: null,
    displayName,
    objectClass: "group",
    attributes: description ? { description: [description] } : {},
  };
}

describe("useGroupSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a search function", () => {
    const { result } = renderHook(() => useGroupSearch());
    expect(typeof result.current).toBe("function");
  });

  it("invokes search_groups and maps results with displayName", async () => {
    const entries: DirectoryEntry[] = [
      makeGroupEntry(
        "CN=Admins,OU=Groups,DC=example,DC=com",
        "Administrators",
        "Admin group",
      ),
    ];
    mockInvoke.mockResolvedValueOnce(entries as never);

    const { result } = renderHook(() => useGroupSearch());
    let options: Awaited<ReturnType<typeof result.current>> = [];
    await act(async () => {
      options = await result.current("admin");
    });

    expect(mockInvoke).toHaveBeenCalledWith("search_groups", {
      query: "admin",
    });
    expect(options).toHaveLength(1);
    expect(options[0]).toEqual({
      distinguishedName: "CN=Admins,OU=Groups,DC=example,DC=com",
      name: "Administrators",
      description: "Admin group",
    });
  });

  it("falls back to CN from DN when displayName is null", async () => {
    const entries: DirectoryEntry[] = [
      makeGroupEntry("CN=Domain Users,OU=Groups,DC=example,DC=com"),
    ];
    mockInvoke.mockResolvedValueOnce(entries as never);

    const { result } = renderHook(() => useGroupSearch());
    let options: Awaited<ReturnType<typeof result.current>> = [];
    await act(async () => {
      options = await result.current("domain");
    });

    expect(options[0].name).toBe("Domain Users");
  });

  it("returns empty array when no results", async () => {
    mockInvoke.mockResolvedValueOnce([] as never);

    const { result } = renderHook(() => useGroupSearch());
    let options: Awaited<ReturnType<typeof result.current>> = [];
    await act(async () => {
      options = await result.current("nonexistent");
    });

    expect(options).toEqual([]);
  });

  it("sets description to undefined when not present", async () => {
    const entries: DirectoryEntry[] = [
      makeGroupEntry("CN=TestGroup,DC=example,DC=com", "TestGroup"),
    ];
    mockInvoke.mockResolvedValueOnce(entries as never);

    const { result } = renderHook(() => useGroupSearch());
    let options: Awaited<ReturnType<typeof result.current>> = [];
    await act(async () => {
      options = await result.current("test");
    });

    expect(options[0].description).toBeUndefined();
  });
});
