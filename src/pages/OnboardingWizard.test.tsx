import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { OnboardingWizard } from "./OnboardingWizard";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { DialogProvider } from "@/contexts/DialogContext";

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
    createElement(DialogProvider, null, children),
  );
}

function setupMocks(level = "AccountOperator") {
  mockInvoke.mockImplementation(((cmd: string) => {
    switch (cmd) {
      case "get_permission_level":
        return Promise.resolve(level);
      case "get_user_groups":
        return Promise.resolve([]);
      case "has_permission":
        return Promise.resolve(level === "AccountOperator");
      case "list_presets":
        return Promise.resolve([
          {
            name: "Dev Onboarding",
            description: "Developer setup",
            type: "Onboarding",
            targetOu: "OU=Devs,DC=example,DC=com",
            groups: ["CN=Devs,DC=example,DC=com"],
            attributes: { department: "Engineering" },
          },
        ]);
      case "get_ou_tree":
        return Promise.resolve([]);
      case "create_user":
        return Promise.resolve(
          "CN=John Smith,OU=Devs,DC=example,DC=com",
        );
      case "add_user_to_group":
        return Promise.resolve(undefined);
      case "get_user_by_identity":
        return Promise.resolve(null);
      default:
        return Promise.resolve(null);
    }
  }) as typeof invoke);
}

