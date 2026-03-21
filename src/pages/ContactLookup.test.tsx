import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { ContactLookup } from "./ContactLookup";
import { NotificationProvider } from "@/contexts/NotificationContext";
import type { ContactInfo } from "@/types/contact";

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

function makeContact(overrides: Partial<ContactInfo> = {}): ContactInfo {
  return {
    dn: "CN=John Doe,OU=Contacts,DC=example,DC=com",
    displayName: "John Doe",
    firstName: "John",
    lastName: "Doe",
    email: "john.doe@example.com",
    phone: "+1234567890",
    mobile: "+0987654321",
    company: "Acme Corp",
    department: "Engineering",
    description: "Test contact",
    ...overrides,
  };
}

describe("ContactLookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(false);
  });

  it("renders with search bar in initial state", () => {
    render(<ContactLookup />, { wrapper: Wrapper });
    expect(screen.getByTestId("contact-lookup")).toBeInTheDocument();
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();
    expect(
      screen.getByText("Search for contacts"),
    ).toBeInTheDocument();
  });

  it("shows loading state during search", async () => {
    mockInvoke.mockImplementation(
      () => new Promise(() => {}),
    );

    render(<ContactLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search contacts by name, email, or company...",
    );
    fireEvent.change(input, { target: { value: "john" } });

    await waitFor(() => {
      expect(screen.getByTestId("contact-lookup-loading")).toBeInTheDocument();
    });
  });

  it("displays search results", async () => {
    const contacts = [
      makeContact(),
      makeContact({
        dn: "CN=Jane Smith,OU=Contacts,DC=example,DC=com",
        displayName: "Jane Smith",
        firstName: "Jane",
        lastName: "Smith",
        email: "jane.smith@example.com",
      }),
    ];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_contacts") return Promise.resolve(contacts);
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search contacts by name, email, or company...",
    );
    fireEvent.change(input, { target: { value: "john" } });

    await waitFor(() => {
      expect(screen.getByTestId("contact-results-list")).toBeInTheDocument();
    });

    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
  });

  it("shows empty state when no contacts found", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_contacts") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search contacts by name, email, or company...",
    );
    fireEvent.change(input, { target: { value: "xyz" } });

    await waitFor(() => {
      expect(screen.getByTestId("empty-state-title")).toHaveTextContent(
        "No contacts found",
      );
    });
  });

  it("shows error state on search failure", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_contacts")
        return Promise.reject(new Error("LDAP error"));
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search contacts by name, email, or company...",
    );
    fireEvent.change(input, { target: { value: "john" } });

    await waitFor(() => {
      expect(screen.getByTestId("contact-lookup-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Failed to search contacts")).toBeInTheDocument();
  });

  it("shows contact detail when a contact is selected", async () => {
    const contacts = [makeContact()];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_contacts") return Promise.resolve(contacts);
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search contacts by name, email, or company...",
    );
    fireEvent.change(input, { target: { value: "john" } });

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
    const contacts = [makeContact()];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_contacts") return Promise.resolve(contacts);
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search contacts by name, email, or company...",
    );
    fireEvent.change(input, { target: { value: "john" } });

    await waitFor(() => {
      expect(screen.getByTestId("contact-results-list")).toBeInTheDocument();
    });

    const contactItem = screen.getByTestId(
      "contact-result-CN=John Doe,OU=Contacts,DC=example,DC=com",
    );
    fireEvent.click(contactItem);

    await waitFor(() => {
      expect(screen.getByTestId("contact-edit-btn")).toBeInTheDocument();
      expect(screen.getByTestId("contact-delete-btn")).toBeInTheDocument();
    });
  });

  it("does not show edit/delete buttons for ReadOnly users", async () => {
    mockHasPermission.mockReturnValue(false);
    const contacts = [makeContact()];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_contacts") return Promise.resolve(contacts);
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search contacts by name, email, or company...",
    );
    fireEvent.change(input, { target: { value: "john" } });

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

    expect(screen.queryByTestId("contact-edit-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("contact-delete-btn")).not.toBeInTheDocument();
  });

  it("shows placeholder when no contact is selected", async () => {
    const contacts = [makeContact()];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_contacts") return Promise.resolve(contacts);
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search contacts by name, email, or company...",
    );
    fireEvent.change(input, { target: { value: "john" } });

    await waitFor(() => {
      expect(screen.getByTestId("contact-results-list")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Select a contact to view details"),
    ).toBeInTheDocument();
  });

  it("shows retry button on error", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_contacts")
        return Promise.reject(new Error("LDAP error"));
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search contacts by name, email, or company...",
    );
    fireEvent.change(input, { target: { value: "john" } });

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  it("shows accessibility status for search results", async () => {
    const contacts = [
      makeContact(),
      makeContact({
        dn: "CN=Jane,OU=Contacts,DC=example,DC=com",
        displayName: "Jane",
      }),
    ];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_contacts") return Promise.resolve(contacts);
      return Promise.resolve(null);
    });

    render(<ContactLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search contacts by name, email, or company...",
    );
    fireEvent.change(input, { target: { value: "john" } });

    await waitFor(() => {
      const status = screen.getByTestId("contact-lookup-status");
      expect(status).toHaveTextContent("2 contacts found");
    });
  });
});
