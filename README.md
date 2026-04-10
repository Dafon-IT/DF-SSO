# DF-SSO

大豐環保 SSO 單一登入系統。所有子專案共用一組 Microsoft 帳號認證，登入一次即可跨系統使用。

---

## Description

### 系統架構

```
Client App（MockA / MockB / ...）       SSO 中央（本專案）            Microsoft Azure AD
┌──────────────────────┐            ┌──────────────────┐         ┌────────────┐
│  /api/auth/me        │  Bearer    │  驗證 JWT        │         │            │
│  /api/auth/callback  │ ──(code)─> │  code exchange   │         │            │
│  /api/auth/logout    │ ──(token)─>│  刪 session      │         │            │
│                      │            │  back-channel    │         │            │
│                      │  <──────── │  authorize       │ ──────> │  OAuth 2.0 │
│                      │            │  redirect        │ <────── │            │
└──────────────────────┘            └──────────────────┘         └────────────┘
```

### 核心原則

- Client App 使用標準 **OAuth2 Authorization Code** 流程，不依賴共用 domain cookie
- Client App 透過 **code exchange** 取得 JWT token，存為自己的本地 cookie
- SSO 是唯一的 session 管理平台，Client App 每次都向 SSO `/api/auth/me` 即時驗證

---

## 流程

### 登入

1. Client App `/api/auth/me` → 無 token → `401 no_token` → 自動導向 SSO `/sso/authorize`
2. SSO 檢查中央 session → 無 → 導向 Microsoft 登入
3. Microsoft 登入成功 → SSO 建立 Redis session → 產生一次性 auth code（60 秒 TTL）
4. redirect 回 Client App `/api/auth/callback?code=xxx`
5. Client App POST `/sso/exchange` 用 code 換 JWT token → 存本地 cookie → 進 Dashboard

### 跨 App 免登入

1. 已在 App-A 登入 → 訪問 App-B → App-B `/api/auth/me` → `401 no_token`
2. 自動導向 SSO `/sso/authorize` → SSO 已有中央 session → 靜默產生 code → redirect 回 App-B
3. App-B 用 code 換 token → 自動進 Dashboard（不跳 Microsoft 登入頁）

### 登出

1. Client App 讀取本地 token → POST SSO `/api/auth/logout`（Bearer token）
2. SSO 刪除 Redis session `sso:session:{userId}`
3. SSO back-channel POST 通知所有白名單 Client App `/api/auth/back-channel-logout`
4. Client App 清除本地 cookie → redirect `/?logged_out=1`

### Session 過期

1. Client App `/api/auth/me` → SSO Redis session 過期 → `401 session_expired` → 清除本地 cookie
2. 重新進入首頁 → `no_token` → 自動導向 SSO → SSO 有中央 cookie → 靜默重新登入

---

## API 端點

| Method | Path | 用途 | Rate Limit |
|--------|------|------|-----------|
| GET | `/api/auth/sso/authorize` | Client App 導向 SSO 認證 | 30/15min |
| POST | `/api/auth/sso/exchange` | Client App 用 code 換 token | 20/1min |
| GET | `/api/auth/sso/logout` | SSO Frontend 全域登出 | 30/15min |
| GET | `/api/auth/{authPath}/login` | 導向 Microsoft 登入 | 30/15min |
| GET | `/api/auth/{authPath}/redirect` | Microsoft OAuth 回調 | 30/15min |
| GET | `/api/auth/me` | 驗證 JWT + Redis session | 100/15min |
| POST | `/api/auth/logout` | 登出（Bearer token + back-channel） | 100/15min |
| GET | `/api/health` | Health check | 500/15min |

---

## Coolify 部署

### SSO Backend 環境變數

```env
PORT=35890
NODE_ENV=production
FRONTEND_URL=https://df-sso-management.apps.zerozero.tw
SESSION_SECRET=<32+ char>
JWT_SECRET=<32+ char>
JWT_EXPIRES_IN=24h
AZURE_CLIENT_ID=<uuid>
AZURE_CLIENT_SECRET=<secret>
AZURE_TENANT_ID=<uuid>
AZURE_REDIRECT_URI=https://df-sso-login.apps.zerozero.tw/api/auth/{authPath}/redirect
PG_HOST=postgres
PG_PORT=5432
PG_DATABASE=SSO-v1
PG_USER=postgres
PG_PASSWORD=<password>
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=15
COOKIE_DOMAIN=.apps.zerozero.tw
ROPC_REDIRECT_URL=https://df-sso-management.apps.zerozero.tw/dashboard
```

### 白名單 (sso_allowed_list)

| name | domain | is_active |
|------|--------|-----------|
| SSO Management | `https://df-sso-management.apps.zerozero.tw` | true |
| App A | `https://df-sso-mock-test-app-a.apps.zerozero.tw` | true |
| App B | `https://df-sso-mock-test-app-b.apps.zerozero.tw` | true |

> `name` = Client App 的 `NEXT_PUBLIC_APP_NAME`，`domain` = Client App 的 `APP_URL` origin。

### 驗證步驟

1. `GET /api/health` → `{ status: "ok", pg: "connected", redis: "connected" }`
2. 從 MockA 登入 → Microsoft → MockA Dashboard
3. 訪問 MockB → 自動登入（不跳 Microsoft）
4. MockA 登出 → Redis session 刪除 → MockB 下次操作回 401
5. 連續重整頁面 → 不應出現 rate limit 錯誤

---

## 專案結構

```
DF-SSO/
├── backend/          # SSO 中央伺服器 (Express, port 35890)
├── frontend/         # SSO 管理後台 (Next.js, port 3000)
└── docker-compose-prod.yml
```

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
