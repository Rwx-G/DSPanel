import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { PresetManagement } from "./PresetManagement";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { DialogProvider } from "@/contexts/DialogContext";
import { NavigationProvider } from "@/contexts/NavigationContext";
import type { Preset } from "@/types/preset";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const samplePresets: Preset[] = [
  {
    name: "Dev Onboarding",
    description: "Standard developer setup",
    type: "Onboarding",
    targetOu: "OU=Devs,DC=example,DC=com",
    groups: ["CN=Developers,DC=example,DC=com"],
    attributes: { department: "Engineering" },
  },
  {
    name: "User Offboarding",
    description: "Disable and remove access",
    type: "Offboarding",
    targetOu: "OU=Disabled,DC=example,DC=com",
    groups: ["CN=DisabledUsers,DC=example,DC=com"],
    attributes: {},
  },
];

function Wrapper({ children }: { children: ReactNode }) {
  return createElement(
    NavigationProvider,
    null,
    createElement(
      NotificationProvider,
      null,
      createElement(DialogProvider, null, children),
    ),
  );
}

function setupDefaultMocks(level = "AccountOperator") {
  mockInvoke.mockImplementation(((cmd: string) => {
    switch (cmd) {
      case "get_permission_level":
        return Promise.resolve(level);
      case "get_user_groups":
        return Promise.resolve([]);
      case "has_permission":
        return Promise.resolve(
          level === "AccountOperator" || level === "DomainAdmin",
        );
      case "get_preset_path":
        return Promise.resolve("C:\\presets");
      case "list_presets":
        return Promise.resolve(samplePresets);
      case "get_ou_tree":
        return Promise.resolve([
          {
            distinguishedName: "OU=Users,DC=example,DC=com",
            name: "Users",
            children: [],
          },
        ]);
      default:
        return Promise.resolve(null);
    }
  }) as typeof invoke);
}

/** Waits for the PresetEditor to finish loading (spinner gone, preset list or empty state visible). */
async function waitForEditorReady() {
  await waitFor(
    () => {
      // Editor is ready when the loading spinner is gone
      expect(screen.queryByText("Loading...")).toBeNull();
      // And the preset management testid is present
      expect(screen.getByTestId("preset-management")).toBeDefined();
    },
    { timeout: 5000 },
  );
}

