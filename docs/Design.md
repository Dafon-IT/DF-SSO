# DF-SSO 系統設計文件

> **部署狀態：** Prod 與 Test 環境皆已上線。
>
> | 環境 | Frontend | Backend | Compose | Migrations |
> |------|----------|---------|---------|------------|
> | **Prod** | `https://df-sso-management.apps.zerozero.tw` | `https://df-sso-login.apps.zerozero.tw` | `docker-compose-prod.yml` | `backend/migrations/prod/` |
> | **Test** | `https://df-sso-management-test.apps.zerozero.tw` | `https://df-sso-login-test.apps.zerozero.tw` | `docker-compose-test.yml` | `backend/migrations/dev/` |
> | **Dev** | `http://localhost:3000` | `http://localhost:3001` | `docker-compose-dev.yml` | `backend/migrations/dev/` |

## 目標

建立企業統一 SSO（Single Sign-On）單一登入系統：

1. 各子專案透過 **OAuth2 Client Credentials**（`app_id` + `app_secret`）接入 SSO 中央
2. 登入 App-A → App-B **自動登入**（中央 session 共享）
3. 登出 App-A → SSO **刪除中央 session** + **back-channel 通知所有 App**
4. 每個 App 可註冊多個 **`redirect_uris`**（同一組 credentials 可橫跨多個 origin，例如 dev + prod）
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
│ 單頁 Dashboard │ │本地 token │ │本地 token │
│ (Tab 切換) :   │ │ cookie    │ │ cookie    │
│ ‧應用程式管理 │ │API routes │ │API routes │
│ ‧登入紀錄    │ │(callback, │ │(callback, │
│ ‧管理員管理  │ │ me, logout)│ │ me, logout)│
└──────┬───────┘ └────┬─────┘ └────┬─────┘
       │              │            │
       │    ┌─────────┴────────────┘
       │    │  server-to-server
       ▼    ▼  (code exchange + client credentials / Bearer token)
┌──────────────────────────────────┐
│    SSO Backend (Express.js)      │
│    本機 3001 / Test 容器 35890   │
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
│  ‧adminAuth 中間件 (後台 API)    │
│  ‧環境變數啟動驗證               │
│  ‧Graceful Shutdown              │
└────┬────────┬─────────┬──────────┘
     │        │         │
┌────▼───┐ ┌──▼─────┐ ┌─▼──────────┐
│Microsoft│ │Postgre │ │   Redis    │
│Azure AD │ │  SQL   │ │ (ioredis)  │
│(OAuth)  │ │  16    │ │     7      │
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

### 登出流程（兩層 Session 模型）

```
App-A 點登出 → /api/auth/logout
  → 讀本地 token → POST SSO /api/auth/logout (Bearer)
                  body: { redirect: "<APP_URL>/?logged_out=1" }
  → SSO 刪除 Redis session（sso:session:{userId}）
  → SSO back-channel POST 所有 App /api/auth/back-channel-logout
    { user_id, timestamp, signature }  ← HMAC-SHA256(app_secret, user_id:timestamp)
  → SSO 驗證 redirect origin 在 sso_allowed_list（剝除 path/query/fragment）
  → 回傳 { message, redirect: "<APP_ORIGIN>/?logged_out=1" }
  → App-A 清除本地 cookie → 302 redirect
```

**設計原則：登出只清「中央 + App 兩層」，不動 AD（Microsoft）那層。**

| 層級 | 由誰維護 | 登出時 |
|------|----------|--------|
| AD session | Microsoft（長壽） | **不動** — 避免使用者每次登入都被迫重打密碼 / MFA / passkey |
| 中央 SSO session | DF-SSO Redis（key = `sso:session:{userId}`） | **刪除** |
| App session | 各 Client App cookie | back-channel 收到通知後刪除 |

