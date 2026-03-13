import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  NotificationProvider,
  useNotifications,
  resetNotificationIdCounter,
} from "./NotificationContext";

function TestConsumer() {
  const { notify, dismiss, notifications } = useNotifications();
  return (
    <div>
      <button
        data-testid="add-info"
        onClick={() => notify("Info message", "info")}
      >
        Add Info
      </button>
      <button
        data-testid="add-error"
        onClick={() => notify("Error message", "error")}
      >
        Add Error
      </button>
      <button
        data-testid="dismiss-first"
        onClick={() => {
          if (notifications.length > 0) dismiss(notifications[0].id);
        }}
      >
        Dismiss First
      </button>
      <span data-testid="count">{notifications.length}</span>
      {notifications.map((n) => (
        <span key={n.id} data-testid={`notif-${n.id}`}>
          {n.message}
        </span>
      ))}
    </div>
  );
}

describe("NotificationContext", () => {
  beforeEach(() => {
    resetNotificationIdCounter();
  });

  it("throws when useNotifications is used outside provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      render(<TestConsumer />);
    }).toThrow("useNotifications must be used within NotificationProvider");
    spy.mockRestore();
  });

  it("starts with empty notifications", () => {
    render(
      <NotificationProvider>
        <TestConsumer />
      </NotificationProvider>,
    );
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("adds notification via notify", () => {
    render(
      <NotificationProvider>
        <TestConsumer />
      </NotificationProvider>,
    );
    fireEvent.click(screen.getByTestId("add-info"));
    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(screen.getByTestId("notif-notification-1")).toHaveTextContent(
      "Info message",
    );
  });

  it("adds multiple notifications", () => {
    render(
      <NotificationProvider>
        <TestConsumer />
      </NotificationProvider>,
    );
    fireEvent.click(screen.getByTestId("add-info"));
    fireEvent.click(screen.getByTestId("add-error"));
    expect(screen.getByTestId("count")).toHaveTextContent("2");
  });

  it("dismisses notification by id", () => {
    render(
      <NotificationProvider>
        <TestConsumer />
      </NotificationProvider>,
    );
    fireEvent.click(screen.getByTestId("add-info"));
    expect(screen.getByTestId("count")).toHaveTextContent("1");

    fireEvent.click(screen.getByTestId("dismiss-first"));
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("auto-dismisses after autoDismissMs", () => {
    vi.useFakeTimers();
    render(
      <NotificationProvider autoDismissMs={500}>
        <TestConsumer />
      </NotificationProvider>,
    );
    fireEvent.click(screen.getByTestId("add-info"));
    expect(screen.getByTestId("count")).toHaveTextContent("1");

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByTestId("count")).toHaveTextContent("0");
    vi.useRealTimers();
  });

  it("generates unique ids for each notification", () => {
    render(
      <NotificationProvider>
        <TestConsumer />
      </NotificationProvider>,
    );
    fireEvent.click(screen.getByTestId("add-info"));
    fireEvent.click(screen.getByTestId("add-error"));

    expect(screen.getByTestId("notif-notification-1")).toBeInTheDocument();
    expect(screen.getByTestId("notif-notification-2")).toBeInTheDocument();
  });
});
