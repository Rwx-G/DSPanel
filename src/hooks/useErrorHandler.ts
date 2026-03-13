import { useCallback } from "react";
import { useNotifications } from "@/contexts/NotificationContext";
import { mapErrorToNotification } from "@/utils/errorMapping";

/**
 * Hook that provides a standardized error handler for Tauri invoke failures.
 *
 * Usage:
 * ```ts
 * const { handleError } = useErrorHandler();
 *
 * try {
 *   await invoke("some_command", { ... });
 * } catch (err) {
 *   handleError(err, "searching users");
 * }
 * ```
 *
 * The hook maps backend errors to user-friendly notifications using the
 * notification context. Retryable errors include a "Retry" action button.
 */
export function useErrorHandler() {
  const { notify } = useNotifications();

  const handleError = useCallback(
    (error: unknown, operationContext: string, onRetry?: () => void) => {
      const mapped = mapErrorToNotification(error, operationContext);

      const action =
        mapped.retryable && onRetry
          ? { label: "Retry", onClick: onRetry }
          : undefined;

      notify(mapped.userMessage, mapped.severity, action);
    },
    [notify],
  );

  return { handleError };
}
