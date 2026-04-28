# DF-SSO 整合指南

> 給接入 DF-SSO 的 Client App / AI Agent 使用。完整架構與安全細節請讀 [docs/Design.md](docs/Design.md)。

---

## 環境

| 環境 | Backend URL（Client 呼叫） | Dashboard |
|------|----------------------------|-----------|
| Prod | `https://df-sso-login.apps.zerozero.tw` | `https://df-sso-management.apps.zerozero.tw` |
| Test | `https://df-sso-login-test.apps.zerozero.tw` | `https://df-sso-management-test.apps.zerozero.tw` |
| Dev  | `http://localhost:3001` | `http://localhost:3000` |

每個環境**各自發放** credentials。同一 App 接多環境必須各到對應 Dashboard 拿一組 `app_id` + `app_secret`。`redirect_uris` 同一 App 可列多個 origin（最多 10），協定限 `http:` / `https:`。

---

## 硬性契約（漏一條就壞）

中央**無法強制驗證** Client 是否遵守，全靠自律：

1. **`/api/auth/me` 即時回源中央** — 本地 handler 必須以 `Authorization: Bearer <token>` 轉發到中央。**JWT 簽名有效 ≠ session 仍存在**，中央 Redis 是唯一事實來源。
2. **登出 POST 中央 `/api/auth/logout` + redirect** — 收到回應的 `redirect` 後 302 過去。只清本地 cookie 不通知中央 → 中央 session 還活著，下次 silent SSO 把使用者拉回。
3. **登入頁（`/`）401 時顯示按鈕，不可自動 redirect 到 `/authorize`** — 自動 redirect 會破壞「登出真有效」（中央被清→AD silent→秒回 dashboard）。**僅適用登入頁**，dashboard 在工作中遇到 401 走 silent re-auth（見後段）。
4. **Back-channel logout 必驗 HMAC + timestamp** — `HMAC-SHA256(app_secret, "${user_id}:${timestamp}")`、constant-time 比對、`abs(now - ts) ≤ 30_000ms`。

---

## 兩種整合模式

| 模式 | 適用 |
|------|------|
| **A. 純 SSO** | App 沒有自己的帳號系統，所有使用者透過 SSO 登入 |
| **B. 本地帳密 + SSO** | App 有自己的帳號表，部分使用者本地登入、部分走 SSO |

兩模式的硬性契約相同，差別在 **token 驗證策略** 與 **silent re-auth 行為**。

---

## 模式 A：純 SSO

### 環境變數

```env
# Server-side（保密）
SSO_URL=https://df-sso-login.apps.zerozero.tw
SSO_APP_ID=<app_id>
SSO_APP_SECRET=<app_secret>
APP_URL=https://your-app.example.com

# Client-side（公開，build-time）
NEXT_PUBLIC_SSO_URL=...
NEXT_PUBLIC_SSO_APP_ID=...
NEXT_PUBLIC_APP_URL=...
```

`SSO_APP_SECRET` **絕不可**出現在前端 bundle。`APP_URL` origin 必須在該 App 的 `redirect_uris` 中。

### 必要檔案

| 檔案 | 職責 |
|------|------|
| `lib/sso.ts` | fetch 工具 + `requireAuth` / `withAuth` middleware（一等公民） |
| `app/api/auth/callback/route.ts` | 收 code → `/sso/exchange` → 寫 token cookie → redirect dashboard |
| `app/api/auth/me/route.ts` | `withAuth(...)` 一行回 user |
| `app/api/auth/logout/route.ts` | Bearer POST 中央 `/logout` → 清本地 cookie → redirect 回應的 `redirect` |
| `app/api/auth/back-channel-logout/route.ts` | 驗 HMAC + timestamp |
| `app/page.tsx` | 登入頁，401 時顯示按鈕（契約 #3） |
| `lib/api-client.ts` | 401 攔截器 + silent re-auth（見後段） |

### `lib/sso.ts` — fetch + auth middleware

所有 protected route（含 `/me`）必須透過 `withAuth` / `requireAuth`，才能保證「中央 session 被撤銷後下一次呼叫立即失效」。

