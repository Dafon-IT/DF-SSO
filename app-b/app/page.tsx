"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

const SSO_URL = process.env.NEXT_PUBLIC_SSO_URL || "http://localhost:3001";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3200";
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "App B";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // 呼叫本地 API 檢查 session（不再跨域呼叫 SSO）
    fetch("/api/auth/me")
      .then((res) => {
        if (res.ok) router.push("/dashboard");
        else setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [router]);

  const handleLogin = () => {
    // 直接呼叫 SSO Backend authorize API，帶上 app 識別 + callback URL
    window.location.href = `${SSO_URL}/api/auth/sso/authorize?app=${encodeURIComponent(APP_NAME)}&redirect_uri=${encodeURIComponent(`${APP_URL}/api/auth/callback`)}`;
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-base text-gray-500">驗證中...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-xl bg-white p-8 shadow-lg">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-100">
              <svg className="h-8 w-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">報修系統</h1>
            <p className="mt-2 text-base text-gray-500">DF Repair Request</p>
          </div>

          {error && (
            <div className="mb-6 rounded-lg bg-red-50 p-3 text-center text-base text-red-600">
              登入失敗：{error}
            </div>
          )}

          <button
            onClick={handleLogin}
            className="flex w-full items-center justify-center gap-3 rounded-lg bg-orange-600 px-4 py-3 text-base font-medium text-white transition-colors hover:bg-orange-700"
          >
            透過 DF-SSO 登入
          </button>

          <p className="mt-4 text-center text-sm text-gray-400">
            使用大豐統一身份認證
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><p className="text-base text-gray-500">載入中...</p></div>}>
      <LoginContent />
    </Suspense>
  );
}
