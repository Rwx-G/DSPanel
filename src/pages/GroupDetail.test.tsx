import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GroupDetail, type GroupDetailProps } from "./GroupDetail";
import type { DirectoryEntry, DirectoryGroup } from "@/types/directory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function makeGroup(overrides: Partial<DirectoryGroup> = {}): DirectoryGroup {
  return {
    distinguishedName: "CN=Developers,OU=Groups,DC=example,DC=com",
    samAccountName: "Developers",
    displayName: "Developers",
    description: "Development team group",
    scope: "Global",
    category: "Security",
    memberCount: 3,
    organizationalUnit: "Groups",
    ...overrides,
  };
}

const defaultMembers: DirectoryEntry[] = [
  {
    distinguishedName: "CN=John Doe,OU=Users,OU=Corp,DC=example,DC=com",
    samAccountName: "jdoe",
    displayName: "John Doe",
    objectClass: "user",
    attributes: {},
  },
  {
    distinguishedName: "CN=Alice Smith,OU=Users,OU=Corp,DC=example,DC=com",
    samAccountName: "asmith",
    displayName: "Alice Smith",
    objectClass: "user",
    attributes: {},
  },
];

function renderGroupDetail(props: Partial<GroupDetailProps> = {}) {
  const defaultProps: GroupDetailProps = {
    group: makeGroup(),
    members: defaultMembers,
    membersLoading: false,
    canManageMembers: false,
    onMembersRefresh: vi.fn(),
    ...props,
  };
  return render(<GroupDetail {...defaultProps} />);
}

