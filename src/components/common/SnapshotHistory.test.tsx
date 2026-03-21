import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { SnapshotHistory } from "./SnapshotHistory";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { DialogProvider } from "@/contexts/DialogContext";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <NotificationProvider>
      <DialogProvider>{children}</DialogProvider>
    </NotificationProvider>
  );
}

const TEST_DN = "CN=John Doe,OU=Users,DC=example,DC=com";

const sampleSnapshots = [
  {
    id: 1,
    objectDn: TEST_DN,
    operationType: "ModifyAttribute",
    timestamp: "2026-03-21T10:00:00Z",
    operator: "admin",
    attributesJson: '{"mail":["john@example.com"]}',
  },
  {
    id: 2,
    objectDn: TEST_DN,
    operationType: "PasswordReset",
    timestamp: "2026-03-20T14:30:00Z",
    operator: "helpdesk",
    attributesJson: '{"mail":["john@example.com"]}',
  },
];

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("SnapshotHistory", () => {
  it("shows empty state when no snapshots", async () => {
    mockInvoke.mockResolvedValueOnce([]);

    render(
      <TestProviders>
        <SnapshotHistory objectDn={TEST_DN} canRestore={false} />
      </TestProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
    expect(screen.getByText("No snapshots")).toBeInTheDocument();
  });

  it("renders snapshot list", async () => {
    mockInvoke.mockResolvedValueOnce(sampleSnapshots);

    render(
      <TestProviders>
        <SnapshotHistory objectDn={TEST_DN} canRestore={false} />
      </TestProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("snapshot-history")).toBeInTheDocument();
    });

    expect(screen.getByText("ModifyAttribute")).toBeInTheDocument();
    expect(screen.getByText("PasswordReset")).toBeInTheDocument();
  });

  it("restore button visible only for canRestore=true", async () => {
    mockInvoke.mockResolvedValueOnce(sampleSnapshots);

    const { rerender } = render(
      <TestProviders>
        <SnapshotHistory objectDn={TEST_DN} canRestore={false} />
      </TestProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("snapshot-history")).toBeInTheDocument();
    });

    // No restore buttons
    expect(screen.queryByTestId("snapshot-restore-1")).not.toBeInTheDocument();

    // Re-render with canRestore=true
    mockInvoke.mockResolvedValueOnce(sampleSnapshots);
    rerender(
      <TestProviders>
        <SnapshotHistory objectDn={TEST_DN} canRestore={true} />
      </TestProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("snapshot-restore-1")).toBeInTheDocument();
    });
  });

  it("calls get_snapshot_history with correct objectDn", async () => {
    mockInvoke.mockResolvedValueOnce([]);

    render(
      <TestProviders>
        <SnapshotHistory objectDn={TEST_DN} canRestore={false} />
      </TestProviders>,
    );

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_snapshot_history", {
        objectDn: TEST_DN,
      });
    });
  });

  it("toggles detail view on click", async () => {
    mockInvoke.mockResolvedValueOnce(sampleSnapshots);

    render(
      <TestProviders>
        <SnapshotHistory objectDn={TEST_DN} canRestore={false} />
      </TestProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("snapshot-toggle-1")).toBeInTheDocument();
    });

    // Mock the diff response
    mockInvoke.mockResolvedValueOnce([
      {
        attribute: "mail",
        snapshotValue: "john@example.com",
        currentValue: "john.doe@example.com",
        changed: true,
      },
    ]);

    fireEvent.click(screen.getByTestId("snapshot-toggle-1"));

    await waitFor(() => {
      expect(screen.getByTestId("snapshot-details-1")).toBeInTheDocument();
    });

    expect(mockInvoke).toHaveBeenCalledWith("compute_snapshot_diff", {
      snapshotId: 1,
    });
  });

  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {})); // never resolves

    render(
      <TestProviders>
        <SnapshotHistory objectDn={TEST_DN} canRestore={false} />
      </TestProviders>,
    );

    expect(
      screen.getByText("Loading snapshot history..."),
    ).toBeInTheDocument();
  });

  it("handles fetch error gracefully", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Network error"));

    render(
      <TestProviders>
        <SnapshotHistory objectDn={TEST_DN} canRestore={false} />
      </TestProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
  });
});
