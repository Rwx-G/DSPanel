import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingSpinner } from "./LoadingSpinner";

describe("LoadingSpinner", () => {
  it("should render when active", () => {
    render(<LoadingSpinner />);
    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
  });

  it("should not render when inactive", () => {
    render(<LoadingSpinner active={false} />);
    expect(screen.queryByTestId("loading-spinner")).not.toBeInTheDocument();
  });

  it("should show message when provided", () => {
    render(<LoadingSpinner message="Loading data..." />);
    expect(screen.getByTestId("loading-message")).toHaveTextContent(
      "Loading data...",
    );
  });

  it("should not show message when not provided", () => {
    render(<LoadingSpinner />);
    expect(screen.queryByTestId("loading-message")).not.toBeInTheDocument();
  });

  it("should have status role for accessibility", () => {
    render(<LoadingSpinner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("should have loading aria-label", () => {
    render(<LoadingSpinner />);
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });

  it("should apply custom size", () => {
    render(<LoadingSpinner size={48} />);
    const spinner = screen.getByRole("status");
    expect(spinner).toHaveStyle({ width: "48px", height: "48px" });
  });
});
