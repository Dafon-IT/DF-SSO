# DF-SSO 串接指南

本文件說明企業內部專案如何串接 DF-SSO 單一登入系統。

> **SSO 中央線上環境：**
>
> | 環境 | Backend URL（Client App 呼叫） | Management Dashboard |
> |------|--------------------------------|---------------------|
> | **Prod** | `https://df-sso-login.apps.zerozero.tw` | `https://df-sso-management.apps.zerozero.tw` |
> | **Test** | `https://df-sso-login-test.apps.zerozero.tw` | `https://df-sso-management-test.apps.zerozero.tw` |
> | **Dev**  | `http://localhost:3001` | `http://localhost:3000` |
>
> **每個環境的 credentials 完全獨立**：同一個 Client App 若要接多環境，必須在每個環境的 Dashboard 各建一筆，各拿一組不同的 `app_id` + `app_secret`。
>
> 「跨環境」只指 `redirect_uris` 可列多個 origin（例如 prod credentials 同時列 `https://warehouse.apps.zerozero.tw` 與 `http://localhost:3100`，讓開發者能用 prod credentials 在本機除錯）。

---

## 必守契約（漏任一項 SSO 流程就壞掉）

下列三點是接入硬性條件。中央**無法強制驗證** Client 有沒有做到，完全靠 Client 自律實作：

