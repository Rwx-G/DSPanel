import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type AppStatus } from "@/App";
import { usePlatform } from "@/hooks/usePlatform";
import { MfaSetupDialog } from "@/components/dialogs/MfaSetupDialog";
import {
  Shield,
  ShieldCheck,
  Wifi,
  WifiOff,
  User,
  Globe,
  KeyRound,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface HomePageProps {
  status: AppStatus;
}

const PERM_COLORS: Record<string, string> = {
  ReadOnly: "var(--color-perm-readonly)",
  HelpDesk: "var(--color-perm-helpdesk)",
  AccountOperator: "var(--color-perm-accountops)",
  Admin: "var(--color-perm-domainadmin)",
  DomainAdmin: "var(--color-perm-domainadmin)",
};

const PLATFORM_LABELS: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
};

function formatPlatform(platform: string): string {
  if (!platform) return "...";
  return PLATFORM_LABELS[platform] ?? platform;
}

export function HomePage({ status }: HomePageProps) {
  const { t } = useTranslation(["home", "common"]);
  const platform = usePlatform();

  const PERM_LABELS: Record<string, string> = {
    ReadOnly: t("readOnly"),
    HelpDesk: t("helpDesk"),
    AccountOperator: t("accountOperator"),
    Admin: t("admin"),
    DomainAdmin: t("domainAdmin"),
  };

  const permColor = PERM_COLORS[status.permissionLevel] ?? PERM_COLORS.ReadOnly;
  const permLabel = PERM_LABELS[status.permissionLevel] ?? PERM_LABELS.ReadOnly;
  const [mfaConfigured, setMfaConfigured] = useState(false);
  const [showMfaSetup, setShowMfaSetup] = useState(false);

  const refreshMfaStatus = useCallback(() => {
    invoke<boolean>("mfa_is_configured")
      .then(setMfaConfigured)
      .catch(() => setMfaConfigured(false));
  }, []);

  useEffect(() => {
    refreshMfaStatus();
  }, [refreshMfaStatus]);

  const handleMfaRevoke = useCallback(async () => {
    await invoke("mfa_revoke");
    refreshMfaStatus();
  }, [refreshMfaStatus]);

  return (
    <div className="h-full overflow-y-auto p-6" data-testid="main-content">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-primary-subtle)]">
            <Shield size={24} className="text-[var(--color-primary)]" />
          </div>
          <div>
            <h1 className="text-h2 text-[var(--color-text-primary)]">
              {t("dashboard")}
            </h1>
            <p className="text-caption text-[var(--color-text-secondary)]">
              DSPanel v{status.appVersion}
            </p>
          </div>
        </div>

        {/* Cards grid */}
        <div className="grid grid-cols-2 gap-4">
          {/* Connection Status */}
          <DashboardCard
            icon={
              status.isConnected ? <Wifi size={18} /> : <WifiOff size={18} />
            }
            title={t("activeDirectory")}
            iconColor={
              status.isConnected ? "var(--color-success)" : "var(--color-error)"
            }
          >
            <StatusRow
              label={t("common:status")}
              value={status.isConnected ? t("common:connected") : t("common:disconnected")}
              valueColor={
                status.isConnected
                  ? "var(--color-success)"
                  : "var(--color-error)"
              }
            />
            <StatusRow label={t("common:domain")} value={status.domainName ?? t("common:na")} />
          </DashboardCard>

          {/* Current Session */}
          <DashboardCard
            icon={<User size={18} />}
            title={t("currentSession")}
            iconColor="var(--color-primary)"
          >
            <StatusRow label="User" value={status.username || "..."} />
            <StatusRow label="Computer" value={status.computerName || "..."} />
          </DashboardCard>

          {/* Permissions */}
          <DashboardCard
            icon={<KeyRound size={18} />}
            title={t("permissions")}
            iconColor={permColor}
          >
            <StatusRow
              label={t("authenticatedAs")}
              value={status.authenticatedUser || status.username || "..."}
            />
            <StatusRow
              label={t("level")}
              value={permLabel}
              valueColor={permColor}
            />
            <StatusRow
              label={t("domainJoined")}
              value={status.domainName ? t("common:yes") : t("common:no")}
              valueColor={
                status.domainName
                  ? "var(--color-success)"
                  : "var(--color-text-secondary)"
              }
            />
          </DashboardCard>

          {/* Environment */}
          <DashboardCard
            icon={<Globe size={18} />}
            title={t("environment")}
            iconColor="var(--color-info)"
          >
            <StatusRow label={t("common:version")} value={`v${status.appVersion}`} />
            <StatusRow label={t("common:platform")} value={`${formatPlatform(platform)} (Tauri v2)`} />
          </DashboardCard>
        </div>

        {/* MFA Security card */}
        <div className="mt-4">
          <DashboardCard
            icon={<ShieldCheck size={18} />}
            title={t("mfaSecurity")}
            iconColor={
              mfaConfigured
                ? "var(--color-success)"
                : "var(--color-text-secondary)"
            }
          >
            <StatusRow
              label={t("common:status")}
              value={mfaConfigured ? t("configured") : t("notConfigured")}
              valueColor={
                mfaConfigured
                  ? "var(--color-success)"
                  : "var(--color-text-secondary)"
              }
            />
            <div className="flex gap-2 pt-1">
              {!mfaConfigured ? (
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => setShowMfaSetup(true)}
                  data-testid="mfa-setup-btn"
                >
                  {t("setupMfa")}
                </button>
              ) : (
                <button
                  className="btn btn-sm btn-secondary text-[var(--color-error)]"
                  onClick={handleMfaRevoke}
                  data-testid="mfa-revoke-btn"
                >
                  {t("revokeMfa")}
                </button>
              )}
            </div>
          </DashboardCard>
        </div>

        {/* Groups section */}
        {status.userGroups.length > 0 && (
          <div className="mt-4">
            <DashboardCard
              icon={<Users size={18} />}
              title={t("adGroupMemberships")}
              iconColor="var(--color-primary)"
            >
              <div className="flex flex-wrap gap-1.5">
                {status.userGroups.map((group) => (
                  <span
                    key={group}
                    className="rounded-md bg-[var(--color-surface-hover)] px-2 py-0.5 text-caption text-[var(--color-text-secondary)]"
                  >
                    {group}
                  </span>
                ))}
              </div>
            </DashboardCard>
          </div>
        )}

        {/* Disconnected hint */}
        {!status.isConnected && (
          <div className="mt-4 rounded-lg border border-[var(--color-warning-bg)] bg-[var(--color-warning-bg)] p-3">
            <p className="text-caption text-[var(--color-warning)]">
              {t("notConnectedWarning")}
            </p>
            {status.connectionError && (
              <>
                <p className="mt-2 text-caption font-medium text-[var(--color-warning)]">
                  {t(`kerberosHint.${status.connectionError}`, {
                    defaultValue: t("kerberosHint.unknown"),
                  })}
                </p>
                <p className="mt-1 text-caption text-[var(--color-text-secondary)]">
                  {t("kerberosHint.logRef")}
                </p>
              </>
            )}
          </div>
        )}

        {/* RODC warning - shown when connected to a Read-Only DC */}
        {status.isConnected && status.dcIsRodc && (
          <div
            className="mt-4 rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning-bg)] p-3"
            data-testid="rodc-banner"
          >
            <p className="text-caption font-medium text-[var(--color-warning)]">
              {t("common:rodcBannerTitle")}
            </p>
            <p className="mt-1 text-caption text-[var(--color-text-secondary)]">
              {t("common:rodcBannerDetail")}
            </p>
          </div>
        )}
      </div>

      {showMfaSetup && (
        <MfaSetupDialog
          onComplete={() => {
            setShowMfaSetup(false);
            refreshMfaStatus();
          }}
          onCancel={() => setShowMfaSetup(false)}
        />
      )}
    </div>
  );
}

function DashboardCard({
  icon,
  title,
  iconColor,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  iconColor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <span style={{ color: iconColor }}>{icon}</span>
        <h3 className="text-caption font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
          {title}
        </h3>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function StatusRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-body text-[var(--color-text-secondary)]">
        {label}
      </span>
      <span
        className="text-body font-medium text-[var(--color-text-primary)]"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
