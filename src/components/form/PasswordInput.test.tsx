import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PasswordInput } from "./PasswordInput";

describe("PasswordInput", () => {
  it("should render a password input", () => {
    render(<PasswordInput />);
    expect(screen.getByTestId("password-input")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("should toggle to text type when show button is clicked", () => {
    render(<PasswordInput />);
    fireEvent.click(screen.getByTestId("password-toggle"));
    expect(screen.getByTestId("password-input")).toHaveAttribute(
      "type",
      "text",
    );
  });

  it("should toggle back to password type on second click", () => {
    render(<PasswordInput />);
    fireEvent.click(screen.getByTestId("password-toggle"));
    fireEvent.click(screen.getByTestId("password-toggle"));
    expect(screen.getByTestId("password-input")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("should show 'Show password' label initially", () => {
    render(<PasswordInput />);
    expect(screen.getByLabelText("Show password")).toBeInTheDocument();
  });

  it("should show 'Hide password' label when visible", () => {
    render(<PasswordInput />);
    fireEvent.click(screen.getByTestId("password-toggle"));
    expect(screen.getByLabelText("Hide password")).toBeInTheDocument();
  });

  it("should support error state", () => {
    render(<PasswordInput error />);
    expect(screen.getByTestId("password-input")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("should support disabled state", () => {
    render(<PasswordInput disabled />);
    expect(screen.getByTestId("password-input")).toBeDisabled();
  });

  it("should accept value and onChange", () => {
    const onChange = vi.fn();
    render(<PasswordInput value="secret" onChange={onChange} />);
    expect(screen.getByTestId("password-input")).toHaveValue("secret");
  });
});
