import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ReplicationStatus } from "./ReplicationStatus";
import { type ReplicationPartnership } from "@/types/replication-status";
import { DialogProvider } from "@/contexts/DialogContext";
import { NotificationProvider } from "@/contexts/NotificationContext";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NotificationProvider>
      <DialogProvider>{children}</DialogProvider>
    </NotificationProvider>
  );
}

const healthyPartnership: ReplicationPartnership = {
  sourceDc: "DC1.example.com",
  targetDc: "DC2.example.com",
  namingContext: "DC=example,DC=com",
  lastSyncTime: new Date(Date.now() - 5 * 60_000).toISOString(), // 5 min ago
  lastSyncResult: 0,
  consecutiveFailures: 0,
  lastSyncMessage: null,
  status: "Healthy",
};

const failedPartnership: ReplicationPartnership = {
  sourceDc: "DC2.example.com",
  targetDc: "DC3.example.com",
  namingContext: "DC=example,DC=com",
  lastSyncTime: new Date(Date.now() - 120 * 60_000).toISOString(), // 2 hours ago
  lastSyncResult: 8453,
  consecutiveFailures: 5,
  lastSyncMessage: "Replication access was denied",
  status: "Failed",
};

describe("ReplicationStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows loading spinner initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );
    expect(
      screen.getByText("Loading replication partnerships..."),
    ).toBeInTheDocument();
  });

  it("displays partnership table after loading", async () => {
    mockInvoke.mockResolvedValueOnce([healthyPartnership]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("DC1.example.com")).toBeInTheDocument();
      expect(screen.getByText("DC2.example.com")).toBeInTheDocument();
    });
  });

  it("shows error state when fetch fails", async () => {
    mockInvoke.mockRejectedValueOnce("Permission denied");
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Replication Check Failed"),
      ).toBeInTheDocument();
    });
  });

  it("shows empty state when no partnerships found", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(
        screen.getByText("No Replication Partnerships Found"),
      ).toBeInTheDocument();
    });
  });

  it("highlights failed partnerships", async () => {
    mockInvoke.mockResolvedValueOnce([failedPartnership]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("5 failures")).toBeInTheDocument();
    });
  });

  it("shows naming context in table", async () => {
    mockInvoke.mockResolvedValueOnce([healthyPartnership]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("DC=example,DC=com")).toBeInTheDocument();
    });
  });

  it("shows sync button for each partnership", async () => {
    mockInvoke.mockResolvedValueOnce([healthyPartnership]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("force-repl-0")).toBeInTheDocument();
      expect(screen.getByText("Sync")).toBeInTheDocument();
    });
  });

  it("manual refresh button triggers reload", async () => {
    mockInvoke.mockResolvedValue([healthyPartnership]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("DC1.example.com")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("refresh-button"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });

  it("auto-refresh triggers at interval", async () => {
    mockInvoke.mockResolvedValue([healthyPartnership]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("DC1.example.com")).toBeInTheDocument();
    });

    // Default is 120s
    vi.advanceTimersByTime(120_000);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });

  it("calls invoke with correct command name", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_replication_status");
    });
  });
});
