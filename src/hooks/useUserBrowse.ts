import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  type DirectoryEntry,
  type DirectoryUser,
  mapEntryToUser,
} from "@/types/directory";

interface BrowseResult {
  entries: DirectoryEntry[];
  totalCount: number;
  hasMore: boolean;
}

type BrowseMode = "browse" | "search";

interface UseUserBrowseReturn {
  users: DirectoryUser[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  totalCount: number;
  mode: BrowseMode;
  filterText: string;
  setFilterText: (text: string) => void;
  loadMore: () => void;
  selectedUser: DirectoryUser | null;
  setSelectedUser: (user: DirectoryUser | null) => void;
  refresh: () => void;
}

const PAGE_SIZE = 50;
const SEARCH_THRESHOLD = 3;

export function useUserBrowse(): UseUserBrowseReturn {
  const [allBrowseUsers, setAllBrowseUsers] = useState<DirectoryUser[]>([]);
  const [displayedUsers, setDisplayedUsers] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [mode, setMode] = useState<BrowseMode>("browse");
  const [filterText, setFilterTextState] = useState("");
  const [selectedUser, setSelectedUser] = useState<DirectoryUser | null>(null);
  const [browsePageLoaded, setBrowsePageLoaded] = useState(0);
  const mountedRef = useRef(false);

  const loadBrowsePage = useCallback(
    async (page: number, append: boolean) => {
      if (page === 0) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);

      try {
        const result = await invoke<BrowseResult>("browse_users", {
          page,
          pageSize: PAGE_SIZE,
        });
        const mapped = result.entries.map(mapEntryToUser);

        if (append) {
          setAllBrowseUsers((prev) => [...prev, ...mapped]);
          setDisplayedUsers((prev) => [...prev, ...mapped]);
        } else {
          setAllBrowseUsers(mapped);
          setDisplayedUsers(mapped);
        }

        setTotalCount(result.totalCount);
        setHasMore(result.hasMore);
        setBrowsePageLoaded(page);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load users");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [],
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
        // Return to browse mode, show all loaded data
        setMode("browse");
        setDisplayedUsers(allBrowseUsers);
        setHasMore(allBrowseUsers.length < totalCount);
        setError(null);
        return;
      }

      if (text.length < SEARCH_THRESHOLD) {
        // Client-side filter of browse results
        setMode("browse");
        const lower = text.toLowerCase();
        const filtered = allBrowseUsers.filter(
          (u) =>
            u.displayName.toLowerCase().includes(lower) ||
            u.samAccountName.toLowerCase().includes(lower) ||
            u.email.toLowerCase().includes(lower),
        );
        setDisplayedUsers(filtered);
        setHasMore(false);
        setError(null);
        return;
      }

      // Server-side search
      setMode("search");
      setLoading(true);
      setError(null);
      try {
        const entries = await invoke<DirectoryEntry[]>("search_users", {
          query: text,
        });
        const mapped = entries.map(mapEntryToUser);
        setDisplayedUsers(mapped);
        setTotalCount(mapped.length);
        setHasMore(false);

        if (mapped.length === 1) {
          setSelectedUser(mapped[0]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        setDisplayedUsers([]);
      } finally {
        setLoading(false);
      }
    },
    [allBrowseUsers, totalCount],
  );

  const loadMore = useCallback(() => {
    if (mode !== "browse" || loadingMore || !hasMore) return;
    loadBrowsePage(browsePageLoaded + 1, true);
  }, [mode, loadingMore, hasMore, browsePageLoaded, loadBrowsePage]);

  const refresh = useCallback(() => {
    setAllBrowseUsers([]);
    setDisplayedUsers([]);
    setBrowsePageLoaded(0);
    setFilterTextState("");
    setMode("browse");
    setSelectedUser(null);
    loadBrowsePage(0, false);
  }, [loadBrowsePage]);

  return {
    users: displayedUsers,
    loading,
    loadingMore,
    error,
    hasMore,
    totalCount,
    mode,
    filterText,
    setFilterText,
    loadMore,
    selectedUser,
    setSelectedUser,
    refresh,
  };
}
