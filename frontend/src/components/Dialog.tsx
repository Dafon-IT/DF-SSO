"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type DialogType = "info" | "warning" | "error";

interface DialogOptions {
  type?: DialogType;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
}

interface DialogState {
  open: boolean;
  type: DialogType;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  showCancel: boolean;
  resolve?: (ok: boolean) => void;
}

interface DialogContextValue {
  alert: (opts: DialogOptions) => Promise<void>;
  confirm: (opts: DialogOptions) => Promise<boolean>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used inside <DialogProvider>");
  return ctx;
}

const COLOR: Record<DialogType, { bar: string; title: string; btn: string; icon: ReactNode }> = {
  info: {
    bar: "bg-blue-50 border-blue-200",
    title: "text-blue-700",
    btn: "bg-blue-600 hover:bg-blue-700",
    icon: (
      <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
      </svg>
    ),
  },
  warning: {
    bar: "bg-amber-50 border-amber-200",
    title: "text-amber-700",
    btn: "bg-amber-600 hover:bg-amber-700",
    icon: (
      <svg className="h-6 w-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
      </svg>
    ),
  },
  error: {
    bar: "bg-red-50 border-red-200",
    title: "text-red-700",
    btn: "bg-red-600 hover:bg-red-700",
    icon: (
      <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
};

interface DialogProviderProps {
  children: ReactNode;
}

export function DialogProvider({ children }: DialogProviderProps): React.ReactNode {
  const [state, setState] = useState<DialogState>({
    open: false,
    type: "info",
    title: "",
    showCancel: false,
  });

  const close = useCallback((ok: boolean): void => {
    setState((prev) => {
      prev.resolve?.(ok);
      return { ...prev, open: false, resolve: undefined };
    });
  }, []);

  const alert = useCallback((opts: DialogOptions): Promise<void> => {
    return new Promise<void>((resolve) => {
      setState({
        open: true,
        type: opts.type ?? "info",
        title: opts.title,
        message: opts.message,
        confirmText: opts.confirmText,
        showCancel: false,
        resolve: () => resolve(),
      });
    });
  }, []);

  const confirm = useCallback((opts: DialogOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setState({
        open: true,
        type: opts.type ?? "warning",
        title: opts.title,
        message: opts.message,
        confirmText: opts.confirmText,
        cancelText: opts.cancelText,
        showCancel: true,
        resolve,
      });
    });
  }, []);

  useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.open, close]);

  const palette = COLOR[state.type];

  return (
    <DialogContext.Provider value={{ alert, confirm }}>
      {children}
      {state.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => close(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className={`flex items-start gap-3 border-b px-6 py-4 ${palette.bar}`}>
              {palette.icon}
              <h3 className={`mt-0.5 text-lg font-semibold ${palette.title}`}>{state.title}</h3>
            </div>
            {state.message && (
              <div className="whitespace-pre-line px-6 py-4 text-base text-foreground">{state.message}</div>
            )}
            <div className="flex justify-end gap-2 border-t border-border bg-surface-muted px-6 py-3">
              {state.showCancel && (
                <button
                  onClick={() => close(false)}
                  className="rounded-xl border border-border bg-surface px-4 py-2 text-base font-medium text-foreground transition-colors hover:cursor-pointer hover:bg-surface-muted"
                >
                  {state.cancelText ?? "取消"}
                </button>
              )}
              <button
                onClick={() => close(true)}
                className={`rounded-xl px-4 py-2 text-base font-medium text-white transition-colors hover:cursor-pointer ${palette.btn}`}
                autoFocus
              >
                {state.confirmText ?? "確認"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
