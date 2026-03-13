import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("should render with text", () => {
    render(<StatusBadge text="Active" />);
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Active");
  });

  it("should default to neutral variant", () => {
    render(<StatusBadge text="Pending" />);
    expect(screen.getByTestId("status-badge")).toHaveAttribute(
      "data-variant",
      "neutral",
    );
  });

  it("should apply success variant", () => {
    render(<StatusBadge text="Enabled" variant="success" />);
    expect(screen.getByTestId("status-badge")).toHaveAttribute(
      "data-variant",
      "success",
    );
  });

  it("should apply warning variant", () => {
    render(<StatusBadge text="Expiring" variant="warning" />);
    expect(screen.getByTestId("status-badge")).toHaveAttribute(
      "data-variant",
      "warning",
    );
  });

  it("should apply error variant", () => {
    render(<StatusBadge text="Disabled" variant="error" />);
    expect(screen.getByTestId("status-badge")).toHaveAttribute(
      "data-variant",
      "error",
    );
  });

  it("should apply info variant", () => {
    render(<StatusBadge text="Info" variant="info" />);
    expect(screen.getByTestId("status-badge")).toHaveAttribute(
      "data-variant",
      "info",
    );
  });

  it("should render as a span element", () => {
    render(<StatusBadge text="Test" />);
    expect(screen.getByTestId("status-badge").tagName).toBe("SPAN");
  });
});
