# DF-SSO 串接指南

給接入 DF-SSO 的 Client App 與 AI Agent 使用的規範契約。

## SSO 中央環境

| 環境 | Backend URL（Client 呼叫） | Dashboard |
|------|----------------------------|-----------|
| **Prod** | `https://df-sso-login.apps.zerozero.tw` | `https://df-sso-management.apps.zerozero.tw` |
| **Test** | `https://df-sso-login-test.apps.zerozero.tw` | `https://df-sso-management-test.apps.zerozero.tw` |
| **Dev**  | `http://localhost:3001` | `http://localhost:3000` |

每個環境各自發放 credentials。同一個 App 接多環境必須到每個 Dashboard 各建一筆，各拿一組不同的 `app_id` + `app_secret`。
`redirect_uris` 可同時列多個 origin（例如 prod credentials 同時列正式 + localhost 給開發者除錯）。

---

## 硬性契約（漏一條 SSO 就壞）

中央**無法強制驗證** Client 是否遵守，全靠自律實作：

1. **`/api/auth/me` 即時回源中央**：本地 handler 必須以 `Authorization: Bearer <token>` 轉發到中央。中央 Redis 是唯一事實來源，**JWT 簽名有效 ≠ session 仍存在**。
2. **登出必須 POST 中央 `/api/auth/logout`**：只清本地 cookie 等於沒登出，使用者回到登入頁會被靜默拉回登入狀態。
3. **Back-channel logout 必須驗 HMAC + timestamp**：否則任何人都能偽造登出把使用者踢掉。

---

## 前置作業

### 1. 向管理員申請 App（每環境分別）

到目標 Dashboard（Prod / Test / Dev）新增：

| 欄位 | 範例 |
|------|------|
| 網域 | `https://warehouse.apps.zerozero.tw` |
| 系統名稱 | 倉儲系統 |
| 說明 | 大豐倉儲管理系統 |
| Redirect URIs（最多 10） | `https://warehouse.apps.zerozero.tw`、`http://localhost:3100` |

建立後 Dashboard「顯示金鑰」可取得 `app_id`（UUID，公開）+ `app_secret`（64 字元，保密）。

### 2. 環境變數

```env
# Server-side（runtime，保密）
SSO_URL=https://df-sso-login.apps.zerozero.tw
SSO_APP_ID=<app_id>
SSO_APP_SECRET=<app_secret>
APP_URL=https://warehouse.apps.zerozero.tw

# Client-side（build time，公開）
NEXT_PUBLIC_SSO_URL=https://df-sso-login.apps.zerozero.tw
NEXT_PUBLIC_SSO_APP_ID=<同 SSO_APP_ID>
NEXT_PUBLIC_APP_URL=https://warehouse.apps.zerozero.tw
```

- 接 Test / Dev 時把所有 URL 換環境對應值，並**從該環境的 Dashboard 拿另一組** credentials
- `APP_URL` origin 必須在該 App 的 `redirect_uris` 中
- `SSO_APP_SECRET` **絕不可**出現在前端 bundle

---

## 路由契約

### 必要頁面

| 路徑 | 用途 | 進入時機 |
|------|------|---------|
| `/` | 登入頁 | 登出 / session 過期 / exchange 失敗 |
| `/dashboard` | 登入後首頁 | OAuth callback 換 token 成功 |

- `/` mount 時呼叫 `/api/auth/me`：已登入 → `router.push("/dashboard")`；`no_token` → 自動導向 SSO `authorize`（享受跨 App 免登入）；`session_expired` / `error` / `logged_out=1` → 顯示按鈕（**不**自動導向）
- `/dashboard` mount 時呼叫 `/api/auth/me`：失敗則導回 `/`
- 錯誤 query：`?error=no_code | exchange_failed | exchange_error | session_expired` / `?logged_out=1`

### 必要 API Route

