import { type DirectoryEntry } from "@/types/directory";

export interface ContactInfo {
  dn: string;
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  mobile: string;
  company: string;
  department: string;
  description: string;
}

export function mapEntryToContact(entry: DirectoryEntry): ContactInfo {
  const attr = (name: string): string => entry.attributes[name]?.[0] ?? "";
  return {
    dn: entry.distinguishedName,
    displayName: entry.displayName ?? attr("displayName") ?? "",
    firstName: attr("givenName"),
    lastName: attr("sn"),
    email: attr("mail"),
    phone: attr("telephoneNumber"),
    mobile: attr("mobile"),
    company: attr("company"),
    department: attr("department"),
    description: attr("description"),
  };
}
