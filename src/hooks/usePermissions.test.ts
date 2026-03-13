import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePermissions } from "./usePermissions";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockedInvoke = vi.mocked(invoke);

describe("usePermissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should default to ReadOnly while loading", () => {
    mockedInvoke.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => usePermissions());
    expect(result.current.level).toBe("ReadOnly");
    expect(result.current.loading).toBe(true);
  });

  it("should fetch permission level from backend", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_permission_level") return Promise.resolve("HelpDesk");
      if (cmd === "get_user_groups")
        return Promise.resolve(["DSPanel-HelpDesk"]);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => usePermissions());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.level).toBe("HelpDesk");
    expect(result.current.groups).toEqual(["DSPanel-HelpDesk"]);
  });

  it("should default to ReadOnly on error", async () => {
    mockedInvoke.mockRejectedValue(new Error("backend not available"));

    const { result } = renderHook(() => usePermissions());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.level).toBe("ReadOnly");
    expect(result.current.groups).toEqual([]);
  });

  it("should provide hasPermission function", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_permission_level")
        return Promise.resolve("AccountOperator");
      if (cmd === "get_user_groups")
        return Promise.resolve(["DSPanel-AccountOps"]);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => usePermissions());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasPermission("ReadOnly")).toBe(true);
    expect(result.current.hasPermission("HelpDesk")).toBe(true);
    expect(result.current.hasPermission("AccountOperator")).toBe(true);
    expect(result.current.hasPermission("DomainAdmin")).toBe(false);
  });

  it("should provide hasPermission for DomainAdmin level", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_permission_level")
        return Promise.resolve("DomainAdmin");
      if (cmd === "get_user_groups")
        return Promise.resolve(["Domain Admins"]);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => usePermissions());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasPermission("ReadOnly")).toBe(true);
    expect(result.current.hasPermission("HelpDesk")).toBe(true);
    expect(result.current.hasPermission("AccountOperator")).toBe(true);
    expect(result.current.hasPermission("DomainAdmin")).toBe(true);
  });
});
