import { useState, useEffect, useCallback } from "react";

export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "dspanel-theme";

function getSystemTheme(): ThemeMode {
  try {
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      return "dark";
    }
  } catch {
    // matchMedia may not be available in test environments
  }
  return "light";
}

function getSavedTheme(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // localStorage may not be available in test environments
  }
  return null;
}

export function useTheme() {
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>(() => {
    return getSavedTheme() ?? getSystemTheme();
  });

  const applyTheme = useCallback((mode: ThemeMode) => {
    document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem(STORAGE_KEY, mode);
    setCurrentTheme(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setCurrentTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", currentTheme);
  }, [currentTheme]);

  return { currentTheme, applyTheme, toggleTheme };
}
