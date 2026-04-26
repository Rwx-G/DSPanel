import type { HealthLevel } from "@/types/health";

/**
 * Stable identifier for each per-object security indicator. Mirrors the Rust
 * `SecurityIndicatorKind` enum. The string value is the JSON wire form used by
 * the `evaluate_user_security_indicators` and `evaluate_computer_security_indicators`
 * Tauri commands (Story 14.1 - Epic 14).
 */
export type SecurityIndicatorKind =
  | "Kerberoastable"
  | "PasswordNotRequired"
  | "PasswordNeverExpires"
  | "ReversibleEncryption"
  | "AsRepRoastable"
  | "UnconstrainedDelegation"
  | "ConstrainedDelegation"
  | "Rbcd";

/** Severity reuses HealthLevel so the same color tokens drive both badges. */
export type IndicatorSeverity = HealthLevel;

/**
 * One detected security indicator on an AD object. Wire shape matches the
 * Rust `SecurityIndicator` struct (camelCase via `#[serde(rename_all = "camelCase")]`).
 */
export interface SecurityIndicator {
  kind: SecurityIndicatorKind;
  severity: IndicatorSeverity;
  /** i18n key, never a translated string. UI translates via `t(descriptionKey)`. */
  descriptionKey: string;
  /**
   * Optional structured payload. `Rbcd` populates `{ allowed_principals: string[] }`
   * (note snake_case inside metadata - it is built via `serde_json::json!()` literal,
   * not via the rename_all attribute). `ConstrainedDelegation` populates
   * `{ target_spns: string[] }`. Other indicators omit this field.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Result of evaluating one AD object. Wire shape matches the Rust
 * `SecurityIndicatorSet` struct.
 */
export interface SecurityIndicatorSet {
  indicators: SecurityIndicator[];
  /** Highest severity across the set; `Healthy` when the set is empty. */
  highestSeverity: IndicatorSeverity;
}

/**
 * Helper - true when the set is non-empty (at least one indicator detected).
 * Use this rather than `set.indicators.length > 0` at call sites for clarity.
 */
export function hasIndicators(set: SecurityIndicatorSet): boolean {
  return set.indicators.length > 0;
}

/**
 * Maps an indicator severity to the `StatusBadge` variant. Reads the per-indicator
 * `severity` (NOT the indicator `kind`) so the AdminSDHolder escalation in the
 * backend (Kerberoastable / PasswordNeverExpires escalate to Critical when
 * adminCount=1) surfaces correctly without the UI re-implementing the rule.
 */
export function severityToBadgeVariant(
  severity: IndicatorSeverity,
): "warning" | "error" {
  return severity === "Critical" ? "error" : "warning";
}
