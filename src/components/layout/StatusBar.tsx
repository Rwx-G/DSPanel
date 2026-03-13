import { Circle } from "lucide-react";

export interface StatusBarProps {
  domainName: string | null;
  domainController: string | null;
  permissionLevel: string;
  isConnected: boolean;
  appVersion: string;
}

export function StatusBar({
  domainName,
  domainController,
  permissionLevel,
  isConnected,
  appVersion,
}: StatusBarProps) {
  const connectionColor = isConnected
    ? "text-[var(--color-success)]"
    : "text-[var(--color-error)]";

  return (
    <footer
      className="flex h-7 items-center justify-between border-t border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 text-caption text-[var(--color-text-secondary)]"
      data-testid="status-bar"
    >
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Circle size={8} className={connectionColor} fill="currentColor" />
          <span data-testid="status-connection">
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </span>

        {domainName && <span data-testid="status-domain">{domainName}</span>}

        {domainController && (
          <span data-testid="status-dc">{domainController}</span>
        )}

        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            backgroundColor: `var(--color-perm-${permissionLevel.toLowerCase()})`,
            color: "var(--color-text-inverse)",
          }}
          data-testid="status-permission"
        >
          {permissionLevel}
        </span>
      </div>

      <span data-testid="status-version">v{appVersion}</span>
    </footer>
  );
}
