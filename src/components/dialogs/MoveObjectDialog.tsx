import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderInput } from "lucide-react";
import { DialogShell } from "@/components/dialogs/DialogShell";
import { OUPicker } from "@/components/form/OUPicker";
import { useOUTree } from "@/hooks/useOUTree";
import { parseCnFromDn, formatOuPath } from "@/utils/dn";
import { useErrorHandler } from "@/hooks/useErrorHandler";
import { useNotifications } from "@/contexts/NotificationContext";

export interface MoveTarget {
  distinguishedName: string;
  displayName?: string;
}

export interface BulkMoveResult {
  objectDn: string;
  success: boolean;
  error: string | null;
}

interface MoveObjectDialogProps {
  targets: MoveTarget[];
  onClose: () => void;
  onMoved?: () => void;
}

export function MoveObjectDialog({
  targets,
  onClose,
  onMoved,
}: MoveObjectDialogProps) {
  const [selectedOU, setSelectedOU] = useState<string | undefined>();
  const [step, setStep] = useState<"pick" | "preview" | "moving">("pick");
  const [moving, setMoving] = useState(false);
  const { nodes, loading, error } = useOUTree({ silent: true });
  const { handleError } = useErrorHandler();
  const { notify } = useNotifications();

  const isBulk = targets.length > 1;
  const title = isBulk
    ? `Move ${targets.length} Objects`
    : `Move ${targets[0]?.displayName || parseCnFromDn(targets[0]?.distinguishedName ?? "")}`;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !moving) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, moving]);

  const handleNext = useCallback(() => {
    if (selectedOU) {
      setStep("preview");
    }
  }, [selectedOU]);

  const handleExecute = useCallback(async () => {
    if (!selectedOU) return;
    setMoving(true);
    setStep("moving");

    try {
      if (isBulk) {
        const dns = targets.map((t) => t.distinguishedName);
        const results = await invoke<BulkMoveResult[]>("bulk_move_objects", {
          objectDns: dns,
          targetContainerDn: selectedOU,
        });
        const succeeded = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        if (failed > 0) {
          notify(
            `Moved ${succeeded} of ${results.length} objects. ${failed} failed.`,
            "warning",
          );
        } else {
          notify(`Successfully moved ${succeeded} object(s).`, "success");
        }
      } else {
        await invoke("move_object", {
          objectDn: targets[0].distinguishedName,
          targetContainerDn: selectedOU,
        });
        notify(
          `Moved ${targets[0].displayName || parseCnFromDn(targets[0].distinguishedName)} successfully.`,
          "success",
        );
      }
      onMoved?.();
      onClose();
    } catch (err) {
      handleError(err, "moving object(s)");
      setMoving(false);
      setStep("preview");
    }
  }, [selectedOU, targets, isBulk, onClose, onMoved, handleError, notify]);

  return (
    <DialogShell
      onClose={moving ? undefined : onClose}
      maxWidth="md"
      ariaLabelledBy="move-dialog-title"
      overlayTestId="move-dialog-overlay"
      dialogTestId="move-dialog"
    >
      <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
        <div className="flex items-center gap-2">
          <FolderInput
            size={16}
            className="text-[var(--color-text-secondary)]"
          />
          <h2
            id="move-dialog-title"
            className="text-body font-semibold text-[var(--color-text-primary)]"
            data-testid="move-dialog-title"
          >
            {title}
          </h2>
        </div>
      </div>

      {step === "pick" && (
        <>
          <div className="px-4 py-3">
            <p className="mb-3 text-caption text-[var(--color-text-secondary)]">
              Select the target Organizational Unit:
            </p>
            <OUPicker
              nodes={nodes}
              selectedOU={selectedOU}
              onSelect={setSelectedOU}
              loading={loading}
              error={error}
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-4 py-3">
            <button
              className="btn btn-sm"
              onClick={onClose}
              data-testid="move-cancel"
            >
              Cancel
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={handleNext}
              disabled={!selectedOU}
              data-testid="move-next"
            >
              Next
            </button>
          </div>
        </>
      )}

      {step === "preview" && selectedOU && (
        <>
          <div className="max-h-64 overflow-auto px-4 py-3">
            <p className="mb-2 text-caption text-[var(--color-text-secondary)]">
              The following object(s) will be moved:
            </p>
            {targets.map((target) => (
              <div
                key={target.distinguishedName}
                className="flex flex-col border-b border-[var(--color-border-subtle)] py-2 last:border-b-0"
                data-testid="move-preview-item"
              >
                <span className="text-body font-medium text-[var(--color-text-primary)]">
                  {target.displayName ||
                    parseCnFromDn(target.distinguishedName)}
                </span>
                <span className="text-caption text-[var(--color-text-secondary)]">
                  From: {formatOuPath(target.distinguishedName)}
                </span>
                <span className="text-caption text-[var(--color-info)]">
                  To: {formatOuPath(selectedOU)}
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-4 py-3">
            <button
              className="btn btn-sm"
              onClick={() => setStep("pick")}
              data-testid="move-back"
            >
              Back
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={handleExecute}
              data-testid="move-execute"
            >
              Move
            </button>
          </div>
        </>
      )}

      {step === "moving" && (
        <div className="flex items-center justify-center px-4 py-8">
          <div className="text-caption text-[var(--color-text-secondary)]">
            Moving object(s)...
          </div>
        </div>
      )}
    </DialogShell>
  );
}
