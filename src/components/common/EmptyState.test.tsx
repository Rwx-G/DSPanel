import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("should render title", () => {
    render(<EmptyState title="No results" />);
    expect(screen.getByTestId("empty-state-title")).toHaveTextContent(
      "No results",
    );
  });

  it("should render description when provided", () => {
    render(
      <EmptyState
        title="No results"
        description="Try adjusting your search."
      />,
    );
    expect(screen.getByTestId("empty-state-description")).toHaveTextContent(
      "Try adjusting your search.",
    );
  });

  it("should not render description when not provided", () => {
    render(<EmptyState title="No results" />);
    expect(
      screen.queryByTestId("empty-state-description"),
    ).not.toBeInTheDocument();
  });

  it("should render icon when provided", () => {
    render(
      <EmptyState
        title="No results"
        icon={<span data-testid="custom-icon">icon</span>}
      />,
    );
    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
  });

  it("should not render icon container when not provided", () => {
    render(<EmptyState title="No results" />);
    expect(screen.queryByTestId("empty-state-icon")).not.toBeInTheDocument();
  });

  it("should render action button when provided", () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="No results"
        action={{ label: "Try again", onClick }}
      />,
    );
    expect(screen.getByTestId("empty-state-action")).toHaveTextContent(
      "Try again",
    );
  });

  it("should call action onClick when button is clicked", () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="No results"
        action={{ label: "Try again", onClick }}
      />,
    );
    fireEvent.click(screen.getByTestId("empty-state-action"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("should not render action when not provided", () => {
    render(<EmptyState title="No results" />);
    expect(screen.queryByTestId("empty-state-action")).not.toBeInTheDocument();
  });
});
