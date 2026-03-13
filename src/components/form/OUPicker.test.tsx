import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OUPicker, type OUNode } from "./OUPicker";

const testOUs: OUNode[] = [
  {
    distinguishedName: "OU=Users,DC=example,DC=com",
    name: "Users",
    children: [
      {
        distinguishedName: "OU=Sales,OU=Users,DC=example,DC=com",
        name: "Sales",
      },
      {
        distinguishedName: "OU=IT,OU=Users,DC=example,DC=com",
        name: "IT",
        hasChildren: true,
      },
    ],
  },
  {
    distinguishedName: "OU=Computers,DC=example,DC=com",
    name: "Computers",
  },
];

describe("OUPicker", () => {
  it("should render the OU picker", () => {
    render(<OUPicker nodes={testOUs} onSelect={vi.fn()} />);
    expect(screen.getByTestId("ou-picker")).toBeInTheDocument();
  });

  it("should display OU tree nodes", () => {
    render(<OUPicker nodes={testOUs} onSelect={vi.fn()} />);
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Computers")).toBeInTheDocument();
  });

  it("should call onSelect when an OU is clicked", () => {
    const onSelect = vi.fn();
    render(<OUPicker nodes={testOUs} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Computers"));
    expect(onSelect).toHaveBeenCalledWith("OU=Computers,DC=example,DC=com");
  });

  it("should show selected OU when selectedOU prop is set", () => {
    render(
      <OUPicker
        nodes={testOUs}
        selectedOU="OU=Users,DC=example,DC=com"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ou-picker-selected")).toHaveTextContent(
      "Selected: OU=Users,DC=example,DC=com",
    );
  });

  it("should show loading state", () => {
    render(<OUPicker nodes={[]} loading={true} onSelect={vi.fn()} />);
    expect(screen.getByTestId("ou-picker-loading")).toBeInTheDocument();
  });

  it("should show error state", () => {
    render(<OUPicker nodes={[]} error={true} onSelect={vi.fn()} />);
    expect(screen.getByTestId("ou-picker-error")).toBeInTheDocument();
  });

  it("should show empty state when no OUs", () => {
    render(<OUPicker nodes={[]} onSelect={vi.fn()} />);
    expect(screen.getByTestId("ou-picker-empty")).toBeInTheDocument();
  });

  it("should be disabled when disabled prop is true", () => {
    render(<OUPicker nodes={testOUs} disabled={true} onSelect={vi.fn()} />);
    const picker = screen.getByTestId("ou-picker");
    expect(picker).toHaveClass("pointer-events-none");
    expect(picker).toHaveClass("opacity-50");
  });

  it("should expand child OUs when parent is toggled", () => {
    render(<OUPicker nodes={testOUs} onSelect={vi.fn()} />);
    // Users has children, click the toggle
    const toggle = screen.getByTestId("tree-toggle-OU=Users,DC=example,DC=com");
    fireEvent.click(toggle);
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("IT")).toBeInTheDocument();
  });

  it("should call onExpand for lazy-loaded OUs", () => {
    const onExpand = vi.fn();
    render(<OUPicker nodes={testOUs} onSelect={vi.fn()} onExpand={onExpand} />);
    // First expand Users
    fireEvent.click(
      screen.getByTestId("tree-toggle-OU=Users,DC=example,DC=com"),
    );
    // Then expand IT which has hasChildren=true
    fireEvent.click(
      screen.getByTestId("tree-toggle-OU=IT,OU=Users,DC=example,DC=com"),
    );
    expect(onExpand).toHaveBeenCalledWith("OU=IT,OU=Users,DC=example,DC=com");
  });
});
