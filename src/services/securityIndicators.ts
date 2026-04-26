import { invoke } from "@tauri-apps/api/core";
import type { DirectoryUser, DirectoryComputer } from "@/types/directory";
import type { SecurityIndicatorSet } from "@/types/securityIndicators";

/**
 * Input sent to the Rust `evaluate_user_security_indicators` Tauri command.
 * Mirrors the Rust `UserIndicatorInput` struct (camelCase via serde rename_all).
 */
interface UserIndicatorInput {
  userAccountControl: number;
  servicePrincipalNames: string[];
  adminCount: number | null;
}

/**
 * Extracts the security-indicator-relevant fields from a DirectoryUser. The
 * raw `userAccountControl`, `servicePrincipalName`, and `adminCount` attributes
 * are read directly from `rawAttributes` because `DirectoryUser` does not
 * surface the raw UAC integer (only derived booleans), and SPNs / adminCount
 * are not on the typed struct at all.
 */
function toUserIndicatorInput(user: DirectoryUser): UserIndicatorInput {
  const uacRaw = user.rawAttributes?.["userAccountControl"]?.[0] ?? "0";
  const userAccountControl = Number.parseInt(uacRaw, 10) || 0;
  const servicePrincipalNames =
    user.rawAttributes?.["servicePrincipalName"] ?? [];
  const adminCountRaw = user.rawAttributes?.["adminCount"]?.[0];
  const adminCount =
    adminCountRaw !== undefined ? Number.parseInt(adminCountRaw, 10) : null;

  return {
    userAccountControl,
    servicePrincipalNames,
    adminCount: Number.isFinite(adminCount) ? adminCount : null,
  };
}

/**
 * Evaluates per-object security indicators for a user via the Rust backend.
 */
export async function evaluateUserSecurityIndicators(
  user: DirectoryUser,
): Promise<SecurityIndicatorSet> {
  return invoke<SecurityIndicatorSet>("evaluate_user_security_indicators", {
    input: toUserIndicatorInput(user),
  });
}

/**
 * Batch-evaluates indicators for many users in a single IPC call. Returns a
 * Map keyed by samAccountName for O(1) lookup at render time.
 */
export async function evaluateUserSecurityIndicatorsBatch(
  users: DirectoryUser[],
): Promise<Map<string, SecurityIndicatorSet>> {
  const inputs = users.map(toUserIndicatorInput);
  const results = await invoke<SecurityIndicatorSet[]>(
    "evaluate_user_security_indicators_batch",
    { inputs },
  );
  const map = new Map<string, SecurityIndicatorSet>();
  users.forEach((user, i) => {
    map.set(user.samAccountName, results[i]);
  });
  return map;
}

// ---------------------------------------------------------------------------
// Computer side (Story 14.3)
// ---------------------------------------------------------------------------

/**
 * Input sent to the Rust `evaluate_computer_security_indicators` Tauri command.
 * Mirrors the Rust `ComputerIndicatorInput` struct (camelCase via serde rename_all).
 */
interface ComputerIndicatorInput {
  userAccountControl: number;
  allowedToDelegateTo: string[];
  /** Base64-encoded RBCD security descriptor blob, or null when absent. */
  allowedToActOnBehalfOfB64: string | null;
}

/**
 * Extracts the security-indicator-relevant fields from a DirectoryComputer.
 * Reads raw `userAccountControl`, `msDS-AllowedToDelegateTo`, and the
 * base64-encoded `msDS-AllowedToActOnBehalfOfOtherIdentity` blob from
 * `rawAttributes`. The base64 surfacing of the binary RBCD attribute is done
 * server-side by `BINARY_ATTRS_TO_SURFACE` in the LDAP provider (Story 14.1).
 */
function toComputerIndicatorInput(
  computer: DirectoryComputer,
): ComputerIndicatorInput {
  const uacRaw = computer.rawAttributes?.["userAccountControl"]?.[0] ?? "0";
  const userAccountControl = Number.parseInt(uacRaw, 10) || 0;
  const allowedToDelegateTo =
    computer.rawAttributes?.["msDS-AllowedToDelegateTo"] ?? [];
  const allowedToActOnBehalfOfB64 =
    computer.rawAttributes?.["msDS-AllowedToActOnBehalfOfOtherIdentity"]?.[0] ??
    null;

  return {
    userAccountControl,
    allowedToDelegateTo,
    allowedToActOnBehalfOfB64,
  };
}

/** Evaluates per-object security indicators for a computer via the Rust backend. */
export async function evaluateComputerSecurityIndicators(
  computer: DirectoryComputer,
): Promise<SecurityIndicatorSet> {
  return invoke<SecurityIndicatorSet>("evaluate_computer_security_indicators", {
    input: toComputerIndicatorInput(computer),
  });
}

/**
 * Batch-evaluates indicators for many computers in a single IPC call. Returns a
 * Map keyed by `distinguishedName` (computers do not have a guaranteed
 * samAccountName the way users do).
 */
export async function evaluateComputerSecurityIndicatorsBatch(
  computers: DirectoryComputer[],
): Promise<Map<string, SecurityIndicatorSet>> {
  const inputs = computers.map(toComputerIndicatorInput);
  const results = await invoke<SecurityIndicatorSet[]>(
    "evaluate_computer_security_indicators_batch",
    { inputs },
  );
  const map = new Map<string, SecurityIndicatorSet>();
  computers.forEach((computer, i) => {
    map.set(computer.distinguishedName, results[i]);
  });
  return map;
}
