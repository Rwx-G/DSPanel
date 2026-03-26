import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen } from "lucide-react";
import { usePresetPath } from "@/hooks/usePresetPath";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation(["components", "common"]);
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
        {t("components:presetSettings.title")}
      </h3>
      <p className="mb-3 text-caption text-[var(--color-text-secondary)]">
        {t("components:presetSettings.description")}
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
          className="group relative btn btn-sm btn-outline"
          data-testid="preset-path-browse"
        >
          <FolderOpen size={14} />
          <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--color-surface-elevated)] px-2.5 py-1.5 text-caption font-medium text-[var(--color-text-primary)] opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
            Browse for folder
          </span>
        </button>
        <button
          onClick={handleTest}
          disabled={loading || !inputPath.trim()}
          className="btn btn-sm btn-secondary"
          data-testid="preset-path-test"
        >
          {t("common:test")}
        </button>
        <button
          onClick={handleSave}
          disabled={loading || !inputPath.trim()}
          className="btn btn-sm btn-primary"
          data-testid="preset-path-save"
        >
          {t("common:save")}
        </button>
      </div>

      {/* Status feedback */}
      {testResult !== null && (
        <div
          className={`mt-2 text-caption ${testResult ? "text-[var(--color-success)]" : "text-[var(--color-error)]"}`}
          data-testid="preset-path-status"
        >
          {testResult
            ? t("components:presetSettings.pathValid")
            : t("components:presetSettings.pathInvalid")}
        </div>
      )}

      {valid === true && testResult === null && path && (
        <div
          className="mt-2 text-caption text-[var(--color-success)]"
          data-testid="preset-path-configured"
        >
          {t("components:presetSettings.currentlyConfigured", { path })}
        </div>
      )}

      {valid === false && testResult === null && (
        <div
          className="mt-2 text-caption text-[var(--color-error)]"
          data-testid="preset-path-error"
        >
          {t("components:presetSettings.configFailed")}
        </div>
      )}
    </div>
  );
}
