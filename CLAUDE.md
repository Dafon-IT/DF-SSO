# DF-SSO — AI Agent 指引

大豐環保企業統一 SSO 系統。Client App 透過 OAuth2 Client Credentials（`app_id` + `app_secret`）接入中央，共用 Microsoft Azure AD 帳號。

> **線上環境：**
>
> | 環境 | Frontend | Backend | Compose | Migrations |
> |------|----------|---------|---------|------------|
> | **Prod** | `https://df-it-sso-management.it.zerozero.tw` | `https://df-it-sso-login.it.zerozero.tw` | `docker-compose-prod.yml` | `backend/migrations/prod/` |
> | **Test** | `https://df-sso-management-test.apps.zerozero.tw` | `https://df-sso-login-test.apps.zerozero.tw` | `docker-compose-test.yml` | `backend/migrations/dev/` |
> | **Dev**  | `http://localhost:3000` | `http://localhost:3001` | `docker-compose-dev.yml` | `backend/migrations/dev/` |
>
> Prod 與 Test 為兩套獨立 Coolify stack，Postgres / Redis volume 完全隔離（`sso-prod-*` vs `sso-test-*`）。

完整架構、流程、API、環境變數、限制清單請讀 [docs/Design.md](docs/Design.md)。Client App 整合步驟請讀 [INTEGRATION.md](INTEGRATION.md)。

---

## 專案結構（monorepo）

```
backend/         Express SSO Authorization Server（OAuth2 + Admin API）
frontend/        Next.js 管理後台（單頁 Tab Dashboard）
microsoft-ad-login/  Claude skill：協助 Client App 接入 SSO
docs/Design.md   系統設計
INTEGRATION.md   Client App 整合步驟
docker-compose-dev.yml      # 本機開發樣板
docker-compose-test.yml     # ★ Coolify Test 實際部署
docker-compose-prod.yml     # ★ Coolify Prod 實際部署
```

### Backend ([backend/](backend/))

- [server.js](backend/server.js) — Helmet / CORS 動態白名單 / rate limit / session / route 掛載 / graceful shutdown
- [config/index.js](backend/config/index.js) — **所有 `process.env` 讀取都集中在此**；其他模組一律 `require('../config')`。啟動會驗證必要變數
- [middleware/adminAuth.js](backend/middleware/adminAuth.js) — JWT + Redis Session + 管理員白名單三層驗證，保護 `/api/allowed-list`、`/api/login-log`、`/api/admin-manager`
- [routes/](backend/routes/) — `auth.js`（Microsoft OAuth + `/me` + `/logout`）、`sso.js`（`/authorize` + `/exchange` + `/logout`）、`allowedList.js`、`loginLog.js`、`adminManager.js`、`ssoSetting.js`
- [services/](backend/services/) — DB 查詢邏輯（`allowedList`、`loginLog`、`adminManager`、`erpApi`、`ssoSetting`） + `rateLimitManager.js`（動態 rate limit）
- [migrations/dev/](backend/migrations/dev/) — Test / Dev 環境用的完整歷史（10 筆 schema / seed / fix）
- [migrations/prod/](backend/migrations/prod/) — Prod 環境用的乾淨 baseline（3 筆：init-schema + admin seed + allowed_list seed）
- 由 [backend/Dockerfile](backend/Dockerfile) 的 `MIGRATIONS_DIR` 環境變數選目錄（`dev` / `prod`）

### Frontend ([frontend/src/app/](frontend/src/app/))

- [page.tsx](frontend/src/app/page.tsx) — 登入入口
- [dashboard/page.tsx](frontend/src/app/dashboard/page.tsx) — 單檔 ~960 行的 Tab 式後台（`allowed` / `logs` / `admins`）
- 前端只讀 `NEXT_PUBLIC_API_URL`；所有呼叫走 `credentials: "include"` cookie-based

---

## 重要慣例

### 不要直接讀 `process.env`
一律透過 [backend/config/index.js](backend/config/index.js)。新增環境變數請同時：
1. 加到 `config` 物件
2. 如為必填加到 `required` 陣列
3. 更新 [docs/Design.md](docs/Design.md) 的「環境變數」表

### 白名單是單一事實來源
`sso_allowed_list` 同時驅動五件事：OAuth2 授權、Code exchange、CORS origins（快取 60 秒）、Back-channel logout、Logout redirect 驗證。修改這張表的欄位請確認五處都考慮到。