**「登出真的有效」由 Client App 端契約保障**（見下節 [Client App 登入頁契約](#client-app-登入頁契約)）：
back-channel 已清掉 App 本地 cookie，App **必須顯示自家登入頁**，**不可** 自動 redirect 到 `/authorize`。
使用者必須在 App 登入頁主動點「登入」才會重新觸發 OAuth flow。

### Client App 登入頁契約

每個整合 SSO 的 Client App **必須遵守** 以下契約，否則「登出」會等同無效（lazy App 自動 redirect → AD silent → 立刻又回到 Dashboard）：

| 情境 | App 端正確行為 | 錯誤行為（會破壞 logout） |
|------|----------------|----------------------------|
| `/api/auth/me` 回 `401 no_token`（沒 cookie，含登出後） | **顯示 App 自家登入首頁**，等使用者點「登入」按鈕 | 自動 `window.location = SSO_URL/authorize?...` |
| `/api/auth/me` 回 `401 session_expired`（有本地 token 但中央 session 過期 / 被登出） | 清除本地 cookie 後，導回首頁 → 觸發上面 `no_token` 流程 | 同上自動 redirect |
| 收到 back-channel logout（`/api/auth/back-channel-logout`） | 驗 HMAC + timestamp 後刪除該 user_id 的本地 session | 不驗簽 / 不驗 timestamp |

> 範本實作見 [INTEGRATION.md](../INTEGRATION.md) 的 `LoginPage` component 與 middleware。

### 兩種 401 情境對照

```
情境 A：中央 session 自然過期（24h TTL 到）
  /api/auth/me → SSO Redis sso:session:{userId} 不存在 → 401 "session_expired"
    → Client 清除本地 token → 回首頁
    → /api/auth/me → 401 "no_token"
    → 顯示登入頁 → 使用者點「登入」
    → /authorize → AD silent SSO → callback → 建立新 session → Dashboard
    （AD session 還在，所以 AD 那關不會跳出畫面）

情境 B：使用者按了登出
  App-A 觸發登出 → 中央刪 sso:session + back-channel 全部 App
    → App-B 本地 cookie 也被清掉
    → 使用者下次回到 App-B：
       /api/auth/me → 401 "no_token"
       → 顯示登入頁 → 使用者點「登入」
       → /authorize → AD silent SSO → callback → 建立新 session → Dashboard
       （和情境 A 一模一樣，差別只在「使用者必須親自點登入」是 logout 的核心保護）
```

> 兩種情境在 backend 行為完全一致（都是「沒中央 session → 走 OAuth 重建」），
> 差別純粹在 App 端：**登出後 App 必須讓使用者看到登入頁**，不能偷偷 silent re-login。

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
| **Logout Origin 剝離** | 驗證通過後只保留 `URL.origin`，剝除 path/query/fragment 防注入 |
| **Secret 遮蔽** | API 列表只回傳 `app_secret_last4`，完整 secret 需管理員呼叫 `/credentials` |
| **adminAuth 中間件** | `/api/allowed-list`、`/api/login-log`、`/api/admin-manager` 須驗證 JWT + Redis Session + 管理員白名單 |
| **Self-delete 防護** | `DELETE /api/admin-manager/:uid` 禁止管理員刪除自己 |
| **Helmet** | X-Content-Type-Options、X-Frame-Options、HSTS 等安全 headers |
| **Rate Limiting** | 分層限制（見下表） |
| **Body Size Limit** | `express.json()` / `urlencoded()` 限制 1MB |
| **trust proxy** | `app.set('trust proxy', 1)` 讓 rate limiter 從 `X-Forwarded-For` 正確取 IP |
| **Graceful Shutdown** | SIGTERM/SIGINT → 停止接受新連線 → 等待完成 → 關閉 DB/Redis |

### Rate Limiting

Rate limit 設定**不寫死在程式碼內**，實際值來自 `sso_setting` 表的 `rate_limit.*` 四筆 seed，可於 Dashboard 的「設定」分頁即時調整；backend 由 [services/rateLimitManager.js](../backend/services/rateLimitManager.js) 的 wrapper middleware 指向可變的 limiter instance，PUT `/api/sso-setting/:key` 成功後會 `reload()` 重建 instance 讓新值立即生效（視窗計數會重置）。若啟動時 DB 不可用則 fallback 到下表預設值。

| 範圍 | 預設值 | 說明 |
|------|--------|------|
| 全域 | 500 / 15min | 防 DoS |
| Auth（login/redirect/authorize） | 30 / 15min | 防暴力登入 |
| Session（/me、POST /logout） | 100 / 15min | Client App 高頻 server-to-server |
| Exchange | 20 / 1min | 防 auth code 猜測 |

---

## 系統限制（Limits）一覽

### 時效限制

| 項目 | 值 | 位置 |
|------|----|------|
| 中央 session TTL | **24 小時**（Redis `sso:session:*`） | [backend/routes/auth.js](../backend/routes/auth.js) `SESSION_TTL` |
| JWT 過期時間 | **24 小時**（`JWT_EXPIRES_IN` 可覆寫） | [backend/config/index.js](../backend/config/index.js) |
| 一次性 Auth Code TTL | **60 秒**，Lua `GET+DEL` 原子消耗 | [backend/routes/sso.js](../backend/routes/sso.js) `AUTH_CODE_TTL` |
| Express Session（OAuth state）TTL | **10 分鐘** | [backend/server.js](../backend/server.js) |
| Back-channel HMAC timestamp 容忍 | **30 秒**（Client 端驗證） | [INTEGRATION.md](../INTEGRATION.md) 範本 |
| Back-channel 對單一 App 的 fetch timeout | **5 秒**（`AbortSignal.timeout`） | [backend/routes/auth.js](../backend/routes/auth.js) / [sso.js](../backend/routes/sso.js) |
| CORS origin 快取 TTL | **60 秒** | [backend/server.js](../backend/server.js) `CORS_CACHE_TTL` |
| Graceful shutdown 強制關閉 | **10 秒**後 `process.exit(1)` | [backend/server.js](../backend/server.js) |

### 格式與長度限制

| 項目 | 限制 |
|------|------|
| Request body | **1 MB**（`express.json({ limit: '1mb' })`） |
| `app_secret` 長度 | **64 字元 hex**（`crypto.randomBytes(32)`），exchange 先檢查長度再 `timingSafeEqual` |
| Auth code 長度 | **64 字元 hex**，exchange 前嚴格比對長度 |
| OAuth state 長度 | **64 字元 hex** |
| Cookie `sameSite` | `lax`；`secure` 僅在 `NODE_ENV=production` 開啟 |
| Redirect URL 協定 | 僅允許 `http:` / `https:`（防 `javascript:` 注入） |

### 資料限制

| 項目 | 限制 | 位置 |
|------|------|------|
| 每個 App 的 `redirect_uris` 筆數 | **最多 10 筆** | [backend/routes/allowedList.js](../backend/routes/allowedList.js) |
| `/api/login-log` `pageSize` | **1 – 100**（超出自動 clamp） | [backend/services/loginLog.js](../backend/services/loginLog.js) |
| 管理員 `email` 格式 | 必須符合 `^[^\s@]+@[^\s@]+\.[^\s@]+$` |
| `domain` 格式 | 必須為合法 URL，協定限 `http:` / `https:` |
| 重複 `domain` | DB UNIQUE 約束（軟刪除時不衝突；建立時若存在軟刪除同名紀錄會自動恢復） |

### Rate Limit 限制

> 所有值由 `sso_setting` 表（category = `rate_limit`）動態載入，管理員可於 Dashboard「設定」分頁即時調整；以下為 seed / fallback 預設值。

| 範圍 | 預設值 | sso_setting key |
|------|--------|------------------|
| 全域 | 500 次 / 15 分鐘 / IP | `rate_limit.global` |
| Auth (`/login`、`/redirect`、`/authorize`) | 30 次 / 15 分鐘 / IP | `rate_limit.auth` |
| Session (`/me`、POST `/logout`) | 100 次 / 15 分鐘 / IP | `rate_limit.session` |
| Exchange (`POST /sso/exchange`) | 20 次 / 1 分鐘 / IP | `rate_limit.exchange` |

> 使用 `app.set('trust proxy', 1)`，rate limit 會從 `X-Forwarded-For` 取真實 IP。
> 修改設定後 wrapper middleware 會重建 limiter instance，當前視窗的計數會歸零。

### 存取控制限制

| 項目 | 規則 |
|------|------|
| `/api/allowed-list`、`/api/login-log`、`/api/admin-manager` | 必須通過 `adminAuth`：JWT 有效 → Redis session 存在 → `email` 在 `sso_admin_manager` 且 `is_active = TRUE` |
| 非 SSO 流程直接登入管理後台 | `email` / `azure_oid` 須在 `sso_admin_manager`，否則跳 `?error=not_admin` |
| SSO 流程（`ssoRedirect` 存在） | **不檢查管理員身份**，允許任何 AD 員工登入 Client App |
| 管理員自刪 | `DELETE /api/admin-manager/:uid` 禁止刪除自己 |
| 白名單網域（`config.frontendUrl`） | Microsoft 登入後會驗證 `FRONTEND_URL` 必須在 `sso_allowed_list` 中，否則 `?error=domain_not_allowed` |
| Redirect URI 驗證 | authorize 的 `redirect_uri` 其 `URL.origin` 必須存在於該 App 的 `redirect_uris[]` |
| Logout redirect | origin 必須在全體 `redirect_uris[]` 或 `FRONTEND_URL`；驗證後僅保留 origin（剝除 path/query/fragment） |

### 登入流程限制

| 項目 | 限制 |
|------|------|
| OAuth `state` 驗證 | `timingSafeEqual` 先比長度再比內容，不符即 `?error=invalid_state` |
| Session fixation 防護 | Microsoft 登入成功後 `req.session.regenerate()` 重新產生 session ID |
| Auth code 重用 | Redis Lua script `GET+DEL`，第二次使用直接 `401 Invalid or expired code` |
| ERP 查詢失敗 | 不中斷登入，`status = erp_not_found`，`erpData` 為 `null` |
| Microsoft token exchange 失敗 | 寫入 `sso_login_log` `status = failed` + `errorMessage`，redirect `?error=token_exchange_failed` |

### 部署環境（目前狀態）

| 環境 | 狀態 | Frontend URL | Backend URL |
|------|------|--------------|-------------|
| **Prod** | ✅ 線上 | `https://df-sso-management.apps.zerozero.tw` | `https://df-sso-login.apps.zerozero.tw` |
| **Test** | ✅ 線上 | `https://df-sso-management-test.apps.zerozero.tw` | `https://df-sso-login-test.apps.zerozero.tw` |
| **Dev** | 本機 | `http://localhost:3000` | `http://localhost:3001` |

| Port 與 Service | 值 |
|-----------------|----|
| SSO Frontend 本機 port | 3000 |
| SSO Backend 本機 port | 3001 |
| SSO Backend 容器 port（Test / Prod） | 35890 |
| Client App MockA / MockB 本機 port | 3100 / 3200 |

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
| `redirect_uris` | TEXT[] | 允許的 redirect_uri origins（本機 / test，最多 10 筆） |
| `is_active` | BOOLEAN | 是否啟用 |
| `is_deleted` | BOOLEAN | 軟刪除 |
| `created_at` / `updated_at` | TIMESTAMPTZ | 含時區 |

**白名單用途：**
1. **OAuth2 授權** — `client_id` 查找 + `redirect_uri` 的 `URL.origin` 必須在 `redirect_uris[]`
2. **Code exchange** — 驗證 `client_id` + `client_secret`（`timingSafeEqual`）
3. **CORS** — 從所有 App 的 `redirect_uris[]` 收集 origins + `FRONTEND_URL`（快取 60 秒）
4. **Back-channel** — 從 `redirect_uris[]` 收集 origins + 對應的 `app_secret` 產生 HMAC
5. **Redirect 驗證** — logout redirect 的 origin 必須在 `redirect_uris[]` 中

**限制：** 每個 App 最多 10 筆 `redirect_uris`，僅允許 `http:` / `https:` 協定

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

### sso_setting（系統動態設定）

通用 key-value 表，儲存可在 Dashboard 即時修改的 runtime 設定。目前只放 rate limit 四筆 seed，但表結構設計為通用，未來可追加其他類別（例如 session TTL、CORS 快取 TTL）而無需改 schema。

| 欄位 | 型態 | 說明 |
|------|------|------|
| `ppid` | SERIAL PK | 自動遞增主鍵 |
| `key` | VARCHAR(128) UNIQUE | 設定 key，以 `{category}.{name}` 命名（例如 `rate_limit.global`） |
| `value` | JSONB | 設定內容，格式由 category 決定 |
| `category` | VARCHAR(64) | 類別（目前：`rate_limit`） |
| `label` | VARCHAR(255) | 顯示用中文名稱 |
| `description` | TEXT | 顯示用說明 |
| `created_at` / `updated_at` | TIMESTAMPTZ | 含時區（BEFORE UPDATE trigger 自動更新 `updated_at`） |

**Rate limit 設定格式**：`value = { "windowMs": <number>, "max": <number> }`，`windowMs >= 1000`、`max >= 1`。

Seed 四筆 key：`rate_limit.global` / `rate_limit.auth` / `rate_limit.session` / `rate_limit.exchange`。

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

### 後台管理 API（皆須 `adminAuth` 中間件：JWT + Redis Session + 管理員白名單）

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/allowed-list` | 取得所有 App（secret 遮蔽為 `app_secret_last4`） |
| GET | `/api/allowed-list/:uid` | 取得單筆（secret 遮蔽） |
| POST | `/api/allowed-list` | 新增 App（自動產生 `app_id` + `app_secret`） |
| PUT | `/api/allowed-list/:uid` | 更新（domain / name / description / redirect_uris / is_active） |
| DELETE | `/api/allowed-list/:uid` | 軟刪除 |
| GET | `/api/allowed-list/:uid/credentials` | 取得完整 `app_id` + `app_secret` |
| POST | `/api/allowed-list/:uid/regenerate-secret` | 重新產生 `app_secret` |
| GET | `/api/login-log` | 登入紀錄搜尋（`email` / `status` / `startDate` / `endDate` / `page`） |
| GET | `/api/admin-manager` | 取得所有管理員 |
| GET | `/api/admin-manager/:uid` | 取得單筆管理員 |
| POST | `/api/admin-manager` | 新增管理員（僅需 `email`） |
| PUT | `/api/admin-manager/:uid` | 更新 `email` / `is_active` |
| DELETE | `/api/admin-manager/:uid` | 軟刪除（禁止刪除自己） |
| GET | `/api/sso-setting` | 取得全部系統設定（依 category + key 排序） |
| GET | `/api/sso-setting/:key` | 取得單筆設定 |
| PUT | `/api/sso-setting/:key` | 更新 `value`；`rate_limit.*` key 成功後會立即重建 rate limiter instance |

### 公開 / 系統

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/health` | PostgreSQL + Redis 狀態（任一失敗回 503 degraded） |
| GET | `/api/docs` | Swagger UI |
| GET | `/api/docs.json` | Swagger JSON |

---

## 環境變數

### SSO Backend（✱ = 必填）

| 變數 | 說明 |
|------|------|
| `PORT` | 後端 Port（預設 3001） |
| `NODE_ENV` | `development`（本機）/ `test`（Test 容器）/ `production`（Prod 容器） |
| `FRONTEND_URL` | SSO Frontend URL（CORS 永遠允許，預設 `http://localhost:3000`） |
| ✱ `SESSION_SECRET` | Express Session 密鑰 |
| ✱ `JWT_SECRET` | JWT 簽名密鑰 |
| `JWT_EXPIRES_IN` | JWT 過期時間（預設 `24h`） |
| ✱ `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID` | Azure AD 應用程式設定 |
| ✱ `AZURE_REDIRECT_URI` | Microsoft OAuth callback URL；`authPathSegment` 會從路徑 `/api/auth/{segment}/redirect` 自動解析 |
| `COOKIE_DOMAIN` | 共用 cookie domain（如 `.apps.zerozero.tw`；未設則僅限同 origin） |
| `ROPC_REDIRECT_URL` | 管理員直接登入成功後的預設跳轉路徑（預設 `/`） |
| ✱ `PG_DATABASE` / `PG_USER` / `PG_PASSWORD` | PostgreSQL 必填 |
| `PG_HOST` / `PG_PORT` / `PG_SCHEMA` | PostgreSQL 選填（預設 `localhost` / `5432` / `public`） |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` | Redis 選填（預設 `localhost` / `6379` / `0`） |
| `ERP_API_LOGIN_URL` / `ERP_API_SEARCH_URL` / `ERP_API_ACCOUNT` / `ERP_API_PASSWORD` | ERP 員工查詢（選填；未設則登入後 `status=erp_not_found`） |

> 啟動時會檢查 ✱ 必填變數，缺任一項 `process.exit(1)`。

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
| SSO Frontend | Next.js (App Router) + TypeScript + Tailwind CSS |
| SSO Backend | Node.js + Express.js |
| 安全 | Helmet + express-rate-limit + CORS 動態白名單 + HMAC-SHA256 + timingSafeEqual |
| 認證 | Microsoft Azure AD (OAuth 2.0 + `@azure/msal-node`) |
| 資料庫 | PostgreSQL 16（`node-pg-migrate`，dev/prod 雙目錄，見下） |
| Session / 快取 | Redis 7 (ioredis + `connect-redis`) |
| Token | JWT HS256（預設 24h） |
| API 文件 | Swagger（`swagger-jsdoc` + `swagger-ui-express`） |
| 部署 | Coolify + Docker Compose（Prod 與 Test 兩套獨立 stack；`docker-compose-dev.yml` 為本機開發樣板） |

---

## 專案結構

```
DF-SSO/
├── backend/                   # Express.js SSO Authorization Server
│   ├── server.js              # Helmet / CORS / rate limit / session / routes
│   ├── config/                # index.js(env) / database / redis / msal / swagger
│   ├── middleware/adminAuth.js# JWT + Redis session + admin 白名單
│   ├── routes/                # auth / sso / allowedList / loginLog / adminManager
│   ├── services/              # allowedList / loginLog / adminManager / erpApi
│   ├── migrations/
│   │   ├── dev/               # Test / 本機 dev（歷史 10 筆 schema / seed / fix）
│   │   └── prod/              # Prod 乾淨 baseline（3 筆：init-schema + admin seed + allowed_list seed）
│   └── sql/init.sql           # postgres 容器 bootstrap（只啟用 pgcrypto，schema 交給 migration）
├── frontend/                  # Next.js 管理後台
│   └── src/app/
│       ├── page.tsx           # 登入首頁
│       ├── layout.tsx
│       └── dashboard/page.tsx # 單頁 Tab 切換（應用程式 / 登入紀錄 / 管理員）
├── microsoft-ad-login/        # Claude skill: SSO 整合器
├── docs/Design.md             # 本文件
├── INTEGRATION.md             # Client App 整合指引
├── README.md
├── docker-compose-dev.yml      # 本機開發樣板
├── docker-compose-test.yml     # ★ Coolify Test 環境部署
└── docker-compose-prod.yml     # ★ Coolify Prod 環境部署
```

> Prod 與 Test 為**兩套獨立** Coolify stack，各自的 Postgres / Redis volume 也完全隔離（`sso-prod-*` vs `sso-test-*`）。

---

## Migration 管理

### 雙目錄策略

| 目錄 | 用途 | 使用者 |
|------|------|--------|
| [backend/migrations/dev/](../backend/migrations/dev/) | 本機開發與 Test 環境，**保留完整歷史**（10 筆）供除錯追蹤 | `docker-compose-dev.yml` / `docker-compose-test.yml` |
| [backend/migrations/prod/](../backend/migrations/prod/) | 正式環境，**乾淨 baseline**（3 筆）確保首次部署無歷史包袱 | `docker-compose-prod.yml` |

### 選擇機制

Backend 容器啟動時會依 `MIGRATIONS_DIR` 環境變數挑資料夾：

```sh
# backend/Dockerfile CMD
npx node-pg-migrate -m migrations/${MIGRATIONS_DIR:-dev} up && node server.js
```

| Compose 檔 | `MIGRATIONS_DIR` | 實際跑的 migration |
|------------|-----------------|-------------------|
| `docker-compose-dev.yml` | `dev` | `backend/migrations/dev/` |
| `docker-compose-test.yml` | `dev` | `backend/migrations/dev/` |
| `docker-compose-prod.yml` | `prod` | `backend/migrations/prod/` |

### NPM Scripts

本機手動操作時，請用對應環境的 script（不能再用舊的 `migrate:up`）：

```bash
# Dev / Test
npm run migrate:up:dev
npm run migrate:down:dev
npm run migrate:create:dev <name>

# Prod
npm run migrate:up:prod
npm run migrate:down:prod
npm run migrate:create:prod <name>
```

### Prod baseline（`migrations/prod/`）

| 檔案 | 作用 |
|------|------|
| `1744200000000_init-schema.js` | 建立 `pgcrypto` + `uuidv7()` + `update_updated_at()` + 三張表（`sso_login_log` / `sso_allowed_list` / `sso_admin_manager`），timestamp 一律 `TIMESTAMPTZ + NOW()`，`sso_allowed_list` 內建 `app_id` / `app_secret` / `redirect_uris` 欄位 |
| `1744200100000_seed-default-admin.js` | 灌入預設管理員 `jiaye.he@df-recycle.com`（azure_oid `c5e1e537-…`）以便首次登入後台 |
| `1744200200000_seed-allowed-list.js` | 灌入 SSO Management 自身白名單（`https://df-sso-management.apps.zerozero.tw`）；其他 Client App 由 Dashboard 新增 |

### 寫新 Migration 原則

1. **Schema 變更** — Dev 與 Prod **兩邊都要加**；Dev 加到尾端，Prod 也加到尾端。未來兩邊的「init-schema」會逐漸分歧是可以接受的（Dev 留歷史、Prod 每隔一段時間可以 squash）
2. **Seed 變更** — 視目標環境只改對應資料夾
3. **down 絕不刪除 management domain 白名單資料** — 避免回滾毀掉管理後台自身的登入能力
4. **Seed 必須 idempotent** — 一律 `ON CONFLICT DO NOTHING`
