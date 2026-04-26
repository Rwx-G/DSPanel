/**
 * Service Principal Name policy helpers (frontend mirror).
 *
 * Story 14.5 (Epic 14 - Security-Aware Admin) - Quick-Fix Remove Unused SPN.
 *
 * The TS prefix list MUST match the Rust list at
 * `src-tauri/src/services/spn.rs` SYSTEM_SPN_PREFIXES verbatim. Frontend
 * uses this guard to hide system SPNs from the selectable list in
 * ManageSpnsDialog so the operator cannot even attempt to remove them.
 * The backend enforces the same guard server-side as defense in depth -
 * a forged IPC call requesting a system SPN removal is filtered into
 * `blocked_system` regardless of what the UI sent.
 *
 * Conservative bias: false positives (a legitimate SPN we hide) just send
 * the operator to ADUC; false negatives (a system SPN we let through)
 * cause an outage. Conservative is correct.
 */
export const SYSTEM_SPN_PREFIXES: readonly string[] = [
  "host",
  "RestrictedKrbHost",
  "cifs",
  "ldap",
  "GC",
  "kadmin",
  "krbtgt",
  "wsman",
  "TERMSRV",
  "MSServerClusterMgmtAPI",
  "MSServerCluster",
  "DNS",
];

/**
 * Returns `true` when the SPN is system-protected and must not be offered
 * for removal in the UI.
 *
 * Splits on the first `/` and matches the prefix case-insensitively against
 * SYSTEM_SPN_PREFIXES. SPNs without a `/` are still checked against the
 * prefix list (conservative-bias: a malformed value equal to a system
 * prefix is flagged as system).
 */
export function isSystemSpn(spn: string): boolean {
  const prefix = spn.split("/", 1)[0];
  if (!prefix) return false;
  return SYSTEM_SPN_PREFIXES.some(
    (p) => p.toLowerCase() === prefix.toLowerCase(),
  );
}
