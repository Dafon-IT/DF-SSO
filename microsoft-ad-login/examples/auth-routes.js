/**
 * Microsoft AD 登入路由範例
 * 
 * 此檔案展示如何在 Express 應用程式中實作 Microsoft AD 登入。
 * 請根據專案架構調整並整合到現有的認證路由中。
 */

const express = require('express');
const msal = require('@azure/msal-node');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const router = express.Router();

// ============================================
// MSAL 設定
// ============================================

const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  },
  system: {
    loggerOptions: {
      loggerCallback(loglevel, message, containsPii) {
        if (!containsPii) {
          console.log(`[MSAL] ${message}`);
        }
      },
      piiLoggingEnabled: false,
      logLevel: msal.LogLevel.Warning,
    }
  }
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

// ============================================
// 輔助函數
// ============================================

/**
 * 產生隨機 state 參數
 */
function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 根據 Azure AD claims 查詢或建立系統使用者
 * 請根據專案的使用者模型調整此函數
 */
async function findOrCreateUser(claims) {
  const { oid, email, name, preferred_username } = claims;
  
  // TODO: 根據專案的使用者模型實作
  // 範例：使用 Mongoose
  /*
  const User = require('../models/User');
  
  // 優先用 oid 查詢
  let user = await User.findOne({ azureOid: oid });
  
  if (!user) {
    // 嘗試用 email 查詢現有使用者
    user = await User.findOne({ email: email || preferred_username });
    
    if (user) {
      // 綁定 Azure AD
      user.azureOid = oid;
      user.authProvider = 'microsoft';
      await user.save();
    } else {
      // 建立新使用者
      user = await User.create({
        azureOid: oid,
        email: email || preferred_username,
        name: name,
        authProvider: 'microsoft'
      });
    }
  }
  
  return user;
  */
  
  // 暫時回傳模擬使用者（請替換為實際實作）
  return {
    id: oid,
    email: email || preferred_username,
    name: name,
  };
}

/**
 * 產生系統 JWT token
 * 請根據專案的 JWT 設定調整
 */
function generateSystemToken(user) {
  // TODO: 根據專案的 JWT 設定調整
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      name: user.name,
    },
    process.env.JWT_SECRET || 'your-jwt-secret',
    { expiresIn: '24h' }
  );
}

// ============================================
// 路由
// ============================================

/**
 * GET /api/auth/microsoft/login
 * 重導向使用者到 Microsoft 登入頁面
 */
router.get('/microsoft/login', async (req, res) => {
  try {
    // 產生 state 防止 CSRF
    const state = generateState();
    req.session.oauthState = state;
    
    // 建構授權 URL
    const authCodeUrlParameters = {
      scopes: ['openid', 'profile', 'email', 'User.Read'],
      redirectUri: process.env.AZURE_REDIRECT_URI,
      state: state,
    };
    
    const authUrl = await cca.getAuthCodeUrl(authCodeUrlParameters);
    
    // 重導向到 Microsoft 登入頁
    res.redirect(authUrl);
    
  } catch (error) {
    console.error('Microsoft Login Error:', error.message);
    res.redirect('/login?error=microsoft_login_failed');
  }
});

/**
 * GET /api/auth/microsoft/redirect
 * 處理 Microsoft OAuth 回調
 */
router.get('/microsoft/redirect', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  
  // 處理 Microsoft 回傳的錯誤
  if (error) {
    console.error('Microsoft OAuth Error:', error, error_description);
    return res.redirect(`/login?error=${error}`);
  }
  
  // 驗證 state 參數
  if (!state || state !== req.session.oauthState) {
    console.error('Invalid state parameter');
    return res.status(403).redirect('/login?error=invalid_state');
  }
  
  // 清除已使用的 state
  delete req.session.oauthState;
  
  try {
    // 用 authorization code 換取 tokens
    const tokenRequest = {
      code: code,
      scopes: ['openid', 'profile', 'email', 'User.Read'],
      redirectUri: process.env.AZURE_REDIRECT_URI,
    };
    
    const tokenResponse = await cca.acquireTokenByCode(tokenRequest);
    
    // 從 id_token claims 取得使用者資訊
    const claims = tokenResponse.idTokenClaims;
    
    console.log('Microsoft Login Success:', {
      oid: claims.oid,
      email: claims.email || claims.preferred_username,
      name: claims.name,
    });
    
    // 查詢或建立系統使用者
    const user = await findOrCreateUser(claims);
    
    // 產生系統 JWT token
    const systemToken = generateSystemToken(user);
    
    // 設定 cookie（根據專案需求調整）
    res.cookie('token', systemToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 小時
    });
    
    // 重導向到首頁
    res.redirect(process.env.ROPC_REDIRECT_URL || '/');
    
  } catch (error) {
    console.error('Microsoft Token Exchange Error:', {
      message: error.message,
      code: error.code,
    });
    res.redirect('/login?error=token_exchange_failed');
  }
});

module.exports = router;
