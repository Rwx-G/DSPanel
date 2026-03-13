import type { DirectoryUser } from "@/types/directory";
import type {
  AccountHealthStatus,
  HealthFlag,
  HealthLevel,
} from "@/types/health";

const SEVERITY_ORDER: Record<HealthLevel, number> = {
  Healthy: 0,
  Info: 1,
  Warning: 2,
  Critical: 3,
};

function worstLevel(a: HealthLevel, b: HealthLevel): HealthLevel {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

/**
 * Evaluates the health status of a user account by checking a set of
 * flags derived from account properties.
 *
 * @param user - The directory user to evaluate
 * @param now - Optional current time for deterministic testing
 */
export function evaluateHealth(
  user: DirectoryUser,
  now: Date = new Date(),
): AccountHealthStatus {
  const flags: HealthFlag[] = [];

  if (!user.enabled) {
    flags.push({
      name: "Disabled",
      severity: "Critical",
      description: "Account is disabled",
    });
  }

  if (user.lockedOut) {
    flags.push({
      name: "Locked",
      severity: "Critical",
      description: "Account is locked out",
    });
  }

  if (user.accountExpires) {
    const expiry = new Date(user.accountExpires);
    if (expiry.getTime() <= now.getTime()) {
      flags.push({
        name: "Expired",
        severity: "Critical",
        description: "Account has expired",
      });
    }
  }

  if (user.passwordExpired) {
    flags.push({
      name: "PasswordExpired",
      severity: "Critical",
      description: "Password has expired",
    });
  }

  if (user.passwordNeverExpires) {
    flags.push({
      name: "PasswordNeverExpires",
      severity: "Warning",
      description: "Password is set to never expire",
    });
  }

  if (user.lastLogon) {
    const lastLogonDate = new Date(user.lastLogon);
    const daysSinceLogon = Math.floor(
      (now.getTime() - lastLogonDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysSinceLogon >= 90) {
      flags.push({
        name: "Inactive90Days",
        severity: "Critical",
        description: "No logon in over 90 days",
      });
    } else if (daysSinceLogon >= 30) {
      flags.push({
        name: "Inactive30Days",
        severity: "Warning",
        description: "No logon in over 30 days",
      });
    }
  } else if (user.whenCreated) {
    const createdDate = new Date(user.whenCreated);
    const daysSinceCreated = Math.floor(
      (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysSinceCreated >= 1) {
      flags.push({
        name: "NeverLoggedOn",
        severity: "Info",
        description: "Account has never been used",
      });
    }
  }

  if (user.passwordLastSet && user.whenCreated) {
    const pwdSet = new Date(user.passwordLastSet);
    const created = new Date(user.whenCreated);
    const diffMs = Math.abs(pwdSet.getTime() - created.getTime());
    if (diffMs <= 60000) {
      flags.push({
        name: "PasswordNeverChanged",
        severity: "Warning",
        description: "Password has never been changed since account creation",
      });
    }
  }

  let level: HealthLevel = "Healthy";
  for (const flag of flags) {
    level = worstLevel(level, flag.severity);
  }

  return { level, activeFlags: flags };
}
