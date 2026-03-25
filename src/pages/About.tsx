import { Info, ExternalLink } from "lucide-react";

export function About() {
  return (
    <div className="flex h-full flex-col gap-4 p-4" data-testid="about-page">
      <div className="flex items-center gap-2">
        <Info size={20} className="text-[var(--color-text-primary)]" />
        <h1 className="text-heading font-semibold text-[var(--color-text-primary)]">
          About DSPanel
        </h1>
      </div>

      <div className="max-w-lg space-y-4">
        <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-6">
          <div className="space-y-2 text-center">
            <h2 className="text-heading font-bold text-[var(--color-text-primary)]">DSPanel</h2>
            <p className="text-body text-[var(--color-text-secondary)]">
              Active Directory Management
            </p>
            <p
              className="text-caption text-[var(--color-text-secondary)]"
              data-testid="about-version"
            >
              Version {__APP_VERSION__}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
          <div className="space-y-2">
            <div className="flex justify-between text-caption">
              <span className="text-[var(--color-text-secondary)]">License</span>
              <span className="text-[var(--color-text-primary)]">Apache-2.0</span>
            </div>
            <div className="flex justify-between text-caption">
              <span className="text-[var(--color-text-secondary)]">Author</span>
              <span className="text-[var(--color-text-primary)]">Rwx-G</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
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
