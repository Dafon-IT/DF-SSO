# 初始化 SSO 登入器整合（Next.js）

在當前 Next.js 專案中自動建立 DF-SSO 登入器所需的所有檔案。
**執行前會詢問必要資訊，之後全自動完成。**

> 對應 [INTEGRATION.md](../../INTEGRATION.md) 的契約。**此 command 建立的是模式 A（純 SSO）**；若你的 App 同時要支援本地帳密 + SSO（模式 B），請讀 INTEGRATION.md「模式 B」章節後手動延伸（這裡建立的 `withAuth` 即為模式 B 的「provider = sso」分支）。
> 預設 **Next.js 15 App Router / Node runtime**（不使用 `middleware.ts` edge runtime，因為 back-channel 要 Node `crypto`）。

## 硬性契約（必看，漏一條就壞）

1. **`/me` 即時回源中央**：`withAuth` 內每次都打中央 `/api/auth/me`，**禁止本地快取 user**
2. **登出 POST 中央 + 跟隨 redirect**：`/api/auth/logout` 必須先通知中央再清本地 cookie
3. **登入頁 401 顯示按鈕，不自動 redirect**：`app/page.tsx` 在 `/me` 401 時**只**顯示按鈕（自動 redirect 會破壞「登出真有效」）
4. **Back-channel logout 必驗 HMAC + timestamp**：`crypto.timingSafeEqual` + 30s drift；不註冊端點 比 註冊但不驗 還安全

完整契約見 [INTEGRATION.md](../../INTEGRATION.md)「硬性契約」與「Silent Re-Auth Pattern」。

## 詢問使用者（依序）

1. **SSO Backend URL** — SSO 中央伺服器網址
   - Prod：`https://df-it-sso-login.it.zerozero.tw`
   - Test：`https://df-sso-login-test.apps.zerozero.tw`
   - Dev：`http://localhost:3001`
2. **App URL** — 你的專案網址（例如 `https://warehouse.apps.zerozero.tw`，本機 `http://localhost:3100`）
3. **App ID** — SSO Dashboard 產生的 `app_id`（UUID）
4. **App Secret** — SSO Dashboard 產生的 `app_secret`（64 字元，保密）
5. **App Port** — 你的專案 Port（例如 `3100`）

## 執行步驟

### 1. 建立 `lib/sso.ts` — fetch 工具 + Auth Middleware

**整個整合的核心**。所有 protected route（包含 `/me` 本身）都必須透過這裡的 `withAuth` / `requireAuth`，才能保證契約 #1（中央 session 被撤銷後下一次呼叫立即失效）。

```typescript
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// ---------- 常數 ----------
const TOKEN_COOKIE = "token";
const SSO_URL = process.env.SSO_URL || "http://localhost:3001";
const SSO_TIMEOUT = 8000;

export const SSO_APP_ID = process.env.SSO_APP_ID || "";
export const SSO_APP_SECRET = process.env.SSO_APP_SECRET || "";

// ---------- 型別 ----------
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

// ---------- 基礎工具 ----------
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

// ---------- Auth Middleware（契約 #1）----------

/** Protected handler 入口都呼叫這個。成功 → SsoUser；失敗 → throw UnauthorizedError。 */
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

/** HOF wrapper：handler 內的 user 保證已登入；失敗自動回 401 / 502 + 清 cookie。 */
export function withAuth(
  handler: (req: Request, user: SsoUser) => Promise<NextResponse>
) {
  return async (req: Request): Promise<NextResponse> => {
    try {
      const user = await requireAuth();
      return await handler(req, user);
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) throw err;
      const status = err.code === "sso_unreachable" ? 502 : 401;
      const response = NextResponse.json({ error: err.code }, { status });
      // sso_unreachable 不刪 cookie（避免短暫網路抖動踢人）
      if (err.code === "session_expired") response.cookies.delete(TOKEN_COOKIE);
      return response;
    }
  };
}
```

### 2. 建立 `app/api/auth/callback/route.ts`

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

