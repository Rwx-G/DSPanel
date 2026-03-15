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
  const targetInput = searchInputs[1];
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
    expect(screen.getByTestId("operation-type-selector")).toBeInTheDocument();
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

  it("delete mode shows source/target group selectors", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("delete");

    expect(screen.getByTestId("source-group-section")).toBeInTheDocument();
    expect(screen.getByTestId("target-group-section")).toBeInTheDocument();
  });

  it("delete mode disables target group selector", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("delete");

    const targetSection = screen.getByTestId("target-group-section");
    const targetPicker = targetSection.querySelector(
      '[data-testid="group-picker"]',
    );
    expect(targetPicker).toHaveClass("pointer-events-none");
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
    await selectSourceGroup();
    await selectTargetGroup();

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-member-Alice Smith"));
    });
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

  it("copy-memberships shows user search inputs", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("copy-memberships");

    expect(screen.getByTestId("source-user-section")).toBeInTheDocument();
    expect(screen.getByTestId("target-user-section")).toBeInTheDocument();
    expect(screen.getByTestId("copy-source-user-input")).toBeInTheDocument();
    expect(screen.getByTestId("copy-target-user-input")).toBeInTheDocument();
  });

  it("copy-memberships search resolves user", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("copy-memberships");

    fireEvent.change(screen.getByTestId("copy-source-user-input"), {
      target: { value: "srcuser" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("copy-source-user-search"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("copy-source-user-result")).toHaveTextContent(
        "Found: Source User",
      );
    });
  });

  // -----------------------------------------------------------------------
  // Clone Group Tests
  // -----------------------------------------------------------------------

  it("clone-group shows source group, name input and container input", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("clone-group");

    expect(screen.getByTestId("source-group-section")).toBeInTheDocument();
    expect(screen.getByTestId("clone-name-input")).toBeInTheDocument();
    expect(screen.getByTestId("clone-container-input")).toBeInTheDocument();
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
    fireEvent.change(screen.getByTestId("clone-container-input"), {
      target: { value: "OU=Groups,DC=example,DC=com" },
    });

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

  it("move-groups shows group picker and target OU input", async () => {
    setupMocks({ permissionLevel: "DomainAdmin" });
    await renderAndWait();
    await clickCard("move-groups");

    expect(screen.getByTestId("source-group-section")).toBeInTheDocument();
    expect(screen.getByTestId("move-target-ou-input")).toBeInTheDocument();
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

  it("update-manager shows group picker and manager input", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("update-manager");

    expect(screen.getByTestId("source-group-section")).toBeInTheDocument();
    expect(screen.getByTestId("manager-user-input")).toBeInTheDocument();
  });

  it("update-manager search resolves manager user", async () => {
    setupMocks();
    await renderAndWait();
    await clickCard("update-manager");

    fireEvent.change(screen.getByTestId("manager-user-input"), {
      target: { value: "srcuser" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("manager-user-search"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("manager-user-result")).toHaveTextContent(
        "Found: Source User",
      );
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
});
