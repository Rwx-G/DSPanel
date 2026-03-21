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
  /** Returns a unique key for an item (used by updateItem). */
  itemKey: (item: T) => string;
  /** When true, automatically loads all pages on mount instead of waiting for scroll. */
  preloadAll?: boolean;
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
  updateItem: (key: string, updated: T) => void;
  refresh: () => void;
}

const PAGE_SIZE = 50;
const SEARCH_THRESHOLD = 3;

export function useBrowse<T>({
  browseCommand,
  searchCommand,
  mapEntry,
  clientFilter,
  itemKey,
  preloadAll = false,
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
  const itemKeyRef = useRef(itemKey);
  itemKeyRef.current = itemKey;

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

  // Loads all pages sequentially (used for preloadAll and refresh)
  const loadAllPages = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAllBrowseItems([]);
    setDisplayedItems([]);
    setBrowsePageLoaded(0);
    setMode("browse");
    try {
      let page = 0;
      let allItems: T[] = [];
      let more = true;

      while (more) {
        const result = await invoke<BrowseResult>(browseCommand, {
          page,
          pageSize: PAGE_SIZE,
        });
        const mapped = result.entries.map((e) => mapEntryRef.current(e));
        allItems = [...allItems, ...mapped];
        setAllBrowseItems(allItems);
        setDisplayedItems(allItems);
        setTotalCount(result.totalCount);
        more = result.hasMore;
        page++;
      }

      setHasMore(false);
      setBrowsePageLoaded(page - 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load items",
      );
    } finally {
      setLoading(false);
    }
  }, [browseCommand]);

  // Load first page on mount, then preload remaining pages if requested
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;

      if (preloadAll) {
        loadAllPages();
      } else {
        loadBrowsePage(0, false);
      }
    }
  }, [loadBrowsePage, preloadAll, loadAllPages]);

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

  const updateItem = useCallback((key: string, updated: T) => {
    const replacer = (items: T[]) =>
      items.map((item) => (itemKeyRef.current(item) === key ? updated : item));
    setAllBrowseItems(replacer);
    setDisplayedItems(replacer);
  }, []);

  const refresh = useCallback(() => {
    setFilterTextState("");
    setSelectedItem(null);
    if (preloadAll) {
      loadAllPages();
    } else {
      setAllBrowseItems([]);
      setDisplayedItems([]);
      setBrowsePageLoaded(0);
      setMode("browse");
      loadBrowsePage(0, false);
    }
  }, [preloadAll, loadAllPages, loadBrowsePage]);

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
    updateItem,
    refresh,
  };
}
