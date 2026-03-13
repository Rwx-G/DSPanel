import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ValidationSummary } from "./ValidationSummary";

describe("ValidationSummary", () => {
  it("should not render when no errors", () => {
    const { container } = render(<ValidationSummary errors={{}} />);
    expect(container.innerHTML).toBe("");
  });

  it("should render when errors exist", () => {
    render(<ValidationSummary errors={{ name: "Name is required" }} />);
    expect(screen.getByTestId("validation-summary")).toBeInTheDocument();
  });

  it("should show singular error count", () => {
    render(<ValidationSummary errors={{ name: "Name is required" }} />);
    expect(screen.getByTestId("validation-summary")).toHaveTextContent(
      "1 validation error",
    );
  });

  it("should show plural error count", () => {
    render(
      <ValidationSummary
        errors={{ name: "Required", email: "Invalid email" }}
      />,
    );
    expect(screen.getByTestId("validation-summary")).toHaveTextContent(
      "2 validation errors",
    );
  });

  it("should display error messages", () => {
    render(<ValidationSummary errors={{ name: "Name is required" }} />);
    expect(screen.getByTestId("validation-error-name")).toHaveTextContent(
      "Name is required",
    );
  });

  it("should call onErrorClick when error is clicked", () => {
    const onErrorClick = vi.fn();
    render(
      <ValidationSummary
        errors={{ name: "Required" }}
        onErrorClick={onErrorClick}
      />,
    );
    fireEvent.click(screen.getByTestId("validation-error-name"));
    expect(onErrorClick).toHaveBeenCalledWith("name");
  });

  it("should render as buttons when onErrorClick is provided", () => {
    render(
      <ValidationSummary
        errors={{ name: "Required" }}
        onErrorClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("validation-error-name").tagName).toBe("BUTTON");
  });

  it("should render as spans when no onErrorClick", () => {
    render(<ValidationSummary errors={{ name: "Required" }} />);
    expect(screen.getByTestId("validation-error-name").tagName).toBe("SPAN");
  });

  it("should have alert role", () => {
    render(<ValidationSummary errors={{ name: "Required" }} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