describe("OnboardingWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows access denied for ReadOnly", async () => {
    setupMocks("ReadOnly");

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Access Denied")).toBeDefined();
    });
  });

  it("renders wizard for AccountOperator", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("onboarding-wizard")).toBeDefined();
    });
    expect(screen.getByTestId("step-details")).toBeDefined();
  });

  it("shows step indicator", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("step-indicator")).toBeDefined();
    });

    expect(screen.getByText("User Details")).toBeDefined();
    expect(screen.getByText("Preset Selection")).toBeDefined();
    expect(screen.getByText("Preview")).toBeDefined();
    expect(screen.getByText("Execute")).toBeDefined();
  });

  it("auto-generates login from first and last name", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-firstname")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("input-firstname"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByTestId("input-lastname"), {
      target: { value: "Smith" },
    });

    const loginInput = screen.getByTestId("input-login") as HTMLInputElement;
    expect(loginInput.value).toBe("jsmith");
  });

  it("next button disabled when required fields empty", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("btn-next")).toBeDefined();
    });

    const nextBtn = screen.getByTestId("btn-next") as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
  });

  it("navigates to preset step when details filled", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-firstname")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("input-firstname"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByTestId("input-lastname"), {
      target: { value: "Smith" },
    });

    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-preset")).toBeDefined();
    });
  });

  it("can select a preset and navigate to preview", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-firstname")).toBeDefined();
    });

    // Fill details
    fireEvent.change(screen.getByTestId("input-firstname"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByTestId("input-lastname"), {
      target: { value: "Smith" },
    });
    fireEvent.click(screen.getByTestId("btn-next"));

    // Select preset
    await waitFor(() => {
      expect(screen.getByTestId("step-preset")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Dev Onboarding"));
    fireEvent.click(screen.getByTestId("btn-next"));

    // Preview
    await waitFor(() => {
      expect(screen.getByTestId("step-preview")).toBeDefined();
    });
    expect(screen.getByText("jsmith")).toBeDefined();
  });

  it("password regenerate button works", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-password")).toBeDefined();
    });

    const pwInput = screen.getByTestId("input-password") as HTMLInputElement;
    expect(pwInput.value.length).toBe(20);

    fireEvent.click(screen.getByTestId("btn-regenerate-password"));

    // Password should still be 20 chars after regeneration
    expect(pwInput.value).toBeDefined();
    expect(pwInput.value.length).toBe(20);
  });

  it("back button navigates backward", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-firstname")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("input-firstname"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByTestId("input-lastname"), {
      target: { value: "Smith" },
    });
    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-preset")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("btn-back"));

    await waitFor(() => {
      expect(screen.getByTestId("step-details")).toBeDefined();
    });
  });

  it("allows manual login override and shows Auto reset button", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-login")).toBeDefined();
    });

    // Type into login field to trigger manual mode
    fireEvent.change(screen.getByTestId("input-login"), {
      target: { value: "customlogin" },
    });

    const loginInput = screen.getByTestId("input-login") as HTMLInputElement;
    expect(loginInput.value).toBe("customlogin");

    // Auto button should appear in manual mode
    expect(screen.getByText("Auto")).toBeDefined();

    // Click Auto to reset to auto-generated login
    fireEvent.click(screen.getByText("Auto"));

    // After reset, the login should be empty since no first/last name
    expect(loginInput.value).toBe("");
  });

  it("sets display name field and uses it in preview", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-firstname")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("input-firstname"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByTestId("input-lastname"), {
      target: { value: "Smith" },
    });
    fireEvent.change(screen.getByTestId("input-displayname"), {
      target: { value: "Johnny S." },
    });

    // Navigate to preset step
    fireEvent.click(screen.getByTestId("btn-next"));
    await waitFor(() => {
      expect(screen.getByTestId("step-preset")).toBeDefined();
    });

    // Select preset
    fireEvent.click(screen.getByText("Dev Onboarding"));
    fireEvent.click(screen.getByTestId("btn-next"));

    // Preview should show custom display name
    await waitFor(() => {
      expect(screen.getByTestId("step-preview")).toBeDefined();
    });
    expect(screen.getByText("Johnny S.")).toBeDefined();
  });

  it("preview step shows all preset details", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-firstname")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("input-firstname"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByTestId("input-lastname"), {
      target: { value: "Smith" },
    });
    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-preset")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Dev Onboarding"));
    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-preview")).toBeDefined();
    });

    // Check all preview fields
    expect(screen.getByText("jsmith")).toBeDefined();
    expect(screen.getByText("John Smith")).toBeDefined();
    expect(screen.getByText("OU=Devs,DC=example,DC=com")).toBeDefined();
    expect(screen.getByText("Dev Onboarding")).toBeDefined();
    expect(screen.getByText("Changes to apply")).toBeDefined();
    // Group listed
    expect(screen.getByText("+ CN=Devs,DC=example,DC=com")).toBeDefined();
    // Attribute listed
    expect(screen.getByText("+ department = Engineering")).toBeDefined();
  });

  it("executes user creation successfully and shows result", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-firstname")).toBeDefined();
    });

    // Fill details
    fireEvent.change(screen.getByTestId("input-firstname"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByTestId("input-lastname"), {
      target: { value: "Smith" },
    });
    fireEvent.click(screen.getByTestId("btn-next"));

    // Select preset
    await waitFor(() => {
      expect(screen.getByTestId("step-preset")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Dev Onboarding"));
    fireEvent.click(screen.getByTestId("btn-next"));

    // Preview - click execute
    await waitFor(() => {
      expect(screen.getByTestId("btn-execute")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("btn-execute"));

    // Result step
    await waitFor(() => {
      expect(screen.getByTestId("step-execute")).toBeDefined();
    });
    expect(screen.getByText("User created successfully")).toBeDefined();
    expect(screen.getByTestId("onboarding-summary")).toBeDefined();
    expect(screen.getByText(/Login: jsmith/)).toBeDefined();
    expect(screen.getByText(/DN: CN=John Smith,OU=Devs,DC=example,DC=com/)).toBeDefined();
  });

  it("shows error state when user creation fails", async () => {
    setupMocks();
    // Override create_user to fail
    mockInvoke.mockImplementation(((cmd: string) => {
      switch (cmd) {
        case "get_permission_level":
          return Promise.resolve("AccountOperator");
        case "get_user_groups":
          return Promise.resolve([]);
        case "has_permission":
          return Promise.resolve(true);
        case "list_presets":
          return Promise.resolve([
            {
              name: "Dev Onboarding",
              description: "Developer setup",
              type: "Onboarding",
              targetOu: "OU=Devs,DC=example,DC=com",
              groups: ["CN=Devs,DC=example,DC=com"],
              attributes: { department: "Engineering" },
            },
          ]);
        case "get_ou_tree":
          return Promise.resolve([]);
        case "create_user":
          return Promise.reject("LDAP error: entry already exists");
        default:
          return Promise.resolve(null);
      }
    }) as typeof invoke);

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-firstname")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("input-firstname"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByTestId("input-lastname"), {
      target: { value: "Smith" },
    });
    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-preset")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Dev Onboarding"));
    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("btn-execute")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("btn-execute"));

    await waitFor(() => {
      expect(screen.getByText("Failed to create user")).toBeDefined();
    });
  });

  it("copy summary button invokes clipboard write", async () => {
    setupMocks();

    // Mock clipboard
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-firstname")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("input-firstname"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByTestId("input-lastname"), {
      target: { value: "Smith" },
    });
    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-preset")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Dev Onboarding"));
    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("btn-execute")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("btn-execute"));

    await waitFor(() => {
      expect(screen.getByTestId("btn-copy-summary")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("btn-copy-summary"));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(1);
    });
    expect(writeTextMock.mock.calls[0][0]).toContain("Login: jsmith");
  });

  it("copy password button invokes clipboard write", async () => {
    setupMocks();

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-firstname")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("input-firstname"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByTestId("input-lastname"), {
      target: { value: "Smith" },
    });
    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-preset")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Dev Onboarding"));
    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("btn-execute")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("btn-execute"));

    await waitFor(() => {
      expect(screen.getByTestId("btn-copy-password")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("btn-copy-password"));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalled();
    });
  });

  it("Start New Onboarding button resets the wizard", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-firstname")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("input-firstname"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByTestId("input-lastname"), {
      target: { value: "Smith" },
    });
    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-preset")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Dev Onboarding"));
    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("btn-execute")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("btn-execute"));

    await waitFor(() => {
      expect(screen.getByTestId("btn-new-onboarding")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("btn-new-onboarding"));

    await waitFor(() => {
      expect(screen.getByTestId("step-details")).toBeDefined();
    });
    // Fields should be cleared
    const firstNameInput = screen.getByTestId("input-firstname") as HTMLInputElement;
    expect(firstNameInput.value).toBe("");
  });

  it("shows empty state when no onboarding presets exist", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      switch (cmd) {
        case "get_permission_level":
          return Promise.resolve("AccountOperator");
        case "get_user_groups":
          return Promise.resolve([]);
        case "has_permission":
          return Promise.resolve(true);
        case "list_presets":
          // Only offboarding presets, no onboarding
          return Promise.resolve([
            {
              name: "Offboard",
              description: "Offboarding",
              type: "Offboarding",
              targetOu: "OU=Disabled,DC=example,DC=com",
              groups: [],
              attributes: {},
            },
          ]);
        case "get_ou_tree":
          return Promise.resolve([]);
        default:
          return Promise.resolve(null);
      }
    }) as typeof invoke);

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-firstname")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("input-firstname"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByTestId("input-lastname"), {
      target: { value: "Smith" },
    });
    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-preset")).toBeDefined();
    });
    expect(screen.getByText("No onboarding presets")).toBeDefined();
  });

  it("next button is disabled on preset step when no preset selected", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-firstname")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("input-firstname"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByTestId("input-lastname"), {
      target: { value: "Smith" },
    });
    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-preset")).toBeDefined();
    });

    const nextBtn = screen.getByTestId("btn-next") as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
  });

  it("auto-generates display name placeholder from first and last name", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-displayname")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("input-firstname"), {
      target: { value: "Jane" },
    });
    fireEvent.change(screen.getByTestId("input-lastname"), {
      target: { value: "Doe" },
    });

    const displayInput = screen.getByTestId("input-displayname") as HTMLInputElement;
    expect(displayInput.placeholder).toBe("Jane Doe");
  });

  it("password field allows manual editing", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-password")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("input-password"), {
      target: { value: "MyCustomP@ss123" },
    });

    const pwInput = screen.getByTestId("input-password") as HTMLInputElement;
    expect(pwInput.value).toBe("MyCustomP@ss123");
  });

  it("preset card shows integrity warning when present", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      switch (cmd) {
        case "get_permission_level":
          return Promise.resolve("AccountOperator");
        case "get_user_groups":
          return Promise.resolve([]);
        case "has_permission":
          return Promise.resolve(true);
        case "list_presets":
          return Promise.resolve([
            {
              name: "Tampered Preset",
              description: "Modified externally",
              type: "Onboarding",
              targetOu: "OU=Users,DC=example,DC=com",
              groups: [],
              attributes: {},
              integrityWarning: true,
            },
          ]);
        case "get_ou_tree":
          return Promise.resolve([]);
        default:
          return Promise.resolve(null);
      }
    }) as typeof invoke);

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-firstname")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("input-firstname"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByTestId("input-lastname"), {
      target: { value: "Smith" },
    });
    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-preset")).toBeDefined();
    });

    expect(screen.getByText("Modified outside DSPanel - review before use")).toBeDefined();
    expect(screen.getByLabelText("Preset modified externally")).toBeDefined();
  });

  it("back button is disabled on the first step", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("btn-back")).toBeDefined();
    });

    const backBtn = screen.getByTestId("btn-back") as HTMLButtonElement;
    expect(backBtn.disabled).toBe(true);
  });

  it("navigation buttons are hidden on execute step", async () => {
    setupMocks();

    render(
      <Wrapper>
        <OnboardingWizard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("input-firstname")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("input-firstname"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByTestId("input-lastname"), {
      target: { value: "Smith" },
    });
    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-preset")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Dev Onboarding"));
    fireEvent.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("btn-execute")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("btn-execute"));

    await waitFor(() => {
      expect(screen.getByTestId("step-execute")).toBeDefined();
    });

    // Back and Next buttons should not be present on execute step
    expect(screen.queryByTestId("btn-back")).toBeNull();
    expect(screen.queryByTestId("btn-next")).toBeNull();
  });
});
