import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChangeTracker } from "./useChangeTracker";

describe("useChangeTracker", () => {
  const initial = { name: "Alice", email: "alice@test.com" };

  it("should start with initial values", () => {
    const { result } = renderHook(() => useChangeTracker(initial));
    expect(result.current.current).toEqual(initial);
  });

  it("should not be dirty initially", () => {
    const { result } = renderHook(() => useChangeTracker(initial));
    expect(result.current.isDirty).toBe(false);
  });

  it("should be dirty after value change", () => {
    const { result } = renderHook(() => useChangeTracker(initial));

    act(() => {
      result.current.setField("name", "Bob");
    });

    expect(result.current.isDirty).toBe(true);
    expect(result.current.current.name).toBe("Bob");
  });

  it("should not be dirty after changing back to original", () => {
    const { result } = renderHook(() => useChangeTracker(initial));

    act(() => {
      result.current.setField("name", "Bob");
    });
    act(() => {
      result.current.setField("name", "Alice");
    });

    expect(result.current.isDirty).toBe(false);
  });

  it("should mark clean after markClean", () => {
    const { result } = renderHook(() => useChangeTracker(initial));

    act(() => {
      result.current.setField("name", "Bob");
    });
    act(() => {
      result.current.markClean();
    });

    expect(result.current.isDirty).toBe(false);
    expect(result.current.current.name).toBe("Bob");
  });

  it("should reset to original values", () => {
    const { result } = renderHook(() => useChangeTracker(initial));

    act(() => {
      result.current.setField("name", "Bob");
      result.current.setField("email", "bob@test.com");
    });
    act(() => {
      result.current.reset();
    });

    expect(result.current.current).toEqual(initial);
    expect(result.current.isDirty).toBe(false);
  });

  it("should support setCurrent for bulk updates", () => {
    const { result } = renderHook(() => useChangeTracker(initial));

    act(() => {
      result.current.setCurrent({ name: "Charlie", email: "charlie@test.com" });
    });

    expect(result.current.current.name).toBe("Charlie");
    expect(result.current.isDirty).toBe(true);
  });
});
