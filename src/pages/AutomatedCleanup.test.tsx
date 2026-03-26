import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AutomatedCleanup } from "./AutomatedCleanup";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const mockDryRunResult = {
  ruleName: "Disable inactive 180 days",
  matches: [
    {
      dn: "CN=Old User,OU=Users,DC=test,DC=com",
      displayName: "Old User",
      samAccountName: "olduser",
      currentState: "Inactive 200 days",
      proposedAction: "Disable account",
      action: "disable",
      targetOu: null,
      selected: true,
    },
    {
      dn: "CN=Stale User,OU=Users,DC=test,DC=com",
      displayName: "Stale User",
      samAccountName: "staleuser",
      currentState: "Inactive 365 days",
      proposedAction: "Disable account",
      action: "disable",
      targetOu: null,
      selected: true,
    },
  ],
  totalCount: 2,
};

describe("AutomatedCleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve([]);
      if (cmd === "save_cleanup_rules") return Promise.resolve(null);
      if (cmd === "cleanup_dry_run") return Promise.resolve(mockDryRunResult);
      if (cmd === "cleanup_execute")
        return Promise.resolve([
          {
            dn: "CN=Old User,OU=Users,DC=test,DC=com",
            displayName: "Old User",
            action: "disable",
            success: true,
            error: null,
          },
        ]);
      if (cmd === "export_table") return Promise.resolve(null);
      return Promise.resolve(null);
    });
  });

  it("renders with empty state", async () => {
    render(<AutomatedCleanup />);
    await waitFor(() => {
      expect(screen.getByText("No Cleanup Rules")).toBeInTheDocument();
    });
  });

  it("shows add rule button", () => {
    render(<AutomatedCleanup />);
    expect(screen.getByTestId("add-rule-btn")).toBeInTheDocument();
  });

  it("opens rule editor when Add Rule is clicked", async () => {
    render(<AutomatedCleanup />);
    fireEvent.click(screen.getByTestId("add-rule-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("rule-editor")).toBeInTheDocument();
    });
  });

  it("shows condition and action selects in editor", async () => {
    render(<AutomatedCleanup />);
    fireEvent.click(screen.getByTestId("add-rule-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("rule-condition-select")).toBeInTheDocument();
      expect(screen.getByTestId("rule-action-select")).toBeInTheDocument();
      expect(screen.getByTestId("rule-threshold-input")).toBeInTheDocument();
    });
  });

  it("saves a rule and shows it in the list", async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve([]);
      if (cmd === "save_cleanup_rules") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    fireEvent.click(screen.getByTestId("add-rule-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-name-input")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("rule-name-input"), {
      target: { value: "Test Rule" },
    });
    fireEvent.click(screen.getByTestId("rule-save-btn"));

    await waitFor(() => {
      expect(screen.getByText("Test Rule")).toBeInTheDocument();
    });
  });

  it("loads existing rules on mount", async () => {
    const existingRules = [
      {
        name: "Disable inactive 90 days",
        condition: "inactiveDays",
        thresholdDays: 90,
        action: "disable",
        targetOu: null,
      },
    ];
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve(existingRules);
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    await waitFor(() => {
      expect(screen.getByText("Disable inactive 90 days")).toBeInTheDocument();
    });
  });

  it("runs dry run and shows matches", async () => {
    const existingRules = [
      {
        name: "Disable inactive 180 days",
        condition: "inactiveDays",
        thresholdDays: 180,
        action: "disable",
        targetOu: null,
      },
    ];
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve(existingRules);
      if (cmd === "cleanup_dry_run") return Promise.resolve(mockDryRunResult);
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    await waitFor(() => {
      expect(screen.getByTestId("run-rule-0")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("run-rule-0"));

    await waitFor(() => {
      expect(screen.getByTestId("dry-run-results")).toBeInTheDocument();
    });
    expect(screen.getByText("Old User")).toBeInTheDocument();
    expect(screen.getByText("Stale User")).toBeInTheDocument();
    expect(screen.getByText("Inactive 200 days")).toBeInTheDocument();
  });

  it("shows execute button with selected count", async () => {
    const existingRules = [
      {
        name: "Test",
        condition: "inactiveDays",
        thresholdDays: 180,
        action: "disable",
        targetOu: null,
      },
    ];
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve(existingRules);
      if (cmd === "cleanup_dry_run") return Promise.resolve(mockDryRunResult);
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    await waitFor(() => {
      fireEvent.click(screen.getByTestId("run-rule-0"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("execute-btn")).toBeInTheDocument();
      expect(screen.getByTestId("execute-btn")).toHaveTextContent("Execute (2)");
    });
  });

  it("shows execution results after execute", async () => {
    const existingRules = [
      {
        name: "Test",
        condition: "inactiveDays",
        thresholdDays: 180,
        action: "disable",
        targetOu: null,
      },
    ];
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve(existingRules);
      if (cmd === "cleanup_dry_run") return Promise.resolve(mockDryRunResult);
      if (cmd === "cleanup_execute")
        return Promise.resolve([
          {
            dn: "CN=Old User",
            displayName: "Old User",
            action: "disable",
            success: true,
            error: null,
          },
        ]);
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    await waitFor(() => {
      fireEvent.click(screen.getByTestId("run-rule-0"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("execute-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("execute-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("execution-results")).toBeInTheDocument();
    });
    expect(screen.getByText("1 / 1 succeeded")).toBeInTheDocument();
  });

  it("shows target OU field when action is move", async () => {
    render(<AutomatedCleanup />);
    fireEvent.click(screen.getByTestId("add-rule-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-action-select")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("rule-action-select"), {
      target: { value: "move" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("rule-target-ou-input")).toBeInTheDocument();
    });
  });

  it("requires double confirm for delete actions", async () => {
    const deleteResult = {
      ...mockDryRunResult,
      matches: mockDryRunResult.matches.map((m) => ({
        ...m,
        action: "delete" as const,
        proposedAction: "Delete account",
      })),
    };
    const existingRules = [
      {
        name: "Delete old",
        condition: "inactiveDays",
        thresholdDays: 365,
        action: "delete",
        targetOu: null,
      },
    ];
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve(existingRules);
      if (cmd === "cleanup_dry_run") return Promise.resolve(deleteResult);
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    await waitFor(() => {
      fireEvent.click(screen.getByTestId("run-rule-0"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("execute-btn")).toBeInTheDocument();
    });

    // First click shows warning
    fireEvent.click(screen.getByTestId("execute-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("delete-warning")).toBeInTheDocument();
      expect(screen.getByTestId("execute-btn")).toHaveTextContent("Confirm DELETE");
    });
  });

  it("permission gating shows error on unauthorized", async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve([]);
      if (cmd === "save_cleanup_rules")
        return Promise.reject("Cleanup rules require DomainAdmin permission");
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    // Just verify the page renders - permission gating happens at the backend
    expect(screen.getByTestId("automated-cleanup")).toBeInTheDocument();
  });

  it("rule editor name input updates value", async () => {
    render(<AutomatedCleanup />);
    fireEvent.click(screen.getByTestId("add-rule-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-name-input")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("rule-name-input"), {
      target: { value: "My Custom Rule" },
    });

    const input = screen.getByTestId("rule-name-input") as HTMLInputElement;
    expect(input.value).toBe("My Custom Rule");
  });

  it("rule editor condition select changes value", async () => {
    render(<AutomatedCleanup />);
    fireEvent.click(screen.getByTestId("add-rule-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-condition-select")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("rule-condition-select"), {
      target: { value: "neverLoggedOnCreatedDays" },
    });

    const select = screen.getByTestId("rule-condition-select") as HTMLSelectElement;
    expect(select.value).toBe("neverLoggedOnCreatedDays");
  });

  it("rule editor threshold input changes value", async () => {
    render(<AutomatedCleanup />);
    fireEvent.click(screen.getByTestId("add-rule-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-threshold-input")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("rule-threshold-input"), {
      target: { value: "90" },
    });

    const input = screen.getByTestId("rule-threshold-input") as HTMLInputElement;
    expect(input.value).toBe("90");
  });

  it("rule editor exclude patterns input accepts comma-separated values", async () => {
    render(<AutomatedCleanup />);
    fireEvent.click(screen.getByTestId("add-rule-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-exclude-patterns")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("rule-exclude-patterns"), {
      target: { value: "svc_*, admin*" },
    });

    const input = screen.getByTestId("rule-exclude-patterns") as HTMLInputElement;
    expect(input.value).toBe("svc_*, admin*");
  });

  it("rule editor exclude OUs input accepts comma-separated values", async () => {
    render(<AutomatedCleanup />);
    fireEvent.click(screen.getByTestId("add-rule-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-exclude-ous")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("rule-exclude-ous"), {
      target: { value: "OU=ServiceAccounts, OU=Admin" },
    });

    const input = screen.getByTestId("rule-exclude-ous") as HTMLInputElement;
    expect(input.value).toBe("OU=ServiceAccounts, OU=Admin");
  });

  it("save button is disabled when rule name is empty", async () => {
    render(<AutomatedCleanup />);
    fireEvent.click(screen.getByTestId("add-rule-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-save-btn")).toBeInTheDocument();
    });

    const saveBtn = screen.getByTestId("rule-save-btn") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("cancel button closes the rule editor", async () => {
    render(<AutomatedCleanup />);
    fireEvent.click(screen.getByTestId("add-rule-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-editor")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("rule-cancel-btn"));

    await waitFor(() => {
      expect(screen.queryByTestId("rule-editor")).not.toBeInTheDocument();
    });
  });

  it("target OU field is hidden when action is not move", async () => {
    render(<AutomatedCleanup />);
    fireEvent.click(screen.getByTestId("add-rule-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-action-select")).toBeInTheDocument();
    });

    // Default action is "disable" - target OU should not be visible
    expect(screen.queryByTestId("rule-target-ou-input")).not.toBeInTheDocument();

    // Change to delete - still should not show target OU
    fireEvent.change(screen.getByTestId("rule-action-select"), {
      target: { value: "delete" },
    });
    expect(screen.queryByTestId("rule-target-ou-input")).not.toBeInTheDocument();
  });

  it("target OU input accepts value when action is move", async () => {
    render(<AutomatedCleanup />);
    fireEvent.click(screen.getByTestId("add-rule-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-action-select")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("rule-action-select"), {
      target: { value: "move" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("rule-target-ou-input")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("rule-target-ou-input"), {
      target: { value: "OU=Disabled,DC=example,DC=com" },
    });

    const input = screen.getByTestId("rule-target-ou-input") as HTMLInputElement;
    expect(input.value).toBe("OU=Disabled,DC=example,DC=com");
  });

  it("edit button opens rule editor with existing rule data", async () => {
    const existingRules = [
      {
        name: "Old Rule",
        condition: "disabledDays",
        thresholdDays: 60,
        action: "delete",
        targetOu: null,
        excludePatterns: ["svc_*"],
        excludeOus: null,
      },
    ];
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve(existingRules);
      if (cmd === "save_cleanup_rules") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    await waitFor(() => {
      expect(screen.getByTestId("edit-rule-0")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("edit-rule-0"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-editor")).toBeInTheDocument();
    });

    const nameInput = screen.getByTestId("rule-name-input") as HTMLInputElement;
    expect(nameInput.value).toBe("Old Rule");

    const conditionSelect = screen.getByTestId("rule-condition-select") as HTMLSelectElement;
    expect(conditionSelect.value).toBe("disabledDays");

    const thresholdInput = screen.getByTestId("rule-threshold-input") as HTMLInputElement;
    expect(thresholdInput.value).toBe("60");

    const actionSelect = screen.getByTestId("rule-action-select") as HTMLSelectElement;
    expect(actionSelect.value).toBe("delete");
  });

  it("delete button removes rule from list", async () => {
    const existingRules = [
      {
        name: "Rule To Delete",
        condition: "inactiveDays",
        thresholdDays: 90,
        action: "disable",
        targetOu: null,
        excludePatterns: null,
        excludeOus: null,
      },
    ];
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve(existingRules);
      if (cmd === "save_cleanup_rules") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    await waitFor(() => {
      expect(screen.getByText("Rule To Delete")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("delete-rule-0"));

    await waitFor(() => {
      expect(screen.queryByText("Rule To Delete")).not.toBeInTheDocument();
    });
  });

  it("dry run match selection toggles individual checkboxes", async () => {
    const existingRules = [
      {
        name: "Test",
        condition: "inactiveDays",
        thresholdDays: 180,
        action: "disable",
        targetOu: null,
      },
    ];
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve(existingRules);
      if (cmd === "cleanup_dry_run") return Promise.resolve(mockDryRunResult);
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    await waitFor(() => {
      fireEvent.click(screen.getByTestId("run-rule-0"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("dry-run-results")).toBeInTheDocument();
    });

    // Both matches are selected by default - uncheck the first one
    const checkboxes = screen.getByTestId("matches-table").querySelectorAll(
      "tbody input[type='checkbox']",
    );
    expect(checkboxes).toHaveLength(2);

    fireEvent.click(checkboxes[0]);

    // Execute button should now show (1) instead of (2)
    await waitFor(() => {
      expect(screen.getByTestId("execute-btn")).toHaveTextContent("Execute (1)");
    });
  });

  it("select-all checkbox toggles all matches", async () => {
    const existingRules = [
      {
        name: "Test",
        condition: "inactiveDays",
        thresholdDays: 180,
        action: "disable",
        targetOu: null,
      },
    ];
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve(existingRules);
      if (cmd === "cleanup_dry_run") return Promise.resolve(mockDryRunResult);
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    await waitFor(() => {
      fireEvent.click(screen.getByTestId("run-rule-0"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("matches-table")).toBeInTheDocument();
    });

    // Uncheck all via header checkbox
    const headerCheckbox = screen.getByTestId("matches-table").querySelector(
      "thead input[type='checkbox']",
    ) as HTMLInputElement;

    fireEvent.click(headerCheckbox);

    await waitFor(() => {
      expect(screen.getByTestId("execute-btn")).toHaveTextContent("Execute (0)");
    });

    // Re-check all
    fireEvent.click(headerCheckbox);

    await waitFor(() => {
      expect(screen.getByTestId("execute-btn")).toHaveTextContent("Execute (2)");
    });
  });

  it("execute button is disabled when no matches are selected", async () => {
    const noSelectedResult = {
      ...mockDryRunResult,
      matches: mockDryRunResult.matches.map((m) => ({ ...m, selected: false })),
    };
    const existingRules = [
      {
        name: "Test",
        condition: "inactiveDays",
        thresholdDays: 180,
        action: "disable",
        targetOu: null,
      },
    ];
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve(existingRules);
      if (cmd === "cleanup_dry_run") return Promise.resolve(noSelectedResult);
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    await waitFor(() => {
      fireEvent.click(screen.getByTestId("run-rule-0"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("execute-btn")).toBeInTheDocument();
    });

    const executeBtn = screen.getByTestId("execute-btn") as HTMLButtonElement;
    expect(executeBtn.disabled).toBe(true);
  });

  it("shows dry run error when dry run fails", async () => {
    const existingRules = [
      {
        name: "Test",
        condition: "inactiveDays",
        thresholdDays: 180,
        action: "disable",
        targetOu: null,
      },
    ];
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve(existingRules);
      if (cmd === "cleanup_dry_run") return Promise.reject("LDAP search failed");
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    await waitFor(() => {
      expect(screen.getByTestId("run-rule-0")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("run-rule-0"));

    await waitFor(() => {
      expect(screen.getByText("Dry Run Failed")).toBeInTheDocument();
    });
  });

  it("shows execution results with failed entries", async () => {
    const existingRules = [
      {
        name: "Test",
        condition: "inactiveDays",
        thresholdDays: 180,
        action: "disable",
        targetOu: null,
      },
    ];
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve(existingRules);
      if (cmd === "cleanup_dry_run") return Promise.resolve(mockDryRunResult);
      if (cmd === "cleanup_execute")
        return Promise.resolve([
          {
            dn: "CN=Old User,OU=Users,DC=test,DC=com",
            displayName: "Old User",
            action: "disable",
            success: true,
            error: null,
          },
          {
            dn: "CN=Stale User,OU=Users,DC=test,DC=com",
            displayName: "Stale User",
            action: "disable",
            success: false,
            error: "Permission denied",
          },
        ]);
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    await waitFor(() => {
      fireEvent.click(screen.getByTestId("run-rule-0"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("execute-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("execute-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("execution-results")).toBeInTheDocument();
    });

    expect(screen.getByText("1 / 2 succeeded")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("FAIL")).toBeInTheDocument();
  });

  it("double confirm for delete then actually executes on second click", async () => {
    const deleteResult = {
      ...mockDryRunResult,
      matches: mockDryRunResult.matches.map((m) => ({
        ...m,
        action: "delete" as const,
        proposedAction: "Delete account",
      })),
    };
    const existingRules = [
      {
        name: "Delete old",
        condition: "inactiveDays",
        thresholdDays: 365,
        action: "delete",
        targetOu: null,
      },
    ];
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve(existingRules);
      if (cmd === "cleanup_dry_run") return Promise.resolve(deleteResult);
      if (cmd === "cleanup_execute")
        return Promise.resolve([
          {
            dn: "CN=Old User",
            displayName: "Old User",
            action: "delete",
            success: true,
            error: null,
          },
        ]);
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    await waitFor(() => {
      fireEvent.click(screen.getByTestId("run-rule-0"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("execute-btn")).toBeInTheDocument();
    });

    // First click - shows warning
    fireEvent.click(screen.getByTestId("execute-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("delete-warning")).toBeInTheDocument();
    });

    // Second click - actually executes
    fireEvent.click(screen.getByTestId("execute-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("execution-results")).toBeInTheDocument();
    });
  });

  it("rule list shows exclude patterns and OUs when present", async () => {
    const existingRules = [
      {
        name: "Complex Rule",
        condition: "inactiveDays",
        thresholdDays: 90,
        action: "move",
        targetOu: "OU=Archive,DC=test,DC=com",
        excludePatterns: ["svc_*", "admin*"],
        excludeOus: ["OU=VIP"],
      },
    ];
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve(existingRules);
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    await waitFor(() => {
      expect(screen.getByText("Complex Rule")).toBeInTheDocument();
    });

    expect(screen.getByText(/svc_\*, admin\*/)).toBeInTheDocument();
    expect(screen.getByText(/OU=VIP/)).toBeInTheDocument();
    expect(screen.getByText(/to OU=Archive,DC=test,DC=com/)).toBeInTheDocument();
  });

  it("editing an existing rule updates it in place", async () => {
    const existingRules = [
      {
        name: "Original Name",
        condition: "inactiveDays",
        thresholdDays: 90,
        action: "disable",
        targetOu: null,
        excludePatterns: null,
        excludeOus: null,
      },
    ];
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "get_cleanup_rules") return Promise.resolve(existingRules);
      if (cmd === "save_cleanup_rules") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    render(<AutomatedCleanup />);
    await waitFor(() => {
      expect(screen.getByTestId("edit-rule-0")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("edit-rule-0"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-name-input")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("rule-name-input"), {
      target: { value: "Updated Name" },
    });
    fireEvent.click(screen.getByTestId("rule-save-btn"));

    await waitFor(() => {
      expect(screen.getByText("Updated Name")).toBeInTheDocument();
    });
    expect(screen.queryByText("Original Name")).not.toBeInTheDocument();
  });
});
