import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { useOUTree } from "./useOUTree";
import { NotificationProvider } from "@/contexts/NotificationContext";
import type { OUNode } from "@/components/form/OUPicker";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function wrapper({ children }: { children: ReactNode }) {
  return createElement(NotificationProvider, null, children);
}

const sampleNodes: OUNode[] = [
  {
    distinguishedName: "OU=Engineering,DC=example,DC=com",
    name: "Engineering",
    children: [],
  },
  {
    distinguishedName: "OU=Sales,DC=example,DC=com",
    name: "Sales",
    children: [],
  },
];

describe("useOUTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads OU tree on mount", async () => {
    mockInvoke.mockResolvedValueOnce(sampleNodes as never);

    const { result } = renderHook(() => useOUTree(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.nodes).toEqual(sampleNodes);
    expect(result.current.error).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith("get_ou_tree");
  });

  it("sets error on load failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("LDAP error") as never);

    const { result } = renderHook(() => useOUTree(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe(true);
    expect(result.current.nodes).toEqual([]);
  });

  it("reload re-fetches the OU tree", async () => {
    mockInvoke
      .mockResolvedValueOnce(sampleNodes as never)
      .mockResolvedValueOnce([
        {
          distinguishedName: "OU=HR,DC=example,DC=com",
          name: "HR",
          children: [],
        },
      ] as never);

    const { result } = renderHook(() => useOUTree(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.nodes).toEqual(sampleNodes);

    // Trigger reload
    result.current.reload();

    await waitFor(() => {
      expect(result.current.nodes).toHaveLength(1);
    });
    expect(result.current.nodes[0].name).toBe("HR");
  });

  it("returns loading true while fetching", () => {
    // Never resolve the promise so we stay in loading state
    mockInvoke.mockReturnValueOnce(new Promise(() => {}) as never);

    const { result } = renderHook(() => useOUTree(), { wrapper });

    expect(result.current.loading).toBe(true);
    expect(result.current.nodes).toEqual([]);
    expect(result.current.error).toBe(false);
  });
});
