/** Type of preset: Onboarding (new user setup) or Offboarding (user departure). */
export type PresetType = "Onboarding" | "Offboarding";

/** A role-based preset stored as JSON on a configurable network share. */
export interface Preset {
  /** Display name for the preset. */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Whether this is an onboarding or offboarding preset. */
  type: PresetType;
  /** Target OU distinguished name. */
  targetOu: string;
  /** List of AD group distinguished names. */
  groups: string[];
  /** Additional LDAP attributes to set (e.g., department, title). */
  attributes: Record<string, string>;
  /** True if the preset file was modified outside DSPanel (checksum mismatch). */
  integrityWarning?: boolean;
}
