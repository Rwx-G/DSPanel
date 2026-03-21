import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

let cachedPlatform: string | null = null;

/** Returns the OS platform ("windows", "macos", "linux", or "unknown"). */
export function usePlatform(): string {
  const [platform, setPlatform] = useState(cachedPlatform ?? "");

  useEffect(() => {
    if (cachedPlatform) return;
    invoke<string>("get_platform")
      .then((p) => {
        cachedPlatform = p;
        setPlatform(p);
      })
      .catch(() => setPlatform("unknown"));
  }, []);

  return platform;
}