| 檔案 | 職責 |
|------|------|
| `lib/sso.ts` | fetch 工具 + **`requireAuth` / `withAuth` auth middleware（一等公民）** |
| `app/api/auth/callback/route.ts` | 收 code → 中央 `/sso/exchange` → 寫 token cookie → redirect `/dashboard` |
| `app/api/auth/me/route.ts` | 一行 `withAuth(...)`，直接回 user |
| `app/api/auth/logout/route.ts` | Bearer POST 中央 `/logout` → 清本地 cookie → redirect `/?logged_out=1` |
| `app/api/auth/back-channel-logout/route.ts` | 驗 HMAC + timestamp → 回 `{ success: true }` |

若已有不同路由結構，callback 成功後的 redirect、logout 後的 redirect、登入頁 `router.push` 這三處**必須改成同一套路徑**。建議直接沿用 `/` + `/dashboard` 跨 App 對齊。

---

## Next.js 樣板

### `lib/sso.ts` — fetch 工具 + Auth Middleware

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

### `app/api/auth/me/route.ts`

`/me` route 本身就是 middleware 的第一個使用者，handler 只做一件事：把 user 回給前端。

```typescript
import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/sso";

export const GET = withAuth(async (_req, user) => NextResponse.json({ user }));
```

### Protected API routes（套用同一條 middleware）

所有需要登入的業務 endpoint 一律 `withAuth(...)` 包裝。**禁止**自行 fetch cookie + 自己打中央，否則容易漏寫「session 被撤銷時清本地 cookie」。

```typescript
// app/api/assets/route.ts
import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/sso";

export const GET = withAuth(async (_req, user) => {
  return NextResponse.json({ viewer: user.email, assets: [] });
});

export const POST = withAuth(async (req, user) => {
  const body = await req.json();
  // 用 user.userId / user.email 當 owner
  return NextResponse.json({ ok: true });
});
```

### 要細控時改用 `requireAuth`

需要自訂 401 回應格式或驗完登入還要檢 role / 權限時：

```typescript
// app/api/reports/route.ts
import { NextResponse } from "next/server";
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

export async function GET() {
  const token = await getToken();
  if (token) {
    try {
      await fetchSSO("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* 忽略網路錯誤，本地 cookie 仍要清 */ }
  }
  const response = NextResponse.redirect(new URL("/?logged_out=1", APP_URL));
  response.cookies.delete("token");
  return response;
}
```

### `app/api/auth/back-channel-logout/route.ts`

