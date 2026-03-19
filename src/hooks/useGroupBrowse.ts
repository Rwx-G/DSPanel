import { type DirectoryGroup, mapEntryToGroup } from "@/types/directory";
import { useBrowse, type UseBrowseReturn } from "@/hooks/useBrowse";

export function useGroupBrowse(): UseBrowseReturn<DirectoryGroup> {
  return useBrowse<DirectoryGroup>({
    browseCommand: "browse_groups",
    searchCommand: "search_groups",
    mapEntry: mapEntryToGroup,
    clientFilter: (g, lower) =>
      g.displayName.toLowerCase().includes(lower) ||
      g.samAccountName.toLowerCase().includes(lower) ||
      g.description.toLowerCase().includes(lower),
    itemKey: (g) => g.distinguishedName,
    preloadAll: true,
  });
}
