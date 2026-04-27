# 初始化 SSO 登入器整合（Next.js）

在當前 Next.js 專案中自動建立 DF-SSO 登入器所需的所有檔案。
**執行前會詢問必要資訊，之後全自動完成。**

> 對應 [INTEGRATION.md](../../INTEGRATION.md) 的契約。
> 預設 **Next.js 15 App Router / Node runtime**（不使用 `middleware.ts` edge runtime，因為 back-channel 要 Node `crypto`）。

## 詢問使用者（依序）

1. **SSO Backend URL** — SSO 中央伺服器網址
   - Prod：`https://df-sso-login.apps.zerozero.tw`
   - Test：`https://df-sso-login-test.apps.zerozero.tw`
   - Dev：`http://localhost:3001`
2. **App URL** — 你的專案網址（例如 `https://warehouse.apps.zerozero.tw`，本機 `http://localhost:3100`）
3. **App ID** — SSO Dashboard 產生的 `app_id`（UUID）
4. **App Secret** — SSO Dashboard 產生的 `app_secret`（64 字元，保密）
5. **App Port** — 你的專案 Port（例如 `3100`）

## 執行步驟

### 1. 建立 `lib/sso.ts` — fetch 工具 + Auth Middleware

**整個整合的核心**。所有 protected route（包含 `/me` 本身）都必須透過這裡的 `withAuth` / `requireAuth`，才能保證「中央 session 被撤銷後下一次呼叫立即失效」。

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

// ---------- Auth Middleware ----------

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

必須 POST 中央 `/logout` **並把瀏覽器導去 SSO 回傳的 `logout_url`**（OIDC RP-Initiated Logout，契約 #2）。
只 POST 不導 `logout_url` 等於沒登 AD，使用者重新整理會被 AD 靜默拉回登入。

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
        const data = (await res.json().catch(() => ({}))) as { logout_url?: string };
        if (data.logout_url) redirectTarget = data.logout_url;
      }
    } catch { /* 網路失敗忽略，本地 cookie 仍要清，落地 fallback URL */ }
  }

  const response = NextResponse.redirect(redirectTarget);
  response.cookies.delete("token");
  return response;
}
```

### 5. 建立 `app/api/auth/back-channel-logout/route.ts`

**必須**驗 HMAC + timestamp（契約 #3），否則任何人都能偽造登出。

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

  // TODO: 若你的 App 本地有 server-side session（Redis / DB），在這裡 invalidate user_id 的 session
  return NextResponse.json({ success: true });
}
```

### 6. 建立登入頁 `app/page.tsx`

核心判斷順序：**`if (res.ok) → /dashboard` 在前、`if (loggedOut) → 顯示按鈕` 在後**。禁止調換順序（會讓登出後的 F5 永遠卡在登入頁）。

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
          setChecking(false); // 顯示登入按鈕
        } else {
          window.location.href = ssoUrl; // no_token → 靜默導向 SSO
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

> 若專案已有 `app/page.tsx`，請詢問使用者是否覆蓋；不覆蓋就把上面的 `useEffect` 邏輯整合到既有的登入頁。

### 7. 建立或更新 `.env.local`

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

### 8. 顯示完成訊息

```
✅ SSO 登入器整合完成（Next.js）！

已建立的檔案：
  lib/sso.ts                                    — fetch 工具 + withAuth / requireAuth middleware
  app/api/auth/callback/route.ts                — OAuth callback + token cookie
  app/api/auth/me/route.ts                      — 一行 withAuth
  app/api/auth/logout/route.ts                  — POST 中央 /logout + 清 cookie + redirect /?logged_out=1
  app/api/auth/back-channel-logout/route.ts     — HMAC + timestamp 驗章
  app/page.tsx                                  — 登入頁（若原本已有請手動整合 useEffect 邏輯）
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

3. 需要角色/權限檢查時改用 requireAuth 手動控：

   import { requireAuth, UnauthorizedError } from "../../../lib/sso";

   export async function GET() {
     try {
       const user = await requireAuth();
       if (!user.email.endsWith("@df-recycle.com")) {
         return NextResponse.json({ error: "forbidden" }, { status: 403 });
       }
       return NextResponse.json({ /* ... */ });
     } catch (err) {
       if (err instanceof UnauthorizedError) {
         const response = NextResponse.json({ error: err.code }, { status: 401 });
         if (err.code === "session_expired") response.cookies.delete("token");
         return response;
       }
       throw err;
     }
   }

4. 登出按鈕直接連 /api/auth/logout：

   <a href="/api/auth/logout">登出</a>

5. 啟動測試：
   npm run dev
   curl http://localhost:{使用者填的 Port}/api/auth/me   # 應該回 401 no_token
```

## 注意事項

- **禁止 Next.js `middleware.ts`**：edge runtime 沒 Node `crypto`、cookie 清除 + redirect 難處理。`withAuth` HOF 跑 Node runtime，可預測、可測試。
- **Cookie 名固定為 `token`**：對齊 [INTEGRATION.md](../../INTEGRATION.md)，若改名要同時改 `TOKEN_COOKIE` 常數與 callback/logout/withAuth 三處。
- **所有 protected handler 都要 `withAuth(...)`**：**禁止**自行 `fetch(... /me)` 或直接讀 cookie，否則容易漏寫「session 被撤銷時清本地 cookie」。
- **no_token vs session_expired 的差異不可合併**：前端看 `no_token` 會自動導向 SSO（跨 App 免登入），看 `session_expired` 會顯示按鈕避免死循環。
- **每次 request 都回源**：正確行為。流量大時可在 `requireAuth` 加 in-process 短 TTL 快取（代價：登出感知延遲），敏感操作務必 bypass。
- **back-channel TODO**：若本地用 Redis / DB 存 session，收到 HMAC-verified 請求後要實際 invalidate 該 `user_id`。
- **目錄已存在同名檔**：先詢問使用者是否覆蓋。
