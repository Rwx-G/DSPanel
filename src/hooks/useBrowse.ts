import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type DirectoryEntry } from "@/types/directory";

interface BrowseResult {
  entries: DirectoryEntry[];
  totalCount: number;
  hasMore: boolean;
}

type BrowseMode = "browse" | "search";

export interface UseBrowseOptions<T> {
  browseCommand: string;
  searchCommand: string;
  mapEntry: (entry: DirectoryEntry) => T;
  clientFilter: (item: T, lower: string) => boolean;
}

export interface UseBrowseReturn<T> {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  totalCount: number;
  mode: BrowseMode;
  filterText: string;
  setFilterText: (text: string) => void;
  loadMore: () => void;
  selectedItem: T | null;
  setSelectedItem: (item: T | null) => void;
  refresh: () => void;
}

const PAGE_SIZE = 50;
const SEARCH_THRESHOLD = 3;

export function useBrowse<T>({
  browseCommand,
  searchCommand,
  mapEntry,
  clientFilter,
}: UseBrowseOptions<T>): UseBrowseReturn<T> {
  const [allBrowseItems, setAllBrowseItems] = useState<T[]>([]);
  const [displayedItems, setDisplayedItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [mode, setMode] = useState<BrowseMode>("browse");
  const [filterText, setFilterTextState] = useState("");
  const [selectedItem, setSelectedItem] = useState<T | null>(null);
  const [browsePageLoaded, setBrowsePageLoaded] = useState(0);
  const mountedRef = useRef(false);

  // Stabilize callbacks via refs to avoid dependency churn
  const mapEntryRef = useRef(mapEntry);
  mapEntryRef.current = mapEntry;
  const clientFilterRef = useRef(clientFilter);
  clientFilterRef.current = clientFilter;

  const loadBrowsePage = useCallback(
    async (page: number, append: boolean) => {
      if (page === 0) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);

      try {
        const result = await invoke<BrowseResult>(browseCommand, {
          page,
          pageSize: PAGE_SIZE,
        });
        const mapped = result.entries.map((e) => mapEntryRef.current(e));

        if (append) {
          setAllBrowseItems((prev) => [...prev, ...mapped]);
          setDisplayedItems((prev) => [...prev, ...mapped]);
        } else {
          setAllBrowseItems(mapped);
          setDisplayedItems(mapped);
        }

        setTotalCount(result.totalCount);
        setHasMore(result.hasMore);
        setBrowsePageLoaded(page);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load items");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [browseCommand],
  );

  // Load first page on mount
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      loadBrowsePage(0, false);
    }
  }, [loadBrowsePage]);

  const setFilterText = useCallback(
    async (text: string) => {
      setFilterTextState(text);

      if (text.length === 0) {
        setMode((prev) => {
          if (prev === "search") {
            setDisplayedItems(allBrowseItems);
          }
          return "browse";
        });
        setHasMore(allBrowseItems.length < totalCount);
        setError(null);
        return;
      }

      if (text.length < SEARCH_THRESHOLD) {
        setMode("browse");
        const lower = text.toLowerCase();
        const filtered = allBrowseItems.filter((item) =>
          clientFilterRef.current(item, lower),
        );
        setDisplayedItems(filtered);
        setHasMore(false);
        setError(null);
        return;
      }

      // Server-side search
      setMode("search");
      setLoading(true);
      setError(null);
      try {
        const entries = await invoke<DirectoryEntry[]>(searchCommand, {
          query: text,
        });
        const mapped = entries.map((e) => mapEntryRef.current(e));
        setDisplayedItems(mapped);
        setTotalCount(mapped.length);
        setHasMore(false);

        if (mapped.length === 1) {
          setSelectedItem(mapped[0]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        setDisplayedItems([]);
      } finally {
        setLoading(false);
      }
    },
    [allBrowseItems, totalCount, searchCommand],
  );

  const loadMore = useCallback(() => {
    if (mode !== "browse" || loadingMore || !hasMore) return;
    loadBrowsePage(browsePageLoaded + 1, true);
  }, [mode, loadingMore, hasMore, browsePageLoaded, loadBrowsePage]);

  const refresh = useCallback(() => {
    setAllBrowseItems([]);
    setDisplayedItems([]);
    setBrowsePageLoaded(0);
    setFilterTextState("");
    setMode("browse");
    setSelectedItem(null);
    loadBrowsePage(0, false);
  }, [loadBrowsePage]);

  return {
    items: displayedItems,
    loading,
    loadingMore,
    error,
    hasMore,
    totalCount,
    mode,
    filterText,
    setFilterText,
    loadMore,
    selectedItem,
    setSelectedItem,
    refresh,
  };
}
