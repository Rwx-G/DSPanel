import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

// Suppress React error boundary console output in tests
const originalError = console.error;
beforeEach(() => {
  console.error = vi.fn();
  return () => {
    console.error = originalError;
  };
});

function ThrowingComponent({ error }: { error?: Error }) {
  if (error) {
    throw error;
  }
  return <div data-testid="child-content">Hello</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });

  it("renders fallback UI when child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent error={new Error("test crash")} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-boundary-fallback")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">Custom</div>}>
        <ThrowingComponent error={new Error("test")} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("custom-fallback")).toBeInTheDocument();
  });

  it("displays retry button in default fallback", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent error={new Error("test")} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-boundary-retry")).toBeInTheDocument();
    expect(screen.getByText("Try Again")).toBeInTheDocument();
  });

  it("resets error state when retry is clicked", () => {
    // Use a component that only throws once
    let shouldThrow = true;
    function ConditionalThrower() {
      if (shouldThrow) {
        throw new Error("test");
      }
      return <div data-testid="recovered-content">Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <ConditionalThrower />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("error-boundary-fallback")).toBeInTheDocument();

    // Fix the error condition before clicking retry
    shouldThrow = false;
    fireEvent.click(screen.getByTestId("error-boundary-retry"));

    expect(screen.getByTestId("recovered-content")).toBeInTheDocument();
  });

  it("does not show raw error messages to user", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent error={new Error("INTERNAL_SECRET_DETAIL")} />
      </ErrorBoundary>,
    );
    expect(
      screen.queryByText("INTERNAL_SECRET_DETAIL"),
    ).not.toBeInTheDocument();
  });

  it("logs error to console.error", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent error={new Error("logged error")} />
      </ErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalled();
  });
});
