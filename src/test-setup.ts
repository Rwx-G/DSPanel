import "@testing-library/jest-dom/vitest";
import "./i18n";

// Polyfill ResizeObserver for jsdom (used by TabBar scroll overflow detection)
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
}
