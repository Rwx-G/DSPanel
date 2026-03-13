import { type ReactNode } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { type PermissionLevel, hasPermissionLevel } from "@/types/permissions";

interface PermissionGateProps {
  requiredLevel: PermissionLevel;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGate({
  requiredLevel,
  children,
  fallback = null,
}: PermissionGateProps) {
  const { level } = usePermissions();

  if (hasPermissionLevel(level, requiredLevel)) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}