### `redirect_uris` 存 origin、不存 path
驗證時比對 `new URL(redirect_uri).origin`。Logout redirect 驗證通過後也只保留 origin（剝除攻擊者可能注入的 path/query/fragment）。每個 App 上限 10 筆，只允許 `http:` / `https:`。

### `authPathSegment` 自動推導
從 `AZURE_REDIRECT_URI` 解析 `/api/auth/{segment}/redirect` 的 segment，改 Microsoft callback URL 不需同步改程式。

### 安全原語
- `client_secret`、OAuth `state` 比對一律用 `crypto.timingSafeEqual`（先檢查長度再比對）
- Auth code 使用 Redis Lua script `GET+DEL` 原子操作，防 race condition 重複使用
- Back-channel logout payload 含 `HMAC-SHA256(app_secret, user_id:timestamp)`，Client 必須驗證簽章 + 30 秒 timestamp 防 replay
- 登入成功一律 `req.session.regenerate()` 防 session fixation

### Migration 原則
- **雙目錄**：`migrations/dev/`（歷史完整）與 `migrations/prod/`（乾淨 baseline），由 `MIGRATIONS_DIR` 環境變數切換
- 檔名格式 `{timestamp}_{description}.js`，使用 `node-pg-migrate`
- **`down` 絕不刪除 management domain 的白名單資料**（參照 memory：避免毀掉管理後台自身的 access）
- **不要手動在 Prod 執行 `migrate:down:prod`**（baseline `down` 會 drop 所有三張表，資料全毀）
- Seed 相關 migration 要 idempotent（一律 `ON CONFLICT DO NOTHING`）
- Schema 變更須 **dev 與 prod 兩邊都加**

### Admin 後台 API 的 adminAuth
任何新增的後台 CRUD route 一律掛 `adminAuth`。不要改成只驗 JWT — 必須三層：JWT 簽名 → Redis session 存在 → email 在 `sso_admin_manager` 且 `is_active = TRUE`。

### DELETE 管理員禁止刪除自己
[routes/adminManager.js](backend/routes/adminManager.js) 已實作，新增類似端點時請保留這類防呆。

---

## 常用指令

```bash
# Backend
cd backend
npm run dev                  # nodemon
npm run migrate:up:dev       # 套用 dev/ 所有 migration（本機 / Test）
npm run migrate:up:prod      # 套用 prod/ 所有 migration（Prod）
npm run migrate:down:dev     # 回退一步（dev）
npm run migrate:create:dev <name>
npm run migrate:create:prod <name>

# Frontend
cd frontend
npm run dev                  # Next.js dev server
npm run build
npm run lint

# Docker
docker compose -f docker-compose-dev.yml up    # 本機
docker compose -f docker-compose-test.yml up   # Test 環境
docker compose -f docker-compose-prod.yml up   # Prod 環境
```

---

## Rate Limit 分層速查

**不再寫死在 server.js**，實際值由 `sso_setting` 表（category = `rate_limit`）動態載入，管理員可在 Dashboard「設定」分頁即時調整。Backend 由 [backend/services/rateLimitManager.js](backend/services/rateLimitManager.js) 用 wrapper middleware 指向可變 instance，`PUT /api/sso-setting/rate_limit.*` 成功後會 `reload()` 重建四個 limiter（視窗計數會歸零）。若 DB 不可用則 fallback 到下表預設值。

| 範圍 | 預設值 | sso_setting key | 說明 |
|------|--------|------------------|------|
| 全域 | 500 / 15min | `rate_limit.global` | 防 DoS |
| Auth（login / redirect / authorize） | 30 / 15min | `rate_limit.auth` | 防暴力登入 |
| Session（`/me`、POST `/logout`） | 100 / 15min | `rate_limit.session` | Client App 高頻 server-to-server |
| Exchange | 20 / 1min | `rate_limit.exchange` | 防 auth code 猜測 |

要改 `skip` / `message` 等 limiter option 邏輯請改 [services/rateLimitManager.js](backend/services/rateLimitManager.js)，不要改 `server.js`。

新增 route 如果是 Client App 高頻呼叫，記得在 [server.js](backend/server.js) 用 `sessionLimiter` 覆蓋預設的 `authLimiter`。

---

## Frontend 注意

[frontend/CLAUDE.md](frontend/CLAUDE.md) → [frontend/AGENTS.md](frontend/AGENTS.md)：**這不是你訓練資料裡的 Next.js**，寫任何前端程式前請先查 `node_modules/next/dist/docs/` 對應指南。