```typescript
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const TOKEN_COOKIE = "token";
const SSO_URL = process.env.SSO_URL || "http://localhost:3001";
const SSO_TIMEOUT = 8000;

export const SSO_APP_ID = process.env.SSO_APP_ID || "";
export const SSO_APP_SECRET = process.env.SSO_APP_SECRET || "";

export type SsoUser = {
  userId: string;
  email: string;
  name: string;
  erpData: Record<string, string> | null;
  loginAt: string;
};

export class UnauthorizedError extends Error {
  constructor(public code: "no_token" | "session_expired" | "sso_unreachable") {
    super(code);
  }
}

export async function getToken(): Promise<string | null> {
  return (await cookies()).get(TOKEN_COOKIE)?.value ?? null;
}

export async function fetchSSO(path: string, init?: RequestInit) {
  return fetch(`${SSO_URL}${path}`, {
    ...init,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(SSO_TIMEOUT),
  });
}

export async function requireAuth(): Promise<SsoUser> {
  const token = await getToken();
  if (!token) throw new UnauthorizedError("no_token");

  try {
    const res = await fetchSSO("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new UnauthorizedError("session_expired");
    const data = await res.json();
    return data.user as SsoUser;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError("sso_unreachable");
  }
}

export function withAuth(
  handler: (req: Request, user: SsoUser) => Promise<NextResponse>
) {
  return async (req: Request) => {
    try {
      const user = await requireAuth();
      return await handler(req, user);
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) throw err;
      const status = err.code === "sso_unreachable" ? 502 : 401;
      const response = NextResponse.json({ error: err.code }, { status });
      if (err.code === "session_expired") response.cookies.delete(TOKEN_COOKIE);
      return response;
    }
  };
}
```

### `app/api/auth/me/route.ts`

```typescript
import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/sso";

export const GET = withAuth(async (_req, user) => NextResponse.json({ user }));
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

### `app/api/auth/logout/route.ts`

```typescript
import { NextResponse } from "next/server";
import { getToken, fetchSSO } from "../../../../lib/sso";

const APP_URL = process.env.APP_URL!;
const FALLBACK_REDIRECT = `${APP_URL}/?logged_out=1`;

export async function GET() {
  const token = await getToken();
  let redirectTarget = FALLBACK_REDIRECT;

  if (token) {
    try {
      const res = await fetchSSO("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ redirect: FALLBACK_REDIRECT }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { redirect?: string };
        if (data.redirect) redirectTarget = data.redirect;
      }
    } catch {
      // SSO 不可達也繼續清本地 cookie
    }
  }

  const response = NextResponse.redirect(redirectTarget);
  response.cookies.delete("token");
  return response;
}
```

### `app/api/auth/back-channel-logout/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const SSO_APP_SECRET = process.env.SSO_APP_SECRET || "";
const MAX_DRIFT = 30_000;

