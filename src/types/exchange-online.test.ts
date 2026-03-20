import { describe, it, expect } from "vitest";
import { formatBytes, usageColor } from "./exchange-online";

describe("formatBytes", () => {
  it("formats gigabytes", () => {
    expect(formatBytes(2_147_483_648)).toBe("2.0 GB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(52_428_800)).toBe("50.0 MB");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(10_240)).toBe("10.0 KB");
  });

  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });
});

describe("usageColor", () => {
  it("returns error color for 90%+", () => {
    expect(usageColor(95)).toBe("var(--color-error)");
    expect(usageColor(90)).toBe("var(--color-error)");
  });

  it("returns warning color for 75-89%", () => {
    expect(usageColor(85)).toBe("var(--color-warning)");
    expect(usageColor(75)).toBe("var(--color-warning)");
  });

  it("returns success color for under 75%", () => {
    expect(usageColor(50)).toBe("var(--color-success)");
    expect(usageColor(0)).toBe("var(--color-success)");
  });
});