1. **`/api/auth/me` 必須即時打中央** — 本地 `/me` route 必須以 `Authorization: Bearer <token>` 轉發到中央 `/api/auth/me`，讓中央檢查 Redis session 是否還活著。中央 Redis session 是登入狀態的唯一事實來源，**JWT 簽名有效 ≠ 使用者仍在登入狀態**。
2. **登出必須打中央 `POST /api/auth/logout`** — 只清本地 cookie 等於沒登出。中央 Redis session 沒刪，使用者一回到登入頁就會被靜默拉回登入狀態（見 [登出死循環](#登出死循環-與-logged_out1)）。
3. **Back-channel logout 必須驗 HMAC 簽章 + timestamp** — 否則任何人都能偽造登出請求把別的使用者踢掉。

---

## 前置作業

### 1. 向 SSO 管理員申請 App（每環境分別申請）

到目標環境的 Dashboard 新增：

- Prod → `https://df-sso-management.apps.zerozero.tw`
- Test → `https://df-sso-management-test.apps.zerozero.tw`
- Dev  → `http://localhost:3000`（本機 Dashboard）

新增表單欄位：

| 欄位 | 說明 | 範例（Prod） |
|------|------|-------------|
| **網域** | 主要 domain（含 `https://`） | `https://warehouse.apps.zerozero.tw` |
| **系統名稱** | 顯示名稱 | `倉儲系統` |
| **說明** | 用途描述 | `大豐倉儲管理系統` |
| **Redirect URIs** | 使用此組 credentials 的所有 origin（最多 10 筆） | `https://warehouse.apps.zerozero.tw`、`http://localhost:3100` |

建立後 SSO 自動產生 `app_id`（UUID，公開）與 `app_secret`（64 字元，保密）。在 Dashboard 點擊「**顯示金鑰**」即可複製完整的 `app_id` + `app_secret`。

### 2. 設定環境變數

以接入 **Prod** 為例：

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

接 **Test** 時把 `SSO_URL` / `NEXT_PUBLIC_SSO_URL` 改成 `https://df-sso-login-test.apps.zerozero.tw`，並**從 Test Dashboard 拿另一組** `SSO_APP_ID` / `SSO_APP_SECRET`（不是 prod 那組）。

> `APP_URL` 的 origin 必須在白名單該筆的 `redirect_uris` 中。`SSO_APP_SECRET` **絕不可**出現在前端 bundle 或 client-side 程式碼。

---

## 路由契約

### 必要頁面

| 路徑 | 用途 | 進入時機 |
|------|------|---------|
| `/` | **登入頁**（未登入入口） | 登出後、`session_expired`、`exchange_failed` 等錯誤情境 |
| `/dashboard` | **登入後首頁** | OAuth callback 換 token 成功後 |

行為要求：

- **`/` mount 時必須呼叫 `/api/auth/me`**：已登入 → `router.push("/dashboard")`；`no_token` → 自動導向 SSO `authorize`（享受跨 App 免登入）；`session_expired` / `error` / `logged_out=1` → **不**自動導向，顯示按鈕
- **`/dashboard` mount 時必須呼叫 `/api/auth/me`**：失敗則導回 `/`。這是 Client 感知「中央 session 已被撤銷」的主要路徑
- **錯誤 query string**：`?error=no_code` / `?error=exchange_failed` / `?error=exchange_error` / `?error=session_expired` / `?logged_out=1`

### 必要 API Route（1 個工具檔 + 4 個 Route）

| 檔案 | 職責 |
|------|------|
| `lib/sso.ts` | `getToken()` + `fetchSSO()` 工具 |
| `app/api/auth/callback/route.ts` | 收 code → 呼叫中央 `/sso/exchange` → 寫 token cookie → redirect `/dashboard` |
| `app/api/auth/me/route.ts` | 讀 cookie → 以 Bearer 轉發中央 `/me` → 401 時清 cookie 回 `session_expired` |
| `app/api/auth/logout/route.ts` | **以 Bearer POST 中央 `/logout`** → 清本地 cookie → redirect `/?logged_out=1` |
| `app/api/auth/back-channel-logout/route.ts` | 驗證 HMAC 簽章 + timestamp，回 `{ success: true }` |

### 若你的專案已有不同路由結構

可以調整，但下列三處**必須全部改成你的路徑，且三處一致**：

1. `callback/route.ts` — 成功後的 `NextResponse.redirect(new URL("<你的 dashboard>", APP_URL))`
2. `logout/route.ts` — 登出後的 `NextResponse.redirect(new URL("<你的登入頁>?logged_out=1", APP_URL))`
3. 登入頁元件 — `useEffect` 中 `router.push("<你的 dashboard>")` 與 `?error=` query 的處理

> 強烈建議直接沿用 `/` + `/dashboard`，跨 App 行為一致，新接入的系統不用每次都重新對齊路由。

---

## Next.js 實作樣板

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

SSO 登出時會帶 HMAC-SHA256 簽章，Client 必須驗證簽章 + timestamp（防 replay）才能確認請求來自 SSO。

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

  console.log(`[Back-channel Logout] User ${user_id} logged out from SSO`);
  return NextResponse.json({ success: true });
}
```

### 登入頁（`app/page.tsx`）

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

---

## 把 `/me` 當共用 Middleware 使用（推薦）

前面 `app/api/auth/me/route.ts` 是給**登入頁與 dashboard mount 時**呼叫的頁面層驗證。但子系統通常還有很多 protected API（`/api/assets`、`/api/orders`...），這些 handler 每次被呼叫時理論上也該先確認「使用者當下還在登入狀態」。做法就是把 `/me` 的回源邏輯包成一個共用 function，在每個 protected handler 入口強制呼叫。

概念上這就是 `@login_required` / `authMiddleware`，只是 session store 不在本地 process，而是跨 HTTP 打中央 Redis。

### 1. 擴充 `lib/sso.ts`

在原本的 `lib/sso.ts` 後面追加：

```typescript
import { NextResponse } from "next/server";

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

/** 任何 protected handler 入口都呼叫這個。成功 → SsoUser；失敗 → throw。 */
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

/** HOF wrapper：handler 內的 user 保證已登入；失敗自動回 401 + 清 cookie。 */
export function withAuth(
  handler: (req: Request, user: SsoUser) => Promise<NextResponse>
) {
  return async (req: Request): Promise<NextResponse> => {
    try {
      const user = await requireAuth();
      return await handler(req, user);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        const status = err.code === "sso_unreachable" ? 502 : 401;
        const response = NextResponse.json({ error: err.code }, { status });
        if (err.code === "session_expired") response.cookies.delete("token");
        return response;
      }
      throw err;
    }
  };
}
```

### 2. 用 `withAuth` 包住每個 protected route（推薦）

```typescript
// app/api/assets/route.ts
import { withAuth } from "../../../lib/sso";
import { NextResponse } from "next/server";

export const GET = withAuth(async (_req, user) => {
  // user 保證已登入；每次呼叫都已向中央 Redis 確認過 session
  return NextResponse.json({ viewer: user.email, assets: [] });
});

