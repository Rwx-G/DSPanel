import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { RecycleBin } from "./RecycleBin";
import { NotificationProvider } from "@/contexts/NotificationContext";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@/hooks/useOUTree", () => ({
  useOUTree: () => ({
    nodes: [
      {
        distinguishedName: "OU=Users,DC=example,DC=com",
        name: "Users",
        children: [],
        hasChildren: false,
      },
    ],
    loading: false,
    error: false,
    reload: vi.fn(),
  }),
}));

vi.mock("@/hooks/useErrorHandler", () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
  }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <NotificationProvider>{children}</NotificationProvider>;
}

const mockDeletedObjects = [
  {
    distinguishedName: "CN=John\\0ADEL:abc,CN=Deleted Objects,DC=example,DC=com",
    name: "John Doe",
    objectType: "user",
    deletionDate: "2026-03-15",
    originalOu: "OU=Users,DC=example,DC=com",
  },
  {
    distinguishedName: "CN=PC01\\0ADEL:def,CN=Deleted Objects,DC=example,DC=com",
    name: "PC01",
    objectType: "computer",
    deletionDate: "2026-03-14",
    originalOu: "OU=Computers,DC=example,DC=com",
  },
];

function setupMock(opts: {
  enabled?: boolean;
  objects?: typeof mockDeletedObjects;
  restoreResult?: unknown;
}) {
  const { enabled = true, objects = mockDeletedObjects, restoreResult = null } = opts;
  mockInvoke.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "is_recycle_bin_enabled":
        return Promise.resolve(enabled);
      case "get_deleted_objects":
        return Promise.resolve(objects);
      case "restore_deleted_object":
        return Promise.resolve(restoreResult);
      default:
        return Promise.resolve(null);
    }
  });
}

describe("RecycleBin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<RecycleBin />, { wrapper: Wrapper });
    expect(screen.getByTestId("recycle-bin-loading")).toBeInTheDocument();
  });

  it("shows warning when recycle bin is not enabled", async () => {
    setupMock({ enabled: false });
    render(<RecycleBin />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByTestId("recycle-bin-disabled")).toBeInTheDocument();
    });
  });

  it("shows deleted objects in table", async () => {
    setupMock({});
    render(<RecycleBin />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByTestId("recycle-bin-table")).toBeInTheDocument();
    });
    expect(screen.getAllByTestId("recycle-bin-row")).toHaveLength(2);
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("PC01")).toBeInTheDocument();
  });

  it("filters by type", async () => {
    setupMock({});
    render(<RecycleBin />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByTestId("recycle-bin-table")).toBeInTheDocument();
    });
    const usersBtn = screen.getAllByRole("button").find(
      (btn) => btn.textContent?.startsWith("Users"),
    );
    expect(usersBtn).toBeDefined();
    fireEvent.click(usersBtn!);
    await waitFor(() => {
      expect(screen.getAllByTestId("recycle-bin-row")).toHaveLength(1);
    });
    expect(screen.getByText("John Doe")).toBeInTheDocument();
  });

  it("filters by name search", async () => {
    setupMock({});
    render(<RecycleBin />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByTestId("recycle-bin-table")).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText(
      "Search deleted objects by name...",
    );
    fireEvent.change(input, { target: { value: "PC" } });
    await waitFor(() => {
      expect(screen.getAllByTestId("recycle-bin-row")).toHaveLength(1);
    });
    expect(screen.getByText("PC01")).toBeInTheDocument();
  });

  it("opens restore dialog on Restore click", async () => {
    setupMock({});
    render(<RecycleBin />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByTestId("recycle-bin-table")).toBeInTheDocument();
    });
    const restoreButtons = screen.getAllByTestId("restore-btn");
    fireEvent.click(restoreButtons[0]);
    await waitFor(() => {
      expect(screen.getByTestId("restore-dialog")).toBeInTheDocument();
    });
  });

  it("calls restore_deleted_object on confirm", async () => {
    setupMock({});
    render(<RecycleBin />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByTestId("recycle-bin-table")).toBeInTheDocument();
    });

    const restoreButtons = screen.getAllByTestId("restore-btn");
    fireEvent.click(restoreButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId("restore-confirm")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("restore-confirm"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("restore_deleted_object", {
        deletedDn:
          "CN=John\\0ADEL:abc,CN=Deleted Objects,DC=example,DC=com",
        targetOuDn: "OU=Users,DC=example,DC=com",
      });
    });
  });

  it("shows empty state when no deleted objects", async () => {
    setupMock({ objects: [] });
    render(<RecycleBin />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByText("No deleted objects")).toBeInTheDocument();
    });
  });
});
