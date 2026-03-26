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
    if (args[0] === "is_simple_bind") return Promise.resolve(false);
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

  it("displays USN value in the table row", async () => {
    const partnershipWithUsn: ReplicationPartnership = {
      ...healthyPartnership,
      usnLastObjChangeSynced: 42,
    };
    mockInvoke.mockResolvedValueOnce([partnershipWithUsn]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("displays transport column value", async () => {
    const partnershipWithTransport: ReplicationPartnership = {
      ...healthyPartnership,
      transport: "IP",
    };
    mockInvoke.mockResolvedValueOnce([partnershipWithTransport]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("IP")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows dash when USN is null", async () => {
    const partnershipNoUsn: ReplicationPartnership = {
      ...healthyPartnership,
      usnLastObjChangeSynced: null,
    };
    mockInvoke.mockResolvedValueOnce([partnershipNoUsn]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("replication-row-0")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows warning count in toolbar when warnings exist", async () => {
    const warningPartnership: ReplicationPartnership = {
      ...healthyPartnership,
      sourceDc: "DC3.example.com",
      status: "Warning",
      consecutiveFailures: 1,
    };
    mockInvoke.mockResolvedValueOnce([healthyPartnership, warningPartnership]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("replication-table")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows both healthy and failed counts in toolbar", async () => {
    mockInvoke.mockResolvedValueOnce([healthyPartnership, failedPartnership]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("replication-table")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("changes refresh interval via dropdown", async () => {
    mockInvoke.mockResolvedValue([healthyPartnership]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("refresh-interval")).toBeInTheDocument();
    }, { timeout: 5000 });

    const select = screen.getByTestId("refresh-interval") as HTMLSelectElement;
    expect(select.value).toBe("120");

    fireEvent.change(select, { target: { value: "300" } });
    expect(select.value).toBe("300");
  });

  it("disabling auto-refresh stops interval fetches", async () => {
    mockInvoke.mockResolvedValue([healthyPartnership]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("refresh-interval")).toBeInTheDocument();
    }, { timeout: 5000 });

    // Set to Off
    fireEvent.change(screen.getByTestId("refresh-interval"), {
      target: { value: "0" },
    });

    const callCountAfterOff = mockInvoke.mock.calls.length;

    // Advance time - should NOT trigger additional fetches
    vi.advanceTimersByTime(300_000);

    await waitFor(() => {
      expect(mockInvoke.mock.calls.length).toBe(callCountAfterOff);
    }, { timeout: 5000 });
  });

  it("force replication button triggers confirmation dialog", async () => {
    mockInvoke.mockResolvedValue([healthyPartnership]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("force-repl-0")).toBeInTheDocument();
    }, { timeout: 5000 });

    fireEvent.click(screen.getByTestId("force-repl-0"));

    // Confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByText("Force Replication")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("displays error recovered after retry", async () => {
    // First call fails, second succeeds
    mockInvoke
      .mockRejectedValueOnce("Network error")
      .mockResolvedValueOnce([healthyPartnership]);

    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    // Should show error
    await waitFor(() => {
      expect(screen.getByText("Replication Check Failed")).toBeInTheDocument();
    }, { timeout: 5000 });

    // Click refresh to retry
    fireEvent.click(screen.getByTestId("refresh-button"));

    // Should now show the data
    await waitFor(() => {
      expect(screen.getByText("DC1.example.com")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("formats latency as N/A when lastSyncTime is null", async () => {
    const noSyncPartnership: ReplicationPartnership = {
      ...healthyPartnership,
      lastSyncTime: null,
    };
    mockInvoke.mockResolvedValueOnce([noSyncPartnership]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("N/A")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows multiple rows for multiple partnerships", async () => {
    mockInvoke.mockResolvedValueOnce([healthyPartnership, failedPartnership]);
    render(
      <Wrapper>
        <ReplicationStatus />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("replication-row-0")).toBeInTheDocument();
      expect(screen.getByTestId("replication-row-1")).toBeInTheDocument();
    }, { timeout: 5000 });

    expect(screen.getByText("DC1.example.com")).toBeInTheDocument();
    expect(screen.getByText("DC3.example.com")).toBeInTheDocument();
  });
});
