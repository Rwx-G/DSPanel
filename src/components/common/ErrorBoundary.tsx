import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertCircle } from "lucide-react";
import { Translation } from "react-i18next";

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
        <Translation ns={["components", "common"]}>
          {(t) => (
        <div
          className="flex h-full flex-col items-center justify-center gap-4 p-8"
          data-testid="error-boundary-fallback"
        >
          <AlertCircle size={48} className="text-[var(--color-error)]" />
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {t("components:errorBoundary.title")}
          </h2>
          <p className="max-w-md text-center text-body text-[var(--color-text-secondary)]">
            {t("components:errorBoundary.description")}
          </p>
          {this.state.error && (
            <details className="w-full max-w-lg" data-testid="error-boundary-details">
              <summary className="cursor-pointer text-caption text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                {t("components:errorBoundary.showDetails")}
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-[var(--color-surface-bg)] p-3 text-caption text-[var(--color-error)] font-mono whitespace-pre-wrap break-all">
                {this.state.error.message}
                {this.state.error.stack && `\n\n${this.state.error.stack}`}
              </pre>
            </details>
          )}
          <button
            className="btn btn-primary"
            onClick={this.handleRetry}
            data-testid="error-boundary-retry"
          >
            {t("components:errorBoundary.tryAgain")}
          </button>
        </div>
          )}
        </Translation>
      );
    }

    return this.props.children;
  }
}
