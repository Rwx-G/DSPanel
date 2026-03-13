import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  type PermissionLevel,
  hasPermissionLevel,
} from "@/types/permissions";

export function usePermissions() {
  const [level, setLevel] = useState<PermissionLevel>("ReadOnly");
  const [groups, setGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      invoke<PermissionLevel>("get_permission_level"),
      invoke<string[]>("get_user_groups"),
    ])
      .then(([permLevel, userGroups]) => {
        setLevel(permLevel);
        setGroups(userGroups);
      })
      .catch(() => {
        setLevel("ReadOnly");
        setGroups([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const hasPermission = useCallback(
    (required: PermissionLevel) => hasPermissionLevel(level, required),
    [level],
  );

  return { level, groups, loading, hasPermission };
}
