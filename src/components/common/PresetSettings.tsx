import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen } from "lucide-react";
import { usePresetPath } from "@/hooks/usePresetPath";

/**
 * Preset storage path configuration section.
 *
 * Allows the user to configure and validate the network share path
 * where preset JSON files are stored. Designed to be embedded in
 * a Settings page or displayed as a standalone configuration panel.
 */
interface PresetSettingsProps {
  /** Called after the path is successfully saved. */
  onSaved?: () => void;
}

export function PresetSettings({ onSaved }: PresetSettingsProps = {}) {
  const { path, loading, valid, setPath, testPath } = usePresetPath();
  const [inputPath, setInputPath] = useState(path ?? "");
  const [testResult, setTestResult] = useState<boolean | null>(null);

  // Sync input when path loads from backend
  if (path !== null && inputPath === "" && path !== "") {
    setInputPath(path);
  }

  const handleTest = async () => {
    setTestResult(null);
    const result = await testPath(inputPath);
    setTestResult(result);
  };

  const handleSave = async () => {
    setTestResult(null);
    const success = await setPath(inputPath);
    if (success) {
      onSaved?.();
    }
  };

  return (
    <div
      className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4"
      data-testid="preset-settings"
    >
      <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
        Preset Storage Path
      </h3>
      <p className="mb-3 text-caption text-[var(--color-text-secondary)]">
        Configure the network share or local directory where preset JSON files
        are stored. All DSPanel instances sharing this path will see the same
        presets.
      </p>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={inputPath}
          onChange={(e) => {
            setInputPath(e.target.value);
            setTestResult(null);
          }}
          placeholder={"\\\\server\\share\\presets or C:\\presets"
          }
          className="flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none"
          data-testid="preset-path-input"
          disabled={loading}
        />
        <button
          onClick={async () => {
            const picked = await invoke<string | null>("pick_folder_dialog");
            if (picked) {
              setInputPath(picked);
              setTestResult(null);
            }
          }}
          disabled={loading}
          className="btn btn-sm btn-outline"
          title="Browse for folder"
          data-testid="preset-path-browse"
        >
          <FolderOpen size={14} />
        </button>
        <button
          onClick={handleTest}
          disabled={loading || !inputPath.trim()}
          className="btn btn-sm btn-secondary"
          data-testid="preset-path-test"
        >
          Test
        </button>
        <button
          onClick={handleSave}
          disabled={loading || !inputPath.trim()}
          className="btn btn-sm btn-primary"
          data-testid="preset-path-save"
        >
          Save
        </button>
      </div>

      {/* Status feedback */}
      {testResult !== null && (
        <div
          className={`mt-2 text-caption ${testResult ? "text-[var(--color-success)]" : "text-[var(--color-error)]"}`}
          data-testid="preset-path-status"
        >
          {testResult
            ? "Path is accessible and valid."
            : "Path is not accessible. Please check the path and permissions."}
        </div>
      )}

      {valid === true && testResult === null && path && (
        <div
          className="mt-2 text-caption text-[var(--color-success)]"
          data-testid="preset-path-configured"
        >
          Currently configured: {path}
        </div>
      )}

      {valid === false && testResult === null && (
        <div
          className="mt-2 text-caption text-[var(--color-error)]"
          data-testid="preset-path-error"
        >
          Failed to configure path. Please check the path and try again.
        </div>
      )}
    </div>
  );
}
