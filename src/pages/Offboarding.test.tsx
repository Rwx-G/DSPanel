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
      case "audit_log":
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
});
