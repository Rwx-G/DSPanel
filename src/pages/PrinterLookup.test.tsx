import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { PrinterLookup } from "./PrinterLookup";
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

function makePrinterEntry(
  name: string,
  overrides: Partial<DirectoryEntry> = {},
): DirectoryEntry {
  const dn = `CN=${name.replace(/\s/g, "-")},OU=Printers,DC=example,DC=com`;
  return {
    distinguishedName: dn,
    samAccountName: name,
    displayName: name,
    objectClass: "printQueue",
    attributes: {
      printerName: [name],
      location: ["Floor 2, Room 201"],
      serverName: ["PRINT-SRV01"],
      uNCName: [`\\\\PRINT-SRV01\\${name.replace(/\s/g, "-")}`],
      driverName: ["HP Universal Printing PCL 6"],
      description: ["Main office printer"],
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

describe("PrinterLookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(false);
  });

  it("renders with search bar in initial state", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_printers")
        return Promise.resolve(makeBrowseResult([]));
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });
    expect(screen.getByTestId("printer-lookup")).toBeInTheDocument();
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText("No printers available."),
      ).toBeInTheDocument();
    });
  });

  it("shows loading state during search", async () => {
    mockInvoke.mockImplementation(
      () => new Promise(() => {}),
    );

    render(<PrinterLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("printer-lookup-loading")).toBeInTheDocument();
    });
  });

  it("displays search results", async () => {
    const entries = [
      makePrinterEntry("HP LaserJet"),
      makePrinterEntry("Canon iR-ADV", {
        distinguishedName: "CN=Canon-iR,OU=Printers,DC=example,DC=com",
        attributes: {
          printerName: ["Canon iR-ADV"],
          location: ["Floor 3"],
          serverName: ["PRINT-SRV01"],
          uNCName: ["\\\\PRINT-SRV01\\Canon-iR"],
          driverName: ["Canon Generic Plus"],
          description: [""],
        },
      }),
    ];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_printers")
        return Promise.resolve(makeBrowseResult(entries));
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("printer-results-list")).toBeInTheDocument();
    });

    expect(screen.getByText("HP LaserJet")).toBeInTheDocument();
    expect(screen.getByText("Canon iR-ADV")).toBeInTheDocument();
  });

  it("shows empty state when no printers found", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_printers")
        return Promise.resolve(makeBrowseResult([]));
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("empty-state-title")).toHaveTextContent(
        "No printers found",
      );
    });
  });

  it("shows error state on search failure", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_printers")
        return Promise.reject(new Error("LDAP error"));
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("printer-lookup-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Failed to load printers")).toBeInTheDocument();
  });

  it("shows printer detail when a printer is selected", async () => {
    const entries = [makePrinterEntry("HP LaserJet")];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_printers")
        return Promise.resolve(makeBrowseResult(entries));
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

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
    const entries = [makePrinterEntry("HP LaserJet")];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_printers")
        return Promise.resolve(makeBrowseResult(entries));
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

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
    const entries = [makePrinterEntry("HP LaserJet")];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_printers")
        return Promise.resolve(makeBrowseResult(entries));
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

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
    const entries = [makePrinterEntry("HP LaserJet")];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_printers")
        return Promise.resolve(makeBrowseResult(entries));
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("printer-results-list")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Select a printer to view details"),
    ).toBeInTheDocument();
  });

  it("shows retry button on error", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_printers")
        return Promise.reject(new Error("LDAP error"));
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  it("shows accessibility status for search results", async () => {
    const entries = [
      makePrinterEntry("HP LaserJet"),
      makePrinterEntry("Canon iR-ADV", {
        distinguishedName: "CN=Canon,OU=Printers,DC=example,DC=com",
      }),
    ];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "browse_printers")
        return Promise.resolve(makeBrowseResult(entries));
      return Promise.resolve(null);
    });

    render(<PrinterLookup />, { wrapper: Wrapper });

    await waitFor(() => {
      const status = screen.getByTestId("printer-lookup-status");
      expect(status).toHaveTextContent("2 printers found");
    });
  });
});
