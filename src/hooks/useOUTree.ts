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

export function useOUTree(): UseOUTreeReturn {
  const [nodes, setNodes] = useState<OUNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const { handleError } = useErrorHandler();

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const tree = await invoke<OUNode[]>("get_ou_tree");
      setNodes(tree);
    } catch (err) {
      setError(true);
      handleError(err, "loading OU tree");
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    load();
  }, [load]);

  return { nodes, loading, error, reload: load };
}
