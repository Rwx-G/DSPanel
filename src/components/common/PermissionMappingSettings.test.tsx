import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PermissionMappingSettings } from "./PermissionMappingSettings";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function setupMocks(level = "DomainAdmin") {
  mockInvoke.mockImplementation(((cmd: string) => {
    switch (cmd) {
      case "get_permission_level":
        return Promise.resolve(level);
      case "get_user_groups":
        return Promise.resolve([]);
      case "has_permission":
        return Promise.resolve(level === "DomainAdmin");
      case "get_permission_mappings":
        return Promise.resolve({ mappings: {} });
      case "search_groups":
        return Promise.resolve([
          {
            distinguishedName: "CN=IT-Support,OU=Groups,DC=contoso,DC=com",
            samAccountName: "IT-Support",
            displayName: "IT Support",
            object_class: "group",
            attributes: {},
          },
        ]);
      case "set_permission_mappings":
        return Promise.resolve();
      case "validate_group_exists":
        return Promise.resolve(true);
      default:
        return Promise.resolve(null);
    }
  }) as typeof invoke);
}

function setupMocksWithMappings() {
  mockInvoke.mockImplementation(((cmd: string) => {
    switch (cmd) {
      case "get_permission_level":
        return Promise.resolve("DomainAdmin");
      case "get_user_groups":
        return Promise.resolve([]);
      case "has_permission":
        return Promise.resolve(true);
      case "get_permission_mappings":
        return Promise.resolve({
          mappings: {
            HelpDesk: ["CN=IT-Support,OU=Groups,DC=contoso,DC=com"],
          },
        });
      case "set_permission_mappings":
        return Promise.resolve();
      default:
        return Promise.resolve(null);
    }
  }) as typeof invoke);
}

describe("PermissionMappingSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows access denied for non-DomainAdmin", async () => {
    setupMocks("AccountOperator");

    render(<PermissionMappingSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("permission-mapping-access-denied")).toBeDefined();
    });
  });

  it("renders all permission levels for DomainAdmin", async () => {
    setupMocks();

    render(<PermissionMappingSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("permission-mapping-settings")).toBeDefined();
    });

    expect(screen.getByTestId("permission-level-ReadOnly")).toBeDefined();
    expect(screen.getByTestId("permission-level-HelpDesk")).toBeDefined();
    expect(screen.getByTestId("permission-level-AccountOperator")).toBeDefined();
    expect(screen.getByTestId("permission-level-Admin")).toBeDefined();
    expect(screen.getByTestId("permission-level-DomainAdmin")).toBeDefined();
  });

  it("displays existing mapped groups", async () => {
    setupMocksWithMappings();

    render(<PermissionMappingSettings />);

    await waitFor(() => {
      expect(screen.getByText("IT-Support")).toBeDefined();
    });
  });

  it("opens search panel when Add Group is clicked", async () => {
    setupMocks();

    render(<PermissionMappingSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("add-group-HelpDesk")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("add-group-HelpDesk"));

    await waitFor(() => {
      expect(screen.getByTestId("group-search-HelpDesk")).toBeDefined();
    });
  });

  it("searches and adds a group", async () => {
    setupMocks();

    render(<PermissionMappingSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("add-group-HelpDesk")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("add-group-HelpDesk"));

    await waitFor(() => {
      expect(screen.getByTestId("group-search-input-HelpDesk")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("group-search-input-HelpDesk"), {
      target: { value: "IT" },
    });
    fireEvent.click(screen.getByTestId("group-search-btn-HelpDesk"));

    await waitFor(() => {
      expect(screen.getByText("IT Support")).toBeDefined();
    });

    fireEvent.click(screen.getByText("IT Support"));

    await waitFor(() => {
      expect(screen.getByText("IT-Support")).toBeDefined();
    });
  });

  it("removes a group", async () => {
    setupMocksWithMappings();

    render(<PermissionMappingSettings />);

    await waitFor(() => {
      expect(screen.getByText("IT-Support")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("remove-group-btn"));

    await waitFor(() => {
      expect(screen.queryByText("CN=IT-Support,OU=Groups,DC=contoso,DC=com")).toBeNull();
    });
  });

  it("save button is disabled when no changes", async () => {
    setupMocks();

    render(<PermissionMappingSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("permission-mapping-save")).toBeDefined();
    });

    expect(
      (screen.getByTestId("permission-mapping-save") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("calls set_permission_mappings on save", async () => {
    setupMocksWithMappings();

    render(<PermissionMappingSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("remove-group-btn")).toBeDefined();
    });

    // Remove a group to make dirty
    fireEvent.click(screen.getByTestId("remove-group-btn"));

    await waitFor(() => {
      expect(
        (screen.getByTestId("permission-mapping-save") as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    fireEvent.click(screen.getByTestId("permission-mapping-save"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("set_permission_mappings", expect.any(Object));
    });
  });
});
