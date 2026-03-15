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

  mockInvoke.mockImplementation(((cmd: string) => {
    if (cmd === "get_permission_level") return Promise.resolve(permLevel);
    if (cmd === "get_user_groups") return Promise.resolve([]);
    if (cmd === "search_groups") return Promise.resolve(groupSearchResults);
    if (cmd === "get_group_members") return Promise.resolve(members);
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
    return Promise.resolve(null);
  }) as typeof invoke);
}

async function selectSourceGroup() {
  const searchInput = screen.getAllByTestId("group-picker-search")[0];
  fireEvent.change(searchInput, { target: { value: "Dev" } });

  await waitFor(() => {
    expect(screen.getByTestId("group-option-Developers")).toBeInTheDocument();
  });

  fireEvent.click(screen.getByTestId("group-option-Developers"));

  await waitFor(() => {
    expect(screen.getByTestId("member-list")).toBeInTheDocument();
  });
}

async function selectTargetGroup() {
  const searchInputs = screen.getAllByTestId("group-picker-search");
  const targetInput = searchInputs[1];
  fireEvent.change(targetInput, { target: { value: "Finance" } });

  await waitFor(() => {
    expect(screen.getByTestId("group-option-Finance-Analysts")).toBeInTheDocument();
  });

  fireEvent.click(screen.getByTestId("group-option-Finance-Analysts"));
}

