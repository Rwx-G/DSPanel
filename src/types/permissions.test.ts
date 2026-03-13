import { describe, it, expect } from "vitest";
import {
  permissionIndex,
  hasPermissionLevel,
  PERMISSION_LEVELS,
} from "./permissions";

describe("permissionIndex", () => {
  it("should return 0 for ReadOnly", () => {
    expect(permissionIndex("ReadOnly")).toBe(0);
  });

  it("should return 1 for HelpDesk", () => {
    expect(permissionIndex("HelpDesk")).toBe(1);
  });

  it("should return 2 for AccountOperator", () => {
    expect(permissionIndex("AccountOperator")).toBe(2);
  });

  it("should return 3 for DomainAdmin", () => {
    expect(permissionIndex("DomainAdmin")).toBe(3);
  });
});

describe("hasPermissionLevel", () => {
  it("should return true when current equals required", () => {
    expect(hasPermissionLevel("HelpDesk", "HelpDesk")).toBe(true);
  });

  it("should return true when current exceeds required", () => {
    expect(hasPermissionLevel("DomainAdmin", "ReadOnly")).toBe(true);
    expect(hasPermissionLevel("DomainAdmin", "HelpDesk")).toBe(true);
    expect(hasPermissionLevel("DomainAdmin", "AccountOperator")).toBe(true);
  });

  it("should return false when current is below required", () => {
    expect(hasPermissionLevel("ReadOnly", "HelpDesk")).toBe(false);
    expect(hasPermissionLevel("HelpDesk", "AccountOperator")).toBe(false);
    expect(hasPermissionLevel("AccountOperator", "DomainAdmin")).toBe(false);
  });

  it("should return true for ReadOnly requiring ReadOnly", () => {
    expect(hasPermissionLevel("ReadOnly", "ReadOnly")).toBe(true);
  });

  it("should follow inheritance - AccountOperator has HelpDesk", () => {
    expect(hasPermissionLevel("AccountOperator", "HelpDesk")).toBe(true);
    expect(hasPermissionLevel("AccountOperator", "ReadOnly")).toBe(true);
  });
});

describe("PERMISSION_LEVELS", () => {
  it("should contain all four levels in order", () => {
    expect(PERMISSION_LEVELS).toEqual([
      "ReadOnly",
      "HelpDesk",
      "AccountOperator",
      "DomainAdmin",
    ]);
  });
});
