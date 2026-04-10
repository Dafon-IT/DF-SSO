# DF-SSO 串接指南

本文件說明企業內部專案如何串接 DF-SSO 單一登入系統。

---

## 前置作業

### 1. 向 SSO 管理員申請 App

到 SSO Dashboard 的白名單管理新增你的專案，SSO 會自動產生 `app_id` + `app_secret`：

| 欄位 | 說明 | 範例 |
|------|------|------|
| **名稱** | App 顯示名稱 | `倉儲系統` |
| **網域** | 主要 domain（含 `https://`） | `https://warehouse.apps.zerozero.tw` |
| **redirect_uris** | 所有環境的 origin（dev/test/prod） | `http://localhost:3100`, `https://warehouse.apps.zerozero.tw` |

建立後你會取得：
- **`app_id`** — UUID，公開的 client identifier
- **`app_secret`** — 64 字元隨機字串，保密，用於 server-to-server exchange

### 2. 確認 SSO Backend URL

- Test：`https://df-sso-login-test.apps.zerozero.tw`
- 本機開發：`http://localhost:3001`

---

## 設定環境變數

```env
# Server-side（runtime）
SSO_URL=https://df-sso-login-test.apps.zerozero.tw
SSO_APP_ID=<從白名單取得的 app_id>
SSO_APP_SECRET=<從白名單取得的 app_secret>
APP_URL=https://warehouse.apps.zerozero.tw

# Client-side（build time，Next.js 用）
NEXT_PUBLIC_SSO_URL=https://df-sso-login-test.apps.zerozero.tw
NEXT_PUBLIC_SSO_APP_ID=<同 SSO_APP_ID>
NEXT_PUBLIC_APP_URL=https://warehouse.apps.zerozero.tw
```

> `app_id` + `app_secret` 跨環境共用（dev/test/prod 同一組），只需改 `APP_URL`。
> `APP_URL` 的 origin 必須在白名單的 `redirect_uris` 中。

---

## 建立檔案

你的專案需要 **1 個工具檔 + 4 個 API Route**。以下以 Next.js App Router 為範例，其他框架請參考「非 Next.js 專案」段落。

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

用 auth code + client credentials 向 SSO 換取 JWT token。

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

前端呼叫此 API 確認登入狀態。

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

通知 SSO 刪除 session，清除本地 cookie。

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

接收 SSO 的登出通知（當其他 App 登出時觸發）。
SSO 會在 request body 附帶 HMAC-SHA256 簽章，**務必驗證**以防偽造登出攻擊。

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
  // TODO: 在此清除該用戶的本地 session / cache
  return NextResponse.json({ success: true });
}
```

---

## 寫登入頁

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
          window.location.href = ssoUrl;  // 自動導向 SSO（跨 App 免登入）
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

> **`no_token`** → 自動導向 SSO（實現跨 App 免登入）
> **`session_expired`** → 顯示按鈕（避免被登出後無限重導）

---

## 取得用戶資料

在受保護的頁面呼叫 `/api/auth/me`：

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => { if (!res.ok) throw new Error(); return res.json(); })
      .then((data) => setUser(data.user))
      .catch(() => router.push("/"));
  }, [router]);

  if (!user) return <p>載入中...</p>;
  return <div>歡迎，{user.name}（{user.email}）</div>;
}
```

回傳格式：

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

> `erpData` 可能為 `null`（ERP 查無該 email 的員工資料）。

---

## 非 Next.js 專案

SSO 整合的核心是 4 個 HTTP 端點，任何後端框架都能實作：

| 端點 | 做什麼 |
|------|--------|
| `GET /api/auth/callback?code=xxx` | POST `SSO_URL/api/auth/sso/exchange` `{ code, client_id, client_secret }` → 取得 token → 存 httpOnly cookie |
| `GET /api/auth/me` | 讀 cookie → `Authorization: Bearer {token}` 呼叫 `SSO_URL/api/auth/me` → 回傳結果 |
| `GET /api/auth/logout` | 讀 cookie → POST `SSO_URL/api/auth/logout` (Bearer) → 刪 cookie → redirect |
| `POST /api/auth/back-channel-logout` | 接收 `{ user_id, timestamp, signature }` → 驗證 HMAC 簽章 → 回傳 `{ success: true }` |

注意事項：
- 所有 server-to-server fetch 加上 `cache: "no-store"` + timeout
- `/api/auth/me` 區分 `no_token`（可自動導向 SSO）和 `session_expired`（顯示按鈕）
- 登出用 server-to-server POST（帶 Bearer token），不是 browser redirect
- exchange 必須帶 `client_id` + `client_secret`（server-to-server，不可暴露在前端）

---

## 常見問題

| 問題 | 原因 |
|------|------|
| `Invalid client_id` | `SSO_APP_ID` 錯誤或該 App 未啟用 |
| `Invalid client credentials` | `SSO_APP_SECRET` 錯誤 |
| `redirect_uri origin is not registered` | `APP_URL` 的 origin 不在白名單的 `redirect_uris` 中 |
| `Too many authentication attempts` | rate limit 超限，檢查是否有無限迴圈 |
| 登出後其他 App 仍可用 | 正常，其他 App 下次呼叫 `/me` 時會收到 401 並清除 cookie |
| `exchange_failed` | auth code 過期（60 秒）或已被使用，或 client credentials 錯誤 |