describe("BulkOperations", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("renders with operation type selector, source/target group inputs", () => {
    setupMocks();
    render(<BulkOperations />, { wrapper: TestProviders });

    expect(screen.getByTestId("bulk-operations")).toBeInTheDocument();
    expect(screen.getByTestId("operation-type-selector")).toBeInTheDocument();
    expect(screen.getByTestId("source-group-section")).toBeInTheDocument();
    expect(screen.getByTestId("target-group-section")).toBeInTheDocument();
  });

  it("delete mode disables target group selector", async () => {
    setupMocks();
    render(<BulkOperations />, { wrapper: TestProviders });

    // Delete is the default mode
    expect(screen.getByTestId("op-type-delete")).toBeInTheDocument();

    // Target group picker should be disabled
    const targetSection = screen.getByTestId("target-group-section");
    const targetPicker = targetSection.querySelector(
      '[data-testid="group-picker"]',
    );
    expect(targetPicker).toHaveClass("pointer-events-none");
  });

  it("add mode enables both source and target", async () => {
    setupMocks();
    render(<BulkOperations />, { wrapper: TestProviders });

    fireEvent.click(screen.getByTestId("op-type-add"));

    await waitFor(() => {
      const targetSection = screen.getByTestId("target-group-section");
      const targetPicker = targetSection.querySelector(
        '[data-testid="group-picker"]',
      );
      expect(targetPicker).not.toHaveClass("pointer-events-none");
    });
  });

  it("transfer mode enables both source and target", async () => {
    setupMocks();
    render(<BulkOperations />, { wrapper: TestProviders });

    fireEvent.click(screen.getByTestId("op-type-transfer"));

    await waitFor(() => {
      const targetSection = screen.getByTestId("target-group-section");
      const targetPicker = targetSection.querySelector(
        '[data-testid="group-picker"]',
      );
      expect(targetPicker).not.toHaveClass("pointer-events-none");
    });
  });

  it("loads members when source group is selected", async () => {
    setupMocks();
    render(<BulkOperations />, { wrapper: TestProviders });

    await selectSourceGroup();

    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Wilson")).toBeInTheDocument();
  });

  it("member selection with checkboxes and select-all", async () => {
    setupMocks();
    render(<BulkOperations />, { wrapper: TestProviders });

    await selectSourceGroup();

    // Select individual member
    fireEvent.click(screen.getByTestId("bulk-member-John Doe"));

    await waitFor(() => {
      expect(screen.getByText("1 selected")).toBeInTheDocument();
    });

    // Select all
    fireEvent.click(screen.getByTestId("bulk-select-all"));

    await waitFor(() => {
      expect(screen.getByText("3 selected")).toBeInTheDocument();
    });

    // Deselect all
    fireEvent.click(screen.getByTestId("bulk-select-all"));

    await waitFor(() => {
      expect(screen.getByText("0 selected")).toBeInTheDocument();
    });
  });

  it("preview generates correct planned changes for Delete", async () => {
    setupMocks();
    render(<BulkOperations />, { wrapper: TestProviders });

    await selectSourceGroup();

    // Select a member
    fireEvent.click(screen.getByTestId("bulk-member-John Doe"));

    // Click preview
    fireEvent.click(screen.getByTestId("bulk-preview-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    expect(screen.getByTestId("planned-change-0")).toBeInTheDocument();
    expect(screen.getByText("REMOVE")).toBeInTheDocument();
    // Should show "from" the source group
    expect(screen.getByText("from Developers")).toBeInTheDocument();
  });

  it("preview generates correct planned changes for Add", async () => {
    setupMocks();
    render(<BulkOperations />, { wrapper: TestProviders });

    // Switch to Add mode
    fireEvent.click(screen.getByTestId("op-type-add"));

    await selectSourceGroup();
    await selectTargetGroup();

    // Select a member
    fireEvent.click(screen.getByTestId("bulk-member-Alice Smith"));

    // Click preview
    fireEvent.click(screen.getByTestId("bulk-preview-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    expect(screen.getByText("ADD")).toBeInTheDocument();
    expect(screen.getByText("to Finance-Analysts")).toBeInTheDocument();
  });

  it("preview generates correct planned changes for Transfer (add + remove pairs)", async () => {
    setupMocks();
    render(<BulkOperations />, { wrapper: TestProviders });

    // Switch to Transfer mode
    fireEvent.click(screen.getByTestId("op-type-transfer"));

    await selectSourceGroup();
    await selectTargetGroup();

    // Select a member
    fireEvent.click(screen.getByTestId("bulk-member-John Doe"));

    // Click preview
    fireEvent.click(screen.getByTestId("bulk-preview-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    // Transfer generates add + remove pairs
    expect(screen.getByText("Planned Changes (2)")).toBeInTheDocument();
    expect(screen.getByText("ADD")).toBeInTheDocument();
    expect(screen.getByText("REMOVE")).toBeInTheDocument();
    expect(screen.getByText("to Finance-Analysts")).toBeInTheDocument();
    expect(screen.getByText("from Developers")).toBeInTheDocument();
  });

  it("execute calls correct Tauri commands for Delete", async () => {
    setupMocks();
    render(<BulkOperations />, { wrapper: TestProviders });

    await selectSourceGroup();

    fireEvent.click(screen.getByTestId("bulk-member-John Doe"));

    // Preview first to generate planned changes
    fireEvent.click(screen.getByTestId("bulk-preview-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    // Execute
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
    render(<BulkOperations />, { wrapper: TestProviders });

    fireEvent.click(screen.getByTestId("op-type-add"));

    await selectSourceGroup();
    await selectTargetGroup();

    fireEvent.click(screen.getByTestId("bulk-member-John Doe"));

    fireEvent.click(screen.getByTestId("bulk-preview-btn"));

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
    render(<BulkOperations />, { wrapper: TestProviders });

    fireEvent.click(screen.getByTestId("op-type-transfer"));

    await selectSourceGroup();
    await selectTargetGroup();

    fireEvent.click(screen.getByTestId("bulk-member-John Doe"));

    fireEvent.click(screen.getByTestId("bulk-preview-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-execute-btn"));
    });

    // Transfer calls add_user_to_group first, then remove_group_member
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
    render(<BulkOperations />, { wrapper: TestProviders });

    await selectSourceGroup();

    // Select multiple members
    fireEvent.click(screen.getByTestId("bulk-member-John Doe"));
    fireEvent.click(screen.getByTestId("bulk-member-Alice Smith"));

    fireEvent.click(screen.getByTestId("bulk-preview-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-execute-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-progress")).toBeInTheDocument();
    });

    // Should eventually show completed
    await waitFor(() => {
      expect(screen.getByTestId("bulk-progress-message")).toHaveTextContent(
        "Successfully completed 2 operations.",
      );
    });
  });

  it("rollback reverses completed operations on failure", async () => {
    // Fail at step 2 (second operation)
    setupMocks({ failAtStep: 2 });
    render(<BulkOperations />, { wrapper: TestProviders });

    await selectSourceGroup();

    // Select two members
    fireEvent.click(screen.getByTestId("bulk-member-John Doe"));
    fireEvent.click(screen.getByTestId("bulk-member-Alice Smith"));

    fireEvent.click(screen.getByTestId("bulk-preview-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("bulk-preview-panel")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-execute-btn"));
    });

    // Should show failed status with rollback message
    await waitFor(() => {
      expect(screen.getByTestId("bulk-progress-message")).toHaveTextContent(
        /Failed at step.*Rolled back/,
      );
    });

    // Verify rollback call was made (reversal of the first successful remove)
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("add_user_to_group", {
        userDn: "CN=John Doe,OU=Users,OU=Corp,DC=example,DC=com",
        groupDn: "CN=Developers,OU=Groups,DC=example,DC=com",
      });
    });
  });

  it("permission gating hides execute for non-AccountOperator", async () => {
    setupMocks({ permissionLevel: "ReadOnly" });
    render(<BulkOperations />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("bulk-no-permission")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("bulk-action-buttons")).not.toBeInTheDocument();
  });
});
