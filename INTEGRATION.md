# DF-SSO 串接指南

本文件說明企業內部專案如何串接 DF-SSO 單一登入系統。

---

## 前置作業

### 1. 向 SSO 管理員申請 App

到 SSO Dashboard 的**應用程式管理**新增你的專案：

| 欄位 | 說明 | 範例 |
|------|------|------|
| **網域** | 主要 domain（含 `https://`） | `https://warehouse.apps.zerozero.tw` |
| **系統名稱** | 顯示名稱 | `倉儲系統` |
| **說明** | 用途描述 | `大豐倉儲管理系統` |
| **Redirect URIs** | 所有環境的 origin | `http://localhost:3100`、`https://warehouse.apps.zerozero.tw` |

建立後 SSO 自動產生：
- **`app_id`** — UUID，公開的 client identifier
- **`app_secret`** — 64 字元，保密，用於 server-to-server exchange

在 Dashboard 點擊「**顯示金鑰**」即可複製完整的 `app_id` + `app_secret`。

### 2. SSO Backend URL

| 環境 | URL |
|------|-----|
| Test | `https://df-sso-login-test.apps.zerozero.tw` |
| 本機 | `http://localhost:3001` |

---

## 設定環境變數

```env
# Server-side（runtime，保密）
SSO_URL=https://df-sso-login-test.apps.zerozero.tw
SSO_APP_ID=<app_id>
SSO_APP_SECRET=<app_secret>
APP_URL=https://warehouse.apps.zerozero.tw

# Client-side（build time，公開）
NEXT_PUBLIC_SSO_URL=https://df-sso-login-test.apps.zerozero.tw
NEXT_PUBLIC_SSO_APP_ID=<同 SSO_APP_ID>
NEXT_PUBLIC_APP_URL=https://warehouse.apps.zerozero.tw
```

> `app_id` + `app_secret` **跨環境共用**（dev/test/prod 同一組），只需改 `APP_URL`。
> `APP_URL` 的 origin 必須在白名單的 `redirect_uris` 中。

---

## 建立檔案

你的專案需要 **1 個工具檔 + 4 個 API Route**。

### `lib/sso.ts`

```typescript
import { cookies } from "next/headers";

const TOKEN_COOKIE = "token";
const SSO_URL = process.env.SSO_URL || "http://localhost:3001";
const SSO_TIMEOUT = 8000;

export const SSO_APP_ID = process.env.SSO_APP_ID || "";
export const SSO_APP_SECRET = process.env.SSO_APP_SECRET || "";

export async function getToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(TOKEN_COOKIE)?.value ?? null;
}

export async function fetchSSO(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SSO_URL}${path}`, {
    ...init,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(SSO_TIMEOUT),
  });
}
```

### `app/api/auth/callback/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { fetchSSO, SSO_APP_ID, SSO_APP_SECRET } from "../../../../lib/sso";

const APP_URL = process.env.APP_URL!;

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/?error=no_code", APP_URL));

  try {
    const res = await fetchSSO("/api/auth/sso/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, client_id: SSO_APP_ID, client_secret: SSO_APP_SECRET }),
    });
    if (!res.ok) return NextResponse.redirect(new URL("/?error=exchange_failed", APP_URL));

    const data = await res.json();
    const response = NextResponse.redirect(new URL("/dashboard", APP_URL));
    response.cookies.set("token", data.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60,
      path: "/",
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/?error=exchange_error", APP_URL));
  }
}
```

### `app/api/auth/me/route.ts`

```typescript
import { NextResponse } from "next/server";
import { getToken, fetchSSO } from "../../../../lib/sso";

export async function GET() {
  const token = await getToken();
  if (!token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  try {
    const res = await fetchSSO("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const response = NextResponse.json({ error: "session_expired" }, { status: 401 });
      response.cookies.delete("token");
      return response;
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "SSO unreachable" }, { status: 502 });
  }
}
```

### `app/api/auth/logout/route.ts`

```typescript
import { NextResponse } from "next/server";
import { getToken, fetchSSO } from "../../../../lib/sso";

const APP_URL = process.env.APP_URL!;

