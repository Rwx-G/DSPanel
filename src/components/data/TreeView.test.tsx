import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TreeView, type TreeNode } from "./TreeView";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const testNodes: TreeNode[] = [
  {
    id: "root1",
    label: "Root 1",
    children: [
      { id: "child1", label: "Child 1" },
      {
        id: "child2",
        label: "Child 2",
        children: [{ id: "grandchild1", label: "Grandchild 1" }],
      },
    ],
  },
  { id: "root2", label: "Root 2" },
];

describe("TreeView", () => {
  it("should render the tree view", () => {
    render(<TreeView nodes={testNodes} />);
    expect(screen.getByTestId("tree-view")).toBeInTheDocument();
  });

  it("should have tree role", () => {
    render(<TreeView nodes={testNodes} />);
    expect(screen.getByRole("tree")).toBeInTheDocument();
  });

  it("should render root nodes", () => {
    render(<TreeView nodes={testNodes} />);
    expect(screen.getByTestId("tree-node-root1")).toBeInTheDocument();
    expect(screen.getByTestId("tree-node-root2")).toBeInTheDocument();
  });

  it("should not show children initially", () => {
    render(<TreeView nodes={testNodes} />);
    expect(screen.queryByTestId("tree-node-child1")).not.toBeInTheDocument();
  });

  it("should show children when expanded", () => {
    render(<TreeView nodes={testNodes} />);
    fireEvent.click(screen.getByTestId("tree-toggle-root1"));
    expect(screen.getByTestId("tree-node-child1")).toBeInTheDocument();
    expect(screen.getByTestId("tree-node-child2")).toBeInTheDocument();
  });

  it("should hide children when collapsed", () => {
    render(<TreeView nodes={testNodes} />);
    fireEvent.click(screen.getByTestId("tree-toggle-root1"));
    fireEvent.click(screen.getByTestId("tree-toggle-root1"));
    expect(screen.queryByTestId("tree-node-child1")).not.toBeInTheDocument();
  });

  it("should not show toggle for leaf nodes", () => {
    render(<TreeView nodes={testNodes} />);
    expect(screen.queryByTestId("tree-toggle-root2")).not.toBeInTheDocument();
  });

  it("should call onSelect when a node is clicked", () => {
    const onSelect = vi.fn();
    render(<TreeView nodes={testNodes} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("tree-item-root2"));
    expect(onSelect).toHaveBeenCalledWith("root2");
  });

  it("should highlight selected nodes", () => {
    render(<TreeView nodes={testNodes} selectedIds={new Set(["root2"])} />);
    expect(screen.getByTestId("tree-item-root2").className).toContain(
      "color-primary",
    );
  });

  it("should show checkboxes in multi-select mode", () => {
    render(<TreeView nodes={testNodes} multiSelect={true} />);
    expect(screen.getByTestId("tree-checkbox-root1")).toBeInTheDocument();
  });

  it("should not show checkboxes by default", () => {
    render(<TreeView nodes={testNodes} />);
    expect(screen.queryByTestId("tree-checkbox-root1")).not.toBeInTheDocument();
  });

  it("should support nested expansion", () => {
    render(<TreeView nodes={testNodes} />);
    fireEvent.click(screen.getByTestId("tree-toggle-root1"));
    fireEvent.click(screen.getByTestId("tree-toggle-child2"));
    expect(screen.getByTestId("tree-node-grandchild1")).toBeInTheDocument();
  });
});
