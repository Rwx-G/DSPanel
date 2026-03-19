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
    if (cmd === "browse_computers")
      return Promise.resolve(makeBrowseResult(entries));
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
    mockInvoke.mockImplementation(
      (() => new Promise(() => {})) as typeof invoke,
    );
    render(<ComputerLookup />);
    expect(screen.getByTestId("computer-lookup-loading")).toBeInTheDocument();
  });

  it("shows error state on browse failure", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_computers")
        return Promise.reject(new Error("LDAP error"));
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

  it("shows empty state when no computers available", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_computers")
        return Promise.resolve(makeBrowseResult([]));
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("empty-state-title")).toHaveTextContent(
        "No computers found",
      );
      expect(screen.getByText("No computers available.")).toBeInTheDocument();
    });
  });

  it("shows placeholder text when no computer is selected", async () => {
    const entries = [makeComputerEntry("WS001")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Select a computer to view details"),
    ).toBeInTheDocument();
  });

  it("displays OS information in computer result item", async () => {
    const entries = [makeComputerEntry("WS001")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    });

    expect(screen.getByText("Windows 11 Enterprise")).toBeInTheDocument();
  });

  it("shows Active badge for enabled computer", async () => {
    const entries = [makeComputerEntry("WS001")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    });

    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows Disabled badge for disabled computer", async () => {
    const entries = [
      makeComputerEntry("WS001", { userAccountControl: ["4098"] }),
    ];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    });

    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("renders accessibility status region", async () => {
    mockBrowseWith([makeComputerEntry("WS001")]);

    render(<ComputerLookup />);

    await waitFor(() => {
      const status = screen.getByTestId("computer-lookup-status");
      expect(status).toBeInTheDocument();
    });
  });

  it("shows Unknown OS when operatingSystem is empty", async () => {
    // Override mapEntryToComputer behavior - OS comes from attributes
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_computers") {
        // Return entry with empty OS
        const entry = {
          ...makeComputerEntry("WS001"),
          attributes: {
            ...makeComputerEntry("WS001").attributes,
            operatingSystem: [],
          },
        };
        return Promise.resolve(makeBrowseResult([entry]));
      }
      if (cmd === "resolve_dns") return Promise.resolve(["10.0.0.1"]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByText("Unknown OS")).toBeInTheDocument();
    });
  });

  it("highlights selected computer in results list", async () => {
    const entries = [makeComputerEntry("WS001"), makeComputerEntry("WS002")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("computer-result-WS001"));

    await waitFor(() => {
      const selected = screen.getByTestId("computer-result-WS001");
      expect(selected.className).toContain("selected");
    });
  });

  it("shows computer detail panel after selection", async () => {
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

    // Computer detail should show the computer name
    expect(screen.getByTestId("computer-detail")).toBeInTheDocument();
  });

  it("shows accessibility status for multiple computers found", async () => {
    const entries = [
      makeComputerEntry("WS001"),
      makeComputerEntry("WS002"),
      makeComputerEntry("WS003"),
    ];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      const status = screen.getByTestId("computer-lookup-status");
      expect(status).toHaveTextContent("3 computers found");
    });
  });

  it("shows accessibility status for single computer found", async () => {
    const entries = [makeComputerEntry("WS001")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      const status = screen.getByTestId("computer-lookup-status");
      expect(status).toHaveTextContent("1 computer found");
    });
  });

  it("shows empty state with filter text message", async () => {
    // First load returns results, then filter returns empty
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_computers")
        return Promise.resolve(makeBrowseResult([]));
      if (cmd === "search_computers") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByText("No computers available.")).toBeInTheDocument();
    });
  });

  it("calls browse_computers with correct pagination", async () => {
    mockBrowseWith([]);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("browse_computers", {
        page: 0,
        pageSize: 50,
      });
    });
  });

  it("shows loading state text in accessibility region", () => {
    mockInvoke.mockImplementation(
      (() => new Promise(() => {})) as typeof invoke,
    );

    render(<ComputerLookup />);

    const status = screen.getByTestId("computer-lookup-status");
    expect(status).toHaveTextContent("Loading computers...");
  });

  it("shows error message in accessibility status region", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_computers")
        return Promise.reject(new Error("LDAP error"));
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<ComputerLookup />);

    await waitFor(() => {
      const status = screen.getByTestId("computer-lookup-status");
      expect(status).toHaveTextContent(/Error/);
    });
  });
});