SSO 登出時會帶 HMAC-SHA256 簽章，Client 必須驗簽 + timestamp 防 replay。

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

  return NextResponse.json({ success: true });
}
```

### 登入頁 `app/page.tsx`

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

### 注意事項

- **不要用 Next.js `middleware.ts`**：edge runtime 沒有 Node `crypto` 模組（back-channel HMAC 會壞），cookie 清除 + redirect 也難處理。`withAuth` HOF 跑 Node runtime，行為可預測、可測試。
- **每次 request 都回源的成本**：正確行為，但會增加中央 `/me` QPS。`sessionLimiter` 預設 100 / 15min per IP。流量大時可向管理員申請調高 rate limit，或在子系統加**短 TTL 快取**（例如 in-process 5 秒 cache），代價是登出感知延遲該秒數。敏感操作（改密碼、付款）務必 bypass 快取強制即時驗。
- **`requireAuth` 只驗 authentication**：它告訴你「這個人是誰」，「這個人能不能做這件事」仍是子系統自己的 authorization 責任。

---

## 登出死循環與 `?logged_out=1`

「跨 App 免登入」的副作用：剛清完本地 cookie 後進入 `/`，`useEffect` 若直接導回 SSO，中央 session 還在就會瞬間拿到新 token 回來（等於沒登出）。

`?logged_out=1` 是**一次性暫停旗標**，打斷這條死循環：

| 進入 `/` 的情境 | URL query | 行為 |
|----------------|-----------|------|
| 第一次訪問 / 跨 App 跳來 |（無）| 靜默導向 SSO |
| Session 過期 | `?error=session_expired` | 顯示按鈕，**不**自動導 |
| 剛點完登出 | `?logged_out=1` | 顯示按鈕，**不**自動導 |
| 其他錯誤 | `?error=...` | 顯示按鈕，**不**自動導 |

登入頁判斷順序必須是 **`if (res.ok) → /dashboard` 在前、`if (loggedOut) → 顯示按鈕` 在後**。這會導致一個「預期非 bug」：Tab1 登出後顯示 `?logged_out=1`，Tab2 另一 App 重新登入（同 origin token cookie 共享），Tab1 F5 → 直接進 dashboard。這是**對的**：使用者實際上已經有有效 session，卡在登入頁反而是真正的 bug。

> MockA（[../DF-SSO-MockA/app/page.tsx](../DF-SSO-MockA/app/page.tsx)）與 MockB 是 reference 實作。

---

## 非 Next.js 專案

任何後端框架都能實作，核心是 **4 個 HTTP 端點 + 1 個登入頁**，語義與上方 Next.js 版本一致：

| 端點 | 做什麼 |
|------|--------|
| `GET /api/auth/callback?code=xxx` | POST 中央 `/api/auth/sso/exchange` → 存 token cookie → redirect dashboard |
| `GET /api/auth/me` | 讀 cookie → Bearer 呼叫中央 `/api/auth/me` → 401 時清 cookie 回 `session_expired` |
| `GET /api/auth/logout` | 讀 cookie → Bearer POST 中央 `/api/auth/logout` → 清 cookie → redirect `/?logged_out=1` |
| `POST /api/auth/back-channel-logout` | 驗 HMAC + timestamp → 回 `{ success: true }` |

**必守**：

- 所有 server-to-server fetch 加 `cache: "no-store"` + timeout
- `/me` 必須區分 `no_token`（自動導向 SSO）與 `session_expired`（顯示按鈕）
- `client_secret` **絕不可**出現在前端
- back-channel：`HMAC-SHA256(app_secret, "${user_id}:${timestamp}")`、constant-time 比對（Node `crypto.timingSafeEqual` / Python `hmac.compare_digest` / Java `MessageDigest.isEqual`）、`abs(now - timestamp) ≤ 30_000 ms`
- **把 `/me` 驗證包成框架原生 middleware**（概念等同 `withAuth`），所有 protected endpoint 必須經過：

| 框架 | 對應實作 |
|------|---------|
| Express | `async function requireAuth(req, res, next)` → 成功塞 `req.user`，失敗 `clearCookie + 401` |
| FastAPI | `user = Depends(require_auth)`，protected endpoint 宣告依賴 |
| Spring Boot | 繼承 `OncePerRequestFilter`，成功塞 `request.setAttribute("ssoUser", ...)` |

中央 session 被撤銷後必須立刻生效 — 禁止本地快取繞過中央驗證，除非明確加短 TTL 並能說明影響範圍。

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

> `erpData` 可能為 `null`（使用者在 Azure AD 存在但 ERP 找不到對應員工）。

---

## 常見錯誤

| 訊息 | 原因 |
|------|------|
| `Invalid client_id` | `SSO_APP_ID` 錯誤或該 App 未啟用 |
| `Invalid client credentials` | `SSO_APP_SECRET` 錯誤 |
| `redirect_uri is not registered` | `APP_URL` origin 不在白名單 `redirect_uris` |
| `exchange_failed` | auth code 過期（60 秒）或已使用 |
| `Too many authentication attempts` | auth rate limit（預設 30 / 15min） |
| `Too many requests`（`/me` / `/logout`） | session rate limit（預設 100 / 15min） |
| `Too many exchange attempts` | exchange rate limit（預設 20 / 1min） |
| `Invalid signature`（back-channel） | `SSO_APP_SECRET` 不一致或 timestamp 超過 30 秒 |
| 登出後其他 App 仍可用 | 正常，其他 App 下次 `/me` 才會 401（契約 #1） |
| 按了登出馬上又自動登入回去 | Client 沒有 POST 中央 `/logout`，中央 Redis session 還活著（契約 #2） |

> Rate limit 為動態值，實際以當下 SSO 環境 Dashboard「設定」分頁為準。
