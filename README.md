# DF-SSO

大豐環保 SSO 單一登入系統。所有子專案共用一組 Microsoft 帳號認證，登入一次即可跨系統使用。

---

## 運作原理

```
你的專案（App-A）                SSO 中央（本專案）              Microsoft
┌────────────┐               ┌──────────────┐              ┌──────────┐
│ 使用者點    │  ──(1)──>    │  檢查是否     │              │          │
│「SSO 登入」 │              │  已登入過     │              │          │
│            │              │              │  ──(2)──>    │ 帳號密碼  │
│            │              │              │  <──(3)──    │ 驗證完成  │
│            │  <──(4)──    │  產生授權碼   │              │          │
│ 用授權碼換  │  ──(5)──>    │  回傳用戶資料 │              │          │
│ 取用戶資料  │  <──(6)──    │  + token     │              │          │
│            │              │              │              │          │
│ 登入成功！  │              │              │              │          │
└────────────┘               └──────────────┘              └──────────┘
```

**重點：**
- 你的專案**不需要**自己串接 Microsoft 登入
- 你的專案**不需要**管理 session
- 每次驗證都問 SSO 中央，SSO 中央是唯一的 session 管理平台
- 如果使用者已經在別的系統登入過，再登入你的系統時**不會再跳 Microsoft 登入頁**

---

## 如何在你的專案中串接 SSO

### 前置作業

1. 請 SSO 管理員到 **SSO Dashboard** 的白名單管理新增你的專案：
   - **網域：** 你的專案 URL（如 `https://your-app.df-recycle.com.tw`）
   - **名稱：** 你的 App 名稱（如 `My App`），之後程式裡會用到
   - **說明：** 簡述你的系統

2. 拿到 SSO Backend 的 URL（如 `https://sso-api.df-recycle.com.tw`）

### Step 1：設定環境變數

在你的專案根目錄建立 `.env.local`：

```env
# SSO 中央伺服器
SSO_URL=https://sso-api.df-recycle.com.tw
NEXT_PUBLIC_SSO_URL=https://sso-api.df-recycle.com.tw

# 你的專案
APP_URL=https://your-app.df-recycle.com.tw
NEXT_PUBLIC_APP_URL=https://your-app.df-recycle.com.tw
NEXT_PUBLIC_APP_NAME=My App

# Session 密鑰（隨機產生，每個專案不同）
SESSION_SECRET=隨便打一串亂碼就好
```

> `NEXT_PUBLIC_APP_NAME` 必須和白名單裡的「名稱」**完全一致**。

### Step 2：複製 5 個檔案

從本專案的 `app-a/` 複製以下檔案到你的專案，**不需要修改任何程式碼**：

#### `lib/sso.ts` — Cookie 工具

只做三件事：存 token、讀 token、刪 token。

```typescript
import { cookies } from "next/headers";

const SSO_TOKEN_COOKIE = "sso_token";
const COOKIE_MAX_AGE = 24 * 60 * 60; // 24 小時

export async function setToken(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SSO_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

export async function getToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SSO_TOKEN_COOKIE)?.value ?? null;
}

export async function clearToken(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SSO_TOKEN_COOKIE);
}
```

#### `app/api/auth/callback/route.ts` — 登入回調

SSO 驗證完成後會帶授權碼回到這裡。這個 API 會用授權碼去 SSO 換取 token。

```typescript
import { NextRequest, NextResponse } from "next/server";
import { setToken } from "../../../../lib/sso";

const SSO_URL = process.env.SSO_URL || "http://localhost:3001";
const APP_URL = process.env.APP_URL || "http://localhost:3100";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/?error=missing_code", APP_URL));
  }

  try {
    const res = await fetch(`${SSO_URL}/api/auth/sso/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    if (!res.ok) {
      return NextResponse.redirect(new URL("/?error=exchange_failed", APP_URL));
    }

    const { token } = await res.json();
    await setToken(token);

    return NextResponse.redirect(new URL("/dashboard", APP_URL));
  } catch {
    return NextResponse.redirect(new URL("/?error=callback_failed", APP_URL));
  }
}
```

#### `app/api/auth/me/route.ts` — 驗證身份

你的前端呼叫這個 API 來確認使用者是否已登入。它會轉發到 SSO 中央驗證。

```typescript
import { NextResponse } from "next/server";
import { getToken, clearToken } from "../../../../lib/sso";

const SSO_URL = process.env.SSO_URL || "http://localhost:3001";

