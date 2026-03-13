import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ComputerLookup } from "./ComputerLookup";
import type { DirectoryEntry } from "@/types/directory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
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

describe("ComputerLookup", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("renders initial state with search bar", () => {
    render(<ComputerLookup />);
    expect(screen.getByTestId("computer-lookup")).toBeInTheDocument();
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();
    expect(screen.getByText("Search for a computer")).toBeInTheDocument();
  });

  it("shows loading state during search", async () => {
    mockInvoke.mockImplementation(() => new Promise(() => {}));
    render(<ComputerLookup />);

    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "WS01" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("computer-lookup-loading")).toBeInTheDocument();
    });
  });

  it("shows results after successful search", async () => {
    const entries = [makeComputerEntry("WS001"), makeComputerEntry("WS002")];
    mockInvoke.mockResolvedValue(entries);

    render(<ComputerLookup />);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "WS" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });

    expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    expect(screen.getByTestId("computer-result-WS002")).toBeInTheDocument();
  });

  it("auto-selects computer when only one result", async () => {
    const entries = [makeComputerEntry("WS001")];
    mockInvoke
      .mockResolvedValueOnce(entries)
      .mockResolvedValueOnce(["192.168.1.10"]);

    render(<ComputerLookup />);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "WS001" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("computer-detail")).toBeInTheDocument();
    });
  });

  it("shows empty state when no results", async () => {
    mockInvoke.mockResolvedValue([]);

    render(<ComputerLookup />);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "NONEXISTENT" },
    });

    await waitFor(() => {
      expect(screen.getByText("No computers found")).toBeInTheDocument();
    });
  });

  it("shows error state on search failure", async () => {
    mockInvoke.mockRejectedValue(new Error("LDAP error"));

    render(<ComputerLookup />);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "test" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("computer-lookup-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Search failed")).toBeInTheDocument();
  });

  it("shows retry button on error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("fail"));

    render(<ComputerLookup />);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "test" },
    });

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });

    mockInvoke.mockResolvedValue([makeComputerEntry("WS001")]);
    fireEvent.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });
  });

  it("selects computer from results list on click", async () => {
    const entries = [makeComputerEntry("WS001"), makeComputerEntry("WS002")];
    mockInvoke.mockResolvedValueOnce(entries).mockResolvedValue(["10.0.0.1"]);

    render(<ComputerLookup />);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "WS" },
    });

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
    mockInvoke
      .mockResolvedValueOnce(entries)
      .mockResolvedValueOnce(["192.168.1.10"]);

    render(<ComputerLookup />);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "WS001" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("computer-detail")).toBeInTheDocument();
    });

    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByText("Network")).toBeInTheDocument();
  });

  it("displays group memberships section", async () => {
    const entries = [makeComputerEntry("WS001")];
    mockInvoke
      .mockResolvedValueOnce(entries)
      .mockResolvedValueOnce(["10.0.0.1"]);

    render(<ComputerLookup />);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "WS001" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("computer-groups-section")).toBeInTheDocument();
    });

    expect(screen.getByText("Group Memberships (1)")).toBeInTheDocument();
  });

  it("calls invoke with correct command and arguments", async () => {
    mockInvoke.mockResolvedValue([]);

    render(<ComputerLookup />);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "WS001" },
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("search_computers", {
        query: "WS001",
      });
    });
  });

  it("does not search with empty query", async () => {
    render(<ComputerLookup />);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "" },
    });

    await waitFor(() => {
      expect(screen.getByText("Search for a computer")).toBeInTheDocument();
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("renders ping button in detail view", async () => {
    const entries = [makeComputerEntry("WS001")];
    mockInvoke
      .mockResolvedValueOnce(entries)
      .mockResolvedValueOnce(["10.0.0.1"]);

    render(<ComputerLookup />);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "WS001" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("ping-button")).toBeInTheDocument();
    });
  });
});
