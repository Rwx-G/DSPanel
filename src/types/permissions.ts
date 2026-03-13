export type PermissionLevel =
  | "ReadOnly"
  | "HelpDesk"
  | "AccountOperator"
  | "DomainAdmin";

export const PERMISSION_LEVELS: PermissionLevel[] = [
  "ReadOnly",
  "HelpDesk",
  "AccountOperator",
  "DomainAdmin",
];

export function permissionIndex(level: PermissionLevel): number {
  return PERMISSION_LEVELS.indexOf(level);
}

export function hasPermissionLevel(
  current: PermissionLevel,
  required: PermissionLevel,
): boolean {
  return permissionIndex(current) >= permissionIndex(required);
}
