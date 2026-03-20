import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { PresetManagement } from "./PresetManagement";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { DialogProvider } from "@/contexts/DialogContext";
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
    NotificationProvider,
    null,
    createElement(DialogProvider, null, children),
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

    await waitFor(
      () => {
        expect(screen.getByText("Dev Onboarding")).toBeDefined();
      },
      { timeout: 3000 },
    );

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
    });

    expect(screen.getAllByText("Onboarding").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Offboarding").length).toBeGreaterThan(0);
  });

  it("clicking a preset shows the editor form", async () => {
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

    expect(screen.getByTestId("preset-editor-form")).toBeDefined();
    expect(
      (screen.getByTestId("preset-name-input") as HTMLInputElement).value,
    ).toBe("Dev Onboarding");
  });

  it("new button creates blank editor", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("preset-new-btn")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("preset-new-btn"));

    expect(screen.getByTestId("preset-editor-form")).toBeDefined();
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

    await waitFor(() => {
      expect(screen.getByTestId("preset-new-btn")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("preset-new-btn"));
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

    await waitFor(() => {
      expect(screen.getByTestId("preset-new-btn")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("preset-new-btn"));

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

    await waitFor(() => {
      expect(screen.getByTestId("preset-new-btn")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("preset-new-btn"));

    const deleteBtn = screen.getByTestId(
      "preset-delete-btn",
    ) as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(true);
  });

  it("validates name uniqueness for new presets", async () => {
    setupDefaultMocks();

    render(
      <Wrapper>
        <PresetManagement />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("preset-new-btn")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("preset-new-btn"));

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
