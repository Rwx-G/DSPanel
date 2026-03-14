import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ComputerLookup } from "./ComputerLookup";
import type { DirectoryEntry } from "@/types/directory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock react-virtual to avoid needing real scroll container measurements
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: vi.fn(({ count, estimateSize, getItemKey }) => {
    const items = Array.from({ length: Math.min(count, 50) }, (_, i) => ({
      key: getItemKey ? getItemKey(i) : i,
      index: i,
      start: i * estimateSize(i),
      size: estimateSize(i),
    }));
    return {
      getTotalSize: () => count * estimateSize(0),
      getVirtualItems: () => items,
    };
  }),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function makeComputerEntry(
  name: string,
  attrs: Record<string, string[]> = {},
): DirectoryEntry {
  return {
    distinguishedName: `CN=${name},OU=Computers,DC=example,DC=com`,
    samAccountName: `${name}$`,
    displayName: name,
    objectClass: "computer",
    attributes: {
      dNSHostName: [`${name.toLowerCase()}.example.com`],
      operatingSystem: ["Windows 11 Enterprise"],
      operatingSystemVersion: ["10.0 (22631)"],
      userAccountControl: ["4096"],
      lastLogon: ["2026-03-12T08:00:00Z"],
      memberOf: ["CN=Domain Computers,CN=Users,DC=example,DC=com"],
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

function mockBrowseWith(entries: DirectoryEntry[]) {
  mockInvoke.mockImplementation(((cmd: string) => {
    if (cmd === "browse_computers") return Promise.resolve(makeBrowseResult(entries));
    if (cmd === "search_computers") return Promise.resolve(entries);
    if (cmd === "resolve_dns") return Promise.resolve(["10.0.0.1"]);
    return Promise.resolve(null);
  }) as typeof invoke);
}

describe("ComputerLookup", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("renders with search bar and loads computers on mount", async () => {
    const entries = [makeComputerEntry("WS001"), makeComputerEntry("WS002")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);
    expect(screen.getByTestId("computer-lookup")).toBeInTheDocument();
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });

    expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    expect(screen.getByTestId("computer-result-WS002")).toBeInTheDocument();
  });

  it("shows loading state during initial load", () => {
    mockInvoke.mockImplementation((() => new Promise(() => {})) as typeof invoke);
    render(<ComputerLookup />);
    expect(screen.getByTestId("computer-lookup-loading")).toBeInTheDocument();
  });

  it("shows error state on browse failure", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_computers") return Promise.reject(new Error("LDAP error"));
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-lookup-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Failed to load computers")).toBeInTheDocument();
  });

  it("shows retry button on error and retries", async () => {
    let callCount = 0;
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_computers") {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(makeBrowseResult([makeComputerEntry("WS001")]));
      }
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });
  });

  it("selects computer from results list on click", async () => {
    const entries = [makeComputerEntry("WS001"), makeComputerEntry("WS002")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-result-WS002")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("computer-result-WS002"));

    await waitFor(() => {
      expect(screen.getByTestId("computer-detail")).toBeInTheDocument();
    });
  });

  it("displays computer detail with property groups", async () => {
    const entries = [makeComputerEntry("WS001")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("computer-result-WS001"));

    await waitFor(() => {
      expect(screen.getByTestId("computer-detail")).toBeInTheDocument();
    });

    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByText("Network")).toBeInTheDocument();
  });

  it("calls browse_computers on mount", async () => {
    mockBrowseWith([]);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("browse_computers", {
        page: 0,
        pageSize: 50,
      });
    });
  });
});
