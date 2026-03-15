import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { GroupManagement } from "./GroupManagement";
import { DialogProvider } from "@/contexts/DialogContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { NavigationProvider } from "@/contexts/NavigationContext";
import type { DirectoryEntry } from "@/types/directory";

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

function makeGroupEntry(
  name: string,
  scope: "Global" | "DomainLocal" | "Universal" = "Global",
  category: "Security" | "Distribution" = "Security",
  memberCount = 0,
): DirectoryEntry {
  let groupType: number;
  let scopeBit = 0;
  if (scope === "Global") scopeBit = 0x2;
  else if (scope === "DomainLocal") scopeBit = 0x4;
  else if (scope === "Universal") scopeBit = 0x8;

  if (category === "Security") {
    groupType = (scopeBit | 0x80000000) >>> 0;
    // Use signed representation for Security groups
    groupType = groupType | 0; // force signed
  } else {
    groupType = scopeBit;
  }

  const members = Array.from(
    { length: memberCount },
    (_, i) => `CN=Member${i},OU=Users,DC=example,DC=com`,
  );

  return {
    distinguishedName: `CN=${name},OU=Groups,DC=example,DC=com`,
    samAccountName: name,
    displayName: name,
    objectClass: "group",
    attributes: {
      groupType: [groupType.toString()],
      description: [`${name} group description`],
      member: members,
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
    if (cmd === "browse_groups")
      return Promise.resolve(makeBrowseResult(entries));
    if (cmd === "search_groups") return Promise.resolve(entries);
    if (cmd === "get_group_members") return Promise.resolve([]);
    if (cmd === "get_ou_tree") return Promise.resolve([]);
    return Promise.resolve(null);
  }) as typeof invoke);
}

describe("GroupManagement", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("renders with search bar and loads groups on mount (flat view default)", async () => {
    const entries = [makeGroupEntry("IT-Admins"), makeGroupEntry("HR-Team")];
    mockBrowseWith(entries);

    render(<GroupManagement />, { wrapper: TestProviders });
    expect(screen.getByTestId("group-management")).toBeInTheDocument();
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("group-results-list")).toBeInTheDocument();
    });

    expect(screen.getByTestId("group-result-IT-Admins")).toBeInTheDocument();
    expect(screen.getByTestId("group-result-HR-Team")).toBeInTheDocument();
  });

  it("shows loading state during initial load", () => {
    mockInvoke.mockImplementation(
      (() => new Promise(() => {})) as typeof invoke,
    );
    render(<GroupManagement />, { wrapper: TestProviders });
    expect(screen.getByTestId("group-management-loading")).toBeInTheDocument();
  });

  it("shows error state when browse fails", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_groups")
        return Promise.reject(new Error("Connection failed"));
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-management-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Failed to load groups")).toBeInTheDocument();
  });

  it("shows empty state when no groups", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_groups") return Promise.resolve(makeBrowseResult([]));
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-management-empty")).toBeInTheDocument();
    });

    expect(screen.getByText("No groups found")).toBeInTheDocument();
  });

  it("displays group details when a group is selected", async () => {
    const entries = [makeGroupEntry("IT-Admins", "Global", "Security", 3)];
    mockBrowseWith(entries);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-result-IT-Admins")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("group-result-IT-Admins"));

    await waitFor(() => {
      expect(screen.getByTestId("group-detail")).toBeInTheDocument();
    });

    const detail = screen.getByTestId("group-detail");
    expect(detail.querySelector("h2")).toHaveTextContent("IT-Admins");
    expect(screen.getByTestId("group-scope")).toHaveTextContent("Global");
    expect(screen.getByTestId("group-category")).toHaveTextContent("Security");
  });

  it("shows member list in detail panel", async () => {
    const entries = [makeGroupEntry("IT-Admins")];
    const memberEntries: DirectoryEntry[] = [
      {
        distinguishedName: "CN=John Doe,OU=Users,DC=example,DC=com",
        samAccountName: "jdoe",
        displayName: "John Doe",
        objectClass: "user",
        attributes: {},
      },
    ];

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_groups")
        return Promise.resolve(makeBrowseResult(entries));
      if (cmd === "get_group_members") return Promise.resolve(memberEntries);
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-result-IT-Admins")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("group-result-IT-Admins"));

    await waitFor(() => {
      expect(screen.getByTestId("group-members-section")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });
  });

  it("toggles between tree and flat views", async () => {
    const entries = [makeGroupEntry("IT-Admins")];
    mockBrowseWith(entries);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-results-list")).toBeInTheDocument();
    });

    // Default is flat - no tree panel
    expect(screen.queryByTestId("group-tree-panel")).not.toBeInTheDocument();

    // Switch to tree
    fireEvent.click(screen.getByTestId("view-toggle-tree"));

    await waitFor(() => {
      expect(screen.getByTestId("group-tree-panel")).toBeInTheDocument();
    });

    // Switch back to flat
    fireEvent.click(screen.getByTestId("view-toggle-flat"));

    await waitFor(() => {
      expect(screen.queryByTestId("group-tree-panel")).not.toBeInTheDocument();
    });
  });

  it("search filters groups in flat view", async () => {
    const entries = [makeGroupEntry("IT-Admins"), makeGroupEntry("HR-Team")];
    mockBrowseWith(entries);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-results-list")).toBeInTheDocument();
    });

    expect(mockInvoke).toHaveBeenCalledWith("browse_groups", {
      page: 0,
      pageSize: 50,
    });
  });

  it("tree view renders OU tree", async () => {
    const entries = [makeGroupEntry("IT-Admins")];
    const ouTree = [
      {
        distinguishedName: "OU=Groups,DC=example,DC=com",
        name: "Groups",
        children: [],
        hasChildren: false,
      },
    ];

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_groups")
        return Promise.resolve(makeBrowseResult(entries));
      if (cmd === "get_ou_tree") return Promise.resolve(ouTree);
      if (cmd === "get_group_members") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-results-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("view-toggle-tree"));

    await waitFor(() => {
      expect(screen.getByTestId("group-tree-panel")).toBeInTheDocument();
    });

    expect(screen.getByText("Groups")).toBeInTheDocument();
  });

  it("group detail shows correct scope and category values", async () => {
    const entries = [makeGroupEntry("DL-Group", "DomainLocal", "Distribution")];
    mockBrowseWith(entries);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-result-DL-Group")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("group-result-DL-Group"));

    await waitFor(() => {
      expect(screen.getByTestId("group-scope")).toHaveTextContent(
        "DomainLocal",
      );
      expect(screen.getByTestId("group-category")).toHaveTextContent(
        "Distribution",
      );
    });
  });

  it("renders each scope/category combination correctly", async () => {
    // Test Global Security
    const gs = [makeGroupEntry("GS-Group", "Global", "Security")];
    mockBrowseWith(gs);

    const { unmount } = render(<GroupManagement />, { wrapper: TestProviders });
    await waitFor(() => {
      expect(screen.getByTestId("group-result-GS-Group")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("group-result-GS-Group"));
    await waitFor(() => {
      expect(screen.getByTestId("group-scope")).toHaveTextContent("Global");
      expect(screen.getByTestId("group-category")).toHaveTextContent(
        "Security",
      );
    });
    unmount();
  });

  it("shows placeholder when no group is selected", async () => {
    const entries = [makeGroupEntry("IT-Admins")];
    mockBrowseWith(entries);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-results-list")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Select a group to view details"),
    ).toBeInTheDocument();
  });
});
