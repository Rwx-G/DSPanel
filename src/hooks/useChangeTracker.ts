import { useState, useCallback, useEffect } from "react";

export function useChangeTracker<T extends Record<string, unknown>>(
  initialValues: T,
) {
  const [original, setOriginal] = useState(initialValues);
  const [current, setCurrent] = useState(initialValues);

  const isDirty = JSON.stringify(original) !== JSON.stringify(current);

  const markClean = useCallback(() => {
    setOriginal(current);
  }, [current]);

  const reset = useCallback(() => {
    setCurrent(original);
  }, [original]);

  const setField = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setCurrent((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    if (!isDirty) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  return { current, setCurrent, setField, isDirty, markClean, reset };
}
