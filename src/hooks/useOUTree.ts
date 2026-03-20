import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type OUNode } from "@/components/form/OUPicker";
import { useErrorHandler } from "@/hooks/useErrorHandler";

interface UseOUTreeReturn {
  nodes: OUNode[];
  loading: boolean;
  error: boolean;
  reload: () => void;
}

/**
 * @param options.silent - When true, errors are captured but not shown as toaster notifications.
 *   The OUPicker component already displays an inline error state.
 */
export function useOUTree(options?: { silent?: boolean }): UseOUTreeReturn {
  const [nodes, setNodes] = useState<OUNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const { handleError } = useErrorHandler();
  const silent = options?.silent ?? false;

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const tree = await invoke<OUNode[]>("get_ou_tree");
      setNodes(tree);
    } catch (err) {
      setError(true);
      if (!silent) {
        handleError(err, "loading OU tree");
      }
    } finally {
      setLoading(false);
    }
  }, [handleError, silent]);

  useEffect(() => {
    load();
  }, [load]);

  return { nodes, loading, error, reload: load };
}
