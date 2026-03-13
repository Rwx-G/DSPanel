import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
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
});
