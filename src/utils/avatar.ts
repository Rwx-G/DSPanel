export function getInitials(displayName?: string): string {
  if (!displayName?.trim()) return "?";
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function getAvatarColor(displayName: string): string {
  let hash = 0;
  for (let i = 0; i < displayName.length; i++) {
    hash = displayName.charCodeAt(i) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}
