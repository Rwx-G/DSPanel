import { vi } from "vitest";
import {
  type PermissionLevel,
  hasPermissionLevel,
} from "@/types/permissions";

/**
 * Helper for vitest tests that need to control the `usePermissions` hook
 * return value per-test. Replaces the per-test boilerplate:
 *
 * ```ts
 * const permMod = await import("@/hooks/usePermissions");
 * vi.spyOn(permMod, "usePermissions").mockReturnValue({
 *   hasPermission: () => true,
 *   level: "AccountOperator" as PermissionLevel,
 *   groups: [],
 *   loading: false,
 * });
 * ```
 *
 * with a single line:
 *
 * ```ts
 * await mockPermissionLevel("AccountOperator");
 * ```
 *
 * `hasPermission(required)` follows the real project hierarchy
 * (ReadOnly < HelpDesk < AccountOperator < Admin < DomainAdmin) via
 * `hasPermissionLevel` so tests asserting "Admin can do X but
 * AccountOperator cannot" work correctly without per-call setup.
 *
 * Tracked as QA-14.6-003 in the Epic 14 backlog.
 */
export async function mockPermissionLevel(
  level: PermissionLevel,
  options: {
    /** Override `groups` (default: `[]`). */
    groups?: string[];
    /** Override `loading` (default: `false`). */
    loading?: boolean;
  } = {},
): Promise<void> {
  const permMod = await import("@/hooks/usePermissions");
  vi.spyOn(permMod, "usePermissions").mockReturnValue({
    hasPermission: (required: PermissionLevel) =>
      hasPermissionLevel(level, required),
    level,
    groups: options.groups ?? [],
    loading: options.loading ?? false,
  });
}
