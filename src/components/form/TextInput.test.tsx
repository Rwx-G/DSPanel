import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TextInput } from "./TextInput";

describe("TextInput", () => {
  it("should render an input element", () => {
    render(<TextInput />);
    expect(screen.getByTestId("text-input")).toBeInTheDocument();
  });

  it("should be a text input", () => {
    render(<TextInput />);
    expect(screen.getByTestId("text-input")).toHaveAttribute("type", "text");
  });

  it("should accept value and onChange", () => {
    const onChange = vi.fn();
    render(<TextInput value="hello" onChange={onChange} />);
    expect(screen.getByTestId("text-input")).toHaveValue("hello");
  });

  it("should accept placeholder", () => {
    render(<TextInput placeholder="Enter name" />);
    expect(screen.getByPlaceholderText("Enter name")).toBeInTheDocument();
  });

  it("should apply error styling when error is true", () => {
    render(<TextInput error />);
    expect(screen.getByTestId("text-input")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("should not have aria-invalid when no error", () => {
    render(<TextInput />);
    expect(screen.getByTestId("text-input")).not.toHaveAttribute(
      "aria-invalid",
    );
  });

  it("should support disabled state", () => {
    render(<TextInput disabled />);
    expect(screen.getByTestId("text-input")).toBeDisabled();
  });

  it("should fire onChange when typing", () => {
    const onChange = vi.fn();
    render(<TextInput onChange={onChange} />);
    fireEvent.change(screen.getByTestId("text-input"), {
      target: { value: "test" },
    });
    expect(onChange).toHaveBeenCalled();
  });
});
