import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ReplicationStatus } from "./ReplicationStatus";
import { type ReplicationPartnership } from "@/types/replication-status";
import { DialogProvider } from "@/contexts/DialogContext";
import { NotificationProvider } from "@/contexts/NotificationContext";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => {
    if (args[0] === "get_platform") return Promise.resolve("windows");
    return mockInvoke(...args);
  },
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
  lastSyncTime: "2026-03-21T12:00:00Z",
  lastSyncResult: 0,
  consecutiveFailures: 0,
  lastSyncMessage: null,
  status: "Healthy",
};

const failedPartnership: ReplicationPartnership = {
  sourceDc: "DC2.example.com",
  targetDc: "DC3.example.com",
  namingContext: "DC=example,DC=com",
  lastSyncTime: "2026-03-21T10:00:00Z",
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
    }, { timeout: 5000 });
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
    }, { timeout: 5000 });
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
    }, { timeout: 5000 });
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
    }, { timeout: 5000 });
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
    }, { timeout: 5000 });
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
    }, { timeout: 5000 });
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
    }, { timeout: 5000 });

    fireEvent.click(screen.getByTestId("refresh-button"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    }, { timeout: 5000 });
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
    }, { timeout: 5000 });

    // Default is 120s
    vi.advanceTimersByTime(120_000);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    }, { timeout: 5000 });
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
    }, { timeout: 5000 });
  });
});
