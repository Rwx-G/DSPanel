import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { Settings } from "./Settings";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { DialogProvider } from "@/contexts/DialogContext";
import { NavigationProvider } from "@/contexts/NavigationContext";

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

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function setupMocks() {
  mockInvoke.mockImplementation(((cmd: string) => {
    switch (cmd) {
      case "get_app_settings":
        return Promise.resolve({
          disabledOu: null,
          graphTenantId: null,
          graphClientId: null,
          auditRetentionDays: 365,
          connection: { domainOverride: "", preferredDc: "" },
          reports: { defaultFormat: "CSV", defaultExportPath: "" },
          appearance: { theme: "system" },
        });
      case "set_app_settings":
        return Promise.resolve();
      case "get_permission_level":
        return Promise.resolve("DomainAdmin");
      case "get_user_groups":
        return Promise.resolve([]);
      case "has_permission":
        return Promise.resolve(true);
      case "get_permission_mappings":
        return Promise.resolve({ mappings: {} });
      case "get_preset_path":
        return Promise.resolve("C:\\presets");
      case "get_credential":
        return Promise.resolve(null);
      case "pick_folder_dialog":
        return Promise.resolve(null);
      default:
        return Promise.resolve(null);
    }
  }) as typeof invoke);
}

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the settings page with tabs", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("settings-page")).toBeDefined();
    });

    expect(screen.getByTestId("tab-connection")).toBeDefined();
    expect(screen.getByTestId("tab-presets")).toBeDefined();
    expect(screen.getByTestId("tab-permissions")).toBeDefined();
    expect(screen.getByTestId("tab-security")).toBeDefined();
    expect(screen.getByTestId("tab-reports")).toBeDefined();
    expect(screen.getByTestId("tab-appearance")).toBeDefined();
  });

  it("defaults to connection tab", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-content-connection")).toBeDefined();
    });
  });

  it("shows connection fields", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("setting-domain-override")).toBeDefined();
    });
    expect(screen.getByTestId("setting-preferred-dc")).toBeDefined();
  });

  it("switches to security tab", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-security")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("tab-security"));

    await waitFor(() => {
      expect(screen.getByTestId("tab-content-security")).toBeDefined();
    });
    expect(screen.getByTestId("setting-audit-retention")).toBeDefined();
  });

  it("switches to reports tab", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-reports")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("tab-reports"));

    await waitFor(() => {
      expect(screen.getByTestId("tab-content-reports")).toBeDefined();
    });
    expect(screen.getByTestId("setting-export-format")).toBeDefined();
    expect(screen.getByTestId("setting-export-path")).toBeDefined();
  });

  it("switches to appearance tab", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-appearance")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("tab-appearance"));

    await waitFor(() => {
      expect(screen.getByTestId("tab-content-appearance")).toBeDefined();
    });
    expect(screen.getByTestId("theme-light")).toBeDefined();
    expect(screen.getByTestId("theme-dark")).toBeDefined();
    expect(screen.getByTestId("theme-system")).toBeDefined();
  });

  it("shows validation error for low audit retention", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-security")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("tab-security"));

    await waitFor(() => {
      expect(screen.getByTestId("setting-audit-retention")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("setting-audit-retention"), {
      target: { value: "10" },
    });

    // Click save to trigger validation
    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      expect(screen.getByTestId("validation-audit-retention")).toBeDefined();
    });
  });

  it("save button is disabled when no changes", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("settings-save")).toBeDefined();
    });

    expect(
      (screen.getByTestId("settings-save") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("save button becomes enabled after a change", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("setting-domain-override")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("setting-domain-override"), {
      target: { value: "corp.example.com" },
    });

    expect(
      (screen.getByTestId("settings-save") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("calls set_app_settings on save", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("setting-domain-override")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("setting-domain-override"), {
      target: { value: "corp.example.com" },
    });

    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("set_app_settings", expect.any(Object));
    });
  });

  it("shows success message after save", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("setting-domain-override")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("setting-domain-override"), {
      target: { value: "test" },
    });

    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      expect(screen.getByTestId("settings-success")).toBeDefined();
    });
  });

  it("switches to presets tab", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-presets")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("tab-presets"));

    await waitFor(() => {
      expect(screen.getByTestId("tab-content-presets")).toBeDefined();
    });
  });

  it("switches to permissions tab", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-permissions")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("tab-permissions"));

    await waitFor(() => {
      expect(screen.getByTestId("tab-content-permissions")).toBeDefined();
    });
  });
});
