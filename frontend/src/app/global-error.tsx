"use client";

import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}

export default function GlobalError({ error, unstable_retry }: GlobalErrorProps): React.ReactNode {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="zh-TW">
      <body
        style={{
          fontFamily: "Arial, Helvetica, sans-serif",
          background: "#f9fafb",
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
        }}
      >
        <div
          style={{
            background: "#ffffff",
            borderRadius: "0.75rem",
            boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
            padding: "2rem",
            maxWidth: "28rem",
            width: "100%",
          }}
        >
          <h2 style={{ margin: 0, color: "#dc2626", fontSize: "1.125rem", fontWeight: 600 }}>
            系統錯誤
          </h2>
          <p style={{ marginTop: "0.5rem", color: "#374151", fontSize: "1rem" }}>
            {error.message || "發生未預期錯誤，請重試或聯繫管理員"}
          </p>
          {error.digest && (
            <p
              style={{
                marginTop: "0.5rem",
                fontFamily: "monospace",
                fontSize: "0.875rem",
                color: "#9ca3af",
              }}
            >
              digest: {error.digest}
            </p>
          )}
          <button
            onClick={() => unstable_retry()}
            style={{
              marginTop: "1.5rem",
              borderRadius: "0.75rem",
              background: "#2563eb",
              color: "#ffffff",
              padding: "0.5rem 1rem",
              fontSize: "1rem",
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
            }}
          >
            重試
          </button>
        </div>
      </body>
    </html>
  );
}
