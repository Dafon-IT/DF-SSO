# DF-SSO 系統設計文件

## 目標

建立企業統一 SSO（Single Sign-On）單一登入系統：

1. 各子專案透過 **OAuth2 Client Credentials**（`app_id` + `app_secret`）接入 SSO 中央
2. 登入 App-A → App-B **自動登入**（中央 session 共享）
3. 登出 App-A → SSO **刪除中央 session** + **back-channel 通知所有 App**
4. 每個 App 可註冊多個 **`redirect_uris`**（dev / test / prod 共用同一組 credentials）
5. 子專案整合只需 **5 個檔案 + 4 個環境變數**

---

## 系統架構

```
┌─────────────────────────────────────────────────────────────────────┐
│                           使用者瀏覽器                               │
└──────┬──────────────┬──────────────┬────────────────────────────────┘
       │              │              │
       ▼              ▼              ▼
┌──────────────┐ ┌──────────┐ ┌──────────┐
│ SSO Frontend │ │  App-A   │ │  App-B   │       ...更多子專案
│  (Next.js)   │ │(Next.js) │ │(Next.js) │
│  Port 3000   │ │Port 3100 │ │Port 3200 │
│              │ │          │ │          │
│ ‧管理後台    │ │ ‧本地 token│ │ ‧本地 token│
│ ‧應用程式管理 │ │  cookie   │ │  cookie   │
│ ‧登入紀錄    │ │ ‧API routes│ │ ‧API routes│
│ ‧管理員管理  │ └────┬─────┘ └────┬─────┘
└──────┬───────┘      │            │
       │    ┌─────────┴────────────┘
       │    │  server-to-server
       ▼    ▼  (code exchange + client credentials / Bearer token)
┌──────────────────────────────────┐
│    SSO Backend (Express.js)      │
│    Port 35890                    │
│                                  │
│  OAuth2 Authorization Server：   │
│  ‧app_id + app_secret 管理      │
│  ‧redirect_uris 多環境註冊      │
│  ‧HMAC-SHA256 back-channel 簽章 │
│  ‧timingSafeEqual 防 timing attack│
│  ‧Auth Code Lua 原子操作         │
│                                  │
│  安全機制：                       │
│  ‧Helmet (安全 headers)          │
│  ‧Rate Limiting（分層）          │
│  ‧CORS 動態白名單 (redirect_uris)│
│  ‧重導向白名單驗證               │
│  ‧Session fixation 防護          │
│  ‧環境變數啟動驗證               │
│  ‧Graceful Shutdown              │
└────┬────────┬─────────┬──────────┘
     │        │         │
┌────▼───┐ ┌──▼─────┐ ┌─▼──────────┐
│Microsoft│ │Postgre │ │   Redis    │
│Azure AD │ │  SQL   │ │  (DB 15)   │
│(OAuth)  │ │DB:SSO-v1│ │            │
└─────────┘ └────────┘ └────────────┘
                │
          ┌─────▼──────┐
          │  ERP API   │
          │ (員工資料)  │
          └────────────┘
```

---

## SSO 核心流程

### 登入流程

