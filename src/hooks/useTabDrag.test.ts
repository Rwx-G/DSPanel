import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabDrag } from "./useTabDrag";

function makePointerEvent(
  type: string,
  overrides: Partial<React.PointerEvent> = {},
): React.PointerEvent {
  return {
    button: 0,
    clientX: 0,
    pointerId: 1,
    target: {
      closest: () => null,
      setPointerCapture: vi.fn(),
    } as unknown as EventTarget,
    ...overrides,
  } as unknown as React.PointerEvent;
}

function makeContainerEl(tabCount: number, tabWidth = 100) {
  const tabs: HTMLElement[] = [];
  for (let i = 0; i < tabCount; i++) {
    const tab = document.createElement("div");
    tab.setAttribute("role", "tab");
    Object.defineProperty(tab, "offsetWidth", { value: tabWidth });
    Object.defineProperty(tab, "offsetLeft", { value: i * tabWidth });
    tabs.push(tab);
  }

  const container = document.createElement("div");
  // Mock querySelectorAll to return our tabs
  container.querySelectorAll = vi.fn().mockReturnValue(tabs) as never;
  return container;
}

describe("useTabDrag", () => {
  let moveTab: ReturnType<typeof vi.fn>;
  let activateTab: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    moveTab = vi.fn();
    activateTab = vi.fn();
  });

  it("returns initial state with no active drag", () => {
    const { result } = renderHook(() =>
      useTabDrag({ tabCount: 3, moveTab, activateTab }),
    );

    expect(result.current.dragTabId).toBeNull();
    expect(result.current.dragDeltaX).toBe(0);
  });

  it("handleTabClick activates a tab when not dragging", () => {
    const { result } = renderHook(() =>
      useTabDrag({ tabCount: 3, moveTab, activateTab }),
    );

    act(() => {
      result.current.handleTabClick("tab-1");
    });

    expect(activateTab).toHaveBeenCalledWith("tab-1");
  });

  it("handlePointerDown ignores non-left clicks", () => {
    const { result } = renderHook(() =>
      useTabDrag({ tabCount: 3, moveTab, activateTab }),
    );

    const event = makePointerEvent("pointerdown", { button: 2 });
    const container = makeContainerEl(3);

    act(() => {
      result.current.handlePointerDown(event, "tab-1", 0, container);
    });

    expect(result.current.dragTabId).toBeNull();
  });

  it("handlePointerDown ignores clicks on buttons", () => {
    const { result } = renderHook(() =>
      useTabDrag({ tabCount: 3, moveTab, activateTab }),
    );

    const buttonEl = document.createElement("button");
    const event = makePointerEvent("pointerdown", {
      target: {
        closest: (sel: string) => (sel === "button" ? buttonEl : null),
        setPointerCapture: vi.fn(),
      } as unknown as EventTarget,
    });
    const container = makeContainerEl(3);

    act(() => {
      result.current.handlePointerDown(event, "tab-1", 0, container);
    });

    expect(result.current.dragTabId).toBeNull();
  });

  it("handlePointerDown ignores when containerEl is null", () => {
    const { result } = renderHook(() =>
      useTabDrag({ tabCount: 3, moveTab, activateTab }),
    );

    const event = makePointerEvent("pointerdown");

    act(() => {
      result.current.handlePointerDown(event, "tab-1", 0, null);
    });

    expect(result.current.dragTabId).toBeNull();
  });

  it("handlePointerDown starts drag and captures pointer", () => {
    const { result } = renderHook(() =>
      useTabDrag({ tabCount: 3, moveTab, activateTab }),
    );

    const setPointerCapture = vi.fn();
    const event = makePointerEvent("pointerdown", {
      clientX: 50,
      target: {
        closest: () => null,
        setPointerCapture,
      } as unknown as EventTarget,
    });
    const container = makeContainerEl(3);

    act(() => {
      result.current.handlePointerDown(event, "tab-1", 1, container);
    });

    expect(result.current.dragTabId).toBe("tab-1");
    expect(result.current.dragDeltaX).toBe(0);
    expect(setPointerCapture).toHaveBeenCalledWith(1);
  });

  it("handlePointerMove does nothing when not dragging", () => {
    const { result } = renderHook(() =>
      useTabDrag({ tabCount: 3, moveTab, activateTab }),
    );

    const event = makePointerEvent("pointermove", { clientX: 200 });

    act(() => {
      result.current.handlePointerMove(event);
    });

    expect(result.current.dragDeltaX).toBe(0);
    expect(moveTab).not.toHaveBeenCalled();
  });

  it("handlePointerMove updates deltaX during drag", () => {
    const { result } = renderHook(() =>
      useTabDrag({ tabCount: 3, moveTab, activateTab }),
    );

    const container = makeContainerEl(3);
    const downEvent = makePointerEvent("pointerdown", { clientX: 150 });

    act(() => {
      result.current.handlePointerDown(downEvent, "tab-1", 1, container);
    });

    const moveEvent = makePointerEvent("pointermove", { clientX: 155 });
    act(() => {
      result.current.handlePointerMove(moveEvent);
    });

    expect(result.current.dragDeltaX).toBe(5);
  });

  it("handlePointerMove triggers moveTab when dragged right past next tab center", () => {
    const { result } = renderHook(() =>
      useTabDrag({ tabCount: 3, moveTab, activateTab }),
    );

    const container = makeContainerEl(3, 100);
    // Start drag on tab index 0 at x=50 (center of first tab)
    const downEvent = makePointerEvent("pointerdown", { clientX: 50 });

    act(() => {
      result.current.handlePointerDown(downEvent, "tab-0", 0, container);
    });

    // Move right by 100px - past the center of next tab (at 150)
    const moveEvent = makePointerEvent("pointermove", { clientX: 160 });
    act(() => {
      result.current.handlePointerMove(moveEvent);
    });

    expect(moveTab).toHaveBeenCalledWith(0, 1);
  });

  it("handlePointerMove triggers moveTab when dragged left past prev tab center", () => {
    const { result } = renderHook(() =>
      useTabDrag({ tabCount: 3, moveTab, activateTab }),
    );

    const container = makeContainerEl(3, 100);
    // Start drag on tab index 2 at x=250 (center of third tab)
    const downEvent = makePointerEvent("pointerdown", { clientX: 250 });

    act(() => {
      result.current.handlePointerDown(downEvent, "tab-2", 2, container);
    });

    // Move left by 110px - past the center of prev tab (at 150)
    const moveEvent = makePointerEvent("pointermove", { clientX: 130 });
    act(() => {
      result.current.handlePointerMove(moveEvent);
    });

    expect(moveTab).toHaveBeenCalledWith(2, 1);
  });

  it("handlePointerUp resets drag state", () => {
    const { result } = renderHook(() =>
      useTabDrag({ tabCount: 3, moveTab, activateTab }),
    );

    const container = makeContainerEl(3);
    const downEvent = makePointerEvent("pointerdown", { clientX: 50 });

    act(() => {
      result.current.handlePointerDown(downEvent, "tab-0", 0, container);
    });
    expect(result.current.dragTabId).toBe("tab-0");

    act(() => {
      result.current.handlePointerUp();
    });

    expect(result.current.dragTabId).toBeNull();
    expect(result.current.dragDeltaX).toBe(0);
  });

  it("handleTabClick suppresses click when didDrag is active", () => {
    const { result } = renderHook(() =>
      useTabDrag({ tabCount: 3, moveTab, activateTab }),
    );

    const container = makeContainerEl(3, 100);
    const downEvent = makePointerEvent("pointerdown", { clientX: 50 });

    act(() => {
      result.current.handlePointerDown(downEvent, "tab-0", 0, container);
    });

    // Move enough to trigger didDrag (> 3px)
    const moveEvent = makePointerEvent("pointermove", { clientX: 60 });
    act(() => {
      result.current.handlePointerMove(moveEvent);
    });

    // Call handleTabClick BEFORE handlePointerUp so didDragRef is still true.
    // In practice handlePointerUp resets didDragRef, so the suppression
    // only applies when the click handler fires while drag is still active.
    act(() => {
      result.current.handleTabClick("tab-0");
    });

    expect(activateTab).not.toHaveBeenCalled();

    // After suppression, didDragRef is cleared, so next click activates
    act(() => {
      result.current.handleTabClick("tab-0");
    });

    expect(activateTab).toHaveBeenCalledWith("tab-0");
  });

  it("does not trigger swap when at boundary (first tab, drag left)", () => {
    const { result } = renderHook(() =>
      useTabDrag({ tabCount: 3, moveTab, activateTab }),
    );

    const container = makeContainerEl(3, 100);
    const downEvent = makePointerEvent("pointerdown", { clientX: 50 });

    act(() => {
      result.current.handlePointerDown(downEvent, "tab-0", 0, container);
    });

    // Try to move left - should not swap since we are at index 0
    const moveEvent = makePointerEvent("pointermove", { clientX: -50 });
    act(() => {
      result.current.handlePointerMove(moveEvent);
    });

    expect(moveTab).not.toHaveBeenCalled();
  });

  it("does not trigger swap when at boundary (last tab, drag right)", () => {
    const { result } = renderHook(() =>
      useTabDrag({ tabCount: 3, moveTab, activateTab }),
    );

    const container = makeContainerEl(3, 100);
    const downEvent = makePointerEvent("pointerdown", { clientX: 250 });

    act(() => {
      result.current.handlePointerDown(downEvent, "tab-2", 2, container);
    });

    // Try to move right - should not swap since we are at last index
    const moveEvent = makePointerEvent("pointermove", { clientX: 400 });
    act(() => {
      result.current.handlePointerMove(moveEvent);
    });

    expect(moveTab).not.toHaveBeenCalled();
  });

  it("small movements (< 4px) do not set didDrag", () => {
    const { result } = renderHook(() =>
      useTabDrag({ tabCount: 3, moveTab, activateTab }),
    );

    const container = makeContainerEl(3, 100);
    const downEvent = makePointerEvent("pointerdown", { clientX: 50 });

    act(() => {
      result.current.handlePointerDown(downEvent, "tab-0", 0, container);
    });

    // Move only 2px
    const moveEvent = makePointerEvent("pointermove", { clientX: 52 });
    act(() => {
      result.current.handlePointerMove(moveEvent);
    });

    act(() => {
      result.current.handlePointerUp();
    });

    // Click after small movement should still activate
    act(() => {
      result.current.handleTabClick("tab-0");
    });

    expect(activateTab).toHaveBeenCalledWith("tab-0");
  });
});
