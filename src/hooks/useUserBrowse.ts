import { type DirectoryUser, mapEntryToUser } from "@/types/directory";
import { useBrowse, type UseBrowseReturn } from "@/hooks/useBrowse";

export function useUserBrowse(): UseBrowseReturn<DirectoryUser> {
  return useBrowse<DirectoryUser>({
    browseCommand: "browse_users",
    searchCommand: "search_users",
    mapEntry: mapEntryToUser,
    clientFilter: (u, lower) =>
      u.displayName.toLowerCase().includes(lower) ||
      u.samAccountName.toLowerCase().includes(lower) ||
      u.email.toLowerCase().includes(lower),
  });
}
