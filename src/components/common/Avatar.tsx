import { getInitials, getAvatarColor } from "@/utils/avatar";

interface AvatarProps {
  imageUrl?: string;
  displayName: string;
  size?: number;
}

export function Avatar({ imageUrl, displayName, size = 32 }: AvatarProps) {
  const initials = getInitials(displayName);
  const bgColor = getAvatarColor(displayName);

  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full text-[var(--color-text-inverse)] font-medium"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        backgroundColor: imageUrl ? undefined : bgColor,
      }}
      data-testid="avatar"
      title={displayName}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={displayName}
          className="h-full w-full object-cover"
          data-testid="avatar-image"
        />
      ) : (
        <span data-testid="avatar-initials">{initials}</span>
      )}
    </div>
  );
}
