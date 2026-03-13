import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TagChip } from "./TagChip";

describe("TagChip", () => {
  it("should render with text", () => {
    render(<TagChip text="Admin" />);
    expect(screen.getByTestId("tag-chip")).toHaveTextContent("Admin");
  });

  it("should show remove button when removable and onRemove is provided", () => {
    render(<TagChip text="Admin" onRemove={vi.fn()} />);
    expect(screen.getByTestId("tag-chip-remove")).toBeInTheDocument();
  });

  it("should hide remove button when removable is false", () => {
    render(<TagChip text="Admin" removable={false} onRemove={vi.fn()} />);
    expect(screen.queryByTestId("tag-chip-remove")).not.toBeInTheDocument();
  });

  it("should hide remove button when onRemove is not provided", () => {
    render(<TagChip text="Admin" />);
    expect(screen.queryByTestId("tag-chip-remove")).not.toBeInTheDocument();
  });

  it("should call onRemove when remove button is clicked", () => {
    const onRemove = vi.fn();
    render(<TagChip text="Admin" onRemove={onRemove} />);
    fireEvent.click(screen.getByTestId("tag-chip-remove"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("should have accessible remove label", () => {
    render(<TagChip text="Admin" onRemove={vi.fn()} />);
    expect(screen.getByLabelText("Remove Admin")).toBeInTheDocument();
  });
});
