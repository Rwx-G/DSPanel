import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NotificationHost } from "./NotificationHost";
import {
  NotificationProvider,
  useNotifications,
  resetNotificationIdCounter,
} from "@/contexts/NotificationContext";

function TestNotifier({
  autoNotify,
}: {
  autoNotify?: {
    message: string;
    severity: "info" | "success" | "warning" | "error";
  };
}) {
  const { notify } = useNotifications();
  return (
    <>
      {autoNotify && (
        <button
          data-testid="trigger"
          onClick={() => notify(autoNotify.message, autoNotify.severity)}
        >
          Notify
        </button>
      )}
    </>
  );
}

function renderWithNotifications(
  autoNotify?: {
    message: string;
    severity: "info" | "success" | "warning" | "error";
  },
  autoDismissMs = 50000,
) {
  return render(
    <NotificationProvider autoDismissMs={autoDismissMs}>
      <TestNotifier autoNotify={autoNotify} />
      <NotificationHost />
    </NotificationProvider>,
  );
}

describe("NotificationHost", () => {
  beforeEach(() => {
    resetNotificationIdCounter();
  });

  it("renders nothing when no notifications", () => {
    renderWithNotifications();
    expect(screen.queryByTestId("notification-host")).not.toBeInTheDocument();
  });

  it("renders notification after trigger", () => {
    renderWithNotifications({ message: "Success!", severity: "success" });
    fireEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByTestId("notification-host")).toBeInTheDocument();
    expect(screen.getByText("Success!")).toBeInTheDocument();
  });

  it("renders multiple notifications", () => {
    render(
      <NotificationProvider autoDismissMs={50000}>
        <TestMultiNotifier />
        <NotificationHost />
      </NotificationProvider>,
    );
    fireEvent.click(screen.getByTestId("trigger-multi"));
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("dismisses notification when X clicked", () => {
    renderWithNotifications({ message: "Dismiss me", severity: "info" });
    fireEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByText("Dismiss me")).toBeInTheDocument();

    const dismissBtn = screen.getByTestId(
      "notification-dismiss-notification-1",
    );
    fireEvent.click(dismissBtn);
    expect(screen.queryByText("Dismiss me")).not.toBeInTheDocument();
  });

  it("auto-dismisses after timeout", () => {
    vi.useFakeTimers();
    renderWithNotifications(
      { message: "Auto dismiss", severity: "warning" },
      1000,
    );
    fireEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByText("Auto dismiss")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.queryByText("Auto dismiss")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("renders notification with action button", () => {
    render(
      <NotificationProvider autoDismissMs={50000}>
        <TestActionNotifier />
        <NotificationHost />
      </NotificationProvider>,
    );
    fireEvent.click(screen.getByTestId("trigger-action"));
    expect(
      screen.getByTestId("notification-action-notification-1"),
    ).toHaveTextContent("Retry");
  });

  it("calls action onClick when action button clicked", () => {
    const actionFn = vi.fn();
    render(
      <NotificationProvider autoDismissMs={50000}>
        <TestActionNotifier actionFn={actionFn} />
        <NotificationHost />
      </NotificationProvider>,
    );
    fireEvent.click(screen.getByTestId("trigger-action"));
    fireEvent.click(screen.getByTestId("notification-action-notification-1"));
    expect(actionFn).toHaveBeenCalledOnce();
  });

  it("has alert role on notification items", () => {
    renderWithNotifications({ message: "Alert!", severity: "error" });
    fireEvent.click(screen.getByTestId("trigger"));
    const notification = screen.getByTestId("notification-notification-1");
    expect(notification).toHaveAttribute("role", "alert");
  });
});

function TestMultiNotifier() {
  const { notify } = useNotifications();
  return (
    <button
      data-testid="trigger-multi"
      onClick={() => {
        notify("First", "info");
        notify("Second", "success");
      }}
    >
      Multi
    </button>
  );
}

function TestActionNotifier({ actionFn = vi.fn() }: { actionFn?: () => void }) {
  const { notify } = useNotifications();
  return (
    <button
      data-testid="trigger-action"
      onClick={() =>
        notify("With action", "info", { label: "Retry", onClick: actionFn })
      }
    >
      Action
    </button>
  );
}
