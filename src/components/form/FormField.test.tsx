import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormField } from "./FormField";

describe("FormField", () => {
  it("should render label text", () => {
    render(
      <FormField label="Username">
        <input />
      </FormField>,
    );
    expect(screen.getByTestId("form-field-label")).toHaveTextContent(
      "Username",
    );
  });

  it("should render children", () => {
    render(
      <FormField label="Email">
        <input data-testid="child-input" />
      </FormField>,
    );
    expect(screen.getByTestId("child-input")).toBeInTheDocument();
  });

  it("should show asterisk when required", () => {
    render(
      <FormField label="Name" required>
        <input />
      </FormField>,
    );
    expect(screen.getByTestId("form-field-label")).toHaveTextContent("Name*");
  });

  it("should not show asterisk when not required", () => {
    render(
      <FormField label="Name">
        <input />
      </FormField>,
    );
    expect(screen.getByTestId("form-field-label").textContent).toBe("Name");
  });

  it("should show error message when provided", () => {
    render(
      <FormField label="Name" error="Name is required">
        <input />
      </FormField>,
    );
    expect(screen.getByTestId("form-field-error")).toHaveTextContent(
      "Name is required",
    );
  });

  it("should not show error when not provided", () => {
    render(
      <FormField label="Name">
        <input />
      </FormField>,
    );
    expect(screen.queryByTestId("form-field-error")).not.toBeInTheDocument();
  });

  it("should have alert role on error message", () => {
    render(
      <FormField label="Name" error="Required">
        <input />
      </FormField>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("should set htmlFor on label", () => {
    render(
      <FormField label="Name" htmlFor="name-input">
        <input id="name-input" />
      </FormField>,
    );
    expect(screen.getByTestId("form-field-label")).toHaveAttribute(
      "for",
      "name-input",
    );
  });
});
