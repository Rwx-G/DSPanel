import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from "lucide-react";
import {
  useNotifications,
  type NotificationSeverity,
} from "@/contexts/NotificationContext";

const SEVERITY_ICON: Record<NotificationSeverity, typeof Info> = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
};

const SEVERITY_BG: Record<NotificationSeverity, string> = {
  info: "border-l-[var(--color-info)]",
  success: "border-l-[var(--color-success)]",
  warning: "border-l-[var(--color-warning)]",
  error: "border-l-[var(--color-error)]",
};

const SEVERITY_TEXT: Record<NotificationSeverity, string> = {
  info: "text-[var(--color-info)]",
  success: "text-[var(--color-success)]",
  warning: "text-[var(--color-warning)]",
  error: "text-[var(--color-error)]",
};

export function NotificationHost() {
  const { notifications, dismiss } = useNotifications();

  if (notifications.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      data-testid="notification-host"
    >
      {notifications.map((notification) => {
        const Icon = SEVERITY_ICON[notification.severity];
        return (
          <div
            key={notification.id}
            className={`flex items-start gap-2 rounded-md border border-[var(--color-border-default)] border-l-4 bg-[var(--color-surface-card)] px-3 py-2 shadow-md animate-in slide-in-from-right ${SEVERITY_BG[notification.severity]}`}
            role="alert"
            data-testid={`notification-${notification.id}`}
          >
            <Icon
              size={16}
              className={`mt-0.5 shrink-0 ${SEVERITY_TEXT[notification.severity]}`}
            />
            <div className="flex-1">
              <p className="text-body text-[var(--color-text-primary)]">
                {notification.message}
              </p>
              {notification.action && (
                <button
                  className="mt-1 text-caption font-medium text-[var(--color-primary)] hover:underline"
                  onClick={notification.action.onClick}
                  data-testid={`notification-action-${notification.id}`}
                >
                  {notification.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => dismiss(notification.id)}
              className="shrink-0 rounded-sm p-0.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label="Dismiss notification"
              data-testid={`notification-dismiss-${notification.id}`}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
