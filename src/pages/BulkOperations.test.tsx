import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { type ReactNode } from "react";
import { BulkOperations } from "./BulkOperations";
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

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const memberEntries: DirectoryEntry[] = [
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
  {
    distinguishedName: "CN=Bob Wilson,OU=Users,OU=Corp,DC=example,DC=com",
    samAccountName: "bwilson",
    displayName: "Bob Wilson",
    objectClass: "user",
    attributes: {},
  },
];

const groupSearchResults: DirectoryEntry[] = [
  {
    distinguishedName: "CN=Developers,OU=Groups,DC=example,DC=com",
    samAccountName: "Developers",
    displayName: "Developers",
    objectClass: "group",
    attributes: { description: ["Development team group"] },
  },
  {
    distinguishedName: "CN=Finance-Analysts,OU=Groups,DC=example,DC=com",
    samAccountName: "Finance-Analysts",
    displayName: "Finance-Analysts",
    objectClass: "group",
    attributes: { description: ["Finance analysts group"] },
  },
];

const ouTree = [
  {
    distinguishedName: "OU=Groups,DC=example,DC=com",
    name: "Groups",
    children: [],
  },
  {
    distinguishedName: "OU=Archive,DC=example,DC=com",
    name: "Archive",
    children: [],
  },
];

function setupMocks(options?: {
  permissionLevel?: string;
  members?: DirectoryEntry[];
  failAtStep?: number;
}) {
  const permLevel = options?.permissionLevel ?? "AccountOperator";
  const members = options?.members ?? memberEntries;
  const failAtStep = options?.failAtStep;
  let invokeCount = 0;

  mockInvoke.mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "get_permission_level") return Promise.resolve(permLevel);
    if (cmd === "get_user_groups") return Promise.resolve([]);
    if (cmd === "search_groups") return Promise.resolve(groupSearchResults);
    if (cmd === "get_group_members") return Promise.resolve(members);
    if (cmd === "get_ou_tree") return Promise.resolve(ouTree);
    if (cmd === "search_users") {
      return Promise.resolve([
        {
          distinguishedName: "CN=Source User,OU=Users,DC=example,DC=com",
          samAccountName: "srcuser",
          displayName: "Source User",
          objectClass: "user",
          attributes: {
            memberOf: [
              "CN=GroupA,DC=example,DC=com",
              "CN=GroupB,DC=example,DC=com",
            ],
          },
        },
      ]);
    }
    if (cmd === "add_user_to_group") {
      invokeCount++;
      if (failAtStep !== undefined && invokeCount >= failAtStep) {
        return Promise.reject(new Error("LDAP operation failed"));
      }
      return Promise.resolve(null);
    }
    if (cmd === "remove_group_member") {
      invokeCount++;
      if (failAtStep !== undefined && invokeCount >= failAtStep) {
        return Promise.reject(new Error("LDAP operation failed"));
      }
      return Promise.resolve(null);
    }
    if (cmd === "create_group")
      return Promise.resolve(
        `CN=${(args as Record<string, string>)?.name ?? "Test"},OU=Groups,DC=example,DC=com`,
      );
    if (cmd === "move_object") return Promise.resolve(null);
    if (cmd === "update_managed_by") return Promise.resolve(null);
    if (cmd === "save_file_dialog") return Promise.resolve("/tmp/test.csv");
    return Promise.resolve(null);
  }) as typeof invoke);
}

async function renderAndWait() {
  await act(async () => {
    render(<BulkOperations />, { wrapper: TestProviders });
  });
}

async function clickCard(opId: string) {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`op-card-${opId}`));
  });
}

async function selectSourceGroup() {
  const searchInput = screen.getAllByTestId("group-picker-search")[0];
  fireEvent.change(searchInput, { target: { value: "Dev" } });

  await waitFor(() => {
    expect(screen.getByTestId("group-option-Developers")).toBeInTheDocument();
  });

  await act(async () => {
    fireEvent.click(screen.getByTestId("group-option-Developers"));
  });

  await waitFor(() => {
    expect(screen.getByTestId("member-list")).toBeInTheDocument();
  });
}

async function selectTargetGroup() {
  const searchInputs = screen.getAllByTestId("group-picker-search");
  const targetInput = searchInputs[searchInputs.length - 1];
  fireEvent.change(targetInput, { target: { value: "Finance" } });

  await waitFor(() => {
    expect(
      screen.getByTestId("group-option-Finance-Analysts"),
    ).toBeInTheDocument();
  });

  await act(async () => {
    fireEvent.click(screen.getByTestId("group-option-Finance-Analysts"));
  });
}

