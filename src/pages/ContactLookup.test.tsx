import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { ContactLookup } from "./ContactLookup";
import { NotificationProvider } from "@/contexts/NotificationContext";
import type { DirectoryEntry } from "@/types/directory";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: vi.fn(({ count, estimateSize, getItemKey }) => {
    const items = Array.from({ length: Math.min(count, 50) }, (_, i) => ({
      key: getItemKey ? getItemKey(i) : i,
      index: i,
      start: i * estimateSize(i),
      size: estimateSize(i),
    }));
    return {
      getTotalSize: () => count * estimateSize(0),
      getVirtualItems: () => items,
    };
  }),
}));

vi.mock("@/hooks/useErrorHandler", () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
  }),
}));

vi.mock("@/contexts/DialogContext", () => ({
  useDialog: () => ({
    showConfirmation: vi.fn(),
  }),
}));

vi.mock("@/hooks/useModifyAttribute", () => ({
  useModifyAttribute: () => ({
    pendingChanges: [],
    saving: false,
    stageChange: vi.fn(),
    clearChanges: vi.fn(),
    submitChanges: vi.fn(),
  }),
}));

const mockHasPermission = vi.fn().mockReturnValue(false);
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    level: "ReadOnly",
    groups: [],
    loading: false,
    hasPermission: mockHasPermission,
  }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <NotificationProvider>{children}</NotificationProvider>;
}

function makeContactEntry(
  displayName: string,
  overrides: Partial<DirectoryEntry> = {},
): DirectoryEntry {
  const dn = `CN=${displayName},OU=Contacts,DC=example,DC=com`;
  return {
    distinguishedName: dn,
    samAccountName: displayName.toLowerCase().replace(/\s/g, "."),
    displayName,
    objectClass: "contact",
    attributes: {
      displayName: [displayName],
      givenName: [displayName.split(" ")[0] || ""],
      sn: [displayName.split(" ")[1] || ""],
      mail: [`${displayName.toLowerCase().replace(/\s/g, ".")}@example.com`],
      telephoneNumber: ["+1234567890"],
      mobile: ["+0987654321"],
      company: ["Acme Corp"],
      department: ["Engineering"],
      description: ["Test contact"],
    },
    ...overrides,
  };
}

function makeBrowseResult(entries: DirectoryEntry[], hasMore = false) {
  return {
    entries,
    totalCount: entries.length + (hasMore ? 50 : 0),
    hasMore,
  };
}

describe("ContactLookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(false);
  });

  it("renders with search bar in initial state", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_contacts")
        return Promise.resolve(makeBrowseResult([]));
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });
    expect(screen.getByTestId("contact-lookup")).toBeInTheDocument();
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText("No contacts available."),
      ).toBeInTheDocument();
    });
  });

  it("shows loading state during search", async () => {
    mockInvoke.mockImplementation(
      () => new Promise(() => {}),
    );

    render(<ContactLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("contact-lookup-loading")).toBeInTheDocument();
    });
  });

  it("displays search results", async () => {
    const entries = [
      makeContactEntry("John Doe"),
      makeContactEntry("Jane Smith"),
    ];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_contacts")
        return Promise.resolve(makeBrowseResult(entries));
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("contact-results-list")).toBeInTheDocument();
    });

    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
  });

  it("shows empty state when no contacts found", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_contacts")
        return Promise.resolve(makeBrowseResult([]));
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("empty-state-title")).toHaveTextContent(
        "No contacts found",
      );
    });
  });

  it("shows error state on search failure", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_contacts")
        return Promise.reject(new Error("LDAP error"));
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("contact-lookup-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Failed to load contacts")).toBeInTheDocument();
  });

  it("shows contact detail when a contact is selected", async () => {
    const entries = [makeContactEntry("John Doe")];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_contacts")
        return Promise.resolve(makeBrowseResult(entries));
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("contact-results-list")).toBeInTheDocument();
    });

    const contactItem = screen.getByTestId(
      "contact-result-CN=John Doe,OU=Contacts,DC=example,DC=com",
    );
    fireEvent.click(contactItem);

    await waitFor(() => {
      expect(screen.getByTestId("contact-detail")).toBeInTheDocument();
    });

    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByText("Contact Info")).toBeInTheDocument();
    expect(screen.getByText("Organization")).toBeInTheDocument();
  });

  it("shows edit and delete buttons for AccountOperator", async () => {
    mockHasPermission.mockReturnValue(true);
    const entries = [makeContactEntry("John Doe")];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_contacts")
        return Promise.resolve(makeBrowseResult(entries));
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("contact-results-list")).toBeInTheDocument();
    });

    const contactItem = screen.getByTestId(
      "contact-result-CN=John Doe,OU=Contacts,DC=example,DC=com",
    );
    fireEvent.click(contactItem);

    await waitFor(() => {
      expect(screen.getByTestId("contact-delete-btn")).toBeInTheDocument();
    });
  });

  it("does not show edit/delete buttons for ReadOnly users", async () => {
    mockHasPermission.mockReturnValue(false);
    const entries = [makeContactEntry("John Doe")];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_contacts")
        return Promise.resolve(makeBrowseResult(entries));
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("contact-results-list")).toBeInTheDocument();
    });

    const contactItem = screen.getByTestId(
      "contact-result-CN=John Doe,OU=Contacts,DC=example,DC=com",
    );
    fireEvent.click(contactItem);

    await waitFor(() => {
      expect(screen.getByTestId("contact-detail")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("contact-delete-btn")).not.toBeInTheDocument();
  });

  it("shows placeholder when no contact is selected", async () => {
    const entries = [makeContactEntry("John Doe")];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_contacts")
        return Promise.resolve(makeBrowseResult(entries));
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("contact-results-list")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Select a contact to view details"),
    ).toBeInTheDocument();
  });

  it("shows retry button on error", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_contacts")
        return Promise.reject(new Error("LDAP error"));
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  it("shows accessibility status for search results", async () => {
    const entries = [
      makeContactEntry("John Doe"),
      makeContactEntry("Jane Smith"),
    ];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_contacts")
        return Promise.resolve(makeBrowseResult(entries));
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      const status = screen.getByTestId("contact-lookup-status");
      expect(status).toHaveTextContent("2 contacts found");
    });
  });
});
