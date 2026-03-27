import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Lock, Server, User, AlertCircle, Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { extractErrorMessage } from "@/utils/errorMapping";

interface LoginDialogProps {
  onSuccess: () => void;
}

export function LoginDialog({ onSuccess }: LoginDialogProps) {
  const { t } = useTranslation(["layout"]);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [server, setServer] = useState("");
  const [bindDn, setBindDn] = useState("");

  useEffect(() => {
    invoke<[string, string]>("get_bind_info").then(([s, d]) => {
      setServer(s);
      setBindDn(d);
    }).catch(() => {});
  }, []);

  // Extract username from bind DN for display
  const displayUser = bindDn
    .split(",")[0]
    ?.replace("CN=", "")
    ?? bindDn;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    setError(null);
    try {
      await invoke<boolean>("connect_simple_bind", { password });
      onSuccess();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-surface-bg)]">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[360px] rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-8 shadow-lg"
        data-testid="login-dialog"
      >
        {/* Header */}
        <div className="mb-6 flex flex-col items-center gap-1.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-primary)]/10">
            <Lock size={24} className="text-[var(--color-primary)]" />
          </div>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
            DSPanel
          </h1>
          <p className="text-caption text-[var(--color-text-secondary)]">
            {t("loginSubtitle")}
          </p>
        </div>

        {/* Connection info */}
        <div className="mb-5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-bg)] px-3 py-2.5 space-y-1.5">
          <div className="flex items-center gap-2 text-caption">
            <Server size={13} className="shrink-0 text-[var(--color-text-secondary)]" />
            <span className="font-medium text-[var(--color-text-secondary)]">{t("loginServer")}</span>
            <span className="ml-auto truncate text-[var(--color-text-primary)]">{server || "-"}</span>
          </div>
          <div className="flex items-center gap-2 text-caption">
            <User size={13} className="shrink-0 text-[var(--color-text-secondary)]" />
            <span className="font-medium text-[var(--color-text-secondary)]">{t("loginAccount")}</span>
            <span className="ml-auto truncate text-[var(--color-text-primary)]">{displayUser || "-"}</span>
          </div>
        </div>

        {/* Password field */}
        <div className="mb-5">
          <label
            htmlFor="login-password"
            className="mb-1.5 block text-caption font-medium text-[var(--color-text-secondary)]"
          >
            {t("loginPassword")}
          </label>
          <div className="relative">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              disabled={loading}
              className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] px-3 py-2 pr-10 text-body text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] placeholder:text-[var(--color-text-secondary)]"
              placeholder={t("loginPasswordPlaceholder")}
              data-testid="login-password-input"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div
            className="mb-4 flex items-center gap-2 rounded-md border border-[var(--color-error)] bg-[var(--color-error)]/10 px-3 py-2 text-caption text-[var(--color-error)]"
            data-testid="login-error"
          >
            <AlertCircle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Submit button */}
        <button
          type="submit"
          disabled={loading || !password.trim()}
          className="btn btn-sm btn-primary w-full py-2 text-body font-medium"
          data-testid="login-submit"
        >
          {loading ? t("loginConnecting") : t("loginConnect")}
        </button>
      </form>
    </div>
  );
}
