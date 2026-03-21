import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useErrorHandler } from "./useErrorHandler";
import type { Preset } from "@/types/preset";

export interface UsePresetsReturn {
  /** All loaded presets. */
  presets: Preset[];
  /** Whether presets are currently being loaded. */
  loading: boolean;
  /** Error message, if any. */
  error: string | null;
  /** Saves a preset (create or update). */
  savePreset: (preset: Preset) => Promise<boolean>;
  /** Deletes a preset by name. */
  deletePreset: (name: string) => Promise<boolean>;
  /** Accepts a preset whose checksum has changed (acknowledges external modification). */
  acceptChecksum: (name: string) => Promise<boolean>;
  /** Reloads the preset list from backend. */
  reload: () => void;
}

/**
 * Hook for managing presets (list, save, delete).
 *
 * Wraps the `list_presets`, `save_preset`, and `delete_preset` Tauri commands.
 * Listens for `presets_changed` events to auto-refresh when presets are
 * modified externally (e.g., by another DSPanel instance).
 */
export function usePresets(): UsePresetsReturn {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { handleError } = useErrorHandler();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<Preset[]>("list_presets");
      setPresets(result);
    } catch (err) {
      handleError(err, "loading presets");
      setError("Failed to load presets");
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    load();
  }, [load]);

  // Listen for external changes (file watcher events from backend)
  useEffect(() => {
    const unlisten = listen("presets_changed", () => {
      load();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [load]);

  const savePreset = useCallback(
    async (preset: Preset): Promise<boolean> => {
      try {
        await invoke("save_preset", { preset });
        await load();
        return true;
      } catch (err) {
        handleError(err, "saving preset");
        return false;
      }
    },
    [handleError, load],
  );

  const deletePreset = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        await invoke("delete_preset", { name });
        await load();
        return true;
      } catch (err) {
        handleError(err, "deleting preset");
        return false;
      }
    },
    [handleError, load],
  );

  const acceptChecksum = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        await invoke("accept_preset_checksum", { name });
        await load();
        return true;
      } catch (err) {
        handleError(err, "accepting preset checksum");
        return false;
      }
    },
    [handleError, load],
  );

  return { presets, loading, error, savePreset, deletePreset, acceptChecksum, reload: load };
}
