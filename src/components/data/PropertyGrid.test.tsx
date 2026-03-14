import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PropertyGrid, type PropertyGroup } from "./PropertyGrid";

const testGroups: PropertyGroup[] = [
  {
    category: "General",
    items: [
      { label: "Name", value: "Alice" },
      { label: "Email", value: "alice@test.com" },
    ],
  },
  {
    category: "Account",
    items: [{ label: "Status", value: "Active" }],
  },
];

describe("PropertyGrid", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("should render the property grid", () => {
    render(<PropertyGrid groups={testGroups} />);
    expect(screen.getByTestId("property-grid")).toBeInTheDocument();
  });

  it("should render group categories", () => {
    render(<PropertyGrid groups={testGroups} />);
    expect(screen.getByTestId("property-group-General")).toBeInTheDocument();
    expect(screen.getByTestId("property-group-Account")).toBeInTheDocument();
  });

  it("should render property items", () => {
    render(<PropertyGrid groups={testGroups} />);
    expect(screen.getByTestId("property-item-Name")).toBeInTheDocument();
    expect(screen.getByTestId("property-item-Email")).toBeInTheDocument();
    expect(screen.getByTestId("property-item-Status")).toBeInTheDocument();
  });

  it("should display label and value", () => {
    render(<PropertyGrid groups={testGroups} />);
    const nameItem = screen.getByTestId("property-item-Name");
    expect(nameItem).toHaveTextContent("Name");
    expect(nameItem).toHaveTextContent("Alice");
  });

  it("should collapse group when toggled", () => {
    render(<PropertyGrid groups={testGroups} />);
    fireEvent.click(screen.getByTestId("property-group-toggle-General"));
    expect(screen.queryByTestId("property-item-Name")).not.toBeInTheDocument();
  });

  it("should expand group when toggled again", () => {
    render(<PropertyGrid groups={testGroups} />);
    fireEvent.click(screen.getByTestId("property-group-toggle-General"));
    fireEvent.click(screen.getByTestId("property-group-toggle-General"));
    expect(screen.getByTestId("property-item-Name")).toBeInTheDocument();
  });

  it("should show empty state when no groups", () => {
    render(<PropertyGrid groups={[]} />);
    expect(screen.getByTestId("property-grid-empty")).toBeInTheDocument();
  });

  it("should have aria-expanded on group toggles", () => {
    render(<PropertyGrid groups={testGroups} />);
    expect(screen.getByTestId("property-group-toggle-General")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
