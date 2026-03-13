import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfoCard } from "./InfoCard";

describe("InfoCard", () => {
  it("should render header text", () => {
    render(<InfoCard header="Details">Content</InfoCard>);
    expect(screen.getByTestId("info-card-header")).toHaveTextContent("Details");
  });

  it("should render children when expanded", () => {
    render(<InfoCard header="Details">Content here</InfoCard>);
    expect(screen.getByTestId("info-card-content")).toHaveTextContent(
      "Content here",
    );
  });

  it("should be expanded by default", () => {
    render(<InfoCard header="Details">Content</InfoCard>);
    expect(screen.getByTestId("info-card-content")).toBeInTheDocument();
  });

  it("should collapse when header is clicked", () => {
    render(<InfoCard header="Details">Content</InfoCard>);
    fireEvent.click(screen.getByTestId("info-card-header"));
    expect(screen.queryByTestId("info-card-content")).not.toBeInTheDocument();
  });

  it("should expand when header is clicked again", () => {
    render(<InfoCard header="Details">Content</InfoCard>);
    fireEvent.click(screen.getByTestId("info-card-header"));
    fireEvent.click(screen.getByTestId("info-card-header"));
    expect(screen.getByTestId("info-card-content")).toBeInTheDocument();
  });

  it("should respect defaultExpanded=false", () => {
    render(
      <InfoCard header="Details" defaultExpanded={false}>
        Content
      </InfoCard>,
    );
    expect(screen.queryByTestId("info-card-content")).not.toBeInTheDocument();
  });

  it("should not toggle when collapsible=false", () => {
    render(
      <InfoCard header="Details" collapsible={false}>
        Content
      </InfoCard>,
    );
    fireEvent.click(screen.getByTestId("info-card-header"));
    expect(screen.getByTestId("info-card-content")).toBeInTheDocument();
  });

  it("should render icon when provided", () => {
    render(
      <InfoCard header="Details" icon={<span data-testid="card-icon">I</span>}>
        Content
      </InfoCard>,
    );
    expect(screen.getByTestId("card-icon")).toBeInTheDocument();
  });

  it("should have aria-expanded attribute", () => {
    render(<InfoCard header="Details">Content</InfoCard>);
    expect(screen.getByTestId("info-card-header")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("should update aria-expanded when collapsed", () => {
    render(<InfoCard header="Details">Content</InfoCard>);
    fireEvent.click(screen.getByTestId("info-card-header"));
    expect(screen.getByTestId("info-card-header")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
