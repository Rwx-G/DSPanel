import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type AppStatus } from "@/App";
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

interface HomePageProps {
  status: AppStatus;
}

const PERM_LABELS: Record<string, { label: string; color: string }> = {
  ReadOnly: {
    label: "Read Only",
    color: "var(--color-perm-readonly)",
  },
  HelpDesk: {
    label: "Help Desk",
    color: "var(--color-perm-helpdesk)",
  },
  AccountOperator: {
    label: "Account Operator",
    color: "var(--color-perm-accountops)",
  },
  DomainAdmin: {
    label: "Domain Admin",
    color: "var(--color-perm-domainadmin)",
  },
};

export function HomePage({ status }: HomePageProps) {
  const perm = PERM_LABELS[status.permissionLevel] ?? PERM_LABELS.ReadOnly;
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
              Dashboard
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
            title="Active Directory"
            iconColor={
              status.isConnected ? "var(--color-success)" : "var(--color-error)"
            }
          >
            <StatusRow
              label="Status"
              value={status.isConnected ? "Connected" : "Disconnected"}
              valueColor={
                status.isConnected
                  ? "var(--color-success)"
                  : "var(--color-error)"
              }
            />
            <StatusRow label="Domain" value={status.domainName ?? "N/A"} />
          </DashboardCard>

          {/* Current Session */}
          <DashboardCard
            icon={<User size={18} />}
            title="Current Session"
            iconColor="var(--color-primary)"
          >
            <StatusRow label="User" value={status.username || "..."} />
            <StatusRow label="Computer" value={status.computerName || "..."} />
          </DashboardCard>

          {/* Permissions */}
          <DashboardCard
            icon={<KeyRound size={18} />}
            title="Permissions"
            iconColor={perm.color}
          >
            <StatusRow
              label="Level"
              value={perm.label}
              valueColor={perm.color}
            />
            <StatusRow
              label="Domain joined"
              value={status.domainName ? "Yes" : "No"}
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
            title="Environment"
            iconColor="var(--color-info)"
          >
            <StatusRow label="Version" value={`v${status.appVersion}`} />
            <StatusRow label="Platform" value="Windows (Tauri v2)" />
          </DashboardCard>
        </div>

        {/* MFA Security card */}
        <div className="mt-4">
          <DashboardCard
            icon={<ShieldCheck size={18} />}
            title="MFA Security"
            iconColor={
              mfaConfigured
                ? "var(--color-success)"
                : "var(--color-text-secondary)"
            }
          >
            <StatusRow
              label="Status"
              value={mfaConfigured ? "Configured" : "Not configured"}
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
                  Setup MFA
                </button>
              ) : (
                <button
                  className="btn btn-sm btn-secondary text-[var(--color-error)]"
                  onClick={handleMfaRevoke}
                  data-testid="mfa-revoke-btn"
                >
                  Revoke MFA
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
              title="AD Group Memberships"
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
              Not connected to Active Directory. Directory lookups will not be
              available. Check that this machine is domain-joined and has
              network access to a domain controller.
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
