export interface GroupComparisonResult {
  sharedGroups: string[];
  onlyAGroups: string[];
  onlyBGroups: string[];
  totalA: number;
  totalB: number;
}

export type GroupCategory = "shared" | "onlyA" | "onlyB";

export interface GroupDisplayItem {
  dn: string;
  name: string;
  category: GroupCategory;
}

export type GroupSortField = "name" | "category";
export type SortDirection = "asc" | "desc";
