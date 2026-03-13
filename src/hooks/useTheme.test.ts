import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "./useTheme";

describe("useTheme", () => {
  let originalMatchMedia: typeof window.matchMedia;
  const storageKey = "dspanel-theme";

  // Mock localStorage with a simple in-memory store
  let store: Record<string, string> = {};

  const mockLocalStorage = {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };

  beforeEach(() => {
    store = {};
    document.documentElement.removeAttribute("data-theme");
    originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "localStorage", {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  function mockSystemTheme(isDark: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" ? isDark : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }

  it("should default to light theme when system prefers light", () => {
    mockSystemTheme(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.currentTheme).toBe("light");
  });

  it("should default to dark theme when system prefers dark", () => {
    mockSystemTheme(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.currentTheme).toBe("dark");
  });

  it("should use saved theme from localStorage", () => {
    store[storageKey] = "dark";
    mockSystemTheme(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.currentTheme).toBe("dark");
  });

  it("should set data-theme attribute on html element", () => {
    mockSystemTheme(false);
    renderHook(() => useTheme());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("should switch theme via applyTheme", () => {
    mockSystemTheme(false);
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.applyTheme("dark");
    });

    expect(result.current.currentTheme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(store[storageKey]).toBe("dark");
  });

  it("should toggle theme", () => {
    mockSystemTheme(false);
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.currentTheme).toBe("dark");

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.currentTheme).toBe("light");
  });

  it("should persist theme to localStorage on apply", () => {
    mockSystemTheme(false);
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.applyTheme("dark");
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(storageKey, "dark");
  });

  it("should persist theme to localStorage on toggle", () => {
    mockSystemTheme(false);
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(store[storageKey]).toBe("dark");
  });

  it("should restore saved theme round-trip", () => {
    mockSystemTheme(false);
    const { result: first } = renderHook(() => useTheme());

    act(() => {
      first.current.applyTheme("dark");
    });

    const { result: second } = renderHook(() => useTheme());
    expect(second.current.currentTheme).toBe("dark");
  });

  it("should ignore invalid localStorage values", () => {
    store[storageKey] = "invalid";
    mockSystemTheme(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.currentTheme).toBe("light");
  });
});
