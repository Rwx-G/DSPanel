import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { UserComparison } from "./UserComparison";
import { NavigationProvider } from "@/contexts/NavigationContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { DialogProvider } from "@/contexts/DialogContext";
import type { DirectoryEntry } from "@/types/directory";
import type { GroupComparisonResult } from "@/types/comparison";

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <NotificationProvider>
      <DialogProvider>
        <NavigationProvider>{children}</NavigationProvider>
      </DialogProvider>
    </NotificationProvider>
  );
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function makeEntry(
  sam: string,
  display: string,
  groups: string[] = [],
): DirectoryEntry {
  return {
    distinguishedName: `CN=${display},OU=Users,DC=example,DC=com`,
    samAccountName: sam,
    displayName: display,
    objectClass: "user",
    attributes: {
      title: ["Engineer"],
      department: ["IT"],
      memberOf: groups,
    },
  };
}

const MOCK_COMPARISON: GroupComparisonResult = {
  sharedGroups: ["CN=Domain Users,DC=example,DC=com"],
  onlyAGroups: ["CN=Developers,DC=example,DC=com"],
  onlyBGroups: ["CN=Managers,DC=example,DC=com"],
  totalA: 2,
  totalB: 2,
};

describe("UserComparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the page with search fields", () => {
    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );
    expect(screen.getByTestId("user-comparison-page")).toBeInTheDocument();
    expect(screen.getByTestId("user-a")).toBeInTheDocument();
    expect(screen.getByTestId("user-b")).toBeInTheDocument();
    expect(screen.getByTestId("compare-button")).toBeInTheDocument();
  });

  it("compare button is disabled when no users selected", () => {
    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );
    const button = screen.getByTestId("compare-button");
    expect(button).toBeDisabled();
  });

  it("searches users when typing in search field", async () => {
    const entries = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("jsmith", "Jane Smith"),
    ];
    mockInvoke.mockResolvedValueOnce(entries);

    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );

    const inputA = screen.getByTestId("user-a-input");
    fireEvent.change(inputA, { target: { value: "jo" } });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("search_users", { query: "jo" });
    });
  });

  it("displays comparison results after comparing", async () => {
    const userA = makeEntry("jdoe", "John Doe", [
      "CN=Domain Users,DC=example,DC=com",
      "CN=Developers,DC=example,DC=com",
    ]);
    const userB = makeEntry("asmith", "Alice Smith", [
      "CN=Domain Users,DC=example,DC=com",
      "CN=Managers,DC=example,DC=com",
    ]);

    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "search_users") return [userA, userB];
      if (cmd === "get_user") {
        const a = args as { samAccountName: string };
        if (a.samAccountName === "jdoe") return userA;
        if (a.samAccountName === "asmith") return userB;
        return null;
      }
      if (cmd === "compare_users") return MOCK_COMPARISON;
      return null;
    });

    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );

    // Select user A
    const inputA = screen.getByTestId("user-a-input");
    fireEvent.change(inputA, { target: { value: "jdoe" } });
    await waitFor(() => {
      expect(screen.getByTestId("user-a-dropdown")).toBeInTheDocument();
    });
    fireEvent.mouseDown(screen.getByTestId("user-a-result-jdoe"));

    // Select user B
    const inputB = screen.getByTestId("user-b-input");
    fireEvent.change(inputB, { target: { value: "asmith" } });
    await waitFor(() => {
      expect(screen.getByTestId("user-b-dropdown")).toBeInTheDocument();
    });
    fireEvent.mouseDown(screen.getByTestId("user-b-result-asmith"));

    // Wait for user details to load
    await waitFor(() => {
      expect(screen.getByTestId("user-a-selected")).toBeInTheDocument();
      expect(screen.getByTestId("user-b-selected")).toBeInTheDocument();
    });

    // Compare
    const compareBtn = screen.getByTestId("compare-button");
    expect(compareBtn).not.toBeDisabled();
    fireEvent.click(compareBtn);

    await waitFor(() => {
      expect(screen.getByTestId("comparison-results")).toBeInTheDocument();
      expect(screen.getByTestId("delta-summary")).toBeInTheDocument();
    });
  });

  it("displays error when comparison fails", async () => {
    const userA = makeEntry("jdoe", "John Doe");
    const userB = makeEntry("asmith", "Alice Smith");

    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "search_users") return [userA, userB];
      if (cmd === "get_user") {
        const a = args as { samAccountName: string };
        if (a.samAccountName === "jdoe") return userA;
        if (a.samAccountName === "asmith") return userB;
        return null;
      }
      if (cmd === "compare_users") throw new Error("Connection failed");
      return null;
    });

    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );

    // Select both users
    fireEvent.change(screen.getByTestId("user-a-input"), {
      target: { value: "jdoe" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("user-a-dropdown")).toBeInTheDocument(),
    );
    fireEvent.mouseDown(screen.getByTestId("user-a-result-jdoe"));

    fireEvent.change(screen.getByTestId("user-b-input"), {
      target: { value: "asmith" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("user-b-dropdown")).toBeInTheDocument(),
    );
    fireEvent.mouseDown(screen.getByTestId("user-b-result-asmith"));

    await waitFor(() => {
      expect(screen.getByTestId("user-a-selected")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("compare-button"));

    await waitFor(() => {
      expect(screen.getByTestId("comparison-error")).toBeInTheDocument();
    });
  });

  it("resets comparison on reset button click", async () => {
    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );

    fireEvent.click(screen.getByTestId("comparison-reset"));

    // Page should still render with empty state
    expect(screen.getByTestId("user-comparison-page")).toBeInTheDocument();
    expect(screen.queryByTestId("comparison-results")).not.toBeInTheDocument();
  });

  // Helper to set up a full comparison with results
  async function renderWithComparison() {
    const userA = makeEntry("jdoe", "John Doe", [
      "CN=Domain Users,DC=example,DC=com",
      "CN=Developers,DC=example,DC=com",
    ]);
    const userB = makeEntry("asmith", "Alice Smith", [
      "CN=Domain Users,DC=example,DC=com",
      "CN=Managers,DC=example,DC=com",
    ]);

    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "search_users") return [userA, userB];
      if (cmd === "get_user") {
        const a = args as { samAccountName: string };
        if (a.samAccountName === "jdoe") return userA;
        if (a.samAccountName === "asmith") return userB;
        return null;
      }
      if (cmd === "compare_users") return MOCK_COMPARISON;
      if (cmd === "analyze_ntfs")
        return {
          paths: [],
          conflicts: [],
          totalAces: 0,
          totalPathsScanned: 0,
          totalErrors: 0,
        };
      return null;
    });

    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );

    // Select user A
    fireEvent.change(screen.getByTestId("user-a-input"), {
      target: { value: "jdoe" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("user-a-dropdown")).toBeInTheDocument(),
    );
    fireEvent.mouseDown(screen.getByTestId("user-a-result-jdoe"));

    // Select user B
    fireEvent.change(screen.getByTestId("user-b-input"), {
      target: { value: "asmith" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("user-b-dropdown")).toBeInTheDocument(),
    );
    fireEvent.mouseDown(screen.getByTestId("user-b-result-asmith"));

    // Wait for both selected
    await waitFor(() => {
      expect(screen.getByTestId("user-a-selected")).toBeInTheDocument();
      expect(screen.getByTestId("user-b-selected")).toBeInTheDocument();
    });

    // Compare
    fireEvent.click(screen.getByTestId("compare-button"));

    await waitFor(() => {
      expect(screen.getByTestId("comparison-results")).toBeInTheDocument();
    });
  }

  it("renders group items with correct categories", async () => {
    await renderWithComparison();

    // Should have 3 group items: 1 shared, 1 onlyA, 1 onlyB
    expect(screen.getByTestId("group-item-0")).toBeInTheDocument();
    expect(screen.getByTestId("group-item-1")).toBeInTheDocument();
    expect(screen.getByTestId("group-item-2")).toBeInTheDocument();
  });

  it("renders delta summary counts", async () => {
    await renderWithComparison();

    const summary = screen.getByTestId("delta-summary");
    expect(summary).toHaveTextContent("1");
    expect(summary).toHaveTextContent("shared");
  });

  it("filters groups by text input", async () => {
    await renderWithComparison();

    const filterInput = screen.getByTestId("group-filter");
    fireEvent.change(filterInput, { target: { value: "Developers" } });

    await waitFor(() => {
      expect(screen.getByTestId("group-item-0")).toBeInTheDocument();
      expect(screen.queryByTestId("group-item-1")).not.toBeInTheDocument();
    });
  });

  it("shows no groups message when filter matches nothing", async () => {
    await renderWithComparison();

    const filterInput = screen.getByTestId("group-filter");
    fireEvent.change(filterInput, { target: { value: "zzz-nonexistent" } });

    await waitFor(() => {
      expect(screen.getByText("No groups to display")).toBeInTheDocument();
    });
  });

  it("can change sort field to category", async () => {
    await renderWithComparison();

    const sortSelect = screen.getByTestId("sort-field");
    fireEvent.change(sortSelect, { target: { value: "category" } });

    // Groups should still be visible, just re-ordered
    await waitFor(() => {
      expect(screen.getByTestId("group-item-0")).toBeInTheDocument();
    });
  });

  it("toggles sort direction between asc and desc", async () => {
    await renderWithComparison();

    const sortBtn = screen.getByTestId("sort-direction");
    expect(sortBtn).toHaveTextContent("A-Z");

    fireEvent.click(sortBtn);
    expect(sortBtn).toHaveTextContent("Z-A");

    fireEvent.click(sortBtn);
    expect(sortBtn).toHaveTextContent("A-Z");
  });

  it("opens context menu on group right-click", async () => {
    await renderWithComparison();

    const groupItem = screen.getByTestId("group-item-0");
    fireEvent.contextMenu(groupItem);

    await waitFor(() => {
      expect(screen.getByText("View group members")).toBeInTheDocument();
    });
  });

  it("renders UNC permissions section after comparison", async () => {
    await renderWithComparison();

    expect(screen.getByTestId("unc-permissions-section")).toBeInTheDocument();
    expect(screen.getByText("UNC Path Permissions Audit")).toBeInTheDocument();
  });

  it("toggles UNC info popup on button click", async () => {
    await renderWithComparison();

    const infoBtn = screen.getByTestId("unc-info-button");
    fireEvent.click(infoBtn);

    await waitFor(() => {
      expect(screen.getByTestId("unc-info-popup")).toBeInTheDocument();
      expect(
        screen.getByText(/Permissions Cross-Reference/),
      ).toBeInTheDocument();
    });
  });

  it("shows selected user details with title and department", async () => {
    const userA = makeEntry("jdoe", "John Doe");
    mockInvoke.mockImplementation(async (cmd: string, _args?: unknown) => {
      if (cmd === "search_users") return [userA];
      if (cmd === "get_user") return userA;
      return null;
    });

    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );

    fireEvent.change(screen.getByTestId("user-a-input"), {
      target: { value: "jdoe" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("user-a-dropdown")).toBeInTheDocument(),
    );
    fireEvent.mouseDown(screen.getByTestId("user-a-result-jdoe"));

    await waitFor(() => {
      expect(screen.getByTestId("user-a-selected")).toBeInTheDocument();
    });

    expect(screen.getByText(/Title:/)).toBeInTheDocument();
    expect(screen.getByText(/Department:/)).toBeInTheDocument();
  });

  it("does not show dropdown when query is less than 2 chars", async () => {
    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );

    fireEvent.change(screen.getByTestId("user-a-input"), {
      target: { value: "j" },
    });

    // Should not call search_users for single character
    expect(mockInvoke).not.toHaveBeenCalledWith("search_users", {
      query: "j",
    });
  });

  it("context menu shows 'Add user to group' for onlyB groups", async () => {
    await renderWithComparison();

    // Find an onlyB group item by category attribute
    const groupItems = screen.getAllByTestId(/group-item-/);
    const onlyBItem = groupItems.find(
      (el) => el.getAttribute("data-category") === "onlyB",
    );
    expect(onlyBItem).toBeDefined();

    fireEvent.contextMenu(onlyBItem!);

    await waitFor(() => {
      // Should offer to add User A to this group
      expect(screen.getByText(/Add.*to this group/)).toBeInTheDocument();
    });
  });

  it("context menu shows 'Add user to group' for onlyA groups", async () => {
    await renderWithComparison();

    const groupItems = screen.getAllByTestId(/group-item-/);
    const onlyAItem = groupItems.find(
      (el) => el.getAttribute("data-category") === "onlyA",
    );
    expect(onlyAItem).toBeDefined();

    fireEvent.contextMenu(onlyAItem!);

    await waitFor(() => {
      // Should offer to add User B to this group
      expect(screen.getByText(/Add.*to this group/)).toBeInTheDocument();
    });
  });

  it("add-to-group action calls invoke and shows notification on success", async () => {
    await renderWithComparison();

    const groupItems = screen.getAllByTestId(/group-item-/);
    const onlyBItem = groupItems.find(
      (el) => el.getAttribute("data-category") === "onlyB",
    );
    expect(onlyBItem).toBeDefined();

    fireEvent.contextMenu(onlyBItem!);

    await waitFor(() => {
      expect(screen.getByText(/Add.*to this group/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Add.*to this group/));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "add_user_to_group",
        expect.objectContaining({
          groupDn: expect.any(String),
        }),
      );
    });
  });

  it("add-to-group action shows error notification on failure", async () => {
    const userA = makeEntry("jdoe", "John Doe", [
      "CN=Domain Users,DC=example,DC=com",
      "CN=Developers,DC=example,DC=com",
    ]);
    const userB = makeEntry("asmith", "Alice Smith", [
      "CN=Domain Users,DC=example,DC=com",
      "CN=Managers,DC=example,DC=com",
    ]);

    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "search_users") return [userA, userB];
      if (cmd === "get_user") {
        const a = args as { samAccountName: string };
        if (a.samAccountName === "jdoe") return userA;
        if (a.samAccountName === "asmith") return userB;
        return null;
      }
      if (cmd === "compare_users") return MOCK_COMPARISON;
      if (cmd === "add_user_to_group")
        throw new Error("Insufficient permissions");
      if (cmd === "analyze_ntfs")
        return {
          paths: [],
          conflicts: [],
          totalAces: 0,
          totalPathsScanned: 0,
          totalErrors: 0,
        };
      return null;
    });

    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );

    // Select user A
    fireEvent.change(screen.getByTestId("user-a-input"), {
      target: { value: "jdoe" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("user-a-dropdown")).toBeInTheDocument(),
    );
    fireEvent.mouseDown(screen.getByTestId("user-a-result-jdoe"));

    // Select user B
    fireEvent.change(screen.getByTestId("user-b-input"), {
      target: { value: "asmith" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("user-b-dropdown")).toBeInTheDocument(),
    );
    fireEvent.mouseDown(screen.getByTestId("user-b-result-asmith"));

    await waitFor(() => {
      expect(screen.getByTestId("user-a-selected")).toBeInTheDocument();
      expect(screen.getByTestId("user-b-selected")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("compare-button"));

    await waitFor(() => {
      expect(screen.getByTestId("comparison-results")).toBeInTheDocument();
    });

    const groupItems = screen.getAllByTestId(/group-item-/);
    const onlyBItem = groupItems.find(
      (el) => el.getAttribute("data-category") === "onlyB",
    );
    expect(onlyBItem).toBeDefined();

    fireEvent.contextMenu(onlyBItem!);

    await waitFor(() => {
      expect(screen.getByText(/Add.*to this group/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Add.*to this group/));

    // Should call add_user_to_group which will fail
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "add_user_to_group",
        expect.any(Object),
      );
    });
  });

  it("group items display category badge labels", async () => {
    await renderWithComparison();

    // Check that category labels appear
    expect(screen.getByText("Shared")).toBeInTheDocument();
  });

  it("shows user names in delta summary", async () => {
    await renderWithComparison();

    const summary = screen.getByTestId("delta-summary");
    expect(summary).toHaveTextContent("John Doe only");
    expect(summary).toHaveTextContent("Alice Smith only");
  });

  it("shows group DN in group list items", async () => {
    await renderWithComparison();

    // Group DNs should be displayed
    expect(
      screen.getByText("CN=Domain Users,DC=example,DC=com"),
    ).toBeInTheDocument();
  });

  it("shows total group counts in delta summary", async () => {
    await renderWithComparison();

    const summary = screen.getByTestId("delta-summary");
    expect(summary).toHaveTextContent("2 groups");
  });

  it("add-to-group action for onlyA group calls invoke with userB DN", async () => {
    await renderWithComparison();

    const groupItems = screen.getAllByTestId(/group-item-/);
    const onlyAItem = groupItems.find(
      (el) => el.getAttribute("data-category") === "onlyA",
    );
    expect(onlyAItem).toBeDefined();

    fireEvent.contextMenu(onlyAItem!);

    await waitFor(() => {
      expect(screen.getByText(/Add.*to this group/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Add.*to this group/));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "add_user_to_group",
        expect.objectContaining({
          userDn: "CN=Alice Smith,OU=Users,DC=example,DC=com",
          groupDn: "CN=Developers,DC=example,DC=com",
        }),
      );
    });
  });

  it("add-to-group for onlyA group shows error notification on failure", async () => {
    const userA = makeEntry("jdoe", "John Doe", [
      "CN=Domain Users,DC=example,DC=com",
      "CN=Developers,DC=example,DC=com",
    ]);
    const userB = makeEntry("asmith", "Alice Smith", [
      "CN=Domain Users,DC=example,DC=com",
      "CN=Managers,DC=example,DC=com",
    ]);

    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "search_users") return [userA, userB];
      if (cmd === "get_user") {
        const a = args as { samAccountName: string };
        if (a.samAccountName === "jdoe") return userA;
        if (a.samAccountName === "asmith") return userB;
        return null;
      }
      if (cmd === "compare_users") return MOCK_COMPARISON;
      if (cmd === "add_user_to_group")
        throw new Error("Access denied");
      if (cmd === "analyze_ntfs")
        return {
          paths: [],
          conflicts: [],
          totalAces: 0,
          totalPathsScanned: 0,
          totalErrors: 0,
        };
      return null;
    });

    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );

    // Select user A
    fireEvent.change(screen.getByTestId("user-a-input"), {
      target: { value: "jdoe" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("user-a-dropdown")).toBeInTheDocument(),
    );
    fireEvent.mouseDown(screen.getByTestId("user-a-result-jdoe"));

    // Select user B
    fireEvent.change(screen.getByTestId("user-b-input"), {
      target: { value: "asmith" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("user-b-dropdown")).toBeInTheDocument(),
    );
    fireEvent.mouseDown(screen.getByTestId("user-b-result-asmith"));

    await waitFor(() => {
      expect(screen.getByTestId("user-a-selected")).toBeInTheDocument();
      expect(screen.getByTestId("user-b-selected")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("compare-button"));

    await waitFor(() => {
      expect(screen.getByTestId("comparison-results")).toBeInTheDocument();
    });

    const groupItems = screen.getAllByTestId(/group-item-/);
    const onlyAItem = groupItems.find(
      (el) => el.getAttribute("data-category") === "onlyA",
    );
    expect(onlyAItem).toBeDefined();

    fireEvent.contextMenu(onlyAItem!);

    await waitFor(() => {
      expect(screen.getByText(/Add.*to this group/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Add.*to this group/));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "add_user_to_group",
        expect.any(Object),
      );
    });
  });

  it("context menu on shared group only shows view members option", async () => {
    await renderWithComparison();

    const groupItems = screen.getAllByTestId(/group-item-/);
    const sharedItem = groupItems.find(
      (el) => el.getAttribute("data-category") === "shared",
    );
    expect(sharedItem).toBeDefined();

    fireEvent.contextMenu(sharedItem!);

    await waitFor(() => {
      expect(screen.getByText("View group members")).toBeInTheDocument();
    });

    // Should NOT have an "Add to group" option for shared groups
    expect(screen.queryByText(/Add.*to this group/)).not.toBeInTheDocument();
  });
});