describe("GroupDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "search_users") return Promise.resolve([]);
      if (cmd === "add_user_to_group") return Promise.resolve(null);
      if (cmd === "remove_group_member") return Promise.resolve(null);
      return Promise.resolve(null);
    }) as typeof invoke);
  });

  it("renders group detail with property grid", () => {
    renderGroupDetail();
    expect(screen.getByTestId("group-detail")).toBeInTheDocument();
    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByText("Group Type")).toBeInTheDocument();
  });

  it("displays group name as heading", () => {
    renderGroupDetail({ group: makeGroup({ displayName: "My Team" }) });
    const heading = screen.getByTestId("group-detail").querySelector("h2");
    expect(heading).toHaveTextContent("My Team");
  });

  it("shows scope and category badges", () => {
    renderGroupDetail({
      group: makeGroup({ scope: "Universal", category: "Distribution" }),
    });
    const badges = screen.getAllByTestId("status-badge");
    const texts = badges.map((b) => b.textContent);
    expect(texts).toContain("Universal");
    expect(texts).toContain("Distribution");
  });

  it("shows scope badge with info variant", () => {
    renderGroupDetail({ group: makeGroup({ scope: "Global" }) });
    const badges = screen.getAllByTestId("status-badge");
    const scopeBadge = badges.find((b) => b.textContent === "Global");
    expect(scopeBadge).toBeDefined();
    expect(scopeBadge?.getAttribute("data-variant")).toBe("info");
  });

  it("shows category badge with neutral variant for Security", () => {
    renderGroupDetail({ group: makeGroup({ category: "Security" }) });
    const badges = screen.getAllByTestId("status-badge");
    const catBadge = badges.find((b) => b.textContent === "Security");
    expect(catBadge).toBeDefined();
    expect(catBadge?.getAttribute("data-variant")).toBe("neutral");
  });

  it("shows category badge with warning variant for Distribution", () => {
    renderGroupDetail({ group: makeGroup({ category: "Distribution" }) });
    const badges = screen.getAllByTestId("status-badge");
    const catBadge = badges.find((b) => b.textContent === "Distribution");
    expect(catBadge).toBeDefined();
    expect(catBadge?.getAttribute("data-variant")).toBe("warning");
  });

  it("shows CopyButton for samAccountName", () => {
    renderGroupDetail();
    // Copy button appears in subtitle area and in PropertyGrid rows
    const copyButtons = screen.getAllByTestId("copy-button");
    expect(copyButtons.length).toBeGreaterThanOrEqual(1);
    // samAccountName appears in subtitle area alongside the copy button
    const allDevs = screen.getAllByText("Developers");
    expect(allDevs.length).toBeGreaterThanOrEqual(2);
  });

  it("shows member list", () => {
    renderGroupDetail();
    expect(screen.getByTestId("group-members-section")).toBeInTheDocument();
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
  });

  it("shows member count in properties", () => {
    renderGroupDetail({ group: makeGroup({ memberCount: 42 }) });
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("shows management controls for AccountOperator", () => {
    renderGroupDetail({ canManageMembers: true });
    expect(
      screen.getByTestId("member-management-controls"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("add-member-section")).toBeInTheDocument();
    expect(screen.getByTestId("select-all-checkbox")).toBeInTheDocument();
    // Buttons always visible but disabled by default
    expect(screen.getByTestId("remove-selected-btn")).toBeDisabled();
    expect(screen.getByTestId("preview-changes-btn")).toBeDisabled();
  });

  it("shows help button with info popup", async () => {
    renderGroupDetail({ canManageMembers: true });
    expect(screen.getByTestId("member-help-btn")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("member-help-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("member-help-popup")).toBeInTheDocument();
    });

    expect(screen.getByText("Member Management")).toBeInTheDocument();
  });

  it("hides management controls for ReadOnly", () => {
    renderGroupDetail({ canManageMembers: false });
    expect(
      screen.queryByTestId("member-management-controls"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("add-member-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("select-all-checkbox")).not.toBeInTheDocument();
  });

  it("shows loading spinner when members are loading", () => {
    renderGroupDetail({ membersLoading: true, members: [] });
    expect(screen.getByText("Loading members...")).toBeInTheDocument();
  });

  it("shows no members message when members list is empty", () => {
    renderGroupDetail({ members: [] });
    expect(screen.getByText("No members found")).toBeInTheDocument();
  });

  it("displays property values in the grid", () => {
    renderGroupDetail({
      group: makeGroup({
        description: "A test group",
        organizationalUnit: "TestOU",
      }),
    });
    expect(screen.getByText("A test group")).toBeInTheDocument();
    expect(screen.getByText("TestOU")).toBeInTheDocument();
  });

  it("multi-select enables remove button", async () => {
    renderGroupDetail({ canManageMembers: true });

    // Button starts disabled
    expect(screen.getByTestId("remove-selected-btn")).toBeDisabled();

    fireEvent.click(screen.getByTestId("member-checkbox-John Doe"));

    await waitFor(() => {
      expect(screen.getByTestId("remove-selected-btn")).not.toBeDisabled();
    });

    expect(screen.getByTestId("remove-selected-btn")).toHaveTextContent(
      "Remove Selected (1)",
    );
  });

  it("add member search returns results", async () => {
    const searchResults: DirectoryEntry[] = [
      {
        distinguishedName: "CN=New User,OU=Users,OU=Corp,DC=example,DC=com",
        samAccountName: "nuser",
        displayName: "New User",
        objectClass: "user",
        attributes: {},
      },
    ];

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "search_users") return Promise.resolve(searchResults);
      return Promise.resolve(null);
    }) as typeof invoke);

    renderGroupDetail({ canManageMembers: true });

    const searchInput = screen.getByTestId("member-search-input");
    fireEvent.change(searchInput, { target: { value: "New" } });

    await waitFor(() => {
      expect(screen.getByTestId("member-search-results")).toBeInTheDocument();
    });

    expect(screen.getByText("New User")).toBeInTheDocument();
  });

  it("select-all checkbox selects all members", async () => {
    renderGroupDetail({ canManageMembers: true });

    fireEvent.click(screen.getByTestId("select-all-checkbox"));

    await waitFor(() => {
      expect(screen.getByTestId("remove-selected-btn")).not.toBeDisabled();
    });

    expect(screen.getByTestId("remove-selected-btn")).toHaveTextContent(
      "Remove Selected (2)",
    );
  });
});
