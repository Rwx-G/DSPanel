import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

export type NotificationSeverity = "info" | "success" | "warning" | "error";

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

export interface Notification {
  id: string;
  message: string;
  severity: NotificationSeverity;
  action?: NotificationAction;
}

interface NotificationContextValue {
  notifications: Notification[];
  addNotification: (
    message: string,
    severity: NotificationSeverity,
    action?: NotificationAction,
  ) => void;
  removeNotification: (id: string) => void;
  autoDismissMs: number;
}

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

let notificationIdCounter = 0;

export function resetNotificationIdCounter() {
  notificationIdCounter = 0;
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error(
      "useNotifications must be used within NotificationProvider",
    );
  }
  return {
    notify: ctx.addNotification,
    dismiss: ctx.removeNotification,
    notifications: ctx.notifications,
    autoDismissMs: ctx.autoDismissMs,
  };
}

interface NotificationProviderProps {
  children: ReactNode;
  autoDismissMs?: number;
}

export function NotificationProvider({
  children,
  autoDismissMs = 5000,
}: NotificationProviderProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const addNotification = useCallback(
    (
      message: string,
      severity: NotificationSeverity,
      action?: NotificationAction,
    ) => {
      notificationIdCounter += 1;
      const id = `notification-${notificationIdCounter}`;
      const notification: Notification = { id, message, severity, action };
      setNotifications((prev) => [...prev, notification]);

      setTimeout(() => {
        removeNotification(id);
      }, autoDismissMs);
    },
    [autoDismissMs, removeNotification],
  );

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        addNotification,
        removeNotification,
        autoDismissMs,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