### 3. 建立 `app/api/auth/me/route.ts`（一行 middleware）

`/me` route 本身就是 middleware 的第一個使用者，handler 只負責回 user：

```typescript
import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/sso";

export const GET = withAuth(async (_req, user) => NextResponse.json({ user }));
```

### 4. 建立 `app/api/auth/logout/route.ts`

兩層 Session 模型：POST 中央 `/logout` → 中央刪 Redis session + 廣播 back-channel → 回傳 `{ message, redirect }` → 把瀏覽器導向 `redirect`（契約 #2）。**AD session 完全不動**。

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
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ redirect: FALLBACK_REDIRECT }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { redirect?: string };
        if (data.redirect) redirectTarget = data.redirect;
      }
    } catch { /* 網路失敗忽略，本地 cookie 仍要清，落地 fallback URL */ }
  }

  // 不論成功與否：同一 response 刪 cookie（避免「中央拒絕但本地仍登入」）
  const response = NextResponse.redirect(redirectTarget);
  response.cookies.delete("token");
  return response;
}
```

### 5. 建立 `app/api/auth/back-channel-logout/route.ts`

**契約 #4**：必須驗 HMAC + timestamp，否則任何人都能偽造登出。模式 A 純 SSO 通常**不需要主動清任何東西**（中央已刪 session，下次 `/me` 自然 401），下方範例僅提供結構，若 App 完全沒有 server-side state 可考慮**整支不註冊**——「保留但不驗」比「不註冊」更糟。

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
  if (Math.abs(Date.now() - timestamp) > MAX_TIMESTAMP_DRIFT) {
    return NextResponse.json({ error: "Timestamp expired" }, { status: 401 });
  }

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

  // TODO: 若你的 App 有 in-process 快取 / WebSocket 連線 / server-push 狀態，在這裡 invalidate user_id
  return NextResponse.json({ success: true });
}
```

### 6. 建立 `lib/sso-silent-reauth.ts` — 前端 401 攔截器（dashboard 用）

**契約 #3 只針對登入頁**。Dashboard 工作中遇到 401 一律走 silent re-auth，否則 = 體感 Bug。
模式 A 純 SSO 直接 navigate 到 authorize URL（中央 session 還在 → 卡頓 < 1s 回原頁；中央死、AD 還在 → 1-2s；AD 也死 → MS 登入畫面）。

```typescript
"use client";

const SSO_URL = process.env.NEXT_PUBLIC_SSO_URL!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;
const SSO_APP_ID = process.env.NEXT_PUBLIC_SSO_APP_ID!;

const STORAGE_KEY_PATH = "sso_reauth_path";
const STORAGE_KEY_ATTEMPTS = "sso_reauth_attempts";
const MAX_ATTEMPTS = 2;

let inFlight: Promise<never> | null = null;

/** 401 處理入口：去重 + 重試上限 + 保留現場 + navigate 到 authorize URL。 */
export function triggerSilentReauth(): Promise<never> {
  if (inFlight) return inFlight;

  inFlight = new Promise<never>(() => {
    const attempts = Number(sessionStorage.getItem(STORAGE_KEY_ATTEMPTS) || "0");
    if (attempts >= MAX_ATTEMPTS) {
      sessionStorage.removeItem(STORAGE_KEY_PATH);
      sessionStorage.removeItem(STORAGE_KEY_ATTEMPTS);
      window.location.href = `${APP_URL}/?error=reauth_failed`;
      return;
    }

    sessionStorage.setItem(STORAGE_KEY_ATTEMPTS, String(attempts + 1));
    sessionStorage.setItem(STORAGE_KEY_PATH, window.location.pathname + window.location.search);

    const ssoUrl =
      `${SSO_URL}/api/auth/sso/authorize` +
      `?client_id=${encodeURIComponent(SSO_APP_ID)}` +
      `&redirect_uri=${encodeURIComponent(`${APP_URL}/api/auth/callback`)}`;
    window.location.href = ssoUrl; // 整頁卸載；不要 await fetch retry
  });

  return inFlight;
}

/** Dashboard 入口呼叫一次：若有保留的 path 就跳回去並清狀態。 */
export function consumeReauthRestore(): string | null {
  const saved = sessionStorage.getItem(STORAGE_KEY_PATH);
  if (saved) {
    sessionStorage.removeItem(STORAGE_KEY_PATH);
    sessionStorage.removeItem(STORAGE_KEY_ATTEMPTS);
  }
  return saved;
}

/** Wrapper：fetch 401 自動觸發 silent re-auth；其餘原樣回傳。 */
export async function authedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { credentials: "include", ...init });
  if (res.status === 401) await triggerSilentReauth(); // 永不 resolve（整頁已 navigate）
  return res;
}
```

