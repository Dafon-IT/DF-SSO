# DF-SSO

大豐環保 SSO 單一登入系統。所有子專案共用一組 Microsoft 帳號認證，登入一次即可跨系統使用。

---

## Description

### 系統架構

```
Client App（MockA / MockB / ...）      SSO 中央（本專案 Backend）         Microsoft Azure AD
┌─────────────────────────┐         ┌─────────────────────────┐      ┌──────────────┐
│                         │         │                         │      │              │
│  1. 使用者進入頁面       │         │                         │      │              │
│     GET /api/auth/me    │         │                         │      │              │
│     → 401 (no_token)    │         │                         │      │              │
│                         │         │                         │      │              │
│  2. 自動導向 SSO        │ ──(A)─> │  GET /sso/authorize     │      │              │
│                         │         │  檢查中央 session        │      │              │
│                         │         │  → 無 session           │ ─(B)>│  Microsoft   │
│                         │         │                         │ <(C)─│  登入完成     │
│                         │         │  設定中央 session        │      │              │
│                         │ <──(D)─ │  產生一次性 auth code    │      │              │
│                         │         │  redirect ?code=xxx     │      │              │
│  3. Callback 收到 code  │         │                         │      │              │
│     POST /sso/exchange  │ ──(E)─> │  驗證 code（原子性）     │      │              │
│                         │ <──(F)─ │  回傳 { user, token }   │      │              │
│     存 token 為本地      │         │                         │      │              │
│     cookie              │         │                         │      │              │
│                         │         │                         │      │              │
│  4. 進入 Dashboard      │         │                         │      │              │
│     GET /api/auth/me    │ ──(G)─> │  GET /api/auth/me       │      │              │
│     Bearer token 驗證    │ <──(H)─ │  回傳用戶資料            │      │              │
│     → 200 OK            │         │                         │      │              │
└─────────────────────────┘         └─────────────────────────┘      └──────────────┘
```

### 核心原則

- Client App **不依賴共用 domain cookie**，使用標準 OAuth2 Authorization Code 流程
- Client App 的 token 存在**自己的 domain cookie**，由 callback 的 code exchange 取得
- 所有 server-to-server fetch 必須加 `cache: "no-store"`，避免 Next.js 快取 stale response
- 每次驗證都向 SSO 中央 `/api/auth/me` 即時確認，SSO 是唯一的 session 管理平台

---

## 完整流程

### 登入流程

```
使用者 → Client App /                   → GET /api/auth/me
                                          → 無 token cookie → 回傳 { error: "no_token" } 401
                                          → page.tsx 判斷 "no_token" → 自動導向 SSO

使用者 → SSO GET /sso/authorize          → 檢查 req.cookies.token
                                          → 無 token → 存 ssoRedirect 到 session → 導向 Microsoft

使用者 → Microsoft 登入                   → 登入成功 → redirect 回 SSO callback

SSO    → GET /{authPath}/redirect        → 驗證 state → 換取 Azure token
                                          → 查詢 ERP → 寫 Redis session
                                          → 設定 token cookie (domain: .apps.zerozero.tw)
                                          → 讀取 ssoRedirect → 產生一次性 auth code (60秒TTL)
                                          → redirect 到 Client App /api/auth/callback?code=xxx

Client → GET /api/auth/callback?code=xxx → POST SSO /sso/exchange { code }
                                          → SSO 用 Lua script 原子性 GET+DEL code
                                          → 回傳 { user, token }
                                          → Client 設定本地 token cookie (24h)
                                          → redirect /dashboard

使用者 → Client App /dashboard           → GET /api/auth/me
                                          → 讀取本地 token cookie
                                          → Bearer token → SSO /api/auth/me
                                          → SSO 驗證 JWT + Redis session
                                          → 回傳用戶資料 → 顯示 Dashboard
```

### 登出流程

