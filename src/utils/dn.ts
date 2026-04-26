/**
 * Parses OU components from a Distinguished Name and returns them
 * as a breadcrumb-friendly array in hierarchical order (top-down).
 *
 * Example:
 *   "CN=John Doe,OU=Engineering,OU=Departments,DC=corp,DC=local"
 *   -> ["Departments", "Engineering"]
 */
export function parseOuBreadcrumb(dn: string): string[] {
  if (!dn) return [];

  const parts = dn.split(",");
  const ous = parts
    .filter((p) => p.trim().toUpperCase().startsWith("OU="))
    .map((p) => p.trim().substring(3));

  return ous.reverse();
}

/**
 * Extracts the CN (Common Name) from a Distinguished Name.
 *
 * Example:
 *   "CN=Domain Admins,CN=Users,DC=corp,DC=local"
 *   -> "Domain Admins"
 */
export function parseCnFromDn(dn: string): string {
  if (!dn) return "";
  const match = dn.match(/^CN=([^,]+)/i);
  return match ? match[1] : dn;
}

/**
 * Formats a full DN as a readable OU path string.
 *
 * Example:
 *   "CN=John Doe,OU=Engineering,OU=Departments,DC=corp,DC=local"
 *   -> "Departments > Engineering"
 */
export function formatOuPath(dn: string): string {
  return parseOuBreadcrumb(dn).join(" > ");
}

/**
 * Detects whether a DN refers to a Foreign Security Principal entry,
 * and returns the SID encoded in the leaf RDN if so.
 *
 * AD stores SIDs from trusted external domains as objects under
 * `CN=ForeignSecurityPrincipals,<domain>` with the literal SID string as
 * their RDN. They appear in `member` attributes by their full DN, which
 * leaves the UI showing `CN=S-1-5-...,CN=ForeignSecurityPrincipals,...`
 * strings instead of resolved names.
 *
 * Mirrors the Rust helper `extract_foreign_sid_from_dn` in
 * `src-tauri/src/services/ldap_directory.rs`.
 */
export function extractForeignSidFromDn(dn: string): string | null {
  if (!dn) return null;
  const lower = dn.toLowerCase();
  if (!lower.includes(",cn=foreignsecurityprincipals,")) return null;
  const firstRdn = dn.split(",")[0]?.trim() ?? "";
  const value = firstRdn.replace(/^cn=/i, "");
  if (value === firstRdn) return null;
  if (!value.toUpperCase().startsWith("S-1-")) return null;
  return value;
}