export const POST = withAuth(async (req, user) => {
  const body = await req.json();
  // 用 user.userId / user.email 當 owner
  return NextResponse.json({ ok: true });
});
```

任何透過 `withAuth(...)` 定義的 handler 都會在執行前強制打一次中央 `/me`，達成「**任意請求一定要經過這個 middleware**」。中央 Redis session 不存在 → 子系統自動回 401 + 清本地 cookie，前端下一次導航就會被導回 `/`。

### 3. 需要細控時改用 `requireAuth` 手動

想自訂 401 回應格式、或驗完登入還要再做權限 / 角色檢查時：

```typescript
// app/api/reports/route.ts
import { requireAuth, UnauthorizedError } from "../../../lib/sso";
import { NextResponse } from "next/server";

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

> 原本 `app/api/auth/me/route.ts` 也可以順便改寫成呼叫 `requireAuth`，把 fetch 邏輯收斂到 `lib/sso.ts` 一處。

### 注意事項

- **不建議用 Next.js `middleware.ts`**：它跑在 edge runtime、沒有 Node `crypto` 模組（back-channel logout 用 HMAC 會壞）、也難以優雅處理 cookie 清除 + redirect。`withAuth` HOF 跑在 Node runtime，行為可預測、可測試。
- **每次 request 都回源的成本**：正確行為，但會增加中央 `/api/auth/me` qps。`sessionLimiter` 預設 100 / 15min per IP，流量大時可向管理員申請調高 rate limit，或在子系統加一層**短 TTL 快取**（例如 in-process 5 秒 cache），代價是登出感知延遲該秒數。敏感操作（改密碼、付款）建議 bypass 快取強制即時驗。
- **`requireAuth` 只驗 authentication、不驗 authorization**：它告訴你「這個人是誰」，「這個人能不能做這件事」仍是子系統自己的責任。

---

## 登出死循環 與 `?logged_out=1`

DF-SSO 的核心特性是「**跨 App 免登入**」— 只要 SSO 中央 session 還在，任何 Client App 進入登入頁都會被自動拉回中央靜默拿一張新 token。這個行為在「第一次訪問」是對的，但在「剛點完登出」時會變成死循環：

```
使用者按登出
  → /api/auth/logout 清本地 cookie
  → redirect 回 /
  → 登入頁 useEffect 呼叫 /api/auth/me
  → no_token
  → 自動 window.location.href = SSO_URL        ← 靜默登入路徑
  → 中央 session 還在（其他 App 沒登出）
  → 靜默發 code → callback → 又登入回去        ← 等於沒登出
```

> Client App 的 `/api/auth/logout` 只清自己的 token cookie + 刪中央 session，但**其他 App 仍保持登入狀態**（這就是跨 App SSO 的定義）。真正的「全域登出」是另一條路徑：由 SSO 管理後台 / 使用者主動呼叫 `GET /api/auth/sso/logout?redirect=...`。

`?logged_out=1` 是**一次性暫停旗標**，打斷上面這條瞬間死循環：

| 進入 `/` 的情境 | URL | 期望行為 |
|----------------|-----|---------|
| 第一次訪問 / 跨 App 跳過來 | `/` | `no_token` → **自動導向 SSO**（享受免登入） |
| Session 過期 | `/?error=session_expired` | 顯示按鈕，**不**自動導向 |
| 剛點完登出 | `/?logged_out=1` | 顯示按鈕，**不**自動導向 |
| 交換失敗 / 其他錯誤 | `/?error=...` | 顯示按鈕，**不**自動導向 |

核心判斷邏輯：**有 `?logged_out=1` 或 `?error=...` → 顯示按鈕等使用者主動點；什麼 query 都沒有 → 靜默自動登入**。

### 「預期非 bug」：登出後重整仍可能進 dashboard

**複現**：
1. Tab1 按登出 → 進入 `/?logged_out=1`，顯示按鈕 ✓
2. Tab2（或另一個 Client App）重新登入 → SSO 中央 session 重建
3. 回 Tab1 按 F5 → **Tab1 直接跳到 `/dashboard`**

**為什麼是對的**：
- Token cookie per-origin 共享。Tab2 callback 寫入 cookie 後，Tab1 同 origin 的 `fetch("/api/auth/me")` 會自動帶上新 cookie，中央回 200
- 登入頁判斷順序 `if (res.ok) → /dashboard` **在前**、`if (loggedOut) → 顯示按鈕` **在後**。「使用者已經有有效 session 還卡在登入頁」才是真正的 bug
- `?logged_out=1` 只擋「清完 cookie 後 `useEffect` 立刻把使用者靜默拉回 SSO 的瞬間死循環」，不擋「使用者真的在別處重新登入後回來」

