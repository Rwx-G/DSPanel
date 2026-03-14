import { describe, it, expect } from "vitest";
import type {
  GroupComparisonResult,
  GroupDisplayItem,
  GroupCategory,
  GroupSortField,
  SortDirection,
} from "./comparison";

describe("comparison types", () => {
  it("GroupComparisonResult can be constructed", () => {
    const result: GroupComparisonResult = {
      sharedGroups: ["CN=G1,DC=example,DC=com"],
      onlyAGroups: ["CN=G2,DC=example,DC=com"],
      onlyBGroups: ["CN=G3,DC=example,DC=com"],
      totalA: 2,
      totalB: 2,
    };
    expect(result.sharedGroups).toHaveLength(1);
    expect(result.onlyAGroups).toHaveLength(1);
    expect(result.onlyBGroups).toHaveLength(1);
    expect(result.totalA).toBe(2);
    expect(result.totalB).toBe(2);
  });

  it("GroupDisplayItem can be constructed", () => {
    const item: GroupDisplayItem = {
      dn: "CN=Admins,DC=example,DC=com",
      name: "Admins",
      category: "shared",
    };
    expect(item.name).toBe("Admins");
    expect(item.category).toBe("shared");
  });

  it("GroupCategory accepts valid values", () => {
    const categories: GroupCategory[] = ["shared", "onlyA", "onlyB"];
    expect(categories).toHaveLength(3);
  });

  it("GroupSortField accepts valid values", () => {
    const fields: GroupSortField[] = ["name", "category"];
    expect(fields).toHaveLength(2);
  });

  it("SortDirection accepts valid values", () => {
    const dirs: SortDirection[] = ["asc", "desc"];
    expect(dirs).toHaveLength(2);
  });

  it("GroupComparisonResult with empty arrays", () => {
    const result: GroupComparisonResult = {
      sharedGroups: [],
      onlyAGroups: [],
      onlyBGroups: [],
      totalA: 0,
      totalB: 0,
    };
    expect(result.sharedGroups).toHaveLength(0);
    expect(result.totalA).toBe(0);
  });
});