```
使用者訪問 App-A → /api/auth/me → 無 token → 401 "no_token" → 自動導向 SSO
        │
        ▼
[1] 瀏覽器導向 SSO Backend
    GET /api/auth/sso/authorize?client_id={app_id}&redirect_uri={APP_URL}/api/auth/callback
        │
        ▼
[2] SSO 驗證
    - 用 client_id 查 sso_allowed_list.app_id
    - 驗證 redirect_uri origin 在 redirect_uris[] 中
    - 檢查是否已有中央 session（JWT cookie + Redis）
        │
        ├─ 已有 session ──→ [5] 直接產生 auth code（免登入！）
        │
        ▼  無 session
[3] 重導向到 Microsoft 登入頁
    - session 記住 ssoRedirect = redirect_uri
    - session.regenerate() 防 session fixation
        │
        ▼
[4] OAuth 回調
    - 用 authorization code 換取 tokens
    - state 用 timingSafeEqual 比對（防 CSRF）
    - 查詢 ERP API 取得員工資料
    - 寫入 sso_login_log
    - 產生 JWT + 寫入 Redis Session (24h TTL)
    - 設定 httpOnly cookie (domain: .apps.zerozero.tw)
        │
        ▼
[5] 產生一次性 Auth Code
    - 隨機 32 bytes hex，存入 Redis（TTL 60 秒）
    - 內含：userId, email, name, erpData
    - 重導向：redirect_uri?code=xxx
        │
        ▼
[6] App-A /api/auth/callback 接收 code
    - POST SSO /api/auth/sso/exchange { code, client_id, client_secret }
    - SSO 用 timingSafeEqual 驗證 client_secret
    - SSO 用 Lua script 原子性 GET+DEL auth code
    - 回傳 { user, token }
    - App-A 將 token 存入 httpOnly cookie（本地 domain）
    - 重導向 /dashboard
        │
        ▼
[7] App-A Dashboard
    - /api/auth/me → 讀本地 token → Bearer 轉發 SSO /api/auth/me
    - SSO 驗證 JWT + Redis Session → 回傳用戶資料
```

### 跨應用自動登入

```
已登入 App-A，訪問 App-B → /api/auth/me → 401 "no_token"
  → 自動導向 SSO /authorize?client_id={app_b_id}
  → SSO 有中央 session → 直接產生 auth code（不碰 Microsoft！）
  → App-B exchange { code, client_id, client_secret } → 存 token → Dashboard
```

### 登出流程

```
App-A 點登出 → /api/auth/logout
  → 讀本地 token → POST SSO /api/auth/logout (Bearer)
  → SSO 刪除 Redis session
  → SSO back-channel POST 所有 App /api/auth/back-channel-logout
    { user_id, timestamp, signature }  ← HMAC-SHA256(app_secret, user_id:timestamp)
  → App-A 清除本地 cookie → redirect /?logged_out=1
  → App-B 下次 /me → SSO 回 401 → 清本地 token → 顯示登入按鈕
```

### Session 過期

```
/api/auth/me → SSO Redis session 過期 → 401 "session_expired"
  → Client 清除本地 token → 回首頁
  → /api/auth/me → "no_token"（不是 session_expired）
  → 自動導向 SSO → SSO 有中央 cookie → 靜默重新登入
```

---

## 安全機制

| 機制 | 說明 |
|------|------|
| **OAuth2 Client Credentials** | 每個 App 有 `app_id`（公開）+ `app_secret`（保密），exchange 時驗證 |
| **timingSafeEqual** | client_secret、OAuth state 比對使用常數時間，防 timing attack |
| **HMAC-SHA256 簽章** | back-channel logout 帶 `signature = HMAC(app_secret, user_id:timestamp)`，Client 驗證防偽造 |
| **Timestamp 驗證** | back-channel 簽章含 timestamp，30 秒內有效，防 replay attack |
| **Auth Code 原子操作** | Redis Lua script `GET+DEL`，防同一 code 重複使用 |
| **Session fixation 防護** | 登入成功後 `req.session.regenerate()` 重新產生 session ID |
| **Redirect 白名單** | authorize 的 `redirect_uri` 和 logout 的 `redirect` 都驗證 `redirect_uris[]` |
| **Protocol 限制** | logout redirect 只允許 `http:` / `https:` 協定，防 `javascript:` 注入 |
| **Secret 遮蔽** | API 列表只回傳 `app_secret_last4`，完整 secret 需管理員呼叫 `/credentials` |
| **Helmet** | X-Content-Type-Options、X-Frame-Options、HSTS 等安全 headers |
| **Rate Limiting** | 分層限制（見下表） |
| **Body Size Limit** | `express.json()` 限制 1MB |
| **Graceful Shutdown** | SIGTERM/SIGINT → 停止接受新連線 → 等待完成 → 關閉 DB/Redis |

### Rate Limiting

