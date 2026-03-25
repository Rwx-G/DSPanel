import { X, ExternalLink } from "lucide-react";

interface AboutDialogProps {
  version: string;
  onClose: () => void;
}

export function AboutDialog({ version, onClose }: AboutDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="about-dialog-overlay"
    >
      <div
        className="w-96 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] shadow-xl"
        data-testid="about-dialog"
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-3">
          <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
            About DSPanel
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            data-testid="about-dialog-close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className="text-center">
            <h3 className="text-heading font-bold text-[var(--color-text-primary)]">DSPanel</h3>
            <p className="text-body text-[var(--color-text-secondary)]">
              Active Directory Management
            </p>
            <p
              className="mt-1 text-caption text-[var(--color-text-secondary)]"
              data-testid="about-version"
            >
              Version {version}
            </p>
          </div>

          <div className="space-y-2 rounded-md bg-[var(--color-surface-card)] p-3">
            <div className="flex justify-between text-caption">
              <span className="text-[var(--color-text-secondary)]">License</span>
              <span className="text-[var(--color-text-primary)]">Apache-2.0</span>
            </div>
            <div className="flex justify-between text-caption">
              <span className="text-[var(--color-text-secondary)]">Author</span>
              <span className="text-[var(--color-text-primary)]">Rwx-G</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <a
              href="https://github.com/Rwx-G/DSPanel"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-caption text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
              data-testid="about-github-link"
            >
              <ExternalLink size={14} />
              GitHub Repository
            </a>
            <a
              href="https://github.com/Rwx-G/DSPanel/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-caption text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
              data-testid="about-releases-link"
            >
              <ExternalLink size={14} />
              Releases & Changelog
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
