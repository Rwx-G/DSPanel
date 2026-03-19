export interface DirectoryEntry {
  distinguishedName: string;
  samAccountName: string | null;
  displayName: string | null;
  objectClass: string | null;
  attributes: Record<string, string[]>;
}

export interface DirectoryUser {
  distinguishedName: string;
  samAccountName: string;
  displayName: string;
  userPrincipalName: string;
  givenName: string;
  surname: string;
  email: string;
  department: string;
  title: string;
  organizationalUnit: string;
  enabled: boolean;
  lockedOut: boolean;
  accountExpires: string | null;
  passwordLastSet: string | null;
  passwordExpired: boolean;
  passwordNeverExpires: boolean;
  lastLogon: string | null;
  lastLogonWorkstation: string;
  badPasswordCount: number;
  whenCreated: string;
  whenChanged: string;
  memberOf: string[];
  rawAttributes: Record<string, string[]>;
}

/** Default empty rawAttributes for test helpers that build DirectoryUser manually. */
export const EMPTY_RAW_ATTRIBUTES: Record<string, string[]> = {};

/**
 * Converts a Windows FILETIME (100ns ticks since 1601-01-01) to a readable date string.
 * Returns "Never" for special values (0, max int64) or null/empty input.
 */
function formatFiletime(value: string | null): string | null {
  if (!value || value === "0") return null;
  // 0x7FFFFFFFFFFFFFFF = "never expires" sentinel
  if (value === "9223372036854775807") return "Never";
  const ticks = BigInt(value);
  // FILETIME epoch offset: ticks between 1601-01-01 and 1970-01-01
  const epochOffset = BigInt("116444736000000000");
  const ms = Number((ticks - epochOffset) / BigInt(10000));
  if (ms < 0 || !isFinite(ms)) return null;
  const d = new Date(ms);
  return d.toISOString().replace("T", " ").substring(0, 19);
}

/**
 * Formats AD generalized time (e.g. "20260319114721.0Z") to a readable date string.
 */
function formatGeneralizedTime(value: string): string {
  if (!value) return "";
  // Format: YYYYMMDDHHmmss.0Z
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/,
  );
  if (!match) return value;
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

export function mapEntryToUser(entry: DirectoryEntry): DirectoryUser {
  const attr = (name: string): string => entry.attributes[name]?.[0] ?? "";

  const attrList = (name: string): string[] => entry.attributes[name] ?? [];

  const uac = parseInt(attr("userAccountControl") || "0", 10);

  return {
    distinguishedName: entry.distinguishedName,
    samAccountName: entry.samAccountName ?? "",
    displayName: entry.displayName ?? attr("displayName"),
    userPrincipalName: attr("userPrincipalName"),
    givenName: attr("givenName"),
    surname: attr("sn"),
    email: attr("mail"),
    department: attr("department"),
    title: attr("title"),
    organizationalUnit: parseOuFromDn(entry.distinguishedName),
    enabled: (uac & 0x0002) === 0,
    lockedOut: attr("lockoutTime") !== "" && attr("lockoutTime") !== "0",
    accountExpires: formatFiletime(attr("accountExpires") || null),
    passwordLastSet: formatFiletime(attr("pwdLastSet") || null),
    passwordExpired: (uac & 0x800000) !== 0,
    passwordNeverExpires: (uac & 0x10000) !== 0,
    lastLogon: formatFiletime(attr("lastLogon") || null),
    lastLogonWorkstation: attr("lastLogonWorkstation"),
    badPasswordCount: parseInt(attr("badPwdCount") || "0", 10),
    whenCreated: formatGeneralizedTime(attr("whenCreated")),
    whenChanged: formatGeneralizedTime(attr("whenChanged")),
    memberOf: attrList("memberOf"),
    rawAttributes: entry.attributes,
  };
}

export interface DirectoryComputer {
  distinguishedName: string;
  name: string;
  dnsHostName: string;
  operatingSystem: string;
  osVersion: string;
  lastLogon: string | null;
  organizationalUnit: string;
  enabled: boolean;
  memberOf: string[];
}

export function mapEntryToComputer(entry: DirectoryEntry): DirectoryComputer {
  const attr = (name: string): string => entry.attributes[name]?.[0] ?? "";
  const attrList = (name: string): string[] => entry.attributes[name] ?? [];
  const uac = parseInt(attr("userAccountControl") || "0", 10);

  return {
    distinguishedName: entry.distinguishedName,
    name: entry.displayName ?? entry.samAccountName?.replace(/\$$/, "") ?? "",
    dnsHostName: attr("dNSHostName"),
    operatingSystem: attr("operatingSystem"),
    osVersion: attr("operatingSystemVersion"),
    lastLogon: attr("lastLogon") || null,
    organizationalUnit: parseOuFromDn(entry.distinguishedName),
    enabled: (uac & 0x0002) === 0,
    memberOf: attrList("memberOf"),
  };
}

export interface DirectoryGroup {
  distinguishedName: string;
  samAccountName: string;
  displayName: string;
  description: string;
  scope: "Global" | "DomainLocal" | "Universal" | "Unknown";
  category: "Security" | "Distribution";
  memberCount: number;
  organizationalUnit: string;
}

export function parseGroupScope(groupType: number): DirectoryGroup["scope"] {
  if (groupType & 0x2) return "Global";
  if (groupType & 0x4) return "DomainLocal";
  if (groupType & 0x8) return "Universal";
  return "Unknown";
}

export function parseGroupCategory(
  groupType: number,
): DirectoryGroup["category"] {
  return (groupType & 0x80000000) !== 0 ? "Security" : "Distribution";
}

export function mapEntryToGroup(entry: DirectoryEntry): DirectoryGroup {
  const attr = (name: string): string => entry.attributes[name]?.[0] ?? "";
  const groupType = parseInt(attr("groupType") || "0", 10);
  const members = entry.attributes["member"] ?? [];

  return {
    distinguishedName: entry.distinguishedName,
    samAccountName: entry.samAccountName ?? "",
    displayName:
      entry.displayName || attr("cn") || parseCnFromDn(entry.distinguishedName),
    description: attr("description"),
    scope: parseGroupScope(groupType),
    category: parseGroupCategory(groupType),
    memberCount: members.length,
    organizationalUnit: parseOuFromDn(entry.distinguishedName),
  };
}

function parseCnFromDn(dn: string): string {
  if (!dn) return "";
  const match = dn.match(/^CN=([^,]+)/i);
  return match ? match[1] : dn;
}

function parseOuFromDn(dn: string): string {
  const parts = dn.split(",");
  const ous = parts
    .filter((p) => p.trim().toUpperCase().startsWith("OU="))
    .map((p) => p.trim().substring(3));
  return ous.reverse().join(" > ");
}
