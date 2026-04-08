---
name: microsoft-ad-login
description: 實作 Microsoft Azure AD 單一登入 (SSO) 功能。Use when 使用者需要在 Node.js/Express 專案中新增 Microsoft 帳號登入按鈕、實作 OAuth Authorization Code Flow、整合 MSAL (Microsoft Authentication Library) 套件、設定 Azure AD 認證、處理 OAuth callback、或將 Azure AD 使用者對應到系統內部使用者。
---

# Microsoft AD 登入功能

為 Node.js/Express 專案新增「使用 Microsoft 帳號登入」按鈕，實現 Azure AD 單一登入 (SSO) 功能。

## 快速開始

### 1. 安裝套件

```bash
npm install @azure/msal-node
```

### 2. 設定環境變數

參考 `.env.example` 設定以下環境變數：
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TENANT_ID`
- `AZURE_REDIRECT_URI`

### 3. 實作步驟

1. **後端 API** - 建立兩個端點（參考 `commands/backend-setup.md`）
   - `GET /api/auth/microsoft/login` - 重導向到 Microsoft 登入
   - `GET /api/auth/microsoft/redirect` - 處理 OAuth callback

2. **前端整合** - 新增登入按鈕（參考 `commands/frontend-setup.md`）

3. **環境設定** - 設定 Azure AD 應用程式（參考 `commands/env-config.md`）

## 安全性檢查清單

- [ ] 實作 state 參數防止 CSRF 攻擊
- [ ] 驗證 id_token 的簽章（使用 Microsoft 公鑰）
- [ ] 將 Azure AD 使用者對應到系統內部使用者
- [ ] 妥善處理錯誤情況並記錄日誌
- [ ] 確保 Client Secret 不外洩

## 相關文件

| 文件 | 說明 |
|------|------|
| `commands/backend-setup.md` | 後端 API 實作指引 |
| `commands/frontend-setup.md` | 前端按鈕整合 |
| `commands/env-config.md` | 環境變數設定 |
| `references/oauth-flow.md` | OAuth 流程說明 |
| `references/security-requirements.md` | 安全性要求 |
| `references/msal-config.md` | MSAL 設定參考 |
| `examples/workflow-demo.md` | 完整整合範例 |