| 範圍 | 限制 | 說明 |
|------|------|------|
| 全域 | 500 / 15min | 防 DoS |
| Auth（login/redirect/authorize） | 30 / 15min | 防暴力登入 |
| Session（/me、POST /logout） | 100 / 15min | Client App 高頻 server-to-server |
| Exchange | 20 / 1min | 防 auth code 猜測 |

---

## 資料庫設計

### sso_allowed_list（應用程式白名單）

| 欄位 | 型態 | 說明 |
|------|------|------|
| `ppid` | SERIAL PK | 自動遞增主鍵 |
| `uid` | UUID | UUIDv7 |
| `domain` | VARCHAR(255) | 主要網域（UNIQUE when not deleted） |
| `name` | VARCHAR(255) | App 顯示名稱 |
| `description` | TEXT | 說明 |
| `app_id` | UUID | OAuth2 Client ID（自動產生，UNIQUE） |
| `app_secret` | VARCHAR(64) | OAuth2 Client Secret（自動產生，64 char hex） |
| `redirect_uris` | TEXT[] | 允許的 redirect_uri origins（dev/test/prod） |
| `is_active` | BOOLEAN | 是否啟用 |
| `is_deleted` | BOOLEAN | 軟刪除 |
| `created_at` / `updated_at` | TIMESTAMPTZ | 含時區 |

**白名單用途：**
1. **OAuth2 授權** — `client_id` 查找 + `redirect_uri` 驗證 `redirect_uris[]`
2. **Code exchange** — 驗證 `client_id` + `client_secret`
3. **CORS** — 從所有 App 的 `redirect_uris[]` 收集 origins + `FRONTEND_URL`
4. **Back-channel** — 從 `redirect_uris[]` 收集 origins + 對應的 `app_secret` 產生 HMAC
5. **Redirect 驗證** — logout redirect 必須在 `redirect_uris[]` 中

### sso_login_log（登入紀錄）

| 欄位 | 型態 | 說明 |
|------|------|------|
| `ppid` | SERIAL PK | 自動遞增主鍵 |
| `uid` | UUID | UUIDv7 |
| `azure_oid` | VARCHAR(255) | Microsoft AD Object ID |
| `email` | VARCHAR(255) | 使用者 Email |
| `name` | VARCHAR(255) | 顯示名稱 |
| `erp_gen01` ~ `erp_gen06` | VARCHAR | ERP 員工資料 |
| `status` | VARCHAR(20) | `success` / `failed` / `erp_not_found` |
| `error_message` | TEXT | 錯誤訊息 |
| `ip_address` | VARCHAR(45) | 來源 IP |
| `user_agent` | TEXT | User Agent |
| `created_at` / `updated_at` | TIMESTAMPTZ | 含時區 |

### sso_admin_manager（管理員）

| 欄位 | 型態 | 說明 |
|------|------|------|
| `ppid` | SERIAL PK | 自動遞增主鍵 |
| `uid` | UUID | UUIDv7 |
| `azure_oid` | VARCHAR(255) | Microsoft AD Object ID（首次登入後填入） |
| `email` | VARCHAR(255) | Email（UNIQUE when not deleted） |
| `name` | VARCHAR(255) | 顯示名稱 |
| `is_active` | BOOLEAN | 是否啟用 |
| `is_newer` | BOOLEAN | 是否尚未登入 |
| `is_deleted` | BOOLEAN | 軟刪除 |

---

## Redis 設計

| Key | TTL | Value | 說明 |
|-----|-----|-------|------|
| `sso:session:{userId}` | 24h | `{ userId, email, name, erpData, loginLogUid, loginAt }` | 中央 session |
| `sso:code:{hex64}` | 60s | `{ userId, email, name, erpData }` | 一次性 auth code（Lua GET+DEL） |
| `sess:{sessionId}` | 10min | Express session data | OAuth state + ssoRedirect |

---

## API 端點

### SSO 授權（OAuth2）

| Method | Path | Rate Limit | 說明 |
|--------|------|------------|------|
| GET | `/api/auth/sso/authorize` | 30/15min | `?client_id=&redirect_uri=` 授權入口 |
| POST | `/api/auth/sso/exchange` | 20/1min | `{ code, client_id, client_secret }` 換 token |
| GET | `/api/auth/sso/logout` | 30/15min | 全域登出 + HMAC back-channel |

