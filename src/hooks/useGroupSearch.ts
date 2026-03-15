import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type GroupOption } from "@/components/form/GroupPicker";
import { type DirectoryEntry } from "@/types/directory";

function parseCnFromDn(dn: string): string {
  const match = dn.match(/^CN=([^,]+)/i);
  return match ? match[1] : dn;
}

export function useGroupSearch(): (query: string) => Promise<GroupOption[]> {
  return useCallback(async (query: string): Promise<GroupOption[]> => {
    const entries = await invoke<DirectoryEntry[]>("search_groups", { query });
    return entries.map((e) => ({
      distinguishedName: e.distinguishedName,
      name: e.displayName ?? parseCnFromDn(e.distinguishedName),
      description: e.attributes?.description?.[0],
    }));
  }, []);
}
