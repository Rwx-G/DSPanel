import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { GroupMembersDialog } from "./GroupMembersDialog";
import type { DirectoryEntry } from "@/types/directory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function makeEntry(sam: string, display: string): DirectoryEntry {
  return {
    distinguishedName: `CN=${display},OU=Users,DC=example,DC=com`,
    samAccountName: sam,
    displayName: display,
    objectClass: "user",
    attributes: {},
  };
}

describe("GroupMembersDialog", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("shows loading state initially", () => {
    mockInvoke.mockImplementation(() => new Promise(() => {}));

    render(
      <GroupMembersDialog
        groupDn="CN=TestGroup,DC=example,DC=com"
        groupName="TestGroup"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId("group-members-loading")).toBeInTheDocument();
  });

  it("displays members after loading", async () => {
    const members = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("asmith", "Alice Smith"),
    ];
    mockInvoke.mockResolvedValueOnce(members);

    render(
      <GroupMembersDialog
        groupDn="CN=TestGroup,DC=example,DC=com"
        groupName="TestGroup"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("group-members-list")).toBeInTheDocument();
    });

    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText(/2 members/)).toBeInTheDocument();
  });

  it("shows empty state when no members", async () => {
    mockInvoke.mockResolvedValueOnce([]);

    render(
      <GroupMembersDialog
        groupDn="CN=Empty,DC=example,DC=com"
        groupName="EmptyGroup"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("group-members-empty")).toBeInTheDocument();
    });

    expect(screen.getByText("No members")).toBeInTheDocument();
  });

  it("shows error state on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("LDAP error"));

    render(
      <GroupMembersDialog
        groupDn="CN=Fail,DC=example,DC=com"
        groupName="FailGroup"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("group-members-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Failed to load members")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    const onClose = vi.fn();

    render(
      <GroupMembersDialog
        groupDn="CN=G,DC=example,DC=com"
        groupName="Group"
        onClose={onClose}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("group-members-close")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("group-members-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls invoke with correct group DN", async () => {
    mockInvoke.mockResolvedValueOnce([]);

    render(
      <GroupMembersDialog
        groupDn="CN=TestGroup,OU=Groups,DC=example,DC=com"
        groupName="TestGroup"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_group_members", {
        groupDn: "CN=TestGroup,OU=Groups,DC=example,DC=com",
      });
    });
  });

  it("displays group name in title", () => {
    mockInvoke.mockImplementation(() => new Promise(() => {}));

    render(
      <GroupMembersDialog
        groupDn="CN=Admins,DC=example,DC=com"
        groupName="Admins"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Admins")).toBeInTheDocument();
  });
});
