# DF-SSO

大豐環保 SSO 單一登入系統。所有子專案共用一組 Microsoft 帳號認證，登入一次即可跨系統使用。

> **線上環境：**
>
> | 環境 | Frontend (管理後台) | Backend (OAuth2 Server) |
> |------|-------------------|------------------------|
> | **Prod** | https://df-sso-management.apps.zerozero.tw | https://df-sso-login.apps.zerozero.tw |
> | **Test** | https://df-sso-management-test.apps.zerozero.tw | https://df-sso-login-test.apps.zerozero.tw |

---

## Description

### 系統架構

```
Client App（MockA / MockB / ...）       SSO 中央（本專案）            Microsoft Azure AD
┌──────────────────────┐            ┌──────────────────┐         ┌────────────┐
│  /api/auth/me        │  Bearer    │  驗證 JWT        │         │            │
│  /api/auth/callback  │ ──(code)─> │  code exchange   │         │            │
│   + client_id/secret │            │  驗證 credentials│         │            │
│  /api/auth/logout    │ ──(token)─>│  刪 session      │         │            │
│                      │            │  back-channel    │         │            │
│                      │  <──────── │  authorize       │ ──────> │  OAuth 2.0 │
│                      │            │  redirect        │ <────── │            │
└──────────────────────┘            └──────────────────┘         └────────────┘
```

### 核心原則

- 每個 Client App 由 SSO 中央發放 **`app_id`** + **`app_secret`**（OAuth2 Client Credentials）
- `app_id` + `app_secret` 跨環境共用（本機 / Test / Prod 同一組），只需改 `APP_URL`
- 一個 App 可註冊多個 **`redirect_uris`**（本機 / Test / Prod 各自的 origin，最多 10 筆）
- SSO 是唯一的 session 管理平台，Client App 每次都向 SSO `/api/auth/me` 即時驗證

---

## 流程

### 登入

1. Client App `/api/auth/me` → 無 token → `401 no_token` → 自動導向 SSO `/sso/authorize?client_id=...`
2. SSO 用 `client_id` 查白名單 → 驗證 `redirect_uri` origin 在 `redirect_uris` 中
3. SSO 檢查中央 session → 無 → 導向 Microsoft 登入
4. Microsoft 登入成功 → SSO 建立 Redis session → 產生一次性 auth code（60 秒 TTL）
5. redirect 回 Client App `/api/auth/callback?code=xxx`
6. Client App POST `/sso/exchange` `{ code, client_id, client_secret }` → 換 JWT token → 存本地 cookie

### 跨 App 免登入

1. 已在 App-A 登入 → 訪問 App-B → App-B `/api/auth/me` → `401 no_token`
2. 自動導向 SSO `/sso/authorize` → SSO 已有中央 session → 靜默產生 code → redirect 回 App-B
3. App-B 用 code + credentials 換 token → 自動進 Dashboard（不跳 Microsoft 登入頁）

### 登出

1. Client App 讀取本地 token → POST SSO `/api/auth/logout`（Bearer token）
2. SSO 刪除 Redis session → back-channel 通知所有 Client App
3. Client App 清除本地 cookie → redirect `/?logged_out=1`

### Session 過期

1. Client App `/api/auth/me` → SSO Redis session 過期 → `401 session_expired` → 清除本地 cookie
2. 重新進入首頁 → `no_token` → 自動導向 SSO → SSO 有中央 cookie → 靜默重新登入

---

## API 端點

| Method | Path | 用途 | Rate Limit |
|--------|------|------|-----------|
| GET | `/api/auth/sso/authorize` | `?client_id=&redirect_uri=` 導向 SSO 認證 | 30/15min |
| POST | `/api/auth/sso/exchange` | `{ code, client_id, client_secret }` 換 token | 20/1min |
| GET | `/api/auth/sso/logout` | SSO Frontend 全域登出 | 30/15min |
| GET | `/api/auth/{authPath}/login` | 導向 Microsoft 登入 | 30/15min |
| GET | `/api/auth/{authPath}/redirect` | Microsoft OAuth 回調 | 30/15min |
| GET | `/api/auth/me` | 驗證 JWT + Redis session | 100/15min |
| POST | `/api/auth/logout` | 登出（Bearer token + back-channel） | 100/15min |
| GET | `/api/health` | Health check | 500/15min |

