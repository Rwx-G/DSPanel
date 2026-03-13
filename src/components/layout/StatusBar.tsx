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
  return (
    <footer
      className="flex h-7 items-center justify-between border-t border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 text-caption text-[var(--color-text-secondary)]"
      data-testid="status-bar"
    >
      <div className="flex items-center gap-3">
        {/* Connection indicator with animated ping */}
        <span className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            {isConnected && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-success)] opacity-40" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${isConnected ? "bg-[var(--color-success)]" : "bg-[var(--color-error)]"}`}
            />
          </span>
          <span data-testid="status-connection">
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </span>

        {domainName && (
          <>
            <span className="h-3 w-px bg-[var(--color-border-default)]" />
            <span data-testid="status-domain">{domainName}</span>
          </>
        )}

        {domainController && (
          <>
            <span className="h-3 w-px bg-[var(--color-border-default)]" />
            <span data-testid="status-dc">{domainController}</span>
          </>
        )}

        <span className="h-3 w-px bg-[var(--color-border-default)]" />
        <span
          className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset"
          style={{
            backgroundColor: `color-mix(in srgb, var(--color-perm-${permissionLevel.toLowerCase()}) 15%, transparent)`,
            color: `var(--color-perm-${permissionLevel.toLowerCase()})`,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, var(--color-perm-${permissionLevel.toLowerCase()}) 30%, transparent)`,
          }}
          data-testid="status-permission"
        >
          {permissionLevel}
        </span>
      </div>

      <span
        className="text-[var(--color-text-disabled)]"
        data-testid="status-version"
      >
        v{appVersion}
      </span>
    </footer>
  );
}
