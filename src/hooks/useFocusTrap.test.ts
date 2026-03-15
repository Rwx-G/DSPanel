import { renderHook, render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement, useEffect } from "react";
import { useFocusTrap } from "./useFocusTrap";

describe("useFocusTrap", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns a ref object", () => {
    const { result } = renderHook(() => useFocusTrap<HTMLDivElement>());
    expect(result.current).toBeDefined();
    expect(result.current.current).toBeNull();
  });

  it("does not activate when active is false", () => {
    const { result } = renderHook(() => useFocusTrap<HTMLDivElement>(false));
    expect(result.current.current).toBeNull();
  });

  it("stores previous focus element for restoration", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    const { unmount } = renderHook(() => useFocusTrap<HTMLDivElement>());

    unmount();
    // After unmount, focus should be restored to the button
    expect(document.activeElement).toBe(button);
  });

  // Helper component that wires up the ref properly
  function TrapTestComponent({
    active = true,
    onRef,
  }: {
    active?: boolean;
    onRef?: (el: HTMLDivElement | null) => void;
  }) {
    const ref = useFocusTrap<HTMLDivElement>(active);

    useEffect(() => {
      if (onRef) onRef(ref.current);
    });

    return createElement(
      "div",
      { ref, "data-testid": "trap" },
      createElement("button", { "data-testid": "btn1" }, "First"),
      createElement("button", { "data-testid": "btn2" }, "Second"),
      createElement("button", { "data-testid": "btn3" }, "Third"),
    );
  }

  it("focuses the first focusable element on mount", () => {
    render(createElement(TrapTestComponent));
    expect(document.activeElement).toBe(screen.getByTestId("btn1"));
  });

  it("wraps focus from last to first on Tab at last element", () => {
    render(createElement(TrapTestComponent));

    // Focus the last button
    const btn3 = screen.getByTestId("btn3");
    btn3.focus();
    expect(document.activeElement).toBe(btn3);

    // Dispatch Tab
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    const spy = vi.spyOn(event, "preventDefault");
    document.dispatchEvent(event);

    expect(spy).toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByTestId("btn1"));
  });

  it("wraps focus from first to last on Shift+Tab at first element", () => {
    render(createElement(TrapTestComponent));

    // Focus is already on btn1 after mount
    expect(document.activeElement).toBe(screen.getByTestId("btn1"));

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    const spy = vi.spyOn(event, "preventDefault");
    document.dispatchEvent(event);

    expect(spy).toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByTestId("btn3"));
  });

  it("does not wrap focus when Tab pressed on middle element", () => {
    render(createElement(TrapTestComponent));

    const btn2 = screen.getByTestId("btn2");
    btn2.focus();

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    const spy = vi.spyOn(event, "preventDefault");
    document.dispatchEvent(event);

    // Should NOT prevent default since we are not at the boundary
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not wrap focus on Shift+Tab when not at first element", () => {
    render(createElement(TrapTestComponent));

    const btn2 = screen.getByTestId("btn2");
    btn2.focus();

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    const spy = vi.spyOn(event, "preventDefault");
    document.dispatchEvent(event);

    expect(spy).not.toHaveBeenCalled();
  });

  it("ignores non-Tab keys", () => {
    render(createElement(TrapTestComponent));

    const btn1 = screen.getByTestId("btn1");
    expect(document.activeElement).toBe(btn1);

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    // Focus should remain on btn1
    expect(document.activeElement).toBe(btn1);
  });

  it("does not trap focus when active is false", () => {
    render(createElement(TrapTestComponent, { active: false }));

    // Focus should NOT be moved to btn1 when inactive
    expect(document.activeElement).not.toBe(screen.getByTestId("btn1"));
  });

  it("focuses container when no focusable elements are inside", () => {
    function EmptyTrap() {
      const ref = useFocusTrap<HTMLDivElement>(true);
      return createElement("div", {
        ref,
        tabIndex: -1,
        "data-testid": "empty-trap",
      });
    }

    render(createElement(EmptyTrap));
    expect(document.activeElement).toBe(screen.getByTestId("empty-trap"));
  });

  it("cleans up event listener on deactivation", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useFocusTrap<HTMLDivElement>(active),
      { initialProps: { active: true } },
    );

    expect(result.current).toBeDefined();

    // Deactivate
    rerender({ active: false });
    expect(result.current).toBeDefined();
  });

  it("restores focus to previous element on unmount", () => {
    const externalButton = document.createElement("button");
    externalButton.textContent = "External";
    document.body.appendChild(externalButton);
    externalButton.focus();

    const { unmount } = render(createElement(TrapTestComponent));

    // Focus should be on btn1 inside the trap
    expect(document.activeElement).toBe(screen.getByTestId("btn1"));

    unmount();

    // Focus should be restored to external button
    expect(document.activeElement).toBe(externalButton);
  });
});