describe("BulkOperations", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  // -----------------------------------------------------------------------
  // Operation Picker Tests
  // -----------------------------------------------------------------------

  it("renders operation picker with all operation cards", async () => {
    setupMocks();
    await renderAndWait();

    expect(screen.getByTestId("bulk-operations")).toBeInTheDocument();
    expect(screen.getByTestId("operation-picker")).toBeInTheDocument();

    expect(screen.getByTestId("op-card-transfer")).toBeInTheDocument();
    expect(screen.getByTestId("op-card-clone-group")).toBeInTheDocument();
    expect(screen.getByTestId("op-card-merge-groups")).toBeInTheDocument();
    expect(screen.getByTestId("op-card-copy-memberships")).toBeInTheDocument();
    expect(screen.getByTestId("op-card-import-csv")).toBeInTheDocument();
    expect(screen.getByTestId("op-card-export-csv")).toBeInTheDocument();
    expect(screen.getByTestId("op-card-move-groups")).toBeInTheDocument();
    expect(screen.getByTestId("op-card-create-groups")).toBeInTheDocument();
    expect(screen.getByTestId("op-card-update-manager")).toBeInTheDocument();
    expect(screen.getByTestId("op-card-delete")).toBeInTheDocument();
    expect(screen.getByTestId("op-card-add")).toBeInTheDocument();
  });

  it("clicking an operation card navigates to its panel", async () => {
    setupMocks();
    await renderAndWait();

    await clickCard("delete");

    expect(screen.getByTestId("bulk-back-btn")).toBeInTheDocument();
    // Operation type selector no longer exists - just the back button and panel
    expect(screen.queryByTestId("operation-picker")).not.toBeInTheDocument();
  });

  it("back button returns to operation picker", async () => {
    setupMocks();
    await renderAndWait();

    await clickCard("delete");
    expect(screen.getByTestId("bulk-back-btn")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-back-btn"));
    });
    expect(screen.getByTestId("operation-picker")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Member-based operation tests (Delete / Add / Transfer)
  // -----------------------------------------------------------------------

  it("delete mode shows source group selector", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("delete");

    expect(screen.getByTestId("source-group-section")).toBeInTheDocument();
    // Delete mode does not show a target group section
  });

  it("loads members when source group is selected", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("delete");
    await selectSourceGroup();

    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Wilson")).toBeInTheDocument();
  });

  it("member selection with checkboxes and select-all", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("delete");
    await selectSourceGroup();

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-member-John Doe"));
    });

    await waitFor(() => {
      expect(screen.getByText("1 selected")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-select-all"));
    });

    await waitFor(() => {
      expect(screen.getByText("3 selected")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-select-all"));
    });

    await waitFor(() => {
      expect(screen.getByText("0 selected")).toBeInTheDocument();
    });
  });

  it("preview generates correct planned changes for Delete", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("delete");
    await selectSourceGroup();

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-member-John Doe"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-preview-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    expect(screen.getByTestId("planned-change-0")).toBeInTheDocument();
    expect(screen.getByText("REMOVE")).toBeInTheDocument();
    expect(screen.getByText("from Developers")).toBeInTheDocument();
  });

  it("preview generates correct planned changes for Add", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("add");

    // Add mode: first select target group
    const searchInput = screen.getByTestId("group-picker-search");
    fireEvent.change(searchInput, { target: { value: "Finance" } });
    await waitFor(() => {
      expect(screen.getByTestId("group-option-Finance-Analysts")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("group-option-Finance-Analysts"));
    });

    // Then search for users to add via the staging area
    // The user search picker needs 3+ chars to trigger search
    const addSearchInput = screen.getByTestId("add-member-search-section").querySelector("input")!;
    await act(async () => {
      fireEvent.change(addSearchInput, { target: { value: "Source" } });
    });

    // Wait for debounced search results
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("search_users", { query: "Source" });
    });

    // Click to stage the user
    await waitFor(() => {
      expect(screen.getByText("Source User")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Source User"));
    });

    // Preview
    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-preview-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    expect(screen.getByText("ADD")).toBeInTheDocument();
    expect(screen.getByText("to Finance-Analysts")).toBeInTheDocument();
  });

  it("preview generates correct planned changes for Transfer (add + remove pairs)", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("transfer");
    await selectSourceGroup();
    await selectTargetGroup();

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-member-John Doe"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-preview-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    expect(screen.getByText("Planned Changes (2)")).toBeInTheDocument();
    expect(screen.getByText("ADD")).toBeInTheDocument();
    expect(screen.getByText("REMOVE")).toBeInTheDocument();
    expect(screen.getByText("to Finance-Analysts")).toBeInTheDocument();
    expect(screen.getByText("from Developers")).toBeInTheDocument();
  });

  it("execute calls correct Tauri commands for Delete", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("delete");
    await selectSourceGroup();

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-member-John Doe"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-preview-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-execute-btn"));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("remove_group_member", {
        memberDn: "CN=John Doe,OU=Users,OU=Corp,DC=example,DC=com",
        groupDn: "CN=Developers,OU=Groups,DC=example,DC=com",
      });
    });
  });

  it("execute calls correct Tauri commands for Add", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("add");

    // Select target group
    const searchInput = screen.getByTestId("group-picker-search");
    fireEvent.change(searchInput, { target: { value: "Finance" } });
    await waitFor(() => {
      expect(screen.getByTestId("group-option-Finance-Analysts")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("group-option-Finance-Analysts"));
    });

    // Search and stage a user
    const addSearchInput = screen.getByTestId("add-member-search-section").querySelector("input")!;
    await act(async () => {
      fireEvent.change(addSearchInput, { target: { value: "Source" } });
    });

    await waitFor(() => {
      expect(screen.getByText("Source User")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Source User"));
    });

    // Preview
    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-preview-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-execute-btn"));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("add_user_to_group", {
        userDn: "CN=Source User,OU=Users,DC=example,DC=com",
        groupDn: "CN=Finance-Analysts,OU=Groups,DC=example,DC=com",
      });
    });
  });

  it("execute calls correct Tauri commands for Transfer", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("transfer");
    await selectSourceGroup();
    await selectTargetGroup();

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-member-John Doe"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-preview-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-execute-btn"));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("add_user_to_group", {
        userDn: "CN=John Doe,OU=Users,OU=Corp,DC=example,DC=com",
        groupDn: "CN=Finance-Analysts,OU=Groups,DC=example,DC=com",
      });
      expect(mockInvoke).toHaveBeenCalledWith("remove_group_member", {
        memberDn: "CN=John Doe,OU=Users,OU=Corp,DC=example,DC=com",
        groupDn: "CN=Developers,OU=Groups,DC=example,DC=com",
      });
    });
  });

  it("progress indicator updates during execution", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("delete");
    await selectSourceGroup();

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-member-John Doe"));
      fireEvent.click(screen.getByTestId("bulk-member-Alice Smith"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-preview-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-execute-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-progress")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-progress-message")).toHaveTextContent(
        "Successfully completed 2 operations.",
      );
    });
  });

  it("rollback reverses completed operations on failure", async () => {
    setupMocks({ failAtStep: 2 });
    await renderAndWait();
    await clickCard("delete");
    await selectSourceGroup();

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-member-John Doe"));
      fireEvent.click(screen.getByTestId("bulk-member-Alice Smith"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-preview-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-execute-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-progress-message")).toHaveTextContent(
        /Failed at step.*Rolled back/,
      );
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("add_user_to_group", {
        userDn: "CN=John Doe,OU=Users,OU=Corp,DC=example,DC=com",
        groupDn: "CN=Developers,OU=Groups,DC=example,DC=com",
      });
    });
  });

  it("permission gating disables cards for insufficient permissions", async () => {
    setupMocks({ permissionLevel: "ReadOnly" });
    await renderAndWait();

    expect(screen.getByTestId("operation-picker")).toBeInTheDocument();

    // Export CSV should still be enabled (ReadOnly permission)
    const exportCard = screen.getByTestId("op-card-export-csv");
    expect(exportCard).not.toBeDisabled();

    // Delete should be disabled (requires AccountOperator)
    const deleteCard = screen.getByTestId("op-card-delete");
    expect(deleteCard).toBeDisabled();
  });

  // -----------------------------------------------------------------------
  // Export CSV Tests
  // -----------------------------------------------------------------------

  it("export-csv operation shows group selector and export button", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("export-csv");

    expect(screen.getByTestId("source-group-section")).toBeInTheDocument();

    const searchInput = screen.getByTestId("group-picker-search");
    fireEvent.change(searchInput, { target: { value: "Dev" } });

    await waitFor(() => {
      expect(
        screen.getByTestId("group-option-Developers"),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("group-option-Developers"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("member-list")).toBeInTheDocument();
    });

    expect(screen.getByTestId("bulk-export-btn")).toBeInTheDocument();
  });

  it("export-csv triggers CSV download via save_file_dialog", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("export-csv");

    const searchInput = screen.getByTestId("group-picker-search");
    fireEvent.change(searchInput, { target: { value: "Dev" } });

    await waitFor(() => {
      expect(
        screen.getByTestId("group-option-Developers"),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("group-option-Developers"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("member-list")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-export-btn"));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "save_file_dialog",
        expect.objectContaining({
          defaultName: "Developers_members.csv",
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Copy Memberships Tests
  // -----------------------------------------------------------------------

  it("copy-memberships shows user search pickers", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("copy-memberships");

    expect(screen.getByTestId("source-user-section")).toBeInTheDocument();
    expect(screen.getByTestId("target-user-section")).toBeInTheDocument();
    // UserSearchPicker renders with testId-input
    expect(screen.getByTestId("copy-source-user-input")).toBeInTheDocument();
    expect(screen.getByTestId("copy-target-user-input")).toBeInTheDocument();
  });

  it("copy-memberships search resolves user via UserSearchPicker", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("copy-memberships");

    // Type 3+ chars to trigger search
    fireEvent.change(screen.getByTestId("copy-source-user-input"), {
      target: { value: "srcuser" },
    });

    // Wait for debounced search
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("search_users", { query: "srcuser" });
    });

    // Click the result to select it
    await waitFor(() => {
      expect(screen.getByText("Source User")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Source User"));
    });

    // After selection, the selected state should show the user name
    await waitFor(() => {
      expect(screen.getByTestId("copy-source-user-selected")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Clone Group Tests
  // -----------------------------------------------------------------------

  it("clone-group shows source group, name input and OU picker", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("clone-group");

    expect(screen.getByTestId("source-group-section")).toBeInTheDocument();
    expect(screen.getByTestId("clone-name-input")).toBeInTheDocument();
    // Container is now an OUPicker, not a text input
    expect(screen.getByTestId("clone-container-picker")).toBeInTheDocument();
  });

  it("clone-group execute creates group and adds members", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("clone-group");

    // Select source group
    const searchInput = screen.getByTestId("group-picker-search");
    fireEvent.change(searchInput, { target: { value: "Dev" } });
    await waitFor(() => {
      expect(
        screen.getByTestId("group-option-Developers"),
      ).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("group-option-Developers"));
    });

    await waitFor(() => {
      expect(screen.getByText(/3 members/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("clone-name-input"), {
      target: { value: "Dev-Clone" },
    });

    // Select OU from the OUPicker dropdown
    const ouPickerBtn = screen.getByTestId("clone-container-picker").querySelector("button")!;
    fireEvent.click(ouPickerBtn);
    await waitFor(() => {
      expect(screen.getByText("Groups")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Groups"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-execute-btn"));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_group", {
        name: "Dev-Clone",
        containerDn: "OU=Groups,DC=example,DC=com",
        scope: "Global",
        category: "Security",
        description: "Clone of Developers",
      });
    });
  });

  // -----------------------------------------------------------------------
  // Merge Groups Tests
  // -----------------------------------------------------------------------

  it("merge-groups shows source and target group pickers", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("merge-groups");

    expect(screen.getByTestId("source-group-section")).toBeInTheDocument();
    expect(screen.getByTestId("target-group-section")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Import CSV Tests
  // -----------------------------------------------------------------------

  it("import-csv shows target group and file input", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("import-csv");

    expect(screen.getByTestId("target-group-section")).toBeInTheDocument();
    expect(screen.getByTestId("csv-file-input")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Move Groups Tests
  // -----------------------------------------------------------------------

  it("move-groups shows group picker and OU picker", async () => {
    setupMocks({ permissionLevel: "DomainAdmin" });
    await renderAndWait();
    await clickCard("move-groups");

    expect(screen.getByTestId("source-group-section")).toBeInTheDocument();
    // OUPicker now used instead of text input
    expect(screen.getByTestId("move-target-ou-picker")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Create Groups Tests
  // -----------------------------------------------------------------------

  it("create-groups shows CSV file input", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("create-groups");

    expect(screen.getByTestId("create-groups-csv-input")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Update Manager Tests
  // -----------------------------------------------------------------------

  it("update-manager shows group picker and UserSearchPicker", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("update-manager");

    expect(screen.getByTestId("source-group-section")).toBeInTheDocument();
    // UserSearchPicker with testId "manager-user"
    expect(screen.getByTestId("manager-user")).toBeInTheDocument();
  });

  it("update-manager search resolves manager user via UserSearchPicker", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("update-manager");

    // Type 3+ chars to trigger search
    fireEvent.change(screen.getByTestId("manager-user-input"), {
      target: { value: "srcuser" },
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("search_users", { query: "srcuser" });
    });

    await waitFor(() => {
      expect(screen.getByText("Source User")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Source User"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("manager-user-selected")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Member list CSV export button
  // -----------------------------------------------------------------------

  it("member list shows inline export CSV button", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("delete");
    await selectSourceGroup();

    expect(screen.getByTestId("member-export-csv-btn")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Merge Groups - Execute Test
  // -----------------------------------------------------------------------

  it("merge-groups execute adds unique members from source to target", async () => {
    const targetMembers: DirectoryEntry[] = [
      {
        distinguishedName: "CN=John Doe,OU=Users,OU=Corp,DC=example,DC=com",
        samAccountName: "jdoe",
        displayName: "John Doe",
        objectClass: "user",
        attributes: {},
      },
    ];

    let getGroupMembersCallCount = 0;
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_permission_level") return Promise.resolve("AccountOperator");
      if (cmd === "search_groups") return Promise.resolve(groupSearchResults);
      if (cmd === "get_user_groups") return Promise.resolve([]);
      if (cmd === "get_ou_tree") return Promise.resolve(ouTree);
      if (cmd === "get_group_members") {
        getGroupMembersCallCount++;
        // First call is from the useEffect when source group is selected (returns memberEntries).
        // During merge execute: source group members, then target group members.
        if (getGroupMembersCallCount <= 1) return Promise.resolve(memberEntries);
        // 2nd call = source in merge, 3rd call = target in merge
        if (getGroupMembersCallCount === 2) return Promise.resolve(memberEntries);
        return Promise.resolve(targetMembers);
      }
      if (cmd === "add_user_to_group") return Promise.resolve(null);
      return Promise.resolve(null);
    }) as typeof invoke);

    await renderAndWait();
    await clickCard("merge-groups");

    // Select source group
    const searchInputs = screen.getAllByTestId("group-picker-search");
    fireEvent.change(searchInputs[0], { target: { value: "Dev" } });
    await waitFor(() => {
      expect(screen.getByTestId("group-option-Developers")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("group-option-Developers"));
    });

    // Select target group
    const searchInputs2 = screen.getAllByTestId("group-picker-search");
    const targetInput = searchInputs2[1];
    fireEvent.change(targetInput, { target: { value: "Finance" } });
    await waitFor(() => {
      expect(screen.getByTestId("group-option-Finance-Analysts")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("group-option-Finance-Analysts"));
    });

    // Click execute
    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-execute-btn"));
    });

    // The merge should add Alice and Bob (not John, who is already in target)
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("add_user_to_group", {
        userDn: "CN=Alice Smith,OU=Users,OU=Corp,DC=example,DC=com",
        groupDn: "CN=Finance-Analysts,OU=Groups,DC=example,DC=com",
      });
      expect(mockInvoke).toHaveBeenCalledWith("add_user_to_group", {
        userDn: "CN=Bob Wilson,OU=Users,OU=Corp,DC=example,DC=com",
        groupDn: "CN=Finance-Analysts,OU=Groups,DC=example,DC=com",
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-progress-message")).toHaveTextContent(
        /Merged 2 new members into Finance-Analysts/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Copy User Groups - Execute Test
  // -----------------------------------------------------------------------

  it("copy-memberships execute adds target user to source user groups", async () => {
    mockInvoke.mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_permission_level") return Promise.resolve("AccountOperator");
      if (cmd === "search_groups") return Promise.resolve(groupSearchResults);
      if (cmd === "get_user_groups") return Promise.resolve([]);
      if (cmd === "get_group_members") return Promise.resolve(memberEntries);
      if (cmd === "get_ou_tree") return Promise.resolve(ouTree);
      if (cmd === "search_users") {
        const query = (args as { query: string })?.query ?? "";
        if (query.includes("src")) {
          return Promise.resolve([
            {
              distinguishedName: "CN=Source User,OU=Users,DC=example,DC=com",
              samAccountName: "srcuser",
              displayName: "Source User",
              objectClass: "user",
              attributes: {
                memberOf: [
                  "CN=GroupA,DC=example,DC=com",
                  "CN=GroupB,DC=example,DC=com",
                ],
              },
            },
          ]);
        }
        // Target user with no overlapping groups
        return Promise.resolve([
          {
            distinguishedName: "CN=Target User,OU=Users,DC=example,DC=com",
            samAccountName: "tgtuser",
            displayName: "Target User",
            objectClass: "user",
            attributes: {
              memberOf: [],
            },
          },
        ]);
      }
      if (cmd === "get_user") {
        const a = args as { samAccountName: string };
        if (a.samAccountName === "srcuser") {
          return Promise.resolve({
            distinguishedName: "CN=Source User,OU=Users,DC=example,DC=com",
            samAccountName: "srcuser",
            displayName: "Source User",
            objectClass: "user",
            attributes: {
              memberOf: [
                "CN=GroupA,DC=example,DC=com",
                "CN=GroupB,DC=example,DC=com",
              ],
            },
          });
        }
        return Promise.resolve({
          distinguishedName: "CN=Target User,OU=Users,DC=example,DC=com",
          samAccountName: "tgtuser",
          displayName: "Target User",
          objectClass: "user",
          attributes: { memberOf: [] },
        });
      }
      if (cmd === "add_user_to_group") return Promise.resolve(null);
      return Promise.resolve(null);
    }) as typeof invoke);

    await renderAndWait();
    await clickCard("copy-memberships");

    // Search and select source user via UserSearchPicker
    fireEvent.change(screen.getByTestId("copy-source-user-input"), {
      target: { value: "srcuser" },
    });
    await waitFor(() => {
      expect(screen.getByText("Source User")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Source User"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("copy-source-user-selected")).toBeInTheDocument();
    });

    // Search and select target user via UserSearchPicker
    fireEvent.change(screen.getByTestId("copy-target-user-input"), {
      target: { value: "tgtuser" },
    });
    await waitFor(() => {
      expect(screen.getByText("Target User")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Target User"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("copy-target-user-selected")).toBeInTheDocument();
    });

    // Preview
    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-preview-btn"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    // Execute
    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-execute-btn"));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("add_user_to_group", {
        userDn: "CN=Target User,OU=Users,DC=example,DC=com",
        groupDn: "CN=GroupA,DC=example,DC=com",
      });
      expect(mockInvoke).toHaveBeenCalledWith("add_user_to_group", {
        userDn: "CN=Target User,OU=Users,DC=example,DC=com",
        groupDn: "CN=GroupB,DC=example,DC=com",
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-progress-message")).toHaveTextContent(
        /Successfully added Target User to 2 groups/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Import CSV - Parse and Execute Test
  // -----------------------------------------------------------------------

  it("import-csv parses CSV file and executes import", async () => {
    let searchCallCount = 0;
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_permission_level") return Promise.resolve("AccountOperator");
      if (cmd === "search_groups") return Promise.resolve(groupSearchResults);
      if (cmd === "get_user_groups") return Promise.resolve([]);
      if (cmd === "get_group_members") return Promise.resolve(memberEntries);
      if (cmd === "get_ou_tree") return Promise.resolve(ouTree);
      if (cmd === "search_users") {
        searchCallCount++;
        // Return a user matching the samAccountName from the CSV
        return Promise.resolve([
          {
            distinguishedName: `CN=User${searchCallCount},OU=Users,DC=example,DC=com`,
            samAccountName: searchCallCount === 1 ? "jdoe" : "asmith",
            displayName: searchCallCount === 1 ? "John Doe" : "Alice Smith",
            objectClass: "user",
            attributes: {},
          },
        ]);
      }
      if (cmd === "add_user_to_group") return Promise.resolve(null);
      return Promise.resolve(null);
    }) as typeof invoke);

    await renderAndWait();
    await clickCard("import-csv");

    // Select target group
    const searchInput = screen.getByTestId("group-picker-search");
    fireEvent.change(searchInput, { target: { value: "Finance" } });
    await waitFor(() => {
      expect(screen.getByTestId("group-option-Finance-Analysts")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("group-option-Finance-Analysts"));
    });

    // Upload CSV file
    const csvContent = "samAccountName\njdoe\nasmith";
    const file = new File([csvContent], "test.csv", { type: "text/csv" });
    const fileInput = screen.getByTestId("csv-file-input");

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    // Wait for CSV to be parsed (the FileReader is async)
    // CSV has 3 rows total (header + 2 data rows)
    await waitFor(() => {
      expect(screen.getByText(/3 rows loaded from CSV/)).toBeInTheDocument();
    });

    // Click Resolve & Preview
    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-preview-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    // Execute
    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-execute-btn"));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("add_user_to_group", {
        userDn: "CN=User1,OU=Users,DC=example,DC=com",
        groupDn: "CN=Finance-Analysts,OU=Groups,DC=example,DC=com",
      });
      expect(mockInvoke).toHaveBeenCalledWith("add_user_to_group", {
        userDn: "CN=User2,OU=Users,DC=example,DC=com",
        groupDn: "CN=Finance-Analysts,OU=Groups,DC=example,DC=com",
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-progress-message")).toHaveTextContent(
        /Successfully imported 2 members into Finance-Analysts/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Move Groups - Execute Test
  // -----------------------------------------------------------------------

  it("move-groups execute calls move_object for each group", async () => {
    setupMocks({ permissionLevel: "DomainAdmin" });
    await renderAndWait();
    await clickCard("move-groups");

    // Select source group
    const searchInput = screen.getByTestId("group-picker-search");
    fireEvent.change(searchInput, { target: { value: "Dev" } });
    await waitFor(() => {
      expect(screen.getByTestId("group-option-Developers")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("group-option-Developers"));
    });

    // Select OU from OUPicker
    const ouPickerBtn = screen.getByTestId("move-target-ou-picker").querySelector("button")!;
    fireEvent.click(ouPickerBtn);
    await waitFor(() => {
      expect(screen.getByText("Archive")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Archive"));

    // Execute
    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-execute-btn"));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("move_object", {
        objectDn: "CN=Developers,OU=Groups,DC=example,DC=com",
        targetContainerDn: "OU=Archive,DC=example,DC=com",
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-progress-message")).toHaveTextContent(
        /Successfully moved 1 group/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Create Groups - Execute Test
  // -----------------------------------------------------------------------

  it("create-groups parses CSV and executes create_group for each row", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("create-groups");

    // Upload CSV with header + 2 data rows (OU values quoted since they contain commas)
    const csvContent =
      'name,description,scope,category,OU\nTestGroup1,Test group one,Global,Security,"OU=Groups,DC=example,DC=com"\nTestGroup2,Test group two,DomainLocal,Distribution,"OU=Dist,DC=example,DC=com"';
    const file = new File([csvContent], "groups.csv", { type: "text/csv" });
    const fileInput = screen.getByTestId("create-groups-csv-input");

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    // Wait for CSV to be parsed and preview to show
    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    // Execute
    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-execute-btn"));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_group", {
        name: "TestGroup1",
        containerDn: "OU=Groups,DC=example,DC=com",
        scope: "Global",
        category: "Security",
        description: "Test group one",
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-progress-message")).toHaveTextContent(
        /Successfully created/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Update Manager - Execute Test
  // -----------------------------------------------------------------------

  it("update-manager execute calls update_managed_by for each group", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("update-manager");

    // Select source group
    const searchInput = screen.getByTestId("group-picker-search");
    fireEvent.change(searchInput, { target: { value: "Dev" } });
    await waitFor(() => {
      expect(screen.getByTestId("group-option-Developers")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("group-option-Developers"));
    });

    // Search and select manager via UserSearchPicker
    fireEvent.change(screen.getByTestId("manager-user-input"), {
      target: { value: "srcuser" },
    });
    await waitFor(() => {
      expect(screen.getByText("Source User")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Source User"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("manager-user-selected")).toBeInTheDocument();
    });

    // Execute
    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-execute-btn"));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("update_managed_by", {
        groupDn: "CN=Developers,OU=Groups,DC=example,DC=com",
        managerDn: "CN=Source User,OU=Users,DC=example,DC=com",
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-progress-message")).toHaveTextContent(
        /Manager updated on 1 group/,
      );
    });
  });
});
