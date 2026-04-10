# 初始化 SSO 登入器整合

在當前 Next.js 專案中自動建立 DF-SSO 登入器所需的所有檔案。
**執行前會詢問必要資訊，之後全自動完成。**

## 詢問使用者（依序）

1. **SSO Backend URL** — SSO 中央伺服器的網址（例如 `https://sso-api.df-recycle.com.tw`），本機開發填 `http://localhost:35890`
2. **App URL** — 你的專案網址（例如 `https://asset.df-recycle.com.tw`），本機開發填 `http://localhost:3100`
3. **App Name** — 你的 App 名稱，必須跟 SSO Dashboard 白名單裡的「名稱」**完全一致**（例如 `App A`）
4. **App Port** — 你的專案 Port（例如 `3100`）

## 執行步驟

### 1. 建立 `lib/sso.ts`

```typescript
import { cookies } from "next/headers";

const SSO_TOKEN_COOKIE = "sso_token";
const COOKIE_MAX_AGE = 24 * 60 * 60;

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

### 2. 建立 `app/api/auth/callback/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { setToken } from "../../../../lib/sso";

const SSO_URL = process.env.SSO_URL || "http://localhost:35890";
const APP_URL = process.env.APP_URL || "http://localhost:{使用者填的 Port}";

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

### 3. 建立 `app/api/auth/me/route.ts`

```typescript
import { NextResponse } from "next/server";
import { getToken, clearToken } from "../../../../lib/sso";

const SSO_URL = process.env.SSO_URL || "http://localhost:35890";

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

### 4. 建立 `app/api/auth/logout/route.ts`

```typescript
import { NextResponse } from "next/server";
import { clearToken } from "../../../../lib/sso";

const APP_URL = process.env.APP_URL || "http://localhost:{使用者填的 Port}";

export async function GET() {
  await clearToken();
  return NextResponse.redirect(APP_URL);
}
```

### 5. 建立 `app/api/auth/back-channel-logout/route.ts`

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

### 6. 建立或更新 `.env.local`

在現有的 `.env.local` 中**追加**以下環境變數（不覆蓋原有內容）：

```
# DF-SSO 登入器
SSO_URL={使用者填的 SSO URL}
NEXT_PUBLIC_SSO_URL={使用者填的 SSO URL}
APP_URL={使用者填的 App URL}
NEXT_PUBLIC_APP_URL={使用者填的 App URL}
NEXT_PUBLIC_APP_NAME={使用者填的 App Name}
SESSION_SECRET={隨機產生 32 字元 hex}
```

### 7. 顯示完成訊息

告知使用者：

```
✅ SSO 登入器整合完成！

已建立的檔案：
  lib/sso.ts
  app/api/auth/callback/route.ts
  app/api/auth/me/route.ts
  app/api/auth/logout/route.ts
  app/api/auth/back-channel-logout/route.ts
  .env.local（已追加 SSO 環境變數）

📋 接下來你需要：
1. 請 SSO 管理員在白名單新增你的系統
   - 網域：{使用者填的 App URL}
   - 名稱：{使用者填的 App Name}

2. 在你的登入頁加上登入按鈕：

   const handleLogin = () => {
     const SSO_URL = process.env.NEXT_PUBLIC_SSO_URL;
     const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
     const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME;
     window.location.href = `${SSO_URL}/api/auth/sso/authorize?app=${encodeURIComponent(APP_NAME)}&redirect_uri=${encodeURIComponent(`${APP_URL}/api/auth/callback`)}`;
   };

3. 在需要驗證的頁面呼叫：

   fetch("/api/auth/me")
     .then(res => res.ok ? res.json() : Promise.reject())
     .then(data => setUser(data.user))
     .catch(() => router.push("/"));

4. 登出按鈕：

   <a href="/api/auth/logout">登出</a>
```

## 注意事項

- 所有 default port 值要用使用者回答的 Port 取代
- `.env.local` 是追加，不是覆蓋
- `SESSION_SECRET` 用 `crypto.randomBytes(32).toString('hex')` 產生
- 如果 `lib/` 或 `app/api/auth/` 目錄已存在同名檔案，詢問使用者是否覆蓋
