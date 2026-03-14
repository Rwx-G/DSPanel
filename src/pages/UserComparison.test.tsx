import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { UserComparison } from "./UserComparison";
import { NavigationProvider } from "@/contexts/NavigationContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { DialogProvider } from "@/contexts/DialogContext";
import type { DirectoryEntry } from "@/types/directory";
import type { GroupComparisonResult } from "@/types/comparison";

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <NotificationProvider>
      <DialogProvider>
        <NavigationProvider>{children}</NavigationProvider>
      </DialogProvider>
    </NotificationProvider>
  );
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function makeEntry(
  sam: string,
  display: string,
  groups: string[] = [],
): DirectoryEntry {
  return {
    distinguishedName: `CN=${display},OU=Users,DC=example,DC=com`,
    samAccountName: sam,
    displayName: display,
    objectClass: "user",
    attributes: {
      title: ["Engineer"],
      department: ["IT"],
      memberOf: groups,
    },
  };
}

const MOCK_COMPARISON: GroupComparisonResult = {
  sharedGroups: ["CN=Domain Users,DC=example,DC=com"],
  onlyAGroups: ["CN=Developers,DC=example,DC=com"],
  onlyBGroups: ["CN=Managers,DC=example,DC=com"],
  totalA: 2,
  totalB: 2,
};

describe("UserComparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the page with search fields", () => {
    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );
    expect(screen.getByTestId("user-comparison-page")).toBeInTheDocument();
    expect(screen.getByTestId("user-a")).toBeInTheDocument();
    expect(screen.getByTestId("user-b")).toBeInTheDocument();
    expect(screen.getByTestId("compare-button")).toBeInTheDocument();
  });

  it("compare button is disabled when no users selected", () => {
    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );
    const button = screen.getByTestId("compare-button");
    expect(button).toBeDisabled();
  });

  it("searches users when typing in search field", async () => {
    const entries = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("jsmith", "Jane Smith"),
    ];
    mockInvoke.mockResolvedValueOnce(entries);

    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );

    const inputA = screen.getByTestId("user-a-input");
    fireEvent.change(inputA, { target: { value: "jo" } });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("search_users", { query: "jo" });
    });
  });

  it("displays comparison results after comparing", async () => {
    const userA = makeEntry("jdoe", "John Doe", [
      "CN=Domain Users,DC=example,DC=com",
      "CN=Developers,DC=example,DC=com",
    ]);
    const userB = makeEntry("asmith", "Alice Smith", [
      "CN=Domain Users,DC=example,DC=com",
      "CN=Managers,DC=example,DC=com",
    ]);

    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "search_users") return [userA, userB];
      if (cmd === "get_user") {
        const a = args as { samAccountName: string };
        if (a.samAccountName === "jdoe") return userA;
        if (a.samAccountName === "asmith") return userB;
        return null;
      }
      if (cmd === "compare_users") return MOCK_COMPARISON;
      return null;
    });

    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );

    // Select user A
    const inputA = screen.getByTestId("user-a-input");
    fireEvent.change(inputA, { target: { value: "jdoe" } });
    await waitFor(() => {
      expect(screen.getByTestId("user-a-dropdown")).toBeInTheDocument();
    });
    fireEvent.mouseDown(screen.getByTestId("user-a-result-jdoe"));

    // Select user B
    const inputB = screen.getByTestId("user-b-input");
    fireEvent.change(inputB, { target: { value: "asmith" } });
    await waitFor(() => {
      expect(screen.getByTestId("user-b-dropdown")).toBeInTheDocument();
    });
    fireEvent.mouseDown(screen.getByTestId("user-b-result-asmith"));

    // Wait for user details to load
    await waitFor(() => {
      expect(screen.getByTestId("user-a-selected")).toBeInTheDocument();
      expect(screen.getByTestId("user-b-selected")).toBeInTheDocument();
    });

    // Compare
    const compareBtn = screen.getByTestId("compare-button");
    expect(compareBtn).not.toBeDisabled();
    fireEvent.click(compareBtn);

    await waitFor(() => {
      expect(screen.getByTestId("comparison-results")).toBeInTheDocument();
      expect(screen.getByTestId("delta-summary")).toBeInTheDocument();
    });
  });

  it("displays error when comparison fails", async () => {
    const userA = makeEntry("jdoe", "John Doe");
    const userB = makeEntry("asmith", "Alice Smith");

    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "search_users") return [userA, userB];
      if (cmd === "get_user") {
        const a = args as { samAccountName: string };
        if (a.samAccountName === "jdoe") return userA;
        if (a.samAccountName === "asmith") return userB;
        return null;
      }
      if (cmd === "compare_users") throw new Error("Connection failed");
      return null;
    });

    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );

    // Select both users
    fireEvent.change(screen.getByTestId("user-a-input"), {
      target: { value: "jdoe" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("user-a-dropdown")).toBeInTheDocument(),
    );
    fireEvent.mouseDown(screen.getByTestId("user-a-result-jdoe"));

    fireEvent.change(screen.getByTestId("user-b-input"), {
      target: { value: "asmith" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("user-b-dropdown")).toBeInTheDocument(),
    );
    fireEvent.mouseDown(screen.getByTestId("user-b-result-asmith"));

    await waitFor(() => {
      expect(screen.getByTestId("user-a-selected")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("compare-button"));

    await waitFor(() => {
      expect(screen.getByTestId("comparison-error")).toBeInTheDocument();
    });
  });

  it("resets comparison on reset button click", async () => {
    render(
      <TestProviders>
        <UserComparison />
      </TestProviders>,
    );

    fireEvent.click(screen.getByTestId("comparison-reset"));

    // Page should still render with empty state
    expect(screen.getByTestId("user-comparison-page")).toBeInTheDocument();
    expect(screen.queryByTestId("comparison-results")).not.toBeInTheDocument();
  });
});
