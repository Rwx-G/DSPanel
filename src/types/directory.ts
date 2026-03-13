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
}

export function mapEntryToUser(entry: DirectoryEntry): DirectoryUser {
  const attr = (name: string): string => entry.attributes[name]?.[0] ?? "";

  const attrList = (name: string): string[] => entry.attributes[name] ?? [];

  const uac = parseInt(attr("userAccountControl") || "0", 10);

  return {
    distinguishedName: entry.distinguishedName,
    samAccountName: entry.samAccountName ?? "",
    displayName: entry.displayName ?? attr("displayName"),
    givenName: attr("givenName"),
    surname: attr("sn"),
    email: attr("mail"),
    department: attr("department"),
    title: attr("title"),
    organizationalUnit: parseOuFromDn(entry.distinguishedName),
    enabled: (uac & 0x0002) === 0,
    lockedOut: attr("lockoutTime") !== "" && attr("lockoutTime") !== "0",
    accountExpires: attr("accountExpires") || null,
    passwordLastSet: attr("pwdLastSet") || null,
    passwordExpired: (uac & 0x800000) !== 0,
    passwordNeverExpires: (uac & 0x10000) !== 0,
    lastLogon: attr("lastLogon") || null,
    lastLogonWorkstation: attr("lastLogonWorkstation"),
    badPasswordCount: parseInt(attr("badPwdCount") || "0", 10),
    whenCreated: attr("whenCreated"),
    whenChanged: attr("whenChanged"),
    memberOf: attrList("memberOf"),
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

function parseOuFromDn(dn: string): string {
  const parts = dn.split(",");
  const ous = parts
    .filter((p) => p.trim().toUpperCase().startsWith("OU="))
    .map((p) => p.trim().substring(3));
  return ous.reverse().join(" > ");
}