export async function POST(request: NextRequest) {
  let body: { user_id?: string; timestamp?: number; signature?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { user_id, timestamp, signature } = body;
  if (!user_id || !timestamp || !signature) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (Math.abs(Date.now() - timestamp) > MAX_DRIFT) {
    return NextResponse.json({ error: "Timestamp expired" }, { status: 401 });
  }

  const expected = crypto.createHmac("sha256", SSO_APP_SECRET)
    .update(`${user_id}:${timestamp}`).digest("hex");

  if (signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 模式 B 才需要：刪除自家 SSO 來源 session（見後段）
  return NextResponse.json({ success: true });
}
```

### 登入頁 `app/page.tsx`

契約 #3：沒 session 時**只顯示按鈕**，不可呼叫 `window.location = ssoUrl`。

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const SSO_URL = process.env.NEXT_PUBLIC_SSO_URL!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;
const SSO_APP_ID = process.env.NEXT_PUBLIC_SSO_APP_ID!;

export default function LoginPage() {
  const router = useRouter();
  const error = useSearchParams().get("error");
  const [checking, setChecking] = useState(true);

  const ssoUrl = `${SSO_URL}/api/auth/sso/authorize?client_id=${encodeURIComponent(SSO_APP_ID)}&redirect_uri=${encodeURIComponent(`${APP_URL}/api/auth/callback`)}`;

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.ok ? router.push("/dashboard") : setChecking(false))
      .catch(() => setChecking(false));
  }, [router]);

  if (checking) return <p>驗證中...</p>;
  return (
    <>
      {error && <p>登入失敗：{error}</p>}
      <button onClick={() => window.location.href = ssoUrl}>透過 DF-SSO 登入</button>
    </>
  );
}
```

---

## 模式 B：本地帳密 + SSO

### 設計原則（核心安全契約）

> **一旦 session 被清除，token 必須立即失效。token 是 SSO 來源的 → 每次請求必檢查中央 session；token 是本地來源的 → 每次請求必檢查自家 session。**

實作方式：**JWT payload 攜帶 `provider` claim**，`requireAuth` 依 provider 分流。本地與 SSO 共用同一個 `token` cookie。

### Token Payload

```typescript
type TokenPayload = {
  userId: string;
  email: string;
  provider: "sso" | "local";
  sessionId?: string; // local 用，對應自家 session store
};
```

### 分流的 `requireAuth`

```typescript
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET!;

export async function requireAuth(): Promise<AuthUser> {
  const token = await getToken();
  if (!token) throw new UnauthorizedError("no_token");

  let decoded: TokenPayload;
  try {
    decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    throw new UnauthorizedError("invalid_token");
  }

  if (decoded.provider === "sso") {
    // SSO 來源：必回源中央驗證（中央 session 被清 → 立即 401）
    const res = await fetchSSO("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new UnauthorizedError("session_expired");
    const data = await res.json();
    return { ...data.user, provider: "sso" };
  }

  // 本地來源：查自家 session（自家 session 被刪 → 立即 401）
  if (!decoded.sessionId) throw new UnauthorizedError("invalid_token");
  const session = await db.localSession.findUnique({
    where: { id: decoded.sessionId },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) {
    throw new UnauthorizedError("session_expired");
  }
  return { ...session.user, provider: "local" };
}
```

### 登入路由

| 路徑 | 行為 |
|------|------|
| `POST /api/auth/login` | 本地帳密驗證 → 寫自家 session → 簽 JWT（`provider: "local"`, `sessionId`）→ 寫 cookie |
| `GET /api/auth/sso/login` | redirect 到 SSO `/authorize`（同模式 A） |
| `GET /api/auth/callback` | exchange 後簽 JWT 時加 `provider: "sso"` |

兩個入口寫**同一個 cookie**，下游只看 `requireAuth` 結果。

### 登出處理

```typescript
export async function GET() {
  const user = await requireAuth().catch(() => null);

  if (user?.provider === "sso") {
    // 通知中央刪 Redis session + back-channel
    await fetchSSO("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${await getToken()}` },
    });
  } else if (user?.provider === "local") {
    // 刪自家 session
    await db.localSession.delete({ where: { id: user.sessionId } });
  }

  const response = NextResponse.redirect(`${APP_URL}/?logged_out=1`);
  response.cookies.delete("token");
  return response;
}
```

### Back-channel 處理

收到 SSO 通知時，**只清 SSO 來源的 session**（本地登入使用者不受影響）：

```typescript
// 在自家 user 表加 azure_oid 欄位對應
await db.localSession.deleteMany({
  where: { user: { azureOid: user_id }, provider: "sso" },
});
```

---

## Silent Re-Auth Pattern（解 dashboard 401 體感 Bug）

### 問題

JWT 與中央 session 是兩個獨立計時器（[Design.md「兩種 401 情境對照」](docs/Design.md)）。使用者**在工作中**突然 401 → 直接踢回登入頁 = **體感 Bug**。

契約 #3「登入頁不自動 redirect」**僅針對登入頁**；dashboard / protected 頁面遇到 401 應走 silent re-auth。

### 攔截器：`lib/api-client.ts`

```typescript
const SSO_URL = process.env.NEXT_PUBLIC_SSO_URL!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;
const SSO_APP_ID = process.env.NEXT_PUBLIC_SSO_APP_ID!;

let reAuthPromise: Promise<void> | null = null;

export async function apiFetch(url: string, init?: RequestInit) {
  let res = await fetch(url, { ...init, credentials: "include" });

  if (res.status === 401) {
    reAuthPromise ??= triggerSilentReAuth();
    await reAuthPromise;
    reAuthPromise = null;
    res = await fetch(url, { ...init, credentials: "include" });
  }
  return res;
}

