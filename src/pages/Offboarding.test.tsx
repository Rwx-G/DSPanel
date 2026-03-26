import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { Offboarding } from "./Offboarding";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { DialogProvider } from "@/contexts/DialogContext";
import { NavigationProvider } from "@/contexts/NavigationContext";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function Wrapper({ children }: { children: ReactNode }) {
  return createElement(
    NotificationProvider,
    null,
    createElement(
      DialogProvider,
      null,
      createElement(NavigationProvider, null, children),
    ),
  );
}

const mockUser = {
  distinguishedName: "CN=John Smith,OU=Users,DC=example,DC=com",
  samAccountName: "jsmith",
  displayName: "John Smith",
  objectClass: "user",
  attributes: {
    memberOf: [
      "CN=Developers,OU=Groups,DC=example,DC=com",
      "CN=VPN-Users,OU=Groups,DC=example,DC=com",
    ],
  },
};

function setupMocks(level = "AccountOperator") {
  mockInvoke.mockImplementation(((cmd: string) => {
    switch (cmd) {
      case "get_permission_level":
        return Promise.resolve(level);
      case "get_user_groups":
        return Promise.resolve([]);
      case "has_permission":
        return Promise.resolve(level === "AccountOperator");
      case "get_user":
        return Promise.resolve(mockUser);
      case "disable_account":
        return Promise.resolve(undefined);
      case "remove_group_member":
        return Promise.resolve(undefined);
      case "reset_password":
        return Promise.resolve(undefined);
      case "move_object":
        return Promise.resolve(undefined);
      default:
        return Promise.resolve(null);
    }
  }) as typeof invoke);
}

