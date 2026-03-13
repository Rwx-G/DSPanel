import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { ConfirmationDialog } from "@/components/dialogs/ConfirmationDialog";
import {
  DryRunPreviewDialog,
  type DryRunChange,
} from "@/components/dialogs/DryRunPreviewDialog";

interface DialogContextValue {
  showConfirmation: (
    title: string,
    message: string,
    detail?: string,
  ) => Promise<boolean>;
  showWarning: (title: string, message: string) => Promise<void>;
  showError: (title: string, message: string, detail?: string) => Promise<void>;
  showDryRunPreview: (changes: DryRunChange[]) => Promise<boolean>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error("useDialog must be used within DialogProvider");
  }
  return ctx;
}

interface DialogProviderProps {
  children: ReactNode;
}

export function DialogProvider({ children }: DialogProviderProps) {
  const [dialog, setDialog] = useState<ReactNode>(null);

  const showConfirmation = useCallback(
    (title: string, message: string, detail?: string) => {
      return new Promise<boolean>((resolve) => {
        setDialog(
          <ConfirmationDialog
            title={title}
            message={message}
            detail={detail}
            severity="info"
            confirmLabel="OK"
            cancelLabel="Cancel"
            onConfirm={() => {
              setDialog(null);
              resolve(true);
            }}
            onCancel={() => {
              setDialog(null);
              resolve(false);
            }}
          />,
        );
      });
    },
    [],
  );

  const showWarning = useCallback((title: string, message: string) => {
    return new Promise<void>((resolve) => {
      setDialog(
        <ConfirmationDialog
          title={title}
          message={message}
          severity="warning"
          confirmLabel="OK"
          onConfirm={() => {
            setDialog(null);
            resolve();
          }}
          onCancel={() => {
            setDialog(null);
            resolve();
          }}
        />,
      );
    });
  }, []);

  const showError = useCallback(
    (title: string, message: string, detail?: string) => {
      return new Promise<void>((resolve) => {
        setDialog(
          <ConfirmationDialog
            title={title}
            message={message}
            detail={detail}
            severity="error"
            confirmLabel="OK"
            onConfirm={() => {
              setDialog(null);
              resolve();
            }}
            onCancel={() => {
              setDialog(null);
              resolve();
            }}
          />,
        );
      });
    },
    [],
  );

  const showDryRunPreview = useCallback((changes: DryRunChange[]) => {
    return new Promise<boolean>((resolve) => {
      setDialog(
        <DryRunPreviewDialog
          changes={changes}
          onExecute={() => {
            setDialog(null);
            resolve(true);
          }}
          onCancel={() => {
            setDialog(null);
            resolve(false);
          }}
        />,
      );
    });
  }, []);

  return (
    <DialogContext.Provider
      value={{ showConfirmation, showWarning, showError, showDryRunPreview }}
    >
      {children}
      {dialog}
    </DialogContext.Provider>
  );
}
