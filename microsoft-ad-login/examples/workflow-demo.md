# 完整整合工作流程

此文件展示如何在 Node.js/Express 專案中完整整合 Microsoft AD 登入功能。

## 前置條件

1. Node.js/Express 專案已建立
2. 已有使用者認證機制（JWT）
3. 已在 Azure Portal 完成應用程式註冊

## 步驟 1：安裝相依套件

```bash
npm install @azure/msal-node
```

## 步驟 2：設定環境變數

在 `.env` 檔案中加入：

```env
AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_SECRET=your-client-secret
AZURE_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_REDIRECT_URI=https://your-domain.com/api/auth/microsoft/redirect
ROPC_REDIRECT_URL=/
```

## 步驟 3：建立認證路由

參考 `examples/auth-routes.js`，將 Microsoft 登入端點加入現有的 `routes/auth.js`：

```javascript
// routes/auth.js
const express = require('express');
const msal = require('@azure/msal-node');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const router = express.Router();

// MSAL 設定
const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  }
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

// ... 現有的登入路由 ...

// Microsoft 登入
router.get('/microsoft/login', async (req, res) => {
  const state = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;
  
  const authUrl = await cca.getAuthCodeUrl({
    scopes: ['openid', 'profile', 'email'],
    redirectUri: process.env.AZURE_REDIRECT_URI,
    state: state,
  });
  
  res.redirect(authUrl);
});

// Microsoft 回調
router.get('/microsoft/redirect', async (req, res) => {
  // 完整實作參考 examples/auth-routes.js
});

module.exports = router;
```

## 步驟 4：修改使用者模型（選用）

如果需要記錄使用者的 Azure AD 資訊：

```javascript
// models/User.js
const userSchema = new mongoose.Schema({
  // 現有欄位...
  email: { type: String, required: true, unique: true },
  name: String,
  
  // 新增 Azure AD 欄位
  azureOid: { type: String, index: true },
  authProvider: { type: String, enum: ['local', 'microsoft'], default: 'local' },
});
```

## 步驟 5：新增前端按鈕

在登入頁面 HTML 中加入：

```html
<!-- 在登入表單後方 -->
<div class="divider"><span>或</span></div>

<a href="/api/auth/microsoft/login" class="microsoft-login-btn">
  <svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 21 21">
    <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
    <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
    <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
  </svg>
  使用 Microsoft 帳號登入
</a>
```

加入樣式（參考 `examples/microsoft-button.css`）。

## 步驟 6：測試流程

1. 啟動開發伺服器
2. 開啟瀏覽器進入登入頁面
3. 點擊「使用 Microsoft 帳號登入」
4. 應重導向到 Microsoft 登入頁面
5. 使用 Azure AD 帳號登入
6. 應自動重導向回應用程式首頁
7. 確認已登入成功

## 常見問題排除

### 問題：重導向 URI 不符

**錯誤訊息**：`AADSTS50011: The reply URL specified in the request does not match...`

**解決方式**：
1. 確認 Azure Portal 中的 Redirect URI 設定
2. 確認 `.env` 中的 `AZURE_REDIRECT_URI` 完全一致
3. 注意 http vs https、結尾斜線

### 問題：Client Secret 無效

**錯誤訊息**：`AADSTS7000215: Invalid client secret provided...`

**解決方式**：
1. 檢查 Client Secret 是否已過期
2. 重新建立 Client Secret
3. 確認 `.env` 中的值正確（無多餘空格）

### 問題：State 驗證失敗

**可能原因**：
1. Session 設定問題
2. 使用者重複點擊登入按鈕
3. Redirect URI 被中間人攻擊

**解決方式**：
1. 確認 session middleware 已正確設定
2. 在前端禁用重複點擊
3. 記錄並監控此類錯誤

## 安全性檢查清單

在上線前確認：

- [ ] State 參數已正確實作
- [ ] Client Secret 未暴露在前端或版本控制
- [ ] 正式環境使用 HTTPS
- [ ] 錯誤處理完善
- [ ] 日誌記錄正確（不含敏感資訊）
- [ ] 使用者對應邏輯正確
