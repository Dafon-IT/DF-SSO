"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const AUTH_PATH = process.env.NEXT_PUBLIC_AUTH_PATH || "microsoft";

function MicrosoftIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="21"
      height="21"
      viewBox="0 0 21 21"
    >
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

const ERROR_MESSAGES: Record<string, string> = {
  microsoft_login_failed: "Microsoft 登入失敗，請稍後再試",
  invalid_state: "驗證失敗（CSRF），請重新登入",
  token_exchange_failed: "Token 交換失敗，請稍後再試",
  access_denied: "存取被拒絕",
  domain_not_allowed: "此網域未在白名單中，請聯繫管理員",
};

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-xl bg-white p-8 shadow-lg">
          {/* Header */}
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900">DF-SSO</h1>
            <p className="mt-2 text-sm text-gray-500">大豐 SSO 單一登入系統</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 rounded-lg bg-red-50 p-3 text-center text-sm text-red-600">
              {ERROR_MESSAGES[error] || `登入錯誤: ${error}`}
            </div>
          )}

          {/* Microsoft Login Button */}
          <a
            href={`${API_BASE_URL}/api/auth/${AUTH_PATH}/login`}
            className="flex w-full items-center justify-center gap-3 rounded-lg bg-[#2F2F2F] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0078D4]"
          >
            <MicrosoftIcon />
            使用 Microsoft 帳號登入
          </a>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p>載入中...</p>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
