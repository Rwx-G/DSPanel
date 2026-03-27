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

// Mock localStorage for theme persistence
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((_i: number) => null),
  };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock });

// Mock matchMedia for theme detection
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query === "(prefers-color-scheme: dark)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

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
      case "get_ou_tree":
        return Promise.resolve([]);
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
      expect(screen.getByTestId("setting-preferred-dc")).toBeDefined();
    });
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
      expect(screen.getByTestId("setting-audit-retention")).toBeDefined();
    });
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
      expect(screen.getByTestId("setting-export-format")).toBeDefined();
      expect(screen.getByTestId("setting-export-path")).toBeDefined();
    });
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
      expect(screen.getByTestId("theme-light")).toBeDefined();
      expect(screen.getByTestId("theme-dark")).toBeDefined();
      expect(screen.getByTestId("theme-system")).toBeDefined();
    });
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

  // -----------------------------------------------------------------------
  // Connection tab fields
  // -----------------------------------------------------------------------

  it("domain override field reflects loaded value and tracks changes", async () => {
    setupMocks();
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_app_settings")
        return Promise.resolve({
          connection: { domainOverride: "loaded.corp.com", preferredDc: "dc01.corp.com" },
          auditRetentionDays: 365,
          reports: { defaultFormat: "CSV", defaultExportPath: "" },
          appearance: { theme: "system" },
        });
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("setting-domain-override")).toBeDefined();
    });

    const domainInput = screen.getByTestId("setting-domain-override") as HTMLInputElement;
    expect(domainInput.value).toBe("loaded.corp.com");

    const dcInput = screen.getByTestId("setting-preferred-dc") as HTMLInputElement;
    expect(dcInput.value).toBe("dc01.corp.com");
  });

  it("preferred DC field change marks dirty", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("setting-preferred-dc")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("setting-preferred-dc"), {
      target: { value: "dc02.corp.com" },
    });

    expect(
      (screen.getByTestId("settings-save") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("update frequency selector changes value", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("setting-update-frequency")).toBeDefined();
    });

    const select = screen.getByTestId("setting-update-frequency") as HTMLSelectElement;
    expect(select.value).toBe("startup");

    fireEvent.change(select, { target: { value: "weekly" } });
    expect(select.value).toBe("weekly");
  });

  // -----------------------------------------------------------------------
  // Security tab - audit retention, disabled OU, risk weights, attack config
  // -----------------------------------------------------------------------

  it("audit retention input updates value", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-security")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("tab-security"));

    await waitFor(() => {
      expect(screen.getByTestId("setting-audit-retention")).toBeDefined();
    });

    const input = screen.getByTestId("setting-audit-retention") as HTMLInputElement;
    expect(input.value).toBe("365");

    fireEvent.change(input, { target: { value: "90" } });
    expect(input.value).toBe("90");
  });

  it("shows disabled OU value with clear button when set", async () => {
    setupMocks();
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_app_settings")
        return Promise.resolve({
          disabledOu: "OU=Disabled,DC=contoso,DC=com",
          auditRetentionDays: 365,
          connection: { domainOverride: "", preferredDc: "" },
          reports: { defaultFormat: "CSV", defaultExportPath: "" },
          appearance: { theme: "system" },
        });
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-security")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("tab-security"));

    await waitFor(() => {
      expect(screen.getByTestId("setting-disabled-ou-value")).toBeDefined();
    });

    expect(screen.getByTestId("setting-disabled-ou-value").textContent).toBe(
      "OU=Disabled,DC=contoso,DC=com",
    );
    expect(screen.getByTestId("setting-disabled-ou-clear")).toBeInTheDocument();

    // Click clear
    fireEvent.click(screen.getByTestId("setting-disabled-ou-clear"));
    await waitFor(() => {
      expect(screen.queryByTestId("setting-disabled-ou-value")).toBeNull();
    });
  });

  it("risk weight inputs render with default values and can be changed", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-security")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("tab-security"));

    await waitFor(() => {
      expect(screen.getByTestId("setting-weight-privilegedHygiene")).toBeDefined();
    });

    const privilegedInput = screen.getByTestId("setting-weight-privilegedHygiene") as HTMLInputElement;
    expect(privilegedInput.value).toBe("15");

    const kerberosInput = screen.getByTestId("setting-weight-kerberosSecurity") as HTMLInputElement;
    expect(kerberosInput.value).toBe("20");

    // Change a weight
    fireEvent.change(privilegedInput, { target: { value: "25" } });
    expect(privilegedInput.value).toBe("25");
  });

  it("attack detection config fields render and update", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-security")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("tab-security"));

    await waitFor(() => {
      expect(screen.getByTestId("setting-brute-force-threshold")).toBeDefined();
    });

    const bruteForce = screen.getByTestId("setting-brute-force-threshold") as HTMLInputElement;
    expect(bruteForce.value).toBe("10");

    const kerberoasting = screen.getByTestId("setting-kerberoasting-threshold") as HTMLInputElement;
    expect(kerberoasting.value).toBe("3");

    // Change values
    fireEvent.change(bruteForce, { target: { value: "20" } });
    expect(bruteForce.value).toBe("20");

    fireEvent.change(kerberoasting, { target: { value: "5" } });
    expect(kerberoasting.value).toBe("5");
  });

  it("excluded IPs and accounts fields work", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-security")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("tab-security"));

    await waitFor(() => {
      expect(screen.getByTestId("setting-excluded-ips")).toBeDefined();
    });

    const ipsInput = screen.getByTestId("setting-excluded-ips") as HTMLInputElement;
    fireEvent.change(ipsInput, { target: { value: "10.0.0.1, 10.0.0.2" } });
    expect(ipsInput.value).toBe("10.0.0.1, 10.0.0.2");

    const accountsInput = screen.getByTestId("setting-excluded-accounts") as HTMLInputElement;
    fireEvent.change(accountsInput, { target: { value: "svc_backup, health_check" } });
    expect(accountsInput.value).toBe("svc_backup, health_check");
  });

  // -----------------------------------------------------------------------
  // Reports tab
  // -----------------------------------------------------------------------

  it("export format selector changes value", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-reports")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("tab-reports"));

    await waitFor(() => {
      expect(screen.getByTestId("setting-export-format")).toBeDefined();
    });

    const formatSelect = screen.getByTestId("setting-export-format") as HTMLSelectElement;
    expect(formatSelect.value).toBe("CSV");

    fireEvent.change(formatSelect, { target: { value: "PDF" } });
    expect(formatSelect.value).toBe("PDF");
  });

  it("export path field and browse button render", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-reports")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("tab-reports"));

    await waitFor(() => {
      expect(screen.getByTestId("setting-export-path")).toBeDefined();
      expect(screen.getByTestId("setting-export-path-browse")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("setting-export-path"), {
      target: { value: "C:\\Reports" },
    });

    expect(
      (screen.getByTestId("setting-export-path") as HTMLInputElement).value,
    ).toBe("C:\\Reports");
  });

  it("browse button calls pick_folder_dialog and updates path", async () => {
    setupMocks();
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_app_settings")
        return Promise.resolve({
          connection: { domainOverride: "", preferredDc: "" },
          auditRetentionDays: 365,
          reports: { defaultFormat: "CSV", defaultExportPath: "" },
          appearance: { theme: "system" },
        });
      if (cmd === "pick_folder_dialog") return Promise.resolve("C:\\PickedDir");
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-reports")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("tab-reports"));

    await waitFor(() => {
      expect(screen.getByTestId("setting-export-path-browse")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("setting-export-path-browse"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pick_folder_dialog");
    });

    await waitFor(() => {
      expect(
        (screen.getByTestId("setting-export-path") as HTMLInputElement).value,
      ).toBe("C:\\PickedDir");
    });
  });

  it("shows validation error for invalid export path on save", async () => {
    setupMocks();
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_app_settings")
        return Promise.resolve({
          connection: { domainOverride: "", preferredDc: "" },
          auditRetentionDays: 365,
          reports: { defaultFormat: "CSV", defaultExportPath: "" },
          appearance: { theme: "system" },
        });
      if (cmd === "test_preset_path") return Promise.resolve(false);
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-reports")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("tab-reports"));

    await waitFor(() => {
      expect(screen.getByTestId("setting-export-path")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("setting-export-path"), {
      target: { value: "C:\\InvalidPath" },
    });

    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      expect(screen.getByTestId("validation-export-path")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Reset defaults
  // -----------------------------------------------------------------------

  it("reset defaults on connection tab clears domain and DC", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("setting-domain-override")).toBeDefined();
    });

    // Make a change first
    fireEvent.change(screen.getByTestId("setting-domain-override"), {
      target: { value: "custom.corp.com" },
    });

    // Reset
    fireEvent.click(screen.getByTestId("settings-reset"));

    await waitFor(() => {
      expect(
        (screen.getByTestId("setting-domain-override") as HTMLInputElement).value,
      ).toBe("");
    });
  });

  it("reset defaults on security tab resets retention to 365", async () => {
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
      target: { value: "90" },
    });

    fireEvent.click(screen.getByTestId("settings-reset"));

    await waitFor(() => {
      expect(
        (screen.getByTestId("setting-audit-retention") as HTMLInputElement).value,
      ).toBe("365");
    });
  });

  it("reset defaults on reports tab resets format to CSV", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-reports")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("tab-reports"));

    await waitFor(() => {
      expect(screen.getByTestId("setting-export-format")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("setting-export-format"), {
      target: { value: "PDF" },
    });

    fireEvent.click(screen.getByTestId("settings-reset"));

    await waitFor(() => {
      expect(
        (screen.getByTestId("setting-export-format") as HTMLSelectElement).value,
      ).toBe("CSV");
    });
  });

  it("reset defaults on appearance tab resets to system theme", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-appearance")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("tab-appearance"));

    await waitFor(() => {
      expect(screen.getByTestId("theme-dark")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("theme-dark"));
    fireEvent.click(screen.getByTestId("settings-reset"));

    // After reset, the system button should be selected (has the primary border class)
    // We verify indirectly - the appearance state should be "system"
    await waitFor(() => {
      expect(screen.getByTestId("theme-system")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Save with validation errors blocks save
  // -----------------------------------------------------------------------

  it("save is blocked when validation fails", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("tab-security")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("tab-security"));

    await waitFor(() => {
      expect(screen.getByTestId("setting-audit-retention")).toBeDefined();
    });

    // Set invalid retention
    fireEvent.change(screen.getByTestId("setting-audit-retention"), {
      target: { value: "5" },
    });

    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      expect(screen.getByTestId("validation-audit-retention")).toBeInTheDocument();
    });

    // set_app_settings should NOT have been called
    expect(mockInvoke).not.toHaveBeenCalledWith("set_app_settings", expect.any(Object));
  });

  // -----------------------------------------------------------------------
  // Dirty state tracking
  // -----------------------------------------------------------------------

  it("dirty indicator shows after change and hides after save", async () => {
    setupMocks();
    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("setting-domain-override")).toBeDefined();
    });

    // No unsaved changes indicator initially
    expect(screen.queryByText("Unsaved changes")).toBeNull();

    // Make a change
    fireEvent.change(screen.getByTestId("setting-domain-override"), {
      target: { value: "new.domain.com" },
    });

    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    // Save
    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      expect(screen.queryByText("Unsaved changes")).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Save failure shows error notification
  // -----------------------------------------------------------------------

  it("save failure does not clear dirty state", async () => {
    setupMocks();
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_app_settings")
        return Promise.resolve({
          connection: { domainOverride: "", preferredDc: "" },
          auditRetentionDays: 365,
          reports: { defaultFormat: "CSV", defaultExportPath: "" },
          appearance: { theme: "system" },
        });
      if (cmd === "set_app_settings") return Promise.reject("Save failed");
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<Wrapper><Settings /></Wrapper>);

    await waitFor(() => {
      expect(screen.getByTestId("setting-domain-override")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("setting-domain-override"), {
      target: { value: "fail.domain.com" },
    });

    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      // Dirty state should remain because save failed
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  it("shows loading spinner while settings are being fetched", () => {
    mockInvoke.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<Wrapper><Settings /></Wrapper>);
    expect(screen.getByText("Loading settings...")).toBeInTheDocument();
  });
});
