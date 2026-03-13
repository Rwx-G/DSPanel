import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function App() {
  const [appTitle, setAppTitle] = useState("DSPanel");
  const [backendReady, setBackendReady] = useState(false);

  useEffect(() => {
    invoke<string>("get_app_title")
      .then((title) => {
        setAppTitle(title);
        setBackendReady(true);
      })
      .catch(() => {
        setBackendReady(false);
      });
  }, []);

  return (
    <main className="flex h-screen items-center justify-center bg-[var(--color-surface-bg)] text-[var(--color-text-primary)]">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">{appTitle}</h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          {backendReady
            ? "Backend connected"
            : "Connecting to backend..."}
        </p>
      </div>
    </main>
  );
}
