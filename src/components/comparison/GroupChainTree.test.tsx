import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GroupChainTree, clearGroupMemberCache } from "./GroupChainTree";
import type { DirectoryEntry } from "@/types/directory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function makeUser(sam: string, display: string): DirectoryEntry {
  return {
    distinguishedName: `CN=${display},OU=Users,DC=contoso,DC=com`,
    samAccountName: sam,
    displayName: display,
    objectClass: "user",
    attributes: {},
  };
}

function makeGroup(name: string): DirectoryEntry {
  return {
    distinguishedName: `CN=${name},OU=Groups,DC=contoso,DC=com`,
    samAccountName: name,
    displayName: name,
    objectClass: "group",
    attributes: {},
  };
}

describe("GroupChainTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGroupMemberCache();
  });

  it("renders the root group node", () => {
    render(
      <GroupChainTree
        groupDn="CN=IT Team,OU=Groups,DC=contoso,DC=com"
        groupName="IT Team"
      />,
    );
    expect(screen.getByTestId("group-chain-tree")).toBeInTheDocument();
    expect(
      screen.getByTestId("group-chain-toggle-IT Team"),
    ).toBeInTheDocument();
  });

  it("expands to show members on click", async () => {
    const members = [
      makeUser("jdoe", "John Doe"),
      makeUser("cjones", "Carol Jones"),
    ];
    mockInvoke.mockResolvedValueOnce(members);

    render(
      <GroupChainTree
        groupDn="CN=IT Team,OU=Groups,DC=contoso,DC=com"
        groupName="IT Team"
      />,
    );

    fireEvent.click(screen.getByTestId("group-chain-toggle-IT Team"));

    await waitFor(() => {
      expect(screen.getByTestId("group-chain-member-jdoe")).toBeInTheDocument();
      expect(
        screen.getByTestId("group-chain-member-cjones"),
      ).toBeInTheDocument();
    });
  });

  it("shows sub-groups as expandable nodes", async () => {
    const members = [makeGroup("IT-Admins"), makeUser("jdoe", "John Doe")];
    mockInvoke.mockResolvedValueOnce(members);

    render(
      <GroupChainTree
        groupDn="CN=IT Team,OU=Groups,DC=contoso,DC=com"
        groupName="IT Team"
      />,
    );

    fireEvent.click(screen.getByTestId("group-chain-toggle-IT Team"));

    await waitFor(() => {
      expect(
        screen.getByTestId("group-chain-toggle-IT-Admins"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("group-chain-member-jdoe")).toBeInTheDocument();
    });
  });

  it("recursively expands sub-groups", async () => {
    const topMembers = [makeGroup("IT-Admins")];
    const subMembers = [makeUser("admin1", "Admin One")];

    mockInvoke
      .mockResolvedValueOnce(topMembers)
      .mockResolvedValueOnce(subMembers);

    render(
      <GroupChainTree
        groupDn="CN=IT Team,OU=Groups,DC=contoso,DC=com"
        groupName="IT Team"
      />,
    );

    fireEvent.click(screen.getByTestId("group-chain-toggle-IT Team"));

    await waitFor(() => {
      expect(
        screen.getByTestId("group-chain-toggle-IT-Admins"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("group-chain-toggle-IT-Admins"));

    await waitFor(() => {
      expect(
        screen.getByTestId("group-chain-member-admin1"),
      ).toBeInTheDocument();
    });
  });

  it("shows empty message when group has no members", async () => {
    mockInvoke.mockResolvedValueOnce([]);

    render(
      <GroupChainTree
        groupDn="CN=Empty,OU=Groups,DC=contoso,DC=com"
        groupName="Empty"
      />,
    );

    fireEvent.click(screen.getByTestId("group-chain-toggle-Empty"));

    await waitFor(() => {
      expect(screen.getByText("No members")).toBeInTheDocument();
    });
  });

  it("detects circular reference and shows warning", async () => {
    // IT Team contains a sub-group that contains IT Team again
    const topMembers = [makeGroup("Sub-Group")];
    const subMembers = [makeGroup("IT Team")]; // circular!

    mockInvoke
      .mockResolvedValueOnce(topMembers)
      .mockResolvedValueOnce(subMembers);

    render(
      <GroupChainTree
        groupDn="CN=IT Team,OU=Groups,DC=contoso,DC=com"
        groupName="IT Team"
      />,
    );

    // Expand IT Team
    fireEvent.click(screen.getByTestId("group-chain-toggle-IT Team"));
    await waitFor(() => {
      expect(
        screen.getByTestId("group-chain-toggle-Sub-Group"),
      ).toBeInTheDocument();
    });

    // Expand Sub-Group
    fireEvent.click(screen.getByTestId("group-chain-toggle-Sub-Group"));
    await waitFor(() => {
      // IT Team appears again but with circular reference warning
      expect(screen.getByTestId("circular-ref-IT Team")).toBeInTheDocument();
      expect(screen.getByText("(circular reference)")).toBeInTheDocument();
    });
  });

  it("collapses on second click", async () => {
    mockInvoke.mockResolvedValueOnce([makeUser("jdoe", "John Doe")]);

    render(
      <GroupChainTree
        groupDn="CN=Test,OU=Groups,DC=contoso,DC=com"
        groupName="Test"
      />,
    );

    fireEvent.click(screen.getByTestId("group-chain-toggle-Test"));

    await waitFor(() => {
      expect(screen.getByTestId("group-chain-member-jdoe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("group-chain-toggle-Test"));

    expect(
      screen.queryByTestId("group-chain-member-jdoe"),
    ).not.toBeInTheDocument();
  });
});
