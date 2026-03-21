import { type DirectoryEntry } from "@/types/directory";

export interface PrinterInfo {
  dn: string;
  name: string;
  location: string;
  serverName: string;
  sharePath: string;
  driverName: string;
  description: string;
}

export function mapEntryToPrinter(entry: DirectoryEntry): PrinterInfo {
  const attr = (name: string): string => entry.attributes[name]?.[0] ?? "";
  return {
    dn: entry.distinguishedName,
    name: attr("printerName") || entry.displayName || entry.samAccountName || "",
    location: attr("location"),
    serverName: attr("serverName"),
    sharePath: attr("uNCName"),
    driverName: attr("driverName"),
    description: attr("description"),
  };
}
