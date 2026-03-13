export function isValidSamAccountName(value: string): boolean {
  if (!value || value.length === 0 || value.length > 20) return false;
  return /^[a-zA-Z0-9._\-]+$/.test(value);
}

export function isValidDistinguishedName(value: string): boolean {
  if (!value || value.length === 0) return false;
  return /^(CN|OU|DC)=.+/.test(value);
}

export function isRequired(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function isMinLength(min: number): (value: unknown) => boolean {
  return (value: unknown) => {
    if (typeof value !== "string") return false;
    return value.length >= min;
  };
}

export function isMaxLength(max: number): (value: unknown) => boolean {
  return (value: unknown) => {
    if (typeof value !== "string") return false;
    return value.length <= max;
  };
}
