import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

export function About() {
  const { t } = useTranslation(["about", "common"]);

  return (
    <div className="space-y-4 p-4" data-testid="about-page">
      <div className="space-y-2 text-center">
        <h2 className="text-heading font-bold text-[var(--color-text-primary)]">DSPanel</h2>
        <p className="text-body text-[var(--color-text-secondary)]">
          {t("subtitle")}
        </p>
        <p
          className="text-caption text-[var(--color-text-secondary)]"
          data-testid="about-version"
        >
          {t("common:version")} {__APP_VERSION__}
        </p>
      </div>

      <div className="space-y-2 rounded-md bg-[var(--color-surface-hover)] p-3">
        <div className="flex justify-between text-caption">
          <span className="text-[var(--color-text-secondary)]">{t("license")}</span>
          <span className="text-[var(--color-text-primary)]">Apache-2.0</span>
        </div>
        <div className="flex justify-between text-caption">
          <span className="text-[var(--color-text-secondary)]">{t("author")}</span>
          <span className="text-[var(--color-text-primary)]">Rwx-G</span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <a
          href="https://github.com/Rwx-G/DSPanel"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-caption text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          data-testid="about-github-link"
        >
          <ExternalLink size={14} />
          {t("githubRepository")}
        </a>
        <a
          href="https://github.com/Rwx-G/DSPanel/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-caption text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          data-testid="about-releases-link"
        >
          <ExternalLink size={14} />
          {t("releasesChangelog")}
        </a>
      </div>
    </div>
  );
}
