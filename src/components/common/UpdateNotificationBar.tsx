import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Info, Download, X, SkipForward } from "lucide-react";

interface UpdateInfo {
  version: string;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string;
}

export function UpdateNotificationBar() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    invoke<UpdateInfo | null>("check_for_update")
      .then((info) => {
        if (info) {
          setUpdateInfo(info);
        }
      })
      .catch(() => {
        // Silent failure - do not show any error
      });
  }, []);

  const handleDownload = useCallback(async () => {
    if (updateInfo) {
      try {
        await openUrl(updateInfo.releaseUrl);
      } catch {
        // Fallback: try window.open
        window.open(updateInfo.releaseUrl, "_blank");
      }
    }
    setDismissed(true);
  }, [updateInfo]);

  const handleSkip = useCallback(async () => {
    if (updateInfo) {
      try {
        await invoke("skip_update_version", { version: updateInfo.version });
      } catch {
        // Non-critical
      }
    }
    setDismissed(true);
  }, [updateInfo]);

  const handleRemindLater = useCallback(() => {
    setDismissed(true);
  }, []);

  if (!updateInfo || dismissed) {
    return null;
  }

  return (
    <div
      className="flex items-center gap-3 border-b border-[var(--color-border-default)] bg-[var(--color-info-bg)] px-4 py-2 animate-in slide-in-from-top"
      data-testid="update-notification-bar"
    >
      <Info size={16} className="shrink-0 text-[var(--color-info)]" />
      <span className="flex-1 text-caption text-[var(--color-text-primary)]">
        <span className="font-medium">DSPanel v{updateInfo.version}</span> is available.
      </span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleDownload}
          className="btn btn-sm btn-primary flex items-center gap-1 px-2 py-1"
          data-testid="update-download-btn"
        >
          <Download size={12} /> Download
        </button>
        <button
          onClick={handleSkip}
          className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1 text-caption text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-1"
          data-testid="update-skip-btn"
        >
          <SkipForward size={12} /> Skip
        </button>
        <button
          onClick={handleRemindLater}
          className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors p-1"
          title="Remind me later"
          data-testid="update-remind-btn"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
