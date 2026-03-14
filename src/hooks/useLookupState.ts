import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type DirectoryEntry } from "@/types/directory";

export type LookupState = "initial" | "loading" | "results" | "empty" | "error";

interface UseLookupStateOptions<T> {
  command: string;
  mapEntry: (entry: DirectoryEntry) => T;
}

interface UseLookupStateReturn<T> {
  lookupState: LookupState;
  errorMessage: string;
  searchResults: T[];
  lastQuery: string;
  searchValue: string;
  setSearchValue: (value: string) => void;
  handleSearch: (query: string) => Promise<void>;
  handleRetry: () => void;
  selectedItem: T | null;
  setSelectedItem: (item: T | null) => void;
}

export function useLookupState<T>({
  command,
  mapEntry,
}: UseLookupStateOptions<T>): UseLookupStateReturn<T> {
  const [searchValue, setSearchValue] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [lookupState, setLookupState] = useState<LookupState>("initial");
  const [errorMessage, setErrorMessage] = useState("");
  const [searchResults, setSearchResults] = useState<T[]>([]);
  const [selectedItem, setSelectedItem] = useState<T | null>(null);

  const handleSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      setLastQuery(trimmed);
      setLookupState("loading");
      setErrorMessage("");
      setSelectedItem(null);

      try {
        const entries = await invoke<DirectoryEntry[]>(command, {
          query: trimmed,
        });
        const mapped = entries.map(mapEntry);
        setSearchResults(mapped);
        setLookupState(mapped.length > 0 ? "results" : "empty");

        if (mapped.length === 1) {
          setSelectedItem(mapped[0]);
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Search failed");
        setLookupState("error");
      }
    },
    [command, mapEntry],
  );

  const handleRetry = useCallback(() => {
    if (lastQuery) {
      handleSearch(lastQuery);
    }
  }, [lastQuery, handleSearch]);

  return {
    lookupState,
    errorMessage,
    searchResults,
    lastQuery,
    searchValue,
    setSearchValue,
    handleSearch,
    handleRetry,
    selectedItem,
    setSelectedItem,
  };
}
