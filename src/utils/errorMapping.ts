import type { NotificationSeverity } from "@/contexts/NotificationContext";

/** Structured error response from the Rust backend. */
export interface BackendErrorResponse {
  kind: string;
  message: string;
  user_message: string;
  retryable: boolean;
}

/** Parsed error with user-friendly details for display. */
export interface MappedError {
  severity: NotificationSeverity;
  userMessage: string;
  retryable: boolean;
  kind: string;
}

/**
 * Parses a backend error (from Tauri invoke rejection) into a structured object.
 *
 * Tauri serializes errors as JSON strings. This function attempts to parse
 * that JSON. If parsing fails, it falls back to a generic error.
 */
export function parseBackendError(error: unknown): BackendErrorResponse | null {
  if (typeof error === "string") {
    try {
      const parsed = JSON.parse(error) as BackendErrorResponse;
      if (parsed.kind && parsed.message) {
        return parsed;
      }
    } catch {
      // Not JSON - fall through
    }
  }
  return null;
}

/**
 * Maps any error (backend or generic) to a user-friendly notification payload.
 *
 * This is the single point of error-to-notification mapping in the frontend.
 * Use this in all catch blocks instead of showing raw error messages.
 */
export function mapErrorToNotification(
  error: unknown,
  operationContext: string,
): MappedError {
  const backendError = parseBackendError(error);

  if (backendError) {
    return {
      severity: getSeverityForKind(backendError.kind),
      userMessage: backendError.user_message,
      retryable: backendError.retryable,
      kind: backendError.kind,
    };
  }

  // Generic JavaScript error
  if (error instanceof Error) {
    return {
      severity: "error",
      userMessage: `${operationContext} failed. Please try again.`,
      retryable: false,
      kind: "unknown",
    };
  }

  // Completely unknown error
  return {
    severity: "error",
    userMessage: `An unexpected error occurred during: ${operationContext}.`,
    retryable: false,
    kind: "unknown",
  };
}

/**
 * Extracts a human-readable error message from any error type.
 *
 * Handles Tauri JSON errors, plain Error objects, and raw strings.
 * Use this for inline error messages (e.g. progress steps).
 */
export function extractErrorMessage(error: unknown): string {
  const backendError = parseBackendError(error);
  if (backendError) {
    return backendError.user_message || backendError.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return (error as { message: string }).message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unexpected error occurred";
}

/** Maps backend error kind to notification severity. */
function getSeverityForKind(kind: string): NotificationSeverity {
  switch (kind) {
    case "permission_denied":
      return "warning";
    case "circuit_breaker":
      return "warning";
    case "network":
      return "warning";
    case "directory":
      return "error";
    case "configuration":
      return "error";
    case "internal":
      return "error";
    default:
      return "error";
  }
}