```
使用者 → 點擊「登出」                     → window.location.href = /api/auth/logout

Client → GET /api/auth/logout            → 讀取本地 token cookie
                                          → POST SSO /api/auth/logout (Bearer token)
                                          → SSO 驗證 JWT → 取得 userId
                                          → SSO 刪除 Redis session: sso:session:{userId}
                                          → SSO back-channel POST 通知所有已註冊的 Client App
                                          → SSO 回傳 { message: "Logged out" }
                                          → Client 清除本地 token cookie
                                          → redirect /?logged_out=1

使用者 → Client App /?logged_out=1       → page.tsx 判斷 loggedOut=1
                                          → 顯示登入按鈕（不自動重導 SSO）
```

### Back-channel 登出流程

```
當使用者從 App-A 登出:

App-A → POST SSO /api/auth/logout (Bearer token)
     → SSO 刪除 Redis session
     → SSO 找出所有白名單 domain（排除 SSO Frontend）
     → SSO POST 每個 domain /api/auth/back-channel-logout { user_id }

App-B 收到 back-channel 通知 → 記錄日誌
     → 下次使用者在 App-B 操作 → /api/auth/me → SSO 回 401（session 已刪）
     → App-B 清除本地 token → 導回登入頁
```

### Session 過期流程

```
使用者 → Client App /dashboard           → GET /api/auth/me
                                          → 讀取本地 token → Bearer → SSO /api/auth/me
                                          → SSO Redis session 已過期 → 401
                                          → Client 回傳 { error: "session_expired" } 401
                                          → Client 清除本地 token cookie
                                          → Dashboard catch → router.push("/")

使用者 → Client App /                    → GET /api/auth/me → no_token (cookie 已清)
                                          → page.tsx 判斷 "no_token" ≠ "session_expired"
                                          → 自動導向 SSO authorize
                                          → SSO 有中央 cookie → 靜默產生 code → 免 Microsoft 登入
                                          → 回到 Dashboard（無感重新登入）
```

---

## 登入行為對照表

| 情境 | 行為 |
|------|------|
| 第一次登入 App-A | 跳 Microsoft 登入頁 → 回 App-A Dashboard |
| 已登入 App-A，進入 App-B | **自動登入**（SSO 有中央 session，靜默發 code） |
| 在 App-A 登出 | App-A 登出 + SSO 刪除中央 session + 通知 App-B |
| App-B 收到 back-channel | 下次操作時 /me 回 401 → 顯示登入按鈕 |
| SSO Dashboard 全域登出 | 所有系統全部登出 |

---

## Coolify 部署 Checklist

### SSO Backend 環境變數

```env
# 必填
PORT=35890
NODE_ENV=production
FRONTEND_URL=https://df-sso-management.apps.zerozero.tw
SESSION_SECRET=<32+ char random string>
JWT_SECRET=<32+ char random string>
JWT_EXPIRES_IN=24h

# Azure AD
AZURE_CLIENT_ID=<uuid>
AZURE_CLIENT_SECRET=<secret>
AZURE_TENANT_ID=<uuid>
AZURE_REDIRECT_URI=https://df-sso-login.apps.zerozero.tw/api/auth/{authPath}/redirect

# Database
PG_HOST=postgres
PG_PORT=5432
PG_DATABASE=SSO-v1
PG_USER=postgres
PG_PASSWORD=<password>

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=15

# Cookie（SSO Frontend 自身使用，Client App 不依賴此 cookie）
COOKIE_DOMAIN=.apps.zerozero.tw

# Login redirect（SSO Frontend Dashboard）
ROPC_REDIRECT_URL=https://df-sso-management.apps.zerozero.tw/dashboard
```

### Client App (MockA) 環境變數

```env
# Server-side（runtime）
SSO_URL=https://df-sso-login.apps.zerozero.tw
APP_URL=https://df-sso-mock-test-app-a.apps.zerozero.tw
NODE_ENV=production

# Client-side（build time）
NEXT_PUBLIC_SSO_URL=https://df-sso-login.apps.zerozero.tw
NEXT_PUBLIC_APP_URL=https://df-sso-mock-test-app-a.apps.zerozero.tw
NEXT_PUBLIC_APP_NAME=App A
```

### Client App (MockB) 環境變數

