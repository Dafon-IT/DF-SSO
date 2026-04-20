"use client";

import { useEffect } from "react";

interface ErrorProps {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}

export default function Error({ error, unstable_retry }: ErrorProps): React.ReactNode {
  useEffect(() => {
    console.error("[route-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 shadow-lg">
        <div className="mb-4 flex items-start gap-3">
          <svg className="mt-0.5 h-6 w-6 shrink-0 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
          </svg>
          <div>
            <h2 className="text-lg font-semibold text-foreground">發生錯誤</h2>
            <p className="mt-1 text-base text-foreground-muted">{error.message || "未知錯誤"}</p>
            {error.digest && (
              <p className="mt-2 font-mono text-sm text-foreground-muted">digest: {error.digest}</p>
            )}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={() => unstable_retry()}
            className="rounded-xl bg-primary px-4 py-2 text-base font-medium text-primary-foreground transition-colors hover:cursor-pointer hover:bg-primary-hover"
          >
            重試
          </button>
        </div>
      </div>
    </div>
  );
}