### 7. 建立登入頁 `app/page.tsx`（契約 #3）

沒 session 時**只顯示按鈕**。**禁止** `window.location = ssoUrl` 自動 redirect — 兩層 Session 模型下，AD silent SSO 永遠成功，自動 redirect = 登出無效。

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

  const ssoUrl =
    `${SSO_URL}/api/auth/sso/authorize` +
    `?client_id=${encodeURIComponent(SSO_APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(`${APP_URL}/api/auth/callback`)}`;

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => {
        if (res.ok) router.push("/dashboard");
        else setChecking(false); // 一律顯示按鈕，不自動 redirect（契約 #3）
      })
      .catch(() => setChecking(false));
  }, [router]);

  if (checking) return <p>驗證中...</p>;

  return (
    <div>
      {error === "reauth_failed" && <p>登入逾時，請重新登入</p>}
      {error && error !== "reauth_failed" && <p>登入失敗：{error}</p>}
      {loggedOut && <p>已登出</p>}
      <button onClick={() => (window.location.href = ssoUrl)}>透過 DF-SSO 登入</button>
    </div>
  );
}
```

> 若專案已有 `app/page.tsx`，請詢問使用者是否覆蓋；不覆蓋就把 `useEffect` 邏輯整合到既有登入頁（**禁止** 在 401 時自動 `window.location = ssoUrl`）。

### 8. 建立 `app/dashboard/layout.tsx` — 復原職責

dashboard layout / shell 在掛載時讀 sessionStorage 的「保留現場 path」，存在則跳回該 path。

```tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { consumeReauthRestore } from "../../lib/sso-silent-reauth";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const saved = consumeReauthRestore();
    if (saved && saved !== window.location.pathname + window.location.search) {
      router.replace(saved);
    }
  }, [router]);

  return <>{children}</>;
}
```

> 若專案已有 dashboard layout，請把 `useEffect` 整合進去即可，不要新建一份重複的。

### 9. 建立或更新 `.env.local`

在現有的 `.env.local` **追加**（不覆蓋原有內容）：

```
# DF-SSO 登入器（server-side，保密）
SSO_URL={使用者填的 SSO URL}
SSO_APP_ID={使用者填的 App ID}
SSO_APP_SECRET={使用者填的 App Secret}
APP_URL={使用者填的 App URL}

# DF-SSO 登入器（client-side，build time，可公開）
NEXT_PUBLIC_SSO_URL={使用者填的 SSO URL}
NEXT_PUBLIC_SSO_APP_ID={使用者填的 App ID}
NEXT_PUBLIC_APP_URL={使用者填的 App URL}
```

> ⚠️ `SSO_APP_SECRET` **絕不可** commit 進 git、**絕不可**以 `NEXT_PUBLIC_` 前綴暴露給前端。
> ⚠️ 同步確認 `.gitignore` 包含 `.env.local` / `.env*.local`。

### 10. 顯示完成訊息

```
✅ SSO 登入器整合完成（Next.js / 模式 A 純 SSO）！