export async function GET() {
  const token = await getToken();
  if (token) {
    try {
      await fetchSSO("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {}
  }
  const response = NextResponse.redirect(new URL("/?logged_out=1", APP_URL));
  response.cookies.delete("token");
  return response;
}
```

### `app/api/auth/back-channel-logout/route.ts`

SSO 登出時會帶 HMAC-SHA256 簽章，驗證後可確認請求來自 SSO。

```typescript
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const SSO_APP_SECRET = process.env.SSO_APP_SECRET || "";
const MAX_TIMESTAMP_DRIFT = 30_000; // 30 秒

export async function POST(request: NextRequest) {
  let body: { user_id?: string; timestamp?: number; signature?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { user_id, timestamp, signature } = body;
  if (!user_id || !timestamp || !signature) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // 驗證時間戳（防 replay）
  if (Math.abs(Date.now() - timestamp) > MAX_TIMESTAMP_DRIFT) {
    return NextResponse.json({ error: "Timestamp expired" }, { status: 401 });
  }

  // 驗證 HMAC 簽章
  const expected = crypto
    .createHmac("sha256", SSO_APP_SECRET)
    .update(`${user_id}:${timestamp}`)
    .digest("hex");

  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  console.log(`[Back-channel Logout] User ${user_id} logged out from SSO`);
  return NextResponse.json({ success: true });
}
```

---

## 登入頁

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const SSO_URL = process.env.NEXT_PUBLIC_SSO_URL!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;
const SSO_APP_ID = process.env.NEXT_PUBLIC_SSO_APP_ID!;

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const loggedOut = searchParams.get("logged_out");
  const [checking, setChecking] = useState(true);

  const ssoUrl = `${SSO_URL}/api/auth/sso/authorize?client_id=${encodeURIComponent(SSO_APP_ID)}&redirect_uri=${encodeURIComponent(`${APP_URL}/api/auth/callback`)}`;

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => {
        if (res.ok) { router.push("/dashboard"); return; }
        const data = await res.json().catch(() => ({}));
        if (data.error === "session_expired" || error || loggedOut) {
          setChecking(false);  // 顯示登入按鈕
        } else {
          window.location.href = ssoUrl;  // no_token → 自動導向 SSO
        }
      })
      .catch(() => setChecking(false));
  }, [router, error, loggedOut, ssoUrl]);

  if (checking) return <p>驗證中...</p>;

  return (
    <div>
      {error && <p>登入失敗：{error}</p>}
      <button onClick={() => window.location.href = ssoUrl}>透過 DF-SSO 登入</button>
    </div>
  );
}
```

> **`no_token`** → 自動導向 SSO（跨 App 免登入）
> **`session_expired`** → 顯示按鈕（避免被登出後無限重導）

---

## 用戶資料格式

`/api/auth/me` 回傳：

```json
{
  "user": {
    "userId": "azure-oid",
    "email": "user@df-recycle.com",
    "name": "王小明",
    "erpData": {
      "gen01": "00063",
      "gen02": "王小明",
      "gen03": "F000",
      "gem02": "財務部",
      "gen06": "user@df-recycle.com"
    },
    "loginAt": "2026-04-09T10:30:00.000Z"
  }
}
```

> `erpData` 可能為 `null`。

---

## 非 Next.js 專案

任何後端框架都能實作，核心是 4 個 HTTP 端點：

| 端點 | 做什麼 |
|------|--------|
| `GET /callback?code=xxx` | POST `SSO/exchange` `{ code, client_id, client_secret }` → 存 token cookie |
| `GET /me` | 讀 cookie → `Bearer {token}` 呼叫 `SSO/me` → 回傳結果 |
| `GET /logout` | 讀 cookie → POST `SSO/logout` (Bearer) → 刪 cookie → redirect |
| `POST /back-channel-logout` | 驗證 HMAC 簽章 `{ user_id, timestamp, signature }` → 回 `{ success: true }` |

重點：
- 所有 server-to-server fetch 加 `cache: "no-store"` + timeout
- `/me` 區分 `no_token`（自動導向 SSO）和 `session_expired`（顯示按鈕）
- exchange 必須帶 `client_id` + `client_secret`（保密，不可暴露在前端）
- back-channel 用 `HMAC-SHA256(app_secret, user_id:timestamp)` 驗證簽章

---

## 常見問題

| 問題 | 原因 |
|------|------|
| `Invalid client_id` | `SSO_APP_ID` 錯誤，或該 App 未啟用 |
| `Invalid client credentials` | `SSO_APP_SECRET` 錯誤 |
| `redirect_uri is not registered` | `APP_URL` origin 不在白名單的 `redirect_uris` 中 |
| `Too many authentication attempts` | rate limit 超限，/me 和 /logout 為 100 次/15min |
| 登出後其他 App 仍可用 | 正常，其他 App 下次 `/me` 時收到 401 並清除 cookie |
| `exchange_failed` | auth code 過期（60 秒）或已被使用，或 client credentials 錯誤 |
| `Invalid signature`（back-channel） | `SSO_APP_SECRET` 與 SSO 端不一致，或 timestamp 超過 30 秒 |