```env
SSO_URL=https://df-sso-login.apps.zerozero.tw
APP_URL=https://df-sso-mock-test-app-b.apps.zerozero.tw
NODE_ENV=production

NEXT_PUBLIC_SSO_URL=https://df-sso-login.apps.zerozero.tw
NEXT_PUBLIC_APP_URL=https://df-sso-mock-test-app-b.apps.zerozero.tw
NEXT_PUBLIC_APP_NAME=App B
```

### SSO 白名單設定 (sso_allowed_list)

| name | domain | is_active |
|------|--------|-----------|
| SSO Management | `https://df-sso-management.apps.zerozero.tw` | true |
| App A | `https://df-sso-mock-test-app-a.apps.zerozero.tw` | true |
| App B | `https://df-sso-mock-test-app-b.apps.zerozero.tw` | true |

> `name` 必須和 Client App 的 `NEXT_PUBLIC_APP_NAME` **完全一致**。
> `domain` 必須和 Client App 的 `APP_URL` origin **完全一致**（含 https://）。

### 部署後驗證步驟

1. **Health check**: `GET https://df-sso-login.apps.zerozero.tw/api/health` → `{ status: "ok", pg: "connected", redis: "connected" }`
2. **登入測試**: 從 MockA 登入 → 應經過 Microsoft → 回到 MockA Dashboard
3. **跨 App 測試**: MockA 登入後訪問 MockB → 應自動登入（不跳 Microsoft）
4. **登出測試**: MockA 登出 → Redis session 應被刪除 → MockB 下次操作回 401
5. **Rate limit 測試**: 連續重整 Dashboard 頁面 → 不應出現 "Too many authentication attempts"

---

## 如何在你的專案中串接 SSO

### 前置作業

1. 請 SSO 管理員到 **SSO Dashboard** 的白名單管理新增你的專案：
   - **名稱：** 你的 App 名稱（如 `My App`），之後程式裡會用到
   - **網域：** 你的專案 URL（如 `https://your-app.apps.zerozero.tw`）
   - **說明：** 簡述你的系統

2. 拿到 SSO Backend 的 URL（如 `https://df-sso-login.apps.zerozero.tw`）

### Step 1：設定環境變數

```env
# SSO 中央伺服器
SSO_URL=https://df-sso-login.apps.zerozero.tw
NEXT_PUBLIC_SSO_URL=https://df-sso-login.apps.zerozero.tw

# 你的專案
APP_URL=https://your-app.apps.zerozero.tw
NEXT_PUBLIC_APP_URL=https://your-app.apps.zerozero.tw
NEXT_PUBLIC_APP_NAME=My App
```

> `NEXT_PUBLIC_APP_NAME` 必須和白名單裡的「名稱」**完全一致**。

### Step 2：建立 4 個 API + 1 個工具檔

#### `lib/sso.ts` — 讀取本地 token cookie

```typescript
import { cookies } from "next/headers";

const TOKEN_COOKIE = "token";

export async function getToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(TOKEN_COOKIE)?.value ?? null;
}
```

#### `app/api/auth/callback/route.ts` — 登入回調（code exchange）

SSO 驗證完成後帶 auth code 回到這裡，用 code 向 SSO 換取 JWT token。

```typescript
import { NextRequest, NextResponse } from "next/server";

const SSO_URL = process.env.SSO_URL!;
const APP_URL = process.env.APP_URL!;

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", APP_URL));
  }

  try {
    const res = await fetch(`${SSO_URL}/api/auth/sso/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.redirect(new URL("/?error=exchange_failed", APP_URL));
    }

    const data = await res.json();

    const response = NextResponse.redirect(new URL("/dashboard", APP_URL));
    response.cookies.set("token", data.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60, // 24 小時（秒）
      path: "/",
    });

    return response;
  } catch {
    return NextResponse.redirect(new URL("/?error=exchange_error", APP_URL));
  }
}
```

#### `app/api/auth/me/route.ts` — 驗證身份

前端呼叫此 API 確認登入狀態。回傳 `no_token`（可自動導向 SSO）或 `session_expired`（顯示按鈕）。

```typescript
import { NextResponse } from "next/server";
import { getToken } from "../../../../lib/sso";

