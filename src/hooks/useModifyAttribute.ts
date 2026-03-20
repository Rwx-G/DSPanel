import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useErrorHandler } from "./useErrorHandler";

export interface PendingChange {
  attributeName: string;
  oldValue: string;
  newValue: string;
  /** Whether this change targets an advanced/raw attribute (higher risk). */
  advanced?: boolean;
}

export interface UseModifyAttributeReturn {
  /** List of pending changes not yet submitted. */
  pendingChanges: PendingChange[];
  /** Whether a modification is in progress. */
  saving: boolean;
  /** Stages a change for later submission. */
  stageChange: (attributeName: string, oldValue: string, newValue: string, advanced?: boolean) => void;
  /** Removes a staged change. */
  unstageChange: (attributeName: string) => void;
  /** Clears all staged changes. */
  clearChanges: () => void;
  /** Executes all staged changes against the backend. */
  submitChanges: (dn: string) => Promise<boolean>;
}

/**
 * Hook for staging and submitting attribute modifications on an AD object.
 *
 * Changes are staged locally and submitted in batch via `modify_attribute`
 * Tauri command. Each change is submitted individually and logged via audit.
 */
export function useModifyAttribute(): UseModifyAttributeReturn {
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [saving, setSaving] = useState(false);
  const { handleError } = useErrorHandler();

  const stageChange = useCallback(
    (attributeName: string, oldValue: string, newValue: string, advanced?: boolean) => {
      setPendingChanges((prev) => {
        const filtered = prev.filter((c) => c.attributeName !== attributeName);
        // Only add if value actually changed
        if (oldValue !== newValue) {
          return [...filtered, { attributeName, oldValue, newValue, advanced }];
        }
        return filtered;
      });
    },
    [],
  );

  const unstageChange = useCallback((attributeName: string) => {
    setPendingChanges((prev) =>
      prev.filter((c) => c.attributeName !== attributeName),
    );
  }, []);

  const clearChanges = useCallback(() => {
    setPendingChanges([]);
  }, []);

  const submitChanges = useCallback(
    async (dn: string): Promise<boolean> => {
      if (pendingChanges.length === 0) return true;

      setSaving(true);
      let allSuccess = true;

      for (const change of pendingChanges) {
        try {
          await invoke("modify_attribute", {
            dn,
            attributeName: change.attributeName,
            values: change.newValue ? [change.newValue] : [],
          });
        } catch (err) {
          handleError(err, `modifying ${change.attributeName}`);
          allSuccess = false;
        }
      }

      setSaving(false);

      if (allSuccess) {
        setPendingChanges([]);
      }

      return allSuccess;
    },
    [pendingChanges, handleError],
  );

  return {
    pendingChanges,
    saving,
    stageChange,
    unstageChange,
    clearChanges,
    submitChanges,
  };
}
