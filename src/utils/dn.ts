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