const SSO_URL = process.env.SSO_URL!;

export async function GET() {
  const token = await getToken();

  if (!token) {
    return NextResponse.json({ error: "no_token" }, { status: 401 });
  }

  try {
    const res = await fetch(`${SSO_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!res.ok) {
      const response = NextResponse.json({ error: "session_expired" }, { status: 401 });
      response.cookies.delete("token");
      return response;
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "SSO unreachable" }, { status: 502 });
  }
}
```

#### `app/api/auth/logout/route.ts` — 登出（server-to-server 通知 SSO）

```typescript
import { NextResponse } from "next/server";
import { getToken } from "../../../../lib/sso";

const SSO_URL = process.env.SSO_URL!;
const APP_URL = process.env.APP_URL!;

export async function GET() {
  const token = await getToken();

  if (token) {
    try {
      await fetch(`${SSO_URL}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // SSO 不可達也繼續清除本地 cookie
    }
  }

  const response = NextResponse.redirect(new URL("/?logged_out=1", APP_URL));
  response.cookies.delete("token");
  return response;
}
```

#### `app/api/auth/back-channel-logout/route.ts` — 接收登出通知

```typescript
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { user_id } = await request.json();
    console.log(`[Back-channel Logout] User ${user_id} logged out from SSO`);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
```

### Step 3：寫你的登入頁

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const SSO_URL = process.env.NEXT_PUBLIC_SSO_URL!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME!;

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const loggedOut = searchParams.get("logged_out");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => {
        if (res.ok) {
          router.push("/dashboard");
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (data.error === "session_expired" || error || loggedOut) {
          // 被撤銷 / SSO 失敗 / 已登出 → 顯示手動登入按鈕
          setChecking(false);
        } else {
          // no_token → 自動導向 SSO（實現跨 App 免登入）
          window.location.href = `${SSO_URL}/api/auth/sso/authorize?app=${encodeURIComponent(APP_NAME)}&redirect_uri=${encodeURIComponent(`${APP_URL}/api/auth/callback`)}`;
        }
      })
      .catch(() => setChecking(false));
  }, [router, error, loggedOut]);

  const handleLogin = () => {
    window.location.href = `${SSO_URL}/api/auth/sso/authorize?app=${encodeURIComponent(APP_NAME)}&redirect_uri=${encodeURIComponent(`${APP_URL}/api/auth/callback`)}`;
  };

  if (checking) return <p>驗證中...</p>;

  return (
    <div>
      {error && <p>登入失敗：{error}</p>}
      <button onClick={handleLogin}>透過 DF-SSO 登入</button>
    </div>
  );
}
```

> **重要：** `no_token` 時自動導向 SSO 是為了實現「App-A 登入後，進 App-B 免登入」。
> `session_expired` 時顯示按鈕，避免被中央撤銷後無限重導。

