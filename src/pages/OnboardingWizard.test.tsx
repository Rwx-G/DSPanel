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
});