### Auth 認證

| Method | Path | Rate Limit | 說明 |
|--------|------|------------|------|
| GET | `/api/auth/{authPath}/login` | 30/15min | Microsoft OAuth 登入 |
| GET | `/api/auth/{authPath}/redirect` | 30/15min | OAuth 回調 |
| GET | `/api/auth/me` | 100/15min | 驗證 JWT + Redis（Cookie 或 Bearer） |
| POST | `/api/auth/logout` | 100/15min | 登出（Bearer + HMAC back-channel） |

### 應用程式管理（Admin）

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/allowed-list` | 取得所有 App（secret 遮蔽） |
| GET | `/api/allowed-list/:uid` | 取得單筆（secret 遮蔽） |
| POST | `/api/allowed-list` | 新增 App（自動產生 app_id + app_secret） |
| PUT | `/api/allowed-list/:uid` | 更新（domain/name/redirect_uris/is_active） |
| DELETE | `/api/allowed-list/:uid` | 軟刪除 |
| GET | `/api/allowed-list/:uid/credentials` | 取得完整 app_id + app_secret |
| POST | `/api/allowed-list/:uid/regenerate-secret` | 重新產生 app_secret |

### 其他

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/login-log` | 登入紀錄搜尋（email/status/date/page） |
| GET/POST/PUT/DELETE | `/api/admin-manager` | 管理員 CRUD |
| GET | `/api/health` | PostgreSQL + Redis 狀態 |
| GET | `/api/docs` | Swagger API 文件 |

---

## 環境變數

### SSO Backend（✱ = 必填）

| 變數 | 說明 |
|------|------|
| `PORT` | 後端 Port（預設 3001，prod 35890） |
| `NODE_ENV` | `development` / `production` |
| `FRONTEND_URL` | SSO Frontend URL（CORS 永遠允許） |
| ✱ `SESSION_SECRET` | Express Session 密鑰 |
| ✱ `JWT_SECRET` | JWT 簽名密鑰 |
| `JWT_EXPIRES_IN` | JWT 過期時間（預設 24h） |
| ✱ `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID` | Azure AD |
| ✱ `AZURE_REDIRECT_URI` | OAuth Redirect URI |
| `COOKIE_DOMAIN` | 共用 cookie domain（如 `.apps.zerozero.tw`） |
| ✱ `PG_DATABASE` / `PG_USER` / `PG_PASSWORD` | PostgreSQL |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` | Redis（有預設值） |
| `ERP_API_*` | ERP API（選填） |

### Client App

| 變數 | 說明 |
|------|------|
| `SSO_URL` | SSO Backend URL（server-side） |
| `SSO_APP_ID` | 從白名單取得的 app_id（server-side） |
| `SSO_APP_SECRET` | 從白名單取得的 app_secret（server-side，保密） |
| `APP_URL` | 本 App URL（各環境各自設） |
| `NEXT_PUBLIC_SSO_URL` | SSO Backend URL（client-side） |
| `NEXT_PUBLIC_SSO_APP_ID` | 同 SSO_APP_ID（client-side，公開） |
| `NEXT_PUBLIC_APP_URL` | 同 APP_URL（client-side） |

---

## 技術棧

| 層級 | 技術 |
|------|------|
| SSO Frontend | Next.js + TypeScript + Tailwind CSS |
| SSO Backend | Node.js + Express.js |
| 安全 | Helmet + express-rate-limit + CORS 動態白名單 + HMAC-SHA256 |
| 認證 | Microsoft Azure AD (OAuth 2.0 + MSAL) |
| 資料庫 | PostgreSQL 16 |
| Session / 快取 | Redis 7 (ioredis) |
| Token | JWT (HS256, 24h) |
| 部署 | Coolify + Docker Compose |
| API 文件 | Swagger (swagger-jsdoc + swagger-ui-express) |
