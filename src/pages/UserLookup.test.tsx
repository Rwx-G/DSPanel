import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UserLookup } from "./UserLookup";
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
    distinguishedName: `CN=${display},OU=Users,OU=Corp,DC=example,DC=com`,
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
      memberOf: [
        "CN=Domain Users,CN=Users,DC=example,DC=com",
        "CN=Developers,OU=Groups,DC=example,DC=com",
      ],
      badPwdCount: ["0"],
      whenCreated: ["2024-01-01T00:00:00Z"],
      whenChanged: ["2026-03-01T00:00:00Z"],
      ...attrs,
    },
  };
}

describe("UserLookup", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("renders initial state with search bar and empty state", () => {
    render(<UserLookup />);
    expect(screen.getByTestId("user-lookup")).toBeInTheDocument();
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();
    expect(screen.getByText("Search for a user")).toBeInTheDocument();
  });

  it("shows loading state during search", async () => {
    mockInvoke.mockImplementation(() => new Promise(() => {}));
    render(<UserLookup />);

    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "jdoe" } });

    await waitFor(() => {
      expect(screen.getByTestId("user-lookup-loading")).toBeInTheDocument();
    });
  });

  it("shows results after successful search", async () => {
    const entries = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("asmith", "Alice Smith"),
    ];
    mockInvoke.mockResolvedValue(entries);

    render(<UserLookup />);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "doe" } });

    await waitFor(() => {
      expect(screen.getByTestId("user-results-list")).toBeInTheDocument();
    });

    expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
    expect(screen.getByTestId("user-result-asmith")).toBeInTheDocument();
  });

  it("auto-selects user when only one result", async () => {
    const entries = [makeEntry("jdoe", "John Doe")];
    mockInvoke.mockResolvedValue(entries);

    render(<UserLookup />);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "jdoe" } });

    await waitFor(() => {
      expect(screen.getByTestId("user-detail")).toBeInTheDocument();
    });
  });

  it("shows empty state when no results", async () => {
    mockInvoke.mockResolvedValue([]);

    render(<UserLookup />);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "nobody" } });

    await waitFor(() => {
      expect(screen.getByText("No users found")).toBeInTheDocument();
    });
  });

  it("shows error state on search failure", async () => {
    mockInvoke.mockRejectedValue(new Error("LDAP connection failed"));

    render(<UserLookup />);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "test" } });

    await waitFor(() => {
      expect(screen.getByTestId("user-lookup-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Search failed")).toBeInTheDocument();
  });

  it("shows retry button on error and retries search", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("fail"));

    render(<UserLookup />);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "test" } });

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });

    const entries = [makeEntry("jdoe", "John Doe")];
    mockInvoke.mockResolvedValue(entries);
    fireEvent.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(screen.getByTestId("user-results-list")).toBeInTheDocument();
    });
  });

  it("selects user from results list on click", async () => {
    const entries = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("asmith", "Alice Smith"),
    ];
    mockInvoke.mockResolvedValue(entries);

    render(<UserLookup />);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "test" } });

    await waitFor(() => {
      expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("user-result-asmith"));

    await waitFor(() => {
      expect(screen.getByTestId("user-detail")).toBeInTheDocument();
    });

    const detail = screen.getByTestId("user-detail");
    expect(detail.querySelector("h2")).toHaveTextContent("Alice Smith");
  });

  it("displays user detail with property groups", async () => {
    const entries = [makeEntry("jdoe", "John Doe")];
    mockInvoke.mockResolvedValue(entries);

    render(<UserLookup />);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "jdoe" } });

    await waitFor(() => {
      expect(screen.getByTestId("user-detail")).toBeInTheDocument();
    });

    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByText("Account Status")).toBeInTheDocument();
    expect(screen.getByText("Authentication")).toBeInTheDocument();
    expect(screen.getByText("Dates")).toBeInTheDocument();
  });

  it("displays group memberships section", async () => {
    const entries = [makeEntry("jdoe", "John Doe")];
    mockInvoke.mockResolvedValue(entries);

    render(<UserLookup />);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "jdoe" } });

    await waitFor(() => {
      expect(screen.getByTestId("user-groups-section")).toBeInTheDocument();
    });

    expect(screen.getByText("Group Memberships (2)")).toBeInTheDocument();
    expect(screen.getByText("Domain Users")).toBeInTheDocument();
    expect(screen.getByText("Developers")).toBeInTheDocument();
  });

  it("shows health badges for enabled/disabled users in results list", async () => {
    const entries = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("disabled", "Disabled User", {
        userAccountControl: ["514"],
      }),
    ];
    mockInvoke.mockResolvedValue(entries);

    render(<UserLookup />);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "test" } });

    await waitFor(() => {
      expect(screen.getByTestId("user-results-list")).toBeInTheDocument();
    });

    const activeResult = screen.getByTestId("user-result-jdoe");
    const activeBadge = activeResult.querySelector(
      '[data-testid="health-badge"]',
    );
    expect(activeBadge).toHaveAttribute("data-level", "Healthy");

    const disabledResult = screen.getByTestId("user-result-disabled");
    const disabledBadge = disabledResult.querySelector(
      '[data-testid="health-badge"]',
    );
    expect(disabledBadge).toHaveAttribute("data-level", "Critical");
  });

  it("does not search with empty query", async () => {
    render(<UserLookup />);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "" } });

    await waitFor(() => {
      expect(screen.getByText("Search for a user")).toBeInTheDocument();
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("calls invoke with correct command and arguments", async () => {
    mockInvoke.mockResolvedValue([]);

    render(<UserLookup />);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "jdoe" } });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("search_users", {
        query: "jdoe",
      });
    });
  });
});
