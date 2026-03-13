import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Pagination } from "./Pagination";

describe("Pagination", () => {
  const defaultProps = {
    currentPage: 1,
    pageSize: 25,
    totalItems: 100,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
  };

  it("should render pagination info", () => {
    render(<Pagination {...defaultProps} />);
    expect(screen.getByTestId("pagination-info")).toHaveTextContent(
      "Showing 1-25 of 100 items",
    );
  });

  it("should show correct info on page 2", () => {
    render(<Pagination {...defaultProps} currentPage={2} />);
    expect(screen.getByTestId("pagination-info")).toHaveTextContent(
      "Showing 26-50 of 100 items",
    );
  });

  it("should show correct info on last page with partial fill", () => {
    render(<Pagination {...defaultProps} currentPage={4} />);
    expect(screen.getByTestId("pagination-info")).toHaveTextContent(
      "Showing 76-100 of 100 items",
    );
  });

  it("should show 'No items' when totalItems is 0", () => {
    render(<Pagination {...defaultProps} totalItems={0} />);
    expect(screen.getByTestId("pagination-info")).toHaveTextContent("No items");
  });

  it("should display page number and total pages", () => {
    render(<Pagination {...defaultProps} />);
    expect(screen.getByTestId("pagination-page")).toHaveTextContent("1 / 4");
  });

  it("should disable first and prev on first page", () => {
    render(<Pagination {...defaultProps} currentPage={1} />);
    expect(screen.getByTestId("pagination-first")).toBeDisabled();
    expect(screen.getByTestId("pagination-prev")).toBeDisabled();
  });

  it("should disable next and last on last page", () => {
    render(<Pagination {...defaultProps} currentPage={4} />);
    expect(screen.getByTestId("pagination-next")).toBeDisabled();
    expect(screen.getByTestId("pagination-last")).toBeDisabled();
  });

  it("should enable all buttons on middle page", () => {
    render(<Pagination {...defaultProps} currentPage={2} />);
    expect(screen.getByTestId("pagination-first")).not.toBeDisabled();
    expect(screen.getByTestId("pagination-prev")).not.toBeDisabled();
    expect(screen.getByTestId("pagination-next")).not.toBeDisabled();
    expect(screen.getByTestId("pagination-last")).not.toBeDisabled();
  });

  it("should call onPageChange with 1 when first is clicked", () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        {...defaultProps}
        currentPage={3}
        onPageChange={onPageChange}
      />,
    );
    fireEvent.click(screen.getByTestId("pagination-first"));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("should call onPageChange with prev page when prev is clicked", () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        {...defaultProps}
        currentPage={3}
        onPageChange={onPageChange}
      />,
    );
    fireEvent.click(screen.getByTestId("pagination-prev"));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("should call onPageChange with next page when next is clicked", () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        {...defaultProps}
        currentPage={2}
        onPageChange={onPageChange}
      />,
    );
    fireEvent.click(screen.getByTestId("pagination-next"));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("should call onPageChange with last page when last is clicked", () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        {...defaultProps}
        currentPage={1}
        onPageChange={onPageChange}
      />,
    );
    fireEvent.click(screen.getByTestId("pagination-last"));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("should call onPageSizeChange when page size is changed", () => {
    const onPageSizeChange = vi.fn();
    render(
      <Pagination {...defaultProps} onPageSizeChange={onPageSizeChange} />,
    );
    fireEvent.change(screen.getByTestId("pagination-page-size"), {
      target: { value: "50" },
    });
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("should handle single page correctly", () => {
    render(<Pagination {...defaultProps} totalItems={10} />);
    expect(screen.getByTestId("pagination-page")).toHaveTextContent("1 / 1");
    expect(screen.getByTestId("pagination-first")).toBeDisabled();
    expect(screen.getByTestId("pagination-last")).toBeDisabled();
  });
});
