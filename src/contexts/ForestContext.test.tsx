import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

type StatusHandler = (event: { payload: unknown }) => void;
let statusHandler: StatusHandler | null = null;
const unlistenSpy = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name: string, handler: StatusHandler) => {
    statusHandler = handler;
    return Promise.resolve(unlistenSpy);
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ForestProvider,
  useForest,
  FOREST_STATUS_EVENT,
} from "./ForestContext";
import type { ForestTopology } from "@/types/forest";

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);
const connectedRef = { value: false };

const singleDomain: ForestTopology = {
  partitions: [
    {
      distinguishedName: "DC=corp,DC=example,DC=com",
      dnsName: "corp.example.com",
      netbiosName: "CORP",
      defaultDcFqdn: "dc01.corp.example.com",
    },
  ],
};

const multiDomain: ForestTopology = {
  partitions: [
    ...singleDomain.partitions,
    {
      distinguishedName: "DC=eu,DC=corp,DC=example,DC=com",
      dnsName: "eu.corp.example.com",
      netbiosName: "CORPEU",
      defaultDcFqdn: null,
    },
  ],
};

function wrapperWith(connected: boolean) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ForestProvider connected={connected}>{children}</ForestProvider>;
  };
}

describe("useForest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusHandler = null;
    connectedRef.value = false;
  });

  it("throws when used outside ForestProvider", () => {
    expect(() => renderHook(() => useForest())).toThrow(
      "useForest must be used within ForestProvider",
    );
  });

  it("loads the topology once mounted and derives the single-domain flag", async () => {
    mockInvoke.mockResolvedValue(singleDomain as never);
    const { result } = renderHook(() => useForest(), {
      wrapper: wrapperWith(true),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockInvoke).toHaveBeenCalledWith("get_forest_topology");
    expect(result.current.forestTopology).toEqual(singleDomain);
    expect(result.current.isSingleDomainForest).toBe(true);
    expect(result.current.seedDnsName).toBe("corp.example.com");
    expect(result.current.partitionStatus).toEqual({
      "corp.example.com": { state: "connected" },
    });
  });

  it("reports a multi-domain forest with every partition connected by default", async () => {
    mockInvoke.mockResolvedValue(multiDomain as never);
    const { result } = renderHook(() => useForest(), {
      wrapper: wrapperWith(true),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isSingleDomainForest).toBe(false);
    expect(Object.keys(result.current.partitionStatus)).toEqual([
      "corp.example.com",
      "eu.corp.example.com",
    ]);
    expect(result.current.partitionStatus["eu.corp.example.com"]).toEqual({
      state: "connected",
    });
  });

  it("applies partition states pushed by the forest status event", async () => {
    mockInvoke.mockResolvedValue(multiDomain as never);
    const { result } = renderHook(() => useForest(), {
      wrapper: wrapperWith(true),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockListen).toHaveBeenCalledWith(
      FOREST_STATUS_EVENT,
      expect.any(Function),
    );

    act(() => {
      statusHandler?.({
        payload: {
          "eu.corp.example.com": { state: "unreachable", reason: "timeout" },
        },
      });
    });

    expect(result.current.partitionStatus["eu.corp.example.com"]).toEqual({
      state: "unreachable",
      reason: "timeout",
    });
    expect(result.current.partitionStatus["corp.example.com"]).toEqual({
      state: "connected",
    });
  });

  it("reads the topology only after the status subscription is armed", async () => {
    const arm: { fire: (() => void) | null } = { fire: null };
    mockListen.mockImplementationOnce((_name, handler) => {
      statusHandler = handler as unknown as StatusHandler;
      return new Promise((resolve) => {
        arm.fire = () => resolve(() => unlistenSpy());
      });
    });
    mockInvoke.mockResolvedValue(singleDomain as never);
    const { result } = renderHook(() => useForest(), {
      wrapper: wrapperWith(true),
    });

    expect(mockInvoke).not.toHaveBeenCalled();
    act(() => {
      arm.fire?.();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(result.current.seedDnsName).toBe("corp.example.com");
  });

  it("re-fetches the topology when the forest status event fires", async () => {
    mockInvoke.mockResolvedValue(singleDomain as never);
    const { result } = renderHook(() => useForest(), {
      wrapper: wrapperWith(true),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    mockInvoke.mockResolvedValue(multiDomain as never);
    act(() => {
      statusHandler?.({
        payload: { "eu.corp.example.com": { state: "connected" } },
      });
    });

    await waitFor(() =>
      expect(result.current.isSingleDomainForest).toBe(false),
    );
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("falls back to an empty topology when the command fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockInvoke.mockRejectedValue(new Error("not connected"));
    const { result } = renderHook(() => useForest(), {
      wrapper: wrapperWith(false),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.forestTopology.partitions).toEqual([]);
    expect(result.current.isSingleDomainForest).toBe(true);
    expect(result.current.seedDnsName).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("tolerates an undefined command result", async () => {
    mockInvoke.mockResolvedValue(undefined as never);
    const { result } = renderHook(() => useForest(), {
      wrapper: wrapperWith(false),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.forestTopology.partitions).toEqual([]);
  });

  it("re-fetches the topology when the connection flag flips", async () => {
    mockInvoke.mockResolvedValue(singleDomain as never);
    const { result, rerender } = renderHook(() => useForest(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ForestProvider connected={connectedRef.value}>
          {children}
        </ForestProvider>
      ),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    mockInvoke.mockResolvedValue(multiDomain as never);
    connectedRef.value = true;
    rerender();

    await waitFor(() =>
      expect(result.current.isSingleDomainForest).toBe(false),
    );
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("re-fetches on demand through refresh()", async () => {
    mockInvoke.mockResolvedValue(singleDomain as never);
    const { result } = renderHook(() => useForest(), {
      wrapper: wrapperWith(true),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockInvoke.mockResolvedValue(multiDomain as never);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.forestTopology).toEqual(multiDomain);
  });

  it("unsubscribes from the status event on unmount", async () => {
    mockInvoke.mockResolvedValue(singleDomain as never);
    const { unmount, result } = renderHook(() => useForest(), {
      wrapper: wrapperWith(true),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();
    await waitFor(() => expect(unlistenSpy).toHaveBeenCalled());
  });
});