---

## Coolify 部署

Coolify 上同時部署 **Prod** 與 **Test** 兩套獨立 stack，各自的 Postgres / Redis volume 完全隔離（`sso-prod-*` vs `sso-test-*`）。

| 環境 | Compose 檔 | Migration 目錄 | `NODE_ENV` |
|------|-----------|---------------|-----------|
| **Prod** | [docker-compose-prod.yml](docker-compose-prod.yml) | `backend/migrations/prod/` | `production` |
| **Test** | [docker-compose-test.yml](docker-compose-test.yml) | `backend/migrations/dev/` | `test` |
| **Dev** | [docker-compose-dev.yml](docker-compose-dev.yml) | `backend/migrations/dev/` | `production`（或自訂） |

### SSO Backend 環境變數（Prod / Test 通用）

| 類別 | 變數 | 說明 |
|------|------|------|
| Server | `NODE_ENV` | `production`（Prod）/ `test`（Test）/ `development`（本機） |
| Server | `FRONTEND_URL` | SSO Frontend URL（CORS 永遠允許） |
| Server | `MIGRATIONS_DIR` | `prod`（Prod baseline）/ `dev`（完整歷史） |
| Auth | `SESSION_SECRET` / `JWT_SECRET` | 隨機產生的強密鑰 |
| Azure AD | `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID` | Azure Portal 取得 |
| Azure AD | `AZURE_REDIRECT_URI` | Microsoft callback URL（`authPathSegment` 會自動解析） |
| Cookie | `COOKIE_DOMAIN` | 共用 cookie domain（預設 `.apps.zerozero.tw`） |
| DB | `PG_DATABASE` / `PG_USER` / `PG_PASSWORD` | PostgreSQL 必填 |
| Cache | `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` | Redis（有預設值） |

完整環境變數說明見 [docs/Design.md](docs/Design.md#環境變數)。

### 白名單 (sso_allowed_list)

建立 App 時 SSO 自動產生 `app_id` + `app_secret`，管理員設定 `redirect_uris`（每 App 最多 10 筆）。**同一組 credentials 跨 Prod / Test / 本機共用**，只要把對應環境的 origin 加進 `redirect_uris` 即可。

Prod baseline seed 只會灌入 `SSO Management` 自身（`https://df-sso-management.apps.zerozero.tw`）— 其他 Client App 由管理員登入 Dashboard 後手動新增。

### 驗證步驟

1. `GET <Backend URL>/api/health` → `{ status: "ok", pg: "connected", redis: "connected" }`
2. 從 Client App 登入 → Microsoft → Client App Dashboard
3. 訪問另一個 Client App → 自動登入（不跳 Microsoft）
4. 任一 App 登出 → Redis session 刪除 → 其他 App 下次 `/me` 回 401
5. 連續重整頁面 → 不應出現 rate limit 錯誤

---

## 專案結構

```
DF-SSO/
├── backend/                    # SSO 中央伺服器（Express；本機 3001 / 容器 35890）
├── frontend/                   # SSO 管理後台（Next.js，本機 port 3000）
├── microsoft-ad-login/         # Claude skill：協助 Client App 接入
├── docs/Design.md              # 系統設計與限制一覽
├── INTEGRATION.md              # Client App 整合指引
├── docker-compose-dev.yml      # 本機開發樣板
├── docker-compose-test.yml     # ★ Coolify Test 環境部署
└── docker-compose-prod.yml     # ★ Coolify Prod 環境部署
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