describe("Offboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows access denied for ReadOnly", async () => {
    setupMocks("ReadOnly");

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Access Denied")).toBeDefined();
    });
  });

  it("renders search step for AccountOperator", async () => {
    setupMocks();

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboarding-wizard")).toBeDefined();
    });
    expect(screen.getByTestId("step-search")).toBeDefined();
    expect(screen.getByTestId("offboard-search-input")).toBeDefined();
  });

  it("searches for user and moves to actions step", async () => {
    setupMocks();

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("step-actions")).toBeDefined();
    });

    expect(screen.getByText("John Smith")).toBeDefined();
  });

  it("shows action checkboxes with defaults", async () => {
    setupMocks();

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("action-disableAccount")).toBeDefined();
    });

    const disable = screen.getByTestId(
      "action-disableAccount",
    ) as HTMLInputElement;
    const removeGroups = screen.getByTestId(
      "action-removeGroups",
    ) as HTMLInputElement;
    const randomPw = screen.getByTestId(
      "action-setRandomPassword",
    ) as HTMLInputElement;

    expect(disable.checked).toBe(true);
    expect(removeGroups.checked).toBe(true);
    expect(randomPw.checked).toBe(true);
  });

  it("navigates to preview step", async () => {
    setupMocks();

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("offboard-btn-next")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("offboard-btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-offboard-preview")).toBeDefined();
    });

    expect(screen.getByText(/Account will be disabled/)).toBeDefined();
  });

  it("back button returns to previous step", async () => {
    setupMocks();

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("step-actions")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("offboard-btn-back"));

    await waitFor(() => {
      expect(screen.getByTestId("step-search")).toBeDefined();
    });
  });

  it("toggle action checkbox works", async () => {
    setupMocks();

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("action-disableAccount")).toBeDefined();
    });

    const checkbox = screen.getByTestId(
      "action-disableAccount",
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it("search button disabled when input empty", async () => {
    setupMocks();

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-btn")).toBeDefined();
    });

    const btn = screen.getByTestId(
      "offboard-search-btn",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("handles search via Enter key", async () => {
    setupMocks();

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    const input = screen.getByTestId("offboard-search-input");
    fireEvent.change(input, { target: { value: "jsmith" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByTestId("step-actions")).toBeDefined();
    });
  });

  it("shows error when user not found", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      switch (cmd) {
        case "get_permission_level":
          return Promise.resolve("AccountOperator");
        case "has_permission":
          return Promise.resolve(true);
        case "get_user":
          return Promise.resolve(null);
        default:
          return Promise.resolve(null);
      }
    }) as typeof invoke);

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "unknown" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    // Should stay on search step (user not found)
    await waitFor(() => {
      expect(screen.getByTestId("step-search")).toBeDefined();
    });
  });

  it("handles search error gracefully", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      switch (cmd) {
        case "get_permission_level":
          return Promise.resolve("AccountOperator");
        case "has_permission":
          return Promise.resolve(true);
        case "get_user":
          return Promise.reject(new Error("LDAP error"));
        default:
          return Promise.resolve(null);
      }
    }) as typeof invoke);

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    // Should stay on search step after error
    await waitFor(() => {
      expect(screen.getByTestId("step-search")).toBeDefined();
    });
  });

  it("filters Domain Users from group list", async () => {
    const userWithDomainUsers = {
      ...mockUser,
      attributes: {
        memberOf: [
          "CN=Developers,OU=Groups,DC=example,DC=com",
          "CN=Domain Users,CN=Users,DC=example,DC=com",
          "CN=VPN-Users,OU=Groups,DC=example,DC=com",
        ],
      },
    };

    mockInvoke.mockImplementation(((cmd: string) => {
      switch (cmd) {
        case "get_permission_level":
          return Promise.resolve("AccountOperator");
        case "has_permission":
          return Promise.resolve(true);
        case "get_user":
          return Promise.resolve(userWithDomainUsers);
        default:
          return Promise.resolve(null);
      }
    }) as typeof invoke);

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("step-actions")).toBeDefined();
    });

    // Should show "Remove from all groups (2)" - Domain Users filtered out
    expect(screen.getByText(/Remove from all groups \(2\)/)).toBeDefined();
  });

  it("shows moveToDisabledOU checkbox and OU picker when enabled", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      switch (cmd) {
        case "get_permission_level":
          return Promise.resolve("AccountOperator");
        case "has_permission":
          return Promise.resolve(true);
        case "get_user":
          return Promise.resolve(mockUser);
        case "get_ou_tree":
          return Promise.resolve([{ name: "Root", distinguishedName: "DC=example,DC=com", children: [] }]);
        default:
          return Promise.resolve(null);
      }
    }) as typeof invoke);

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("action-moveToDisabledOU")).toBeDefined();
    });

    const moveCheckbox = screen.getByTestId("action-moveToDisabledOU") as HTMLInputElement;
    expect(moveCheckbox.checked).toBe(false);

    fireEvent.click(moveCheckbox);
    expect(moveCheckbox.checked).toBe(true);

    // OU picker label should appear
    await waitFor(() => {
      expect(screen.getByText("Disabled OU")).toBeDefined();
    });
  });

  it("disables Next when no actions are selected", async () => {
    setupMocks();

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("action-disableAccount")).toBeDefined();
    });

    // Uncheck all default-checked actions
    fireEvent.click(screen.getByTestId("action-disableAccount"));
    fireEvent.click(screen.getByTestId("action-removeGroups"));
    fireEvent.click(screen.getByTestId("action-setRandomPassword"));

    const nextBtn = screen.getByTestId("offboard-btn-next") as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
  });

  it("preview step shows all selected actions", async () => {
    setupMocks();

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("offboard-btn-next")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("offboard-btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-offboard-preview")).toBeDefined();
    });

    expect(screen.getByText(/Account will be disabled/)).toBeDefined();
    expect(screen.getByText(/Password will be reset to random value/)).toBeDefined();
    // Group removal entries
    expect(screen.getByText(/Remove from:.*Developers/)).toBeDefined();
    expect(screen.getByText(/Remove from:.*VPN-Users/)).toBeDefined();
  });

  it("preview step shows user display name", async () => {
    setupMocks();

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("offboard-btn-next")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("offboard-btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-offboard-preview")).toBeDefined();
    });

    expect(screen.getByText(/Changes to apply to John Smith/)).toBeDefined();
  });

  it("back from preview returns to actions step", async () => {
    setupMocks();

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("offboard-btn-next")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("offboard-btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-offboard-preview")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("offboard-btn-back"));

    await waitFor(() => {
      expect(screen.getByTestId("step-actions")).toBeDefined();
    });
  });

  it("executes offboarding and shows results", async () => {
    setupMocks();

    // Mock showConfirmation to return true (via DialogProvider)
    // The DialogProvider renders a confirmation dialog - we need to handle that
    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("offboard-btn-next")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("offboard-btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("offboard-btn-execute")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("offboard-btn-execute"));

    // Confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByText("Confirm Offboarding")).toBeDefined();
    });

    // Find and click the confirm button in the dialog
    const confirmBtn = screen.getByTestId("dialog-confirm");
    fireEvent.click(confirmBtn);

    // Should reach execute step with results
    await waitFor(() => {
      expect(screen.getByTestId("step-offboard-results")).toBeDefined();
    });

    expect(screen.getByTestId("offboard-summary")).toBeDefined();
    // All actions succeeded
    expect(screen.getByText(/actions completed/)).toBeDefined();
  });

  it("shows partial failure in results", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      switch (cmd) {
        case "get_permission_level":
          return Promise.resolve("AccountOperator");
        case "has_permission":
          return Promise.resolve(true);
        case "get_user":
          return Promise.resolve(mockUser);
        case "disable_account":
          return Promise.resolve(undefined);
        case "remove_group_member":
          return Promise.reject(new Error("Permission denied"));
        case "reset_password":
          return Promise.resolve(undefined);
        default:
          return Promise.resolve(null);
      }
    }) as typeof invoke);

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("offboard-btn-next")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("offboard-btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("offboard-btn-execute")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("offboard-btn-execute"));

    await waitFor(() => {
      expect(screen.getByText("Confirm Offboarding")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("step-offboard-results")).toBeDefined();
    });

    // Should have FAIL entries for group removal
    const summary = screen.getByTestId("offboard-summary");
    expect(summary.textContent).toContain("[FAIL]");
    expect(summary.textContent).toContain("[OK]");
  });

  it("copy summary button works", async () => {
    setupMocks();

    // Mock clipboard
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("offboard-btn-next")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("offboard-btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("offboard-btn-execute")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("offboard-btn-execute"));

    await waitFor(() => {
      expect(screen.getByText("Confirm Offboarding")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("btn-copy-offboard-summary")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("btn-copy-offboard-summary"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });

    // Verify the clipboard content contains the summary header
    const clipboardContent = writeText.mock.calls[0][0] as string;
    expect(clipboardContent).toContain("Offboarding: John Smith");
  });

  it("new offboarding button resets to search step", async () => {
    setupMocks();

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("offboard-btn-next")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("offboard-btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("offboard-btn-execute")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("offboard-btn-execute"));

    await waitFor(() => {
      expect(screen.getByText("Confirm Offboarding")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("btn-new-offboarding")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("btn-new-offboarding"));

    await waitFor(() => {
      expect(screen.getByTestId("step-search")).toBeDefined();
    });

    // Input should be cleared
    const input = screen.getByTestId("offboard-search-input") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("does not execute when confirmation is cancelled", async () => {
    setupMocks();

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("offboard-btn-next")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("offboard-btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("offboard-btn-execute")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("offboard-btn-execute"));

    await waitFor(() => {
      expect(screen.getByText("Confirm Offboarding")).toBeDefined();
    });

    // Click cancel instead of confirm
    const cancelBtn = screen.getByTestId("dialog-cancel");
    fireEvent.click(cancelBtn);

    // Should stay on preview step
    await waitFor(() => {
      expect(screen.getByTestId("step-offboard-preview")).toBeDefined();
    });
  });

  it("step indicator shows correct progress", async () => {
    setupMocks();

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-step-indicator")).toBeDefined();
    });

    const indicator = screen.getByTestId("offboard-step-indicator");
    expect(indicator.textContent).toContain("Search User");
    expect(indicator.textContent).toContain("Select Actions");
    expect(indicator.textContent).toContain("Preview");
    expect(indicator.textContent).toContain("Execute");
  });

  it("shows search help tooltip on info button click", async () => {
    setupMocks();

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("step-search")).toBeDefined();
    });

    const infoBtn = screen.getByLabelText("What is sAMAccountName?");
    fireEvent.click(infoBtn);

    await waitFor(() => {
      expect(screen.getByText(/The sAMAccountName is the user login/)).toBeDefined();
    });
  });

  it("loads default disabled OU from app settings", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      switch (cmd) {
        case "get_permission_level":
          return Promise.resolve("AccountOperator");
        case "has_permission":
          return Promise.resolve(true);
        case "get_user":
          return Promise.resolve(mockUser);
        case "get_app_settings":
          return Promise.resolve({ disabledOu: "OU=Disabled,DC=example,DC=com" });
        case "get_ou_tree":
          return Promise.resolve([{ name: "Root", distinguishedName: "DC=example,DC=com", children: [] }]);
        default:
          return Promise.resolve(null);
      }
    }) as typeof invoke);

    render(
      <Wrapper>
        <Offboarding />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offboard-search-input")).toBeDefined();
    });

    // The setting is loaded in background, verify by navigating to actions and enabling move
    fireEvent.change(screen.getByTestId("offboard-search-input"), {
      target: { value: "jsmith" },
    });
    fireEvent.click(screen.getByTestId("offboard-search-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("action-moveToDisabledOU")).toBeDefined();
    });

    // Enable move to OU
    fireEvent.click(screen.getByTestId("action-moveToDisabledOU"));

    // Then go to preview to see the OU shown
    fireEvent.click(screen.getByTestId("offboard-btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-offboard-preview")).toBeDefined();
    });

    expect(screen.getByText(/Move to:.*OU=Disabled/)).toBeDefined();
  });
});
