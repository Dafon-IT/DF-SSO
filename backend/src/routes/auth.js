const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { cca, SCOPES } = require('../config/msal');
const User = require('../models/user');

const router = express.Router();

// ============================================
// 輔助函數
// ============================================

function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

function generateSystemToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '24h' },
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
    const state = generateState();
    req.session.oauthState = state;

    const authUrl = await cca.getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: process.env.AZURE_REDIRECT_URI,
      state,
    });

    res.redirect(authUrl);
  } catch (error) {
    console.error('Microsoft Login Error:', error.message);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=microsoft_login_failed`);
  }
});

/**
 * GET /api/auth/microsoft/redirect
 * 處理 Microsoft OAuth 回調
 */
router.get('/microsoft/redirect', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error('Microsoft OAuth Error:', error, error_description);
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=${error}`);
  }

  // 驗證 state 參數
  if (!state || state !== req.session.oauthState) {
    console.error('Invalid state parameter');
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_state`);
  }
  delete req.session.oauthState;

  try {
    const tokenResponse = await cca.acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: process.env.AZURE_REDIRECT_URI,
    });

    const claims = tokenResponse.idTokenClaims;

    console.log('Microsoft Login Success:', {
      oid: claims.oid,
      email: claims.email || claims.preferred_username,
      name: claims.name,
    });

    // 查詢或建立系統使用者
    const user = await User.findOrCreateByMicrosoft(claims);

    // 產生系統 JWT token
    const systemToken = generateSystemToken(user);

    res.cookie('token', systemToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24h
    });

    res.redirect(`${process.env.FRONTEND_URL}/dashboard`);
  } catch (err) {
    console.error('Microsoft Token Exchange Error:', {
      message: err.message,
      code: err.code,
    });
    res.redirect(`${process.env.FRONTEND_URL}/login?error=token_exchange_failed`);
  }
});

/**
 * GET /api/auth/me
 * 取得目前登入的使用者資訊
 */
router.get('/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.json({ user: null });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ user: decoded });
  } catch {
    res.json({ user: null });
  }
});

/**
 * POST /api/auth/logout
 * 登出
 */
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

module.exports = router;
