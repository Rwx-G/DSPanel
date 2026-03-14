import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

describe("ContextMenu", () => {
  const defaultItems: ContextMenuItem[] = [
    { label: "View members", onClick: vi.fn() },
    { label: "Copy DN", onClick: vi.fn() },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when position is null", () => {
    render(
      <ContextMenu items={defaultItems} position={null} onClose={vi.fn()} />,
    );
    expect(screen.queryByTestId("context-menu")).not.toBeInTheDocument();
  });

  it("renders menu items at the given position", () => {
    render(
      <ContextMenu
        items={defaultItems}
        position={{ x: 100, y: 200 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("context-menu")).toBeInTheDocument();
    expect(screen.getByText("View members")).toBeInTheDocument();
    expect(screen.getByText("Copy DN")).toBeInTheDocument();
  });

  it("calls item onClick and onClose when clicked", () => {
    const onClose = vi.fn();
    const items: ContextMenuItem[] = [
      { label: "Action", onClick: vi.fn() },
    ];

    render(
      <ContextMenu items={items} position={{ x: 0, y: 0 }} onClose={onClose} />,
    );

    fireEvent.click(screen.getByText("Action"));
    expect(items[0].onClick).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("does not call onClick for disabled items", () => {
    const items: ContextMenuItem[] = [
      { label: "Disabled", onClick: vi.fn(), disabled: true },
    ];

    render(
      <ContextMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
    );

    fireEvent.click(screen.getByText("Disabled"));
    expect(items[0].onClick).not.toHaveBeenCalled();
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu
        items={defaultItems}
        position={{ x: 0, y: 0 }}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on click outside", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu
        items={defaultItems}
        position={{ x: 0, y: 0 }}
        onClose={onClose}
      />,
    );

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("has correct role attributes", () => {
    render(
      <ContextMenu
        items={defaultItems}
        position={{ x: 0, y: 0 }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("renders items with icons", () => {
    const items: ContextMenuItem[] = [
      {
        label: "With icon",
        icon: <span data-testid="test-icon">IC</span>,
        onClick: vi.fn(),
      },
    ];

    render(
      <ContextMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
    );

    expect(screen.getByTestId("test-icon")).toBeInTheDocument();
  });
});