已建立的檔案：
  lib/sso.ts                                    — fetch 工具 + withAuth / requireAuth（契約 #1）
  lib/sso-silent-reauth.ts                      — 前端 401 攔截器 + 復原（dashboard 401 處理）
  app/api/auth/callback/route.ts                — OAuth callback + token cookie
  app/api/auth/me/route.ts                      — 一行 withAuth
  app/api/auth/logout/route.ts                  — 通知中央 + 清 cookie + redirect（契約 #2）
  app/api/auth/back-channel-logout/route.ts     — HMAC + timestamp 驗章（契約 #4）
  app/page.tsx                                  — 登入頁 401 顯示按鈕（契約 #3）
  app/dashboard/layout.tsx                      — silent re-auth 復原入口
  .env.local                                    — 已追加 SSO 環境變數

📋 接下來你需要：

1. 確認 SSO Dashboard 的白名單：
   - 網域：{使用者填的 App URL}
   - Redirect URIs 要包含：{使用者填的 App URL}

2. 在所有需要登入的 API route 上都用 withAuth 包起來（禁止自己 fetch cookie + 自己打中央）：

   // app/api/assets/route.ts
   import { NextResponse } from "next/server";
   import { withAuth } from "../../../lib/sso";

   export const GET = withAuth(async (_req, user) => {
     return NextResponse.json({ viewer: user.email, assets: [] });
   });

3. dashboard 內所有 API 呼叫改用 authedFetch（自動觸發 silent re-auth）：

   import { authedFetch } from "@/lib/sso-silent-reauth";

   const res = await authedFetch("/api/assets");
   // 401 時整頁會 navigate 到 SSO；res.json() 不會執行到

4. 需要角色/權限檢查時改用 requireAuth 手動控：

   import { requireAuth, UnauthorizedError } from "../../../lib/sso";

   try {
     const user = await requireAuth();
     if (!user.email.endsWith("@df-recycle.com")) {
       return NextResponse.json({ error: "forbidden" }, { status: 403 });
     }
     // ...
   } catch (err) { /* 同 withAuth 的處理 */ }

5. 登出按鈕直接連 /api/auth/logout：

   <a href="/api/auth/logout">登出</a>

6. 啟動測試：
   npm run dev
   curl http://localhost:{使用者填的 Port}/api/auth/me   # 應該回 401 no_token
```

## 注意事項

- **禁止 Next.js `middleware.ts`**：edge runtime 沒 Node `crypto`、cookie 清除 + redirect 難處理。`withAuth` HOF 跑 Node runtime，可預測、可測試。
- **Cookie 名固定為 `token`**：對齊 [INTEGRATION.md](../../INTEGRATION.md)，若改名要同時改 `TOKEN_COOKIE` 常數與 callback/logout/withAuth 三處。
- **所有 protected handler 都要 `withAuth(...)`**：**禁止**自行 `fetch(... /me)` 或直接讀 cookie，否則容易漏寫「session 被撤銷時清本地 cookie」。
- **登入頁 vs dashboard 401 處理不一樣**：登入頁（契約 #3）禁止自動 redirect；dashboard 工作中（silent re-auth）必須自動 redirect。兩者邏輯放在不同檔案。
- **每次 request 都回源**：正確行為（契約 #1）。流量大時可在 `requireAuth` 加 in-process 短 TTL 快取（代價：登出感知延遲），敏感操作務必 bypass。
- **back-channel TODO**：模式 A 純 SSO 通常不需動作；若 App 真的沒有 server-side state（無 Redis 快取、無 WebSocket、無 push），可整支 route 不註冊。**保留無驗證的端點 比 不註冊還糟**——前者騙系統有保護。
- **模式 B（本地帳密 + SSO）**：JWT payload 加 `provider` claim、守衛分流、登入路徑分兩條、back-channel 只清 SSO 來源 session。本 command 不自動建立模式 B；請延伸 `withAuth` 讓它在解 JWT 後依 `provider` 分流（細節見 [INTEGRATION.md](../../INTEGRATION.md)「模式 B」）。
- **目錄已存在同名檔**：先詢問使用者是否覆蓋。
