import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import {
  NotificationProvider,
  useNotifications,
} from "@/contexts/NotificationContext";
import { useErrorHandler } from "./useErrorHandler";
import type { BackendErrorResponse } from "@/utils/errorMapping";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(NotificationProvider, null, children);
}

describe("useErrorHandler", () => {
  it("notifies with user-friendly message for backend errors", () => {
    const { result } = renderHook(
      () => {
        const errorHandler = useErrorHandler();
        const notifications = useNotifications();
        return { ...errorHandler, ...notifications };
      },
      { wrapper },
    );

    const json: BackendErrorResponse = {
      kind: "directory",
      message: "Directory error: timeout",
      user_message: "The operation timed out.",
      retryable: true,
    };

    act(() => {
      result.current.handleError(JSON.stringify(json), "searching users");
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].message).toBe(
      "The operation timed out.",
    );
    expect(result.current.notifications[0].severity).toBe("error");
  });

  it("notifies with generic message for unknown errors", () => {
    const { result } = renderHook(
      () => {
        const errorHandler = useErrorHandler();
        const notifications = useNotifications();
        return { ...errorHandler, ...notifications };
      },
      { wrapper },
    );

    act(() => {
      result.current.handleError(new Error("something"), "loading data");
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].message).toContain("loading data");
  });

  it("includes retry action when retryable and onRetry provided", () => {
    const onRetry = vi.fn();
    const { result } = renderHook(
      () => {
        const errorHandler = useErrorHandler();
        const notifications = useNotifications();
        return { ...errorHandler, ...notifications };
      },
      { wrapper },
    );

    const json: BackendErrorResponse = {
      kind: "network",
      message: "Network error",
      user_message: "Network issue.",
      retryable: true,
    };

    act(() => {
      result.current.handleError(JSON.stringify(json), "pinging", onRetry);
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].action).toBeDefined();
    expect(result.current.notifications[0].action!.label).toBe("Retry");

    act(() => {
      result.current.notifications[0].action!.onClick();
    });

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("does not include retry action when not retryable", () => {
    const onRetry = vi.fn();
    const { result } = renderHook(
      () => {
        const errorHandler = useErrorHandler();
        const notifications = useNotifications();
        return { ...errorHandler, ...notifications };
      },
      { wrapper },
    );

    const json: BackendErrorResponse = {
      kind: "permission_denied",
      message: "Denied",
      user_message: "No permission.",
      retryable: false,
    };

    act(() => {
      result.current.handleError(JSON.stringify(json), "modifying", onRetry);
    });

    expect(result.current.notifications[0].action).toBeUndefined();
  });

  it("does not include retry action when no onRetry callback", () => {
    const { result } = renderHook(
      () => {
        const errorHandler = useErrorHandler();
        const notifications = useNotifications();
        return { ...errorHandler, ...notifications };
      },
      { wrapper },
    );

    const json: BackendErrorResponse = {
      kind: "network",
      message: "Error",
      user_message: "Network issue.",
      retryable: true,
    };

    act(() => {
      result.current.handleError(JSON.stringify(json), "pinging");
    });

    expect(result.current.notifications[0].action).toBeUndefined();
  });
});
