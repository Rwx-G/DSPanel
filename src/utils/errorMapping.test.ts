import { describe, it, expect } from "vitest";
import {
  parseBackendError,
  mapErrorToNotification,
  type BackendErrorResponse,
} from "./errorMapping";

describe("parseBackendError", () => {
  it("parses valid JSON error string", () => {
    const json: BackendErrorResponse = {
      kind: "directory",
      message: "Directory error: timeout",
      user_message: "The operation timed out.",
      retryable: true,
    };
    const result = parseBackendError(JSON.stringify(json));
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("directory");
    expect(result!.retryable).toBe(true);
  });

  it("returns null for non-JSON string", () => {
    expect(parseBackendError("just a plain error")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(parseBackendError(42)).toBeNull();
    expect(parseBackendError(null)).toBeNull();
    expect(parseBackendError(undefined)).toBeNull();
  });

  it("returns null for JSON without required fields", () => {
    expect(parseBackendError(JSON.stringify({ foo: "bar" }))).toBeNull();
  });

  it("returns null for Error objects", () => {
    expect(parseBackendError(new Error("test"))).toBeNull();
  });
});

describe("mapErrorToNotification", () => {
  it("maps backend directory error correctly", () => {
    const json: BackendErrorResponse = {
      kind: "directory",
      message: "Directory error: LDAP timeout",
      user_message: "The operation timed out. Please try again.",
      retryable: true,
    };
    const mapped = mapErrorToNotification(
      JSON.stringify(json),
      "searching users",
    );
    expect(mapped.severity).toBe("error");
    expect(mapped.userMessage).toBe(
      "The operation timed out. Please try again.",
    );
    expect(mapped.retryable).toBe(true);
    expect(mapped.kind).toBe("directory");
  });

  it("maps backend permission denied with warning severity", () => {
    const json: BackendErrorResponse = {
      kind: "permission_denied",
      message: "Permission denied: admin required",
      user_message: "You do not have permission.",
      retryable: false,
    };
    const mapped = mapErrorToNotification(
      JSON.stringify(json),
      "modifying user",
    );
    expect(mapped.severity).toBe("warning");
    expect(mapped.retryable).toBe(false);
  });

  it("maps backend network error with warning severity", () => {
    const json: BackendErrorResponse = {
      kind: "network",
      message: "Network error: timeout",
      user_message: "Network error occurred.",
      retryable: true,
    };
    const mapped = mapErrorToNotification(JSON.stringify(json), "pinging host");
    expect(mapped.severity).toBe("warning");
  });

  it("maps backend circuit breaker with warning severity", () => {
    const json: BackendErrorResponse = {
      kind: "circuit_breaker",
      message: "Circuit breaker open",
      user_message: "Service temporarily unavailable.",
      retryable: true,
    };
    const mapped = mapErrorToNotification(JSON.stringify(json), "searching");
    expect(mapped.severity).toBe("warning");
    expect(mapped.retryable).toBe(true);
  });

  it("maps JavaScript Error with generic message", () => {
    const mapped = mapErrorToNotification(
      new Error("something broke"),
      "searching users",
    );
    expect(mapped.severity).toBe("error");
    expect(mapped.userMessage).toBe(
      "searching users failed. Please try again.",
    );
    expect(mapped.retryable).toBe(false);
    expect(mapped.kind).toBe("unknown");
  });

  it("maps unknown error type with generic message", () => {
    const mapped = mapErrorToNotification(42, "loading data");
    expect(mapped.severity).toBe("error");
    expect(mapped.userMessage).toContain("loading data");
    expect(mapped.kind).toBe("unknown");
  });

  it("never exposes raw error messages to users", () => {
    const json: BackendErrorResponse = {
      kind: "internal",
      message: "Internal error: panicked at src/main.rs:42",
      user_message: "An unexpected error occurred.",
      retryable: false,
    };
    const mapped = mapErrorToNotification(JSON.stringify(json), "operation");
    expect(mapped.userMessage).not.toContain("panicked");
    expect(mapped.userMessage).not.toContain("src/main.rs");
  });
});