export async function GET() {
  const token = await getToken();

  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const res = await fetch(`${SSO_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      await clearToken();
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "SSO unreachable" }, { status: 502 });
  }
}
```

#### `app/api/auth/logout/route.ts` — 登出

只清除你自己專案的 token，不會影響其他系統。

```typescript
import { NextResponse } from "next/server";
import { clearToken } from "../../../../lib/sso";

const APP_URL = process.env.APP_URL || "http://localhost:3100";

export async function GET() {
  await clearToken();
  return NextResponse.redirect(APP_URL);
}
```

#### `app/api/auth/back-channel-logout/route.ts` — 接收登出通知

當 SSO 管理員從中控中心全域登出時，SSO 會呼叫這個 API 通知你的專案。

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

在你的首頁加一個登入按鈕：

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const SSO_URL = process.env.NEXT_PUBLIC_SSO_URL || "http://localhost:3001";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100";
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "My App";

export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  // 頁面載入時先檢查是否已經登入
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => {
        if (res.ok) router.push("/dashboard");  // 已登入，直接跳轉
        else setChecking(false);                 // 未登入，顯示按鈕
      })
      .catch(() => setChecking(false));
  }, [router]);

  // 點擊後導向 SSO 中央認證
  const handleLogin = () => {
    const callbackUrl = `${APP_URL}/api/auth/callback`;
    window.location.href =
      `${SSO_URL}/api/auth/sso/authorize?app=${encodeURIComponent(APP_NAME)}&redirect_uri=${encodeURIComponent(callbackUrl)}`;
  };

  if (checking) return <p>驗證中...</p>;

  return (
    <button onClick={handleLogin}>
      透過 DF-SSO 登入
    </button>
  );
}
```

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
      .catch(() => router.push("/"));  // 未登入，回首頁
  }, [router]);

  if (!user) return <p>載入中...</p>;

  return (
    <div>
      <h1>歡迎，{user.name}</h1>
      <p>Email: {user.email}</p>

      {/* ERP 員工資料（如果有的話） */}
      {user.erpData && (
        <div>
          <p>員工編號: {user.erpData.gen01}</p>
          <p>部門: {user.erpData.gem02}</p>
        </div>
      )}

      {/* 登出：只登出自己，不影響其他系統 */}
      <a href="/api/auth/logout">登出</a>
    </div>
  );
}
```

### 完成！

你的登入流程：

```
使用者進入你的系統 → 自動檢查登入狀態
  → 未登入 → 顯示「透過 DF-SSO 登入」按鈕
    → 點擊 → SSO 中央驗證 → Microsoft 登入（或自動跳過） → 回到你的 /dashboard
  → 已登入 → 直接進 /dashboard
```

---

## `/api/auth/me` 回傳的用戶資料格式

```json
{
  "user": {
    "userId": "microsoft-azure-oid",
    "email": "user@df-recycle.com.tw",
    "name": "王小明",
    "erpData": {
      "gen01": "00063",
      "gen02": "王小明",
      "gen03": "F000",
      "gem02": "財務部",
      "gen06": "user@df-recycle.com.tw"
    },
    "loginLogUid": "uuid",
    "loginAt": "2026-04-09T10:30:00.000Z"
  }
}
```

> `erpData` 可能為 `null`（如果 ERP 查不到該 email 的員工資料）。

---

## 常見問題

### Q: 登入時出現 `App "xxx" not found`

你的 `NEXT_PUBLIC_APP_NAME` 和 SSO Dashboard 白名單裡的「名稱」不一致。請確認完全相同（含大小寫、空格）。

### Q: 登入時出現 `redirect_uri origin does not match`

你的 `APP_URL` 和白名單裡的「網域」不一致。例如白名單寫了 `https://app.example.com`，但你的 `APP_URL` 是 `http://localhost:3100`。

### Q: 登出後其他系統也被登出了

如果你用的是 `/api/auth/logout`（本地登出），不會影響其他系統。只有 SSO Dashboard 的全域登出才會影響所有系統。

### Q: 使用者登入後 `erpData` 是 null

表示 ERP 系統查不到該 email 對應的員工資料。登入本身不受影響，但 ERP 相關欄位會是空的。

### Q: 我的專案不是 Next.js 怎麼辦？

SSO 整合的核心是 3 個 HTTP 端點，任何後端框架都能實作：

1. **`GET /api/auth/callback?code=xxx`** — 收到 code → POST 到 `SSO_URL/api/auth/sso/exchange` 換 token → 存 cookie
2. **`GET /api/auth/me`** — 讀 cookie → 帶 `Authorization: Bearer {token}` 呼叫 `SSO_URL/api/auth/me` → 回傳結果
3. **`GET /api/auth/logout`** — 刪 cookie → 重導向回首頁

---

## 登入行為對照表

| 情境 | 行為 |
|------|------|
| 第一次登入 App-A | 跳 Microsoft 登入頁 → 回 App-A Dashboard |
| 已登入 App-A，進入 App-B | **自動登入**（不碰 Microsoft 登入頁） |
| 在 App-A 登出 | App-A 登出，App-B **不受影響** |
| 在 App-A 登出後重新登入 | **自動登入**（中央 session 還在） |
| SSO Dashboard 全域登出 | 所有系統全部登出 |

---

## 專案結構

```
DF-SSO/
├── backend/          # SSO 中央伺服器 (Express, port 3001)
├── frontend/         # SSO 管理後台 (Next.js, port 3000)
├── app-a/            # 範例：資產管理系統 (port 3100) ← 你可以參考這個
├── app-b/            # 範例：報修系統 (port 3200)
└── docs/Design.md    # 完整技術設計文件
```

---

## 本機開發

```bash
# 1. 啟動 Backend
cd backend
cp .env.example .env   # 填入實際的 Azure AD、DB、Redis 設定
npm install
npm run dev            # http://localhost:3001

# 2. 啟動 SSO Frontend（管理後台）
cd frontend
npm install
npm run dev            # http://localhost:3000

# 3. 啟動範例 App
cd app-a
npm install
npm run dev            # http://localhost:3100

cd app-b
npm install
npm run dev            # http://localhost:3200
```

---

## 技術棧

| 元件 | 技術 |
|------|------|
| SSO Backend | Node.js + Express + Helmet + Rate Limiting |
| SSO Frontend | Next.js + TypeScript + Tailwind CSS |
| 認證 | Microsoft Azure AD (OAuth 2.0) |
| 資料庫 | PostgreSQL |
| Session | Redis |
| Token | JWT |
