import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertCircle } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global error boundary that catches unhandled React rendering errors.
 *
 * Prevents the entire app from crashing on unexpected errors. Displays
 * a generic error UI with a retry button instead of a white screen.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Unhandled error:", error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          className="flex h-full flex-col items-center justify-center gap-4 p-8"
          data-testid="error-boundary-fallback"
        >
          <AlertCircle size={48} className="text-[var(--color-error)]" />
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Something went wrong
          </h2>
          <p className="max-w-md text-center text-body text-[var(--color-text-secondary)]">
            An unexpected error occurred. This has been logged for
            investigation.
          </p>
          <button
            className="btn-primary"
            onClick={this.handleRetry}
            data-testid="error-boundary-retry"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
