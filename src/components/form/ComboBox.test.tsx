import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ComboBox, type ComboBoxOption } from "./ComboBox";

const options: ComboBoxOption[] = [
  { value: "us", label: "United States" },
  { value: "uk", label: "United Kingdom" },
  { value: "fr", label: "France" },
  { value: "de", label: "Germany" },
];

describe("ComboBox", () => {
  it("should render the trigger button", () => {
    render(<ComboBox options={options} value="" onChange={vi.fn()} />);
    expect(screen.getByTestId("combobox-trigger")).toBeInTheDocument();
  });

  it("should show placeholder when no value selected", () => {
    render(<ComboBox options={options} value="" onChange={vi.fn()} />);
    expect(screen.getByTestId("combobox-trigger")).toHaveTextContent(
      "Select...",
    );
  });

  it("should show selected option label", () => {
    render(<ComboBox options={options} value="fr" onChange={vi.fn()} />);
    expect(screen.getByTestId("combobox-trigger")).toHaveTextContent("France");
  });

  it("should open dropdown when trigger is clicked", () => {
    render(<ComboBox options={options} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("combobox-trigger"));
    expect(screen.getByTestId("combobox-dropdown")).toBeInTheDocument();
  });

  it("should not open when disabled", () => {
    render(<ComboBox options={options} value="" onChange={vi.fn()} disabled />);
    fireEvent.click(screen.getByTestId("combobox-trigger"));
    expect(screen.queryByTestId("combobox-dropdown")).not.toBeInTheDocument();
  });

  it("should show all options in dropdown", () => {
    render(<ComboBox options={options} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("combobox-trigger"));
    expect(screen.getByTestId("combobox-option-us")).toBeInTheDocument();
    expect(screen.getByTestId("combobox-option-uk")).toBeInTheDocument();
    expect(screen.getByTestId("combobox-option-fr")).toBeInTheDocument();
    expect(screen.getByTestId("combobox-option-de")).toBeInTheDocument();
  });

  it("should filter options based on search text", () => {
    render(<ComboBox options={options} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("combobox-trigger"));
    fireEvent.change(screen.getByTestId("combobox-search"), {
      target: { value: "united" },
    });
    expect(screen.getByTestId("combobox-option-us")).toBeInTheDocument();
    expect(screen.getByTestId("combobox-option-uk")).toBeInTheDocument();
    expect(screen.queryByTestId("combobox-option-fr")).not.toBeInTheDocument();
  });

  it("should show no results when search matches nothing", () => {
    render(<ComboBox options={options} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("combobox-trigger"));
    fireEvent.change(screen.getByTestId("combobox-search"), {
      target: { value: "xyz" },
    });
    expect(screen.getByTestId("combobox-no-results")).toBeInTheDocument();
  });

  it("should call onChange when an option is selected", () => {
    const onChange = vi.fn();
    render(<ComboBox options={options} value="" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("combobox-trigger"));
    fireEvent.click(screen.getByTestId("combobox-option-fr"));
    expect(onChange).toHaveBeenCalledWith("fr");
  });

  it("should close dropdown after selection", () => {
    render(<ComboBox options={options} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("combobox-trigger"));
    fireEvent.click(screen.getByTestId("combobox-option-fr"));
    expect(screen.queryByTestId("combobox-dropdown")).not.toBeInTheDocument();
  });

  it("should have aria-expanded attribute", () => {
    render(<ComboBox options={options} value="" onChange={vi.fn()} />);
    expect(screen.getByTestId("combobox-trigger")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.click(screen.getByTestId("combobox-trigger"));
    expect(screen.getByTestId("combobox-trigger")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("should have listbox role on dropdown", () => {
    render(<ComboBox options={options} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("combobox-trigger"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("should close on Escape key", () => {
    render(<ComboBox options={options} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("combobox-trigger"));
    fireEvent.keyDown(screen.getByTestId("combobox"), { key: "Escape" });
    expect(screen.queryByTestId("combobox-dropdown")).not.toBeInTheDocument();
  });
});