async function triggerSilentReAuth(): Promise<void> {
  // 重試上限防無限迴圈
  const attempts = Number(sessionStorage.getItem("reauth_attempts") || 0);
  if (attempts >= 2) {
    sessionStorage.removeItem("reauth_attempts");
    window.location.href = "/?error=reauth_failed";
    return new Promise(() => {}); // 不 resolve
  }
  sessionStorage.setItem("reauth_attempts", String(attempts + 1));

  // 保留現場（路徑 / 滾動 / 未送出表單序列化）
  sessionStorage.setItem("post_reauth_url", location.pathname + location.search);

  // 走 SSO authorize → callback 後回 dashboard
  window.location.href = `${SSO_URL}/api/auth/sso/authorize?client_id=${SSO_APP_ID}&redirect_uri=${encodeURIComponent(`${APP_URL}/api/auth/callback`)}`;
  return new Promise(() => {}); // 等待 navigation
}
```

### 復原現場：`app/dashboard/layout.tsx`

```tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const target = sessionStorage.getItem("post_reauth_url");
    if (target) {
      sessionStorage.removeItem("post_reauth_url");
      sessionStorage.removeItem("reauth_attempts");
      router.replace(target);
    }
  }, [router]);

  return <>{children}</>;
}
```

### 模式 A vs B 的差異

| 模式 | dashboard 401 處理 |
|------|--------------------|
| **A. 純 SSO** | 一律走 silent re-auth（token 必為 SSO） |
| **B. 混合** | 先看當前 user 的 `provider`：`"sso"` → silent re-auth；`"local"` → 跳本地登入頁 |

模式 B 實作建議：讓 `/api/auth/me` 回應帶 `provider` 欄位，前端據此分流。

```typescript
async function triggerSilentReAuth() {
  const provider = await fetch("/api/auth/me").then(r => r.json()).then(d => d.user?.provider).catch(() => null);
  if (provider === "local") {
    sessionStorage.setItem("post_login_url", location.pathname + location.search);
    window.location.href = "/login"; // 本地登入頁
    return;
  }
  // 預設走 SSO silent re-auth（含 provider unknown）
  // ...
}
```

### 三種 silent re-auth 結局

| 狀況 | 體感 |
|------|------|
| 中央 session 還在 | 卡頓 < 1s，回原頁面 |
| 中央 session 死，AD session 還在 | 卡頓 1-2s（AD silent SSO），回原頁面 |
| AD session 也死 | Microsoft 跳登入畫面 |

---

## 用戶資料格式

`/api/auth/me`（中央回應）：

```json
{
  "user": {
    "userId": "azure-oid",
    "email": "user@df-recycle.com",
    "name": "王小明",
    "erpData": {
      "gen01": "00063", "gen02": "王小明", "gen03": "F000",
      "gem02": "財務部", "gen06": "user@df-recycle.com"
    },
    "loginAt": "2026-04-09T10:30:00.000Z"
  }
}
```

`erpData` 可能為 `null`（AD 有但 ERP 找不到員工）。模式 B 自家包裝後請追加 `provider` 欄位。

---

## 非 Next.js 框架

核心仍是 **4 個 HTTP 端點 + 1 個登入頁 + 1 個 401 攔截器**。`requireAuth` 包成框架原生 middleware：

| 框架 | 對應實作 |
|------|---------|
| Express | `async function requireAuth(req, res, next)` → 成功塞 `req.user`，失敗 `clearCookie + 401` |
| FastAPI | `user = Depends(require_auth)` |
| Spring Boot | 繼承 `OncePerRequestFilter`，成功塞 `request.setAttribute("ssoUser", ...)` |

**必守**：
- 所有 server-to-server fetch `cache: "no-store"` + timeout
- `client_secret` 絕不出現在前端 bundle
- back-channel HMAC + 30s timestamp 驗證（`crypto.timingSafeEqual` / `hmac.compare_digest` / `MessageDigest.isEqual`）
- 登入頁 401 顯示按鈕，dashboard 401 走 silent re-auth
- 模式 B 必有 provider 分流，**SSO 來源 token 一律即時驗中央**

---

## 常見錯誤

| 訊息 / 症狀 | 原因 |
|------|------|
| `Invalid client_id` | `SSO_APP_ID` 錯或 App 未啟用 |
| `Invalid client credentials` | `SSO_APP_SECRET` 錯 |
| `redirect_uri is not registered` | `APP_URL` origin 不在白名單 |
| `exchange_failed` | auth code 過期（60s）或已使用 |
| `Too many ...` | rate limit（預設值見 Dashboard「設定」分頁） |
| `Invalid signature`（back-channel） | `SSO_APP_SECRET` 不一致或 timestamp >30s |
| 登出後其他 App 仍可用 | 正常，下次 `/me` 才 401（契約 #1） |
| 登出後立刻被自動登入 | (a) 沒 POST 中央 `/logout`（契約 #2）；(b) 登入頁在 401 時自動 redirect 到 `/authorize`（契約 #3） |
| **工作中突然被踢出** | **沒做 silent re-auth — 加 401 攔截器** |
| 模式 B：SSO 登出後該 user 仍能用本地憑證 | 正常，本地與 SSO 是兩套獨立 session |
| 模式 B：本地刪 session 後 token 還能用 | `requireAuth` 沒分流，或 SSO 來源 token 漏接 `provider === "sso"` 分支 |

> Rate limit 為動態值，實際以當下 SSO Dashboard「設定」分頁為準。