describe("PresetManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders permission gate fallback for ReadOnly users", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      switch (cmd) {
        case "get_permission_level":
          return Promise.resolve("ReadOnly");
        case "get_user_groups":
          return Promise.resolve([]);
        case "has_permission":
          return Promise.resolve(false);
        case "get_preset_path":
          return Promise.resolve("C:\\presets");
        case "list_presets":
          return Promise.resolve([]);
        case "get_ou_tree":
          return Promise.resolve([]);
        default:
          return Promise.resolve(null);
      }
    }) as typeof invoke);

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Access Denied")).toBeDefined();
    });
  });

  it("renders preset list for AccountOperator", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitForEditorReady();

    await waitFor(() => {
      expect(screen.getByText("Dev Onboarding")).toBeDefined();
    });
    expect(screen.getByText("User Offboarding")).toBeDefined();
  });

  it("displays preset type badges", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Dev Onboarding")).toBeDefined();
      expect(screen.getAllByText("Onboarding").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Offboarding").length).toBeGreaterThan(0);
    });
  });

  it("clicking a preset shows the editor form", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitForEditorReady();
    await waitFor(() => {
      expect(screen.getByTestId("preset-item-0")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("preset-item-0"));

    await waitFor(() => {
      expect(screen.getByTestId("preset-editor-form")).toBeDefined();
      expect(
        (screen.getByTestId("preset-name-input") as HTMLInputElement).value,
      ).toBe("Dev Onboarding");
    });
  });

  it("new button creates blank editor", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitForEditorReady();

    fireEvent.click(screen.getByTestId("preset-new-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("preset-editor-form")).toBeDefined();
    });
    expect(
      (screen.getByTestId("preset-name-input") as HTMLInputElement).value,
    ).toBe("");
  });

  it("save validates required fields", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitForEditorReady();

    fireEvent.click(screen.getByTestId("preset-new-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("preset-save-btn")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("preset-save-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("preset-editor-errors")).toBeDefined();
    });

    expect(screen.getByText("Name is required")).toBeDefined();
    expect(screen.getByText("Target OU is required")).toBeDefined();
  });

  it("save calls save_preset on valid input", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("preset-item-0")).toBeDefined();
    });

    // Select existing preset and save
    fireEvent.click(screen.getByTestId("preset-item-0"));

    const nameInput = screen.getByTestId(
      "preset-name-input",
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Updated Name" } });

    fireEvent.click(screen.getByTestId("preset-save-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "save_preset",
        expect.objectContaining({
          preset: expect.objectContaining({ name: "Updated Name" }),
        }),
      );
    });
  });

  it("delete shows confirmation dialog", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("preset-item-0")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("preset-item-0"));
    fireEvent.click(screen.getByTestId("preset-delete-btn"));

    // The dialog should be rendered
    await waitFor(() => {
      expect(
        screen.getByText(/Are you sure you want to delete/),
      ).toBeDefined();
    });
  });

  it("shows empty state when no presets exist", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      switch (cmd) {
        case "get_permission_level":
          return Promise.resolve("AccountOperator");
        case "get_user_groups":
          return Promise.resolve([]);
        case "has_permission":
          return Promise.resolve(true);
        case "get_preset_path":
          return Promise.resolve("C:\\presets");
        case "list_presets":
          return Promise.resolve([]);
        case "get_ou_tree":
          return Promise.resolve([]);
        default:
          return Promise.resolve(null);
      }
    }) as typeof invoke);

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("No presets")).toBeDefined();
    });
  });

  it("add attribute button works", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitForEditorReady();

    fireEvent.click(screen.getByTestId("preset-new-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("preset-editor-form")).toBeDefined();
    });

    const keyInput = screen.getByTestId("attr-key-input") as HTMLInputElement;
    const valInput = screen.getByTestId(
      "attr-value-input",
    ) as HTMLInputElement;

    fireEvent.change(keyInput, { target: { value: "department" } });
    fireEvent.change(valInput, { target: { value: "IT" } });
    fireEvent.click(screen.getByTestId("attr-add-btn"));

    expect(screen.getByText("department")).toBeDefined();
    expect(screen.getByText("= IT")).toBeDefined();
  });

  it("delete button is disabled for new presets", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitForEditorReady();

    fireEvent.click(screen.getByTestId("preset-new-btn"));

    await waitFor(() => {
      const deleteBtn = screen.getByTestId(
        "preset-delete-btn",
      ) as HTMLButtonElement;
      expect(deleteBtn.disabled).toBe(true);
    });
  });

  it("shows external modification warning with accept button", async () => {
    const presetsWithWarning: Preset[] = [
      {
        ...samplePresets[0],
        integrityWarning: true,
      },
      samplePresets[1],
    ];

    mockInvoke.mockImplementation(((cmd: string) => {
      switch (cmd) {
        case "get_permission_level":
          return Promise.resolve("AccountOperator");
        case "get_user_groups":
          return Promise.resolve([]);
        case "has_permission":
          return Promise.resolve(true);
        case "get_preset_path":
          return Promise.resolve("C:\\presets");
        case "list_presets":
          return Promise.resolve(presetsWithWarning);
        case "get_ou_tree":
          return Promise.resolve([]);
        default:
          return Promise.resolve(null);
      }
    }) as typeof invoke);

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitForEditorReady();

    // Wait for preset items to render
    await waitFor(() => {
      expect(screen.getByTestId("preset-item-0")).toBeDefined();
    });

    // The warning icon should be visible in the preset list item
    const presetItem = screen.getByTestId("preset-item-0");
    expect(presetItem.querySelector('[aria-label="Preset modified externally"]')).toBeDefined();

    // Click the preset to open editor
    fireEvent.click(presetItem);

    await waitFor(() => {
      expect(screen.getByTestId("preset-integrity-warning")).toBeDefined();
      expect(screen.getByText("This preset was modified outside DSPanel")).toBeDefined();
    });
  });

  it("accept checksum calls accept_preset_checksum", async () => {
    const presetsWithWarning: Preset[] = [
      {
        ...samplePresets[0],
        integrityWarning: true,
      },
    ];

    mockInvoke.mockImplementation(((cmd: string) => {
      switch (cmd) {
        case "get_permission_level":
          return Promise.resolve("AccountOperator");
        case "get_user_groups":
          return Promise.resolve([]);
        case "has_permission":
          return Promise.resolve(true);
        case "get_preset_path":
          return Promise.resolve("C:\\presets");
        case "list_presets":
          return Promise.resolve(presetsWithWarning);
        case "get_ou_tree":
          return Promise.resolve([]);
        case "accept_preset_checksum":
          return Promise.resolve(null);
        default:
          return Promise.resolve(null);
      }
    }) as typeof invoke);

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).toBeNull();
      expect(screen.getByTestId("preset-item-0")).toBeDefined();
    }, { timeout: 5000 });

    fireEvent.click(screen.getByTestId("preset-item-0"));

    await waitFor(() => {
      expect(screen.getByTestId("preset-accept-checksum")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("preset-accept-checksum"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("accept_preset_checksum", {
        name: "Dev Onboarding",
      });
    });
  });

  it("type select changes preset type to Offboarding", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitForEditorReady();
    fireEvent.click(screen.getByTestId("preset-new-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("preset-type-select")).toBeDefined();
    });

    const typeSelect = screen.getByTestId("preset-type-select") as HTMLSelectElement;
    expect(typeSelect.value).toBe("Onboarding");

    fireEvent.change(typeSelect, { target: { value: "Offboarding" } });
    expect(typeSelect.value).toBe("Offboarding");
  });

  it("description textarea updates draft", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitForEditorReady();
    fireEvent.click(screen.getByTestId("preset-new-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("preset-description-input")).toBeDefined();
    });

    const descInput = screen.getByTestId("preset-description-input") as HTMLTextAreaElement;
    fireEvent.change(descInput, { target: { value: "New description" } });
    expect(descInput.value).toBe("New description");
  });

  it("remove attribute button removes the attribute from draft", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitForEditorReady();
    fireEvent.click(screen.getByTestId("preset-new-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("preset-editor-form")).toBeDefined();
    });

    // Add an attribute
    fireEvent.change(screen.getByTestId("attr-key-input"), {
      target: { value: "title" },
    });
    fireEvent.change(screen.getByTestId("attr-value-input"), {
      target: { value: "Engineer" },
    });
    fireEvent.click(screen.getByTestId("attr-add-btn"));

    expect(screen.getByText("title")).toBeDefined();
    expect(screen.getByText("= Engineer")).toBeDefined();

    // Remove the attribute
    fireEvent.click(screen.getByTestId("attr-remove-title"));

    await waitFor(() => {
      expect(screen.queryByText("= Engineer")).toBeNull();
    });
  });

  it("add attribute button is disabled when key is empty", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitForEditorReady();
    fireEvent.click(screen.getByTestId("preset-new-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("attr-add-btn")).toBeDefined();
    });

    const addBtn = screen.getByTestId("attr-add-btn") as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });

  it("validates at least one group or attribute is required", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitForEditorReady();
    fireEvent.click(screen.getByTestId("preset-new-btn"));

    // Fill name and target OU (but no groups or attributes)
    fireEvent.change(screen.getByTestId("preset-name-input"), {
      target: { value: "Empty Preset" },
    });

    // We need to save - but targetOu is also required
    // The validation will catch both targetOu and groups/attributes
    fireEvent.click(screen.getByTestId("preset-save-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("preset-editor-errors")).toBeDefined();
      expect(
        screen.getByText("At least one group or attribute is required"),
      ).toBeDefined();
    });
  });

  it("save button is disabled when no editor is active", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitForEditorReady();

    // No preset selected, no new preset - save should be disabled
    const saveBtn = screen.getByTestId("preset-save-btn") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("shows preset storage path when configured", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("preset-show-settings")).toBeDefined();
      expect(screen.getByText(/C:\\presets/)).toBeDefined();
    });
  });

  it("shows empty state when preset path is not configured", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      switch (cmd) {
        case "get_permission_level":
          return Promise.resolve("AccountOperator");
        case "get_user_groups":
          return Promise.resolve([]);
        case "has_permission":
          return Promise.resolve(true);
        case "get_preset_path":
          return Promise.resolve(null);
        case "list_presets":
          return Promise.resolve([]);
        case "get_ou_tree":
          return Promise.resolve([]);
        default:
          return Promise.resolve(null);
      }
    }) as typeof invoke);

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Preset Storage Not Configured")).toBeDefined();
    });
  });

  it("validates name uniqueness for new presets", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitForEditorReady();

    fireEvent.click(screen.getByTestId("preset-new-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("preset-save-btn")).toBeDefined();
    });

    const nameInput = screen.getByTestId(
      "preset-name-input",
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Dev Onboarding" } });
    fireEvent.click(screen.getByTestId("preset-save-btn"));

    await waitFor(() => {
      expect(
        screen.getByText("A preset with this name already exists"),
      ).toBeDefined();
    });
  });
});