如果測試人員回報這個行為，**直接結案 as designed**，不要把 `loggedOut` 判斷拉到 `res.ok` 之前 — 那會讓重整永遠卡在登入頁，反而是真正的 bug。

> MockA（[app/page.tsx](../DF-SSO-MockA/app/page.tsx)）與 MockB 都是這個設計的 reference 實作，可直接對照。

---

## 非 Next.js 專案

任何後端框架都能實作。核心是 **4 個 HTTP 端點 + 1 個登入頁**，語義必須和 Next.js 樣板一致：

| 端點 | 做什麼 |
|------|--------|
| `GET /api/auth/callback?code=xxx` | POST 中央 `/api/auth/sso/exchange` `{ code, client_id, client_secret }` → 存 token cookie → redirect dashboard |
| `GET /api/auth/me` | 讀 cookie → `Bearer {token}` 呼叫中央 `/api/auth/me` → 原樣回傳 / 401 時清 cookie 回 `session_expired` |
| `GET /api/auth/logout` | 讀 cookie → `Bearer` POST 中央 `/api/auth/logout` → 刪 cookie → redirect `/?logged_out=1` |
| `POST /api/auth/back-channel-logout` | 驗 HMAC `{ user_id, timestamp, signature }` → 回 `{ success: true }` |

實作重點：

- server-to-server fetch **必須**加 `cache: "no-store"` + timeout
- `/me` 必須區分 `no_token`（自動導向 SSO）與 `session_expired`（顯示按鈕）
- `exchange` 必須帶 `client_id` + `client_secret`，`client_secret` **絕不可**出現在前端
- back-channel 驗證：
  - `HMAC-SHA256(app_secret, "${user_id}:${timestamp}")`
  - 簽章比對務必用 **constant-time**（Node: `crypto.timingSafeEqual`、Python: `hmac.compare_digest`、Java: `MessageDigest.isEqual`）
  - `abs(now - timestamp) ≤ 30_000 ms` 防 replay
- **把 `/me` 驗證包成共用 middleware**（概念等同 Next.js 樣板的 `withAuth` HOF）：
  - **Express** — `async function requireAuth(req, res, next)` 讀 cookie → 打中央 → 成功 `req.user = ...` + `next()`；失敗 `res.clearCookie + 401`
  - **FastAPI** — 寫成 `Depends(require_auth)`，回傳 user dict；protected endpoint 宣告 `user = Depends(require_auth)`
  - **Spring Boot** — 繼承 `OncePerRequestFilter`，匹配 `/api/...` 路徑後打中央驗證，成功塞 `request.setAttribute("ssoUser", ...)`
  - 所有 protected endpoint 都**必須**經過這層，才能確保「中央 session 被刪後下一次呼叫會失效」

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

## 常見問題

| 問題 | 原因 |
|------|------|
| `Invalid client_id` | `SSO_APP_ID` 錯誤，或該 App 未啟用 |
| `Invalid client credentials` | `SSO_APP_SECRET` 錯誤 |
| `redirect_uri is not registered` | `APP_URL` origin 不在白名單的 `redirect_uris` 中 |
| `exchange_failed` | auth code 過期（60 秒）或已被使用 |
| `Too many authentication attempts` | auth rate limit 超限（預設 30 / 15min） |
| `Too many requests`（`/me` / `/logout`） | session rate limit 超限（預設 100 / 15min） |
| `Too many exchange attempts` | exchange rate limit 超限（預設 20 / 1min） |
| `Invalid signature`（back-channel） | `SSO_APP_SECRET` 不一致，或 timestamp 超過 30 秒 |
| 登出後其他 App 仍可用 | 正常，其他 App 下次 `/me` 時收到 401 並清 cookie（見「必守契約 #1」） |
| 按了登出馬上又自動登入回去 | Client 沒有在 logout 時 POST 中央 `/api/auth/logout`，中央 Redis session 還活著（見「必守契約 #2」） |

> rate limit 數值是**動態的**，管理員可在 Dashboard「設定」分頁調整，實際生效值以當下 SSO 環境的設定為準。
