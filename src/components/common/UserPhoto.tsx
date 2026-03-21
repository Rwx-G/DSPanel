import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Camera, Trash2, Upload, Loader2 } from "lucide-react";
import { Avatar } from "./Avatar";

interface UserPhotoProps {
  userDn: string;
  displayName: string;
  canEdit: boolean;
  size?: number;
}

/**
 * Resizes an image file to a square JPEG, center-cropped, and returns
 * the result as a base64-encoded string (without the data URL prefix).
 */
async function resizeImage(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = maxSize;
      canvas.height = maxSize;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }
      // Center crop: take the smaller dimension as the crop square
      const cropSize = Math.min(img.width, img.height);
      const sx = (img.width - cropSize) / 2;
      const sy = (img.height - cropSize) / 2;
      ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, maxSize, maxSize);
      // Convert to JPEG base64 (strip data:image/jpeg;base64, prefix)
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const base64 = dataUrl.split(",")[1];
      URL.revokeObjectURL(img.src);
      resolve(base64);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Failed to load image"));
    };
    img.src = URL.createObjectURL(file);
  });
}

export function UserPhoto({
  userDn,
  displayName,
  canEdit,
  size = 96,
}: UserPhotoProps) {
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    invoke<string | null>("get_thumbnail_photo", { userDn })
      .then((result) => {
        if (!cancelled) setPhotoBase64(result);
      })
      .catch(() => {
        if (!cancelled) setPhotoBase64(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userDn]);

  const handleUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setUploading(true);
      try {
        const base64 = await resizeImage(file, 96);
        await invoke("set_thumbnail_photo", {
          userDn,
          photoBase64: base64,
        });
        setPhotoBase64(base64);
      } catch {
        // Silently handle - the user sees the photo did not change
      } finally {
        setUploading(false);
        // Reset file input so the same file can be re-selected
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [userDn],
  );

  const handleRemove = useCallback(async () => {
    setUploading(true);
    try {
      await invoke("remove_thumbnail_photo", { userDn });
      setPhotoBase64(null);
    } catch {
      // Silently handle
    } finally {
      setUploading(false);
    }
  }, [userDn]);

  const imageUrl = photoBase64
    ? `data:image/jpeg;base64,${photoBase64}`
    : undefined;

  return (
    <div
      className="flex items-center gap-3"
      data-testid="user-photo"
    >
      <div className="relative">
        {loading ? (
          <div
            className="flex items-center justify-center rounded-full bg-[var(--color-surface-elevated)]"
            style={{ width: size, height: size }}
            data-testid="user-photo-loading"
          >
            <Loader2
              size={size * 0.3}
              className="animate-spin text-[var(--color-text-secondary)]"
            />
          </div>
        ) : (
          <Avatar
            displayName={displayName}
            imageUrl={imageUrl}
            size={size}
          />
        )}
        {uploading && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40"
            data-testid="user-photo-uploading"
          >
            <Loader2
              size={size * 0.3}
              className="animate-spin text-white"
            />
          </div>
        )}
      </div>

      {canEdit && !loading && (
        <div className="flex flex-col gap-1">
          <button
            className="btn btn-sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            data-testid="upload-photo-btn"
          >
            {photoBase64 ? (
              <Camera size={12} />
            ) : (
              <Upload size={12} />
            )}
            {photoBase64 ? "Change Photo" : "Upload Photo"}
          </button>
          {photoBase64 && (
            <button
              className="btn btn-sm"
              onClick={handleRemove}
              disabled={uploading}
              data-testid="remove-photo-btn"
            >
              <Trash2 size={12} />
              Remove
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png"
            className="hidden"
            onChange={handleUpload}
            data-testid="photo-file-input"
          />
        </div>
      )}
    </div>
  );
}