### Step 4：在需要驗證的頁面取得用戶資料

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => setUser(data.user))
      .catch(() => router.push("/"));
  }, [router]);

  if (!user) return <p>載入中...</p>;

  return (
    <div>
      <h1>歡迎，{user.name}</h1>
      <p>Email: {user.email}</p>
      {user.erpData && (
        <div>
          <p>員工編號: {user.erpData.gen01}</p>
          <p>部門: {user.erpData.gem02}</p>
        </div>
      )}
      <a href="/api/auth/logout">登出</a>
    </div>
  );
}
```

---

## `/api/auth/me` 回傳的用戶資料格式

```json
{
  "user": {
    "userId": "microsoft-azure-oid",
    "email": "user@df-recycle.com",
    "name": "王小明",
    "erpData": {
      "gen01": "00063",
      "gen02": "王小明",
      "gen03": "F000",
      "gem02": "財務部",
      "gen06": "user@df-recycle.com"
    },
    "loginLogUid": "uuid",
    "loginAt": "2026-04-09T10:30:00.000Z"
  }
}
```

> `erpData` 可能為 `null`（如果 ERP 查不到該 email 的員工資料）。

---

## SSO Backend API 端點

| Method | Path | 用途 | Rate Limit |
|--------|------|------|-----------|
| GET | `/api/auth/sso/authorize` | Client App 導向 SSO 認證 | 30/15min |
| POST | `/api/auth/sso/exchange` | Client App 用 code 換 token | 20/1min |
| GET | `/api/auth/sso/logout` | SSO Frontend 全域登出（讀 cookie） | 30/15min |
| GET | `/api/auth/{authPath}/login` | 導向 Microsoft 登入 | 30/15min |
| GET | `/api/auth/{authPath}/redirect` | Microsoft OAuth 回調 | 30/15min |
| GET | `/api/auth/me` | 驗證 JWT + Redis session | 100/15min |
| POST | `/api/auth/logout` | 登出（支援 Bearer token + back-channel） | 100/15min |
| GET | `/api/health` | Health check | 500/15min |

---

## 常見問題

### Q: 登入時出現 `App "xxx" not found`
`NEXT_PUBLIC_APP_NAME` 和 SSO Dashboard 白名單裡的「名稱」不一致。請確認完全相同（含大小寫、空格）。

### Q: 登入時出現 `redirect_uri origin does not match`
`APP_URL` 和白名單裡的「網域 (domain)」不一致。

### Q: 出現 `Too many authentication attempts`
SSO `/api/auth/me` 和 `/api/auth/logout` 的 rate limit 為 100 次/15 分鐘。如果多個 Client App 共用同一個 IP（Coolify 內部網路），可能達到上限。

### Q: 登出後另一個 App 仍然能用
登出時 SSO 會刪除 Redis session 並 back-channel 通知，但另一個 App 的**本地 cookie 不會即時消失**。下次使用者在該 App 操作時，`/api/auth/me` 會向 SSO 驗證失敗 → 401 → 清除本地 cookie → 顯示登入按鈕。

### Q: 我的專案不是 Next.js 怎麼辦？
SSO 整合的核心是 4 個 HTTP 端點，任何後端框架都能實作：

1. **`GET /api/auth/callback?code=xxx`** — 收到 code → POST `SSO_URL/api/auth/sso/exchange` 換 token → 存 cookie
2. **`GET /api/auth/me`** — 讀 cookie → `Authorization: Bearer {token}` 呼叫 `SSO_URL/api/auth/me` → 回傳結果（加 `cache: no-store`）
3. **`GET /api/auth/logout`** — 讀 cookie → POST `SSO_URL/api/auth/logout` (Bearer token) → 刪 cookie → redirect
4. **`POST /api/auth/back-channel-logout`** — 接收 SSO 登出通知 `{ user_id }` → 回傳 `{ success: true }`

---

## 專案結構

```
DF-SSO/
├── backend/          # SSO 中央伺服器 (Express, port 35890)
├── frontend/         # SSO 管理後台 (Next.js, port 3000)
└── docker-compose-prod.yml

DF-SSO-MockA/         # 範例：資產管理系統 (port 3100)
DF-SSO-MockB/         # 範例：報修系統 (port 3200)
```

---

## 本機開發

```bash
# 1. 啟動 Backend
cd DF-SSO/backend
cp .env.example .env   # 填入實際的 Azure AD、DB、Redis 設定
npm install
npm run dev            # http://localhost:3001

# 2. 啟動 SSO Frontend（管理後台）
cd DF-SSO/frontend
npm install
npm run dev            # http://localhost:3000

# 3. 啟動範例 App
cd DF-SSO-MockA
npm install
npm run dev            # http://localhost:3100

cd DF-SSO-MockB
npm install
npm run dev            # http://localhost:3200
```

---

## 技術棧

| 元件 | 技術 |
|------|------|
| SSO Backend | Node.js + Express + Helmet + Rate Limiting |
| SSO Frontend | Next.js + TypeScript + Tailwind CSS |
| 認證 | Microsoft Azure AD (OAuth 2.0 + MSAL) |
| 資料庫 | PostgreSQL 16 |
| Session | Redis 7 (ioredis) |
| Token | JWT (HS256, 24h) |
| 部署 | Coolify + Docker Compose |
