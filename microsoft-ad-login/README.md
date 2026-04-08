# Microsoft AD Login Skill

此 Skill 提供 Node.js/Express 專案整合 Microsoft Azure AD 單一登入 (SSO) 的完整指導。

## 功能特色

- OAuth 2.0 Authorization Code Flow 實作
- MSAL (Microsoft Authentication Library) 整合
- 前端 Microsoft 登入按鈕樣式
- 安全性最佳實踐（CSRF 防護、Token 驗證）

## 資料夾結構

```
microsoft-ad-login/
├── SKILL.md              # Skill 主文件
├── README.md             # 本說明文件
├── .env.example          # 環境變數範例
├── .gitignore            # Git 忽略規則
├── commands/             # 操作指令說明
│   ├── backend-setup.md  # 後端 API 實作
│   ├── frontend-setup.md # 前端整合
│   └── env-config.md     # 環境變數設定
├── references/           # 參考文件
│   ├── oauth-flow.md     # OAuth 流程說明
│   ├── security-requirements.md  # 安全性要求
│   └── msal-config.md    # MSAL 設定參考
└── examples/             # 程式碼範例
    ├── workflow-demo.md  # 完整工作流程
    ├── auth-routes.js    # 後端路由範例
    ├── login-button.html # 前端按鈕範例
    └── microsoft-button.css  # 按鈕樣式
```

## 使用方式

1. 閱讀 `SKILL.md` 了解整體實作步驟
2. 依照 `commands/` 中的指令逐步實作
3. 參考 `examples/` 中的程式碼範例
4. 查閱 `references/` 了解詳細技術說明

## 前置需求

- Node.js 專案（Express 或類似框架）
- Azure AD 應用程式註冊
- 現有的使用者認證機制（JWT）

## 授權

MIT License
