import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  type GroupComparisonResult,
  type GroupDisplayItem,
  type GroupCategory,
  type GroupSortField,
  type SortDirection,
} from "@/types/comparison";
import { type DirectoryEntry } from "@/types/directory";
import { parseCnFromDn } from "@/utils/dn";

export function useComparison() {
  const [userA, setUserA] = useState<DirectoryEntry | null>(null);
  const [userB, setUserB] = useState<DirectoryEntry | null>(null);
  const [comparisonResult, setComparisonResult] =
    useState<GroupComparisonResult | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sortField, setSortField] = useState<GroupSortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const selectUserA = useCallback(
    async (samAccountName: string) => {
      try {
        const entry = await invoke<DirectoryEntry | null>("get_user", {
          samAccountName,
        });
        setUserA(entry);
        setComparisonResult(null);
        setError(null);
      } catch (e) {
        setError(`Failed to load user A: ${e}`);
      }
    },
    [],
  );

  const selectUserB = useCallback(
    async (samAccountName: string) => {
      try {
        const entry = await invoke<DirectoryEntry | null>("get_user", {
          samAccountName,
        });
        setUserB(entry);
        setComparisonResult(null);
        setError(null);
      } catch (e) {
        setError(`Failed to load user B: ${e}`);
      }
    },
    [],
  );

  const compare = useCallback(async () => {
    if (!userA?.samAccountName || !userB?.samAccountName) {
      setError("Please select both users before comparing.");
      return;
    }
    setIsComparing(true);
    setError(null);
    try {
      const result = await invoke<GroupComparisonResult>("compare_users", {
        samA: userA.samAccountName,
        samB: userB.samAccountName,
      });
      setComparisonResult(result);
    } catch (e) {
      setError(`Comparison failed: ${e}`);
    } finally {
      setIsComparing(false);
    }
  }, [userA, userB]);

  const allGroups: GroupDisplayItem[] = useMemo(() => {
    if (!comparisonResult) return [];
    const items: GroupDisplayItem[] = [];
    for (const dn of comparisonResult.sharedGroups) {
      items.push({ dn, name: parseCnFromDn(dn), category: "shared" });
    }
    for (const dn of comparisonResult.onlyAGroups) {
      items.push({ dn, name: parseCnFromDn(dn), category: "onlyA" });
    }
    for (const dn of comparisonResult.onlyBGroups) {
      items.push({ dn, name: parseCnFromDn(dn), category: "onlyB" });
    }
    return items;
  }, [comparisonResult]);

  const filteredGroups = useMemo(() => {
    let groups = allGroups;
    if (filter) {
      const lowerFilter = filter.toLowerCase();
      groups = groups.filter((g) => g.name.toLowerCase().includes(lowerFilter));
    }

    const categoryOrder: Record<GroupCategory, number> = {
      shared: 0,
      onlyA: 1,
      onlyB: 2,
    };

    groups.sort((a, b) => {
      let cmp: number;
      if (sortField === "category") {
        cmp = categoryOrder[a.category] - categoryOrder[b.category];
        if (cmp === 0) {
          cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        }
      } else {
        cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      }
      return sortDirection === "desc" ? -cmp : cmp;
    });

    return groups;
  }, [allGroups, filter, sortField, sortDirection]);

  const reset = useCallback(() => {
    setUserA(null);
    setUserB(null);
    setComparisonResult(null);
    setError(null);
    setFilter("");
  }, []);

  return {
    userA,
    userB,
    comparisonResult,
    isComparing,
    error,
    filter,
    sortField,
    sortDirection,
    filteredGroups,
    selectUserA,
    selectUserB,
    compare,
    setFilter,
    setSortField,
    setSortDirection,
    reset,
  };
}
