import { invoke } from "@tauri-apps/api/core";
import type { DirectoryUser } from "@/types/directory";
import type { AccountHealthStatus } from "@/types/health";

/**
 * Input sent to the Rust evaluate_health_cmd Tauri command.
 */
interface HealthInput {
  enabled: boolean;
  lockedOut: boolean;
  accountExpires: string | null;
  passwordLastSet: string | null;
  passwordExpired: boolean;
  passwordNeverExpires: boolean;
  lastLogon: string | null;
  whenCreated: string | null;
}

/**
 * Extracts the health-relevant fields from a DirectoryUser for the Rust command.
 */
function toHealthInput(user: DirectoryUser): HealthInput {
  return {
    enabled: user.enabled,
    lockedOut: user.lockedOut,
    accountExpires: user.accountExpires,
    passwordLastSet: user.passwordLastSet,
    passwordExpired: user.passwordExpired,
    passwordNeverExpires: user.passwordNeverExpires,
    lastLogon: user.lastLogon,
    whenCreated: user.whenCreated || null,
  };
}

/**
 * Evaluates the health status of a user account via the Rust backend.
 *
 * Calls the `evaluate_health_cmd` Tauri command which runs the health
 * evaluation logic in Rust with the current server time.
 */
export async function evaluateHealth(
  user: DirectoryUser,
): Promise<AccountHealthStatus> {
  return invoke<AccountHealthStatus>("evaluate_health_cmd", {
    input: toHealthInput(user),
  });
}
