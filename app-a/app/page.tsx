"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

const SSO_URL = process.env.NEXT_PUBLIC_SSO_URL || "http://localhost:3001";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100";
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "App A";

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
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100">
              <svg className="h-8 w-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">資產管理系統</h1>
            <p className="mt-2 text-base text-gray-500">DF Asset Management</p>
          </div>

          {error && (
            <div className="mb-6 rounded-lg bg-red-50 p-3 text-center text-base text-red-600">
              登入失敗：{error}
            </div>
          )}

          <button
            onClick={handleLogin}
            className="flex w-full items-center justify-center gap-3 rounded-lg bg-emerald-600 px-4 py-3 text-base font-medium text-white transition-colors hover:bg-emerald-700"
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
