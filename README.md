# DF-SSO

大豐環保 SSO 單一登入系統。Client App 透過 OAuth2 Client Credentials（`app_id` + `app_secret`）接入中央，共用 Microsoft Azure AD 帳號。

## 線上環境

| 環境 | Frontend（管理後台） | Backend（OAuth2 Server） |
|------|---------------------|--------------------------|
| **Prod** | https://df-sso-management.apps.zerozero.tw | https://df-sso-login.apps.zerozero.tw |
| **Test** | https://df-sso-management-test.apps.zerozero.tw | https://df-sso-login-test.apps.zerozero.tw |
| **Dev**  | http://localhost:3000 | http://localhost:3001 |

## 系統架構

```
Client App              SSO 中央                       Microsoft Azure AD
──────────              ────────                       ──────────────────
/api/auth/me     ─JWT──> 驗證 Redis session
/api/auth/callback ─code─> /sso/exchange + credentials
/api/auth/logout ─token─> 刪 Redis session + back-channel
                          /sso/authorize ─OAuth─────>  Microsoft
```

## 核心原則

- 每個 Client App 由 SSO 中央發放 `app_id` + `app_secret`
- **每個 SSO 環境（Prod / Test / Dev）獨立**：各自有 DB、各自發 credentials，不共用
- 一個 App 最多 10 個 `redirect_uris`（同一組 credentials 可對應多個 origin）
- **中央 Redis session 是登入狀態的唯一事實來源** — JWT 簽名有效 ≠ 使用者仍在登入狀態
- SaaS 路由 convention：`/` 登入頁、`/dashboard` 登入後首頁

## 流程速覽

| 情境 | 流程 |
|------|------|
| **登入** | Client `/me` 回 401 → SSO authorize → Microsoft → 建 Redis session → 發 code → Client `/sso/exchange` 換 JWT |
| **跨 App 免登入** | 訪問新 App → authorize → 中央 session 已存在 → 靜默發 code → 直接換 token（不跳 Microsoft） |
| **登出** | Client POST 中央 `/logout` → 刪 Redis session → back-channel 廣播 → Client 清本地 cookie |
| **Session 過期** | `/me` 回 401 → 清本地 cookie → 回首頁若中央 cookie 仍存在則靜默重登 |

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

> Rate limit 為動態值，管理員可在 Dashboard「設定」分頁調整。

## 部署

Coolify 上 Prod / Test 為兩套獨立 stack，Postgres / Redis volume 完全隔離（`sso-prod-*` vs `sso-test-*`）。

| 環境 | Compose | Migration 目錄 | `NODE_ENV` |
|------|---------|---------------|-----------|
| **Prod** | [docker-compose-prod.yml](docker-compose-prod.yml) | `backend/migrations/prod/` | `production` |
| **Test** | [docker-compose-test.yml](docker-compose-test.yml) | `backend/migrations/dev/` | `test` |
| **Dev**  | [docker-compose-dev.yml](docker-compose-dev.yml) | `backend/migrations/dev/` | `development` |

完整環境變數、架構細節與限制請讀 [docs/Design.md](docs/Design.md)。Client App 接入請讀 [INTEGRATION.md](INTEGRATION.md)。

## 專案結構

```
backend/                Express SSO Authorization Server（OAuth2 + Admin API）
frontend/               Next.js 管理後台（Tab Dashboard）
microsoft-ad-login/     Claude skill：協助 Client App 接入
docs/Design.md          系統設計與限制
INTEGRATION.md          Client App 整合指引
docker-compose-*.yml    prod / test / dev 部署
```

## 技術棧

Node.js + Express / Next.js 15 / PostgreSQL 16 / Redis 7 / MSAL（Azure AD）/ JWT HS256 24h / Coolify + Docker Compose
