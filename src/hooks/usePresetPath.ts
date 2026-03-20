import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useErrorHandler } from "./useErrorHandler";

export interface UsePresetPathReturn {
  /** Currently configured preset storage path, or null if not set. */
  path: string | null;
  /** Whether the path is currently being loaded or set. */
  loading: boolean;
  /** Whether the last test/set operation succeeded. */
  valid: boolean | null;
  /** Sets and validates the preset storage path. */
  setPath: (path: string) => Promise<boolean>;
  /** Tests whether a path is accessible without persisting it. */
  testPath: (path: string) => Promise<boolean>;
  /** Reloads the current path from backend. */
  reload: () => void;
}

/**
 * Hook for managing the preset storage path configuration.
 *
 * Wraps the `get_preset_path`, `set_preset_path`, and `test_preset_path`
 * Tauri commands with React state management.
 */
export function usePresetPath(): UsePresetPathReturn {
  const [path, setPathState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [valid, setValid] = useState<boolean | null>(null);
  const { handleError } = useErrorHandler();

  const load = useCallback(async () => {
    try {
      const result = await invoke<string | null>("get_preset_path");
      setPathState(result);
      setValid(result !== null ? true : null);
    } catch (err) {
      handleError(err, "loading preset path");
    }
  }, [handleError]);

  useEffect(() => {
    load();
  }, [load]);

  const setPath = useCallback(
    async (newPath: string): Promise<boolean> => {
      setLoading(true);
      try {
        await invoke("set_preset_path", { path: newPath });
        setPathState(newPath);
        setValid(true);
        return true;
      } catch (err) {
        handleError(err, "setting preset path");
        setValid(false);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [handleError],
  );

  const testPath = useCallback(
    async (testPathStr: string): Promise<boolean> => {
      setLoading(true);
      try {
        const result = await invoke<boolean>("test_preset_path", {
          path: testPathStr,
        });
        setValid(result);
        return result;
      } catch (err) {
        handleError(err, "testing preset path");
        setValid(false);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [handleError],
  );

  return { path, loading, valid, setPath, testPath, reload: load };
}
