import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { PrinterLookup } from "./PrinterLookup";
import { NotificationProvider } from "@/contexts/NotificationContext";
import type { PrinterInfo } from "@/types/printer";

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

function makePrinter(overrides: Partial<PrinterInfo> = {}): PrinterInfo {
  return {
    dn: "CN=HP-LaserJet,OU=Printers,DC=example,DC=com",
    name: "HP LaserJet",
    location: "Floor 2, Room 201",
    serverName: "PRINT-SRV01",
    sharePath: "\\\\PRINT-SRV01\\HP-LaserJet",
    driverName: "HP Universal Printing PCL 6",
    description: "Main office printer",
    ...overrides,
  };
}

describe("PrinterLookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(false);
  });

  it("renders with search bar in initial state", () => {
    render(<PrinterLookup />, { wrapper: Wrapper });
    expect(screen.getByTestId("printer-lookup")).toBeInTheDocument();
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();
    expect(
      screen.getByText("Search for printers"),
    ).toBeInTheDocument();
  });

  it("shows loading state during search", async () => {
    mockInvoke.mockImplementation(
      () => new Promise(() => {}),
    );

    render(<PrinterLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search printers by name, location, or server...",
    );
    fireEvent.change(input, { target: { value: "HP" } });

    await waitFor(() => {
      expect(screen.getByTestId("printer-lookup-loading")).toBeInTheDocument();
    });
  });

  it("displays search results", async () => {
    const printers = [
      makePrinter(),
      makePrinter({
        dn: "CN=Canon-iR,OU=Printers,DC=example,DC=com",
        name: "Canon iR-ADV",
        location: "Floor 3",
      }),
    ];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_printers") return Promise.resolve(printers);
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search printers by name, location, or server...",
    );
    fireEvent.change(input, { target: { value: "printer" } });

    await waitFor(() => {
      expect(screen.getByTestId("printer-results-list")).toBeInTheDocument();
    });

    expect(screen.getByText("HP LaserJet")).toBeInTheDocument();
    expect(screen.getByText("Canon iR-ADV")).toBeInTheDocument();
  });

  it("shows empty state when no printers found", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_printers") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search printers by name, location, or server...",
    );
    fireEvent.change(input, { target: { value: "xyz" } });

    await waitFor(() => {
      expect(screen.getByTestId("empty-state-title")).toHaveTextContent(
        "No printers found",
      );
    });
  });

  it("shows error state on search failure", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_printers")
        return Promise.reject(new Error("LDAP error"));
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search printers by name, location, or server...",
    );
    fireEvent.change(input, { target: { value: "HP" } });

    await waitFor(() => {
      expect(screen.getByTestId("printer-lookup-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Failed to search printers")).toBeInTheDocument();
  });

  it("shows printer detail when a printer is selected", async () => {
    const printers = [makePrinter()];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_printers") return Promise.resolve(printers);
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search printers by name, location, or server...",
    );
    fireEvent.change(input, { target: { value: "HP" } });

    await waitFor(() => {
      expect(screen.getByTestId("printer-results-list")).toBeInTheDocument();
    });

    const printerItem = screen.getByTestId(
      "printer-result-CN=HP-LaserJet,OU=Printers,DC=example,DC=com",
    );
    fireEvent.click(printerItem);

    await waitFor(() => {
      expect(screen.getByTestId("printer-detail")).toBeInTheDocument();
    });

    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Server Info")).toBeInTheDocument();
  });

  it("shows delete button for DomainAdmin", async () => {
    mockHasPermission.mockReturnValue(true);
    const printers = [makePrinter()];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_printers") return Promise.resolve(printers);
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search printers by name, location, or server...",
    );
    fireEvent.change(input, { target: { value: "HP" } });

    await waitFor(() => {
      expect(screen.getByTestId("printer-results-list")).toBeInTheDocument();
    });

    const printerItem = screen.getByTestId(
      "printer-result-CN=HP-LaserJet,OU=Printers,DC=example,DC=com",
    );
    fireEvent.click(printerItem);

    await waitFor(() => {
      expect(screen.getByTestId("printer-delete-btn")).toBeInTheDocument();
    });
  });

  it("does not show delete button for ReadOnly users", async () => {
    mockHasPermission.mockReturnValue(false);
    const printers = [makePrinter()];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_printers") return Promise.resolve(printers);
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search printers by name, location, or server...",
    );
    fireEvent.change(input, { target: { value: "HP" } });

    await waitFor(() => {
      expect(screen.getByTestId("printer-results-list")).toBeInTheDocument();
    });

    const printerItem = screen.getByTestId(
      "printer-result-CN=HP-LaserJet,OU=Printers,DC=example,DC=com",
    );
    fireEvent.click(printerItem);

    await waitFor(() => {
      expect(screen.getByTestId("printer-detail")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("printer-delete-btn")).not.toBeInTheDocument();
  });

  it("shows placeholder when no printer is selected", async () => {
    const printers = [makePrinter()];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_printers") return Promise.resolve(printers);
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search printers by name, location, or server...",
    );
    fireEvent.change(input, { target: { value: "HP" } });

    await waitFor(() => {
      expect(screen.getByTestId("printer-results-list")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Select a printer to view details"),
    ).toBeInTheDocument();
  });

  it("shows retry button on error", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_printers")
        return Promise.reject(new Error("LDAP error"));
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search printers by name, location, or server...",
    );
    fireEvent.change(input, { target: { value: "HP" } });

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  it("shows accessibility status for search results", async () => {
    const printers = [
      makePrinter(),
      makePrinter({
        dn: "CN=Canon,OU=Printers,DC=example,DC=com",
        name: "Canon",
      }),
    ];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_printers") return Promise.resolve(printers);
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(
      "Search printers by name, location, or server...",
    );
    fireEvent.change(input, { target: { value: "printer" } });

    await waitFor(() => {
      const status = screen.getByTestId("printer-lookup-status");
      expect(status).toHaveTextContent("2 printers found");
    });
  });
});
