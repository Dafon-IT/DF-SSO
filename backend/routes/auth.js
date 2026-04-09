const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const redis = require('../config/redis');
const { cca } = require('../config/msal');
const loginLogService = require('../services/loginLog');
const erpApi = require('../services/erpApi');
const allowedListService = require('../services/allowedList');

const router = express.Router();

const SCOPES = ['openid', 'profile', 'email', 'User.Read'];
const SESSION_PREFIX = 'sso:session:';
const SESSION_TTL = 24 * 60 * 60; // 24 小時（秒）

/**
 * 產生系統 JWT token
 */
function generateSystemToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      name: user.name,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

/**
 * GET /api/auth/{authPathSegment}/login
 * 重導向使用者到 Microsoft 登入頁面
 */
router.get(`/${config.azure.authPathSegment}/login`, async (req, res) => {
  try {
    const state = crypto.randomBytes(32).toString('hex');
    req.session.oauthState = state;

    const authUrl = await cca.getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: config.azure.redirectUri,
      state: state,
    });

    res.redirect(authUrl);
  } catch (error) {
    console.error('Microsoft Login Error:', error.message);
    res.redirect(`${config.frontendUrl}?error=microsoft_login_failed`);
  }
});

/**
 * GET /api/auth/{authPathSegment}/redirect
 * 處理 Microsoft OAuth 回調
 */
router.get(`/${config.azure.authPathSegment}/redirect`, async (req, res) => {
  const { code, state, error: oauthError, error_description } = req.query;
  const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];

  if (oauthError) {
    console.error('Microsoft OAuth Error:', oauthError, error_description);
    return res.redirect(`${config.frontendUrl}?error=${oauthError}`);
  }

  if (!state || state !== req.session.oauthState) {
    console.error('Invalid state parameter');
    return res.redirect(`${config.frontendUrl}?error=invalid_state`);
  }

  delete req.session.oauthState;

  let claims = null;

  try {
    // Step 3: 用 code 換取 tokens
    const tokenResponse = await cca.acquireTokenByCode({
      code: code,
      scopes: SCOPES,
      redirectUri: config.azure.redirectUri,
    });

    claims = tokenResponse.idTokenClaims;

    console.log('Microsoft Login Success:', {
      oid: claims.oid,
      email: claims.email || claims.preferred_username,
      name: claims.name,
    });
  } catch (error) {
    console.error('Microsoft Token Exchange Error:', error.message);

    // 記錄失敗的登入
    await loginLogService.create({
      azureOid: null,
      email: null,
      name: null,
      preferredUsername: null,
      erpData: null,
      status: 'failed',
      errorMessage: error.message,
      ipAddress,
      userAgent,
    }).catch((e) => console.error('Failed to log login:', e.message));

    return res.redirect(`${config.frontendUrl}?error=token_exchange_failed`);
  }

  const email = claims.email || claims.preferred_username;

  // 白名單驗證：FRONTEND_URL 必須在 sso_allowed_list 中
  try {
    const isAllowed = await allowedListService.isDomainAllowed(config.frontendUrl);
    if (!isAllowed) {
      console.error('Domain not in allowed list:', config.frontendUrl);

      await loginLogService.create({
        azureOid: claims.oid,
        email: email,
        name: claims.name,
        preferredUsername: claims.preferred_username,
        erpData: null,
        status: 'failed',
        errorMessage: `Domain not allowed: ${config.frontendUrl}`,
        ipAddress,
        userAgent,
      }).catch((e) => console.error('Failed to log login:', e.message));

      return res.redirect(`${config.frontendUrl}?error=domain_not_allowed`);
    }
  } catch (error) {
    console.error('Allowed list check error:', error.message);
    return res.redirect(`${config.frontendUrl}?error=internal_error`);
  }

  // Step 4 & 5: 查詢 ERP 員工資料
  let erpData = null;

  try {
    erpData = await erpApi.searchByEmail(email);
  } catch (error) {
    console.error('ERP API Error:', error.message);
  }

  // Step 6: 寫入 sso_login_log
  const status = erpData ? 'success' : 'erp_not_found';
  let logRecord = null;

  try {
    logRecord = await loginLogService.create({
      azureOid: claims.oid,
      email: email,
      name: claims.name,
      preferredUsername: claims.preferred_username,
      erpData: erpData,
      status: status,
      errorMessage: erpData ? null : 'ERP employee not found for this email',
      ipAddress,
      userAgent,
    });
  } catch (error) {
    console.error('Failed to log login:', error.message);
  }

  // Step 7: 發放 JWT + 寫入 Redis Session
  const user = {
    id: claims.oid,
    email: email,
    name: claims.name,
  };

  const systemToken = generateSystemToken(user);

  // 寫入 Redis Session
  const sessionData = {
    userId: claims.oid,
    email: email,
    name: claims.name,
    erpData: erpData,
    loginLogUid: logRecord?.uid || null,
    loginAt: new Date().toISOString(),
  };

  try {
    await redis.set(
      `${SESSION_PREFIX}${claims.oid}`,
      JSON.stringify(sessionData),
      'EX',
      SESSION_TTL
    );
  } catch (error) {
    console.error('Redis session write error:', error.message);
  }

  res.cookie('token', systemToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL * 1000,
  });

  res.redirect(config.loginRedirectUrl);
});

/**
 * GET /api/auth/me
 * 取得目前登入使用者資訊（驗證 JWT + Redis Session）
 */
router.get('/me', async (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);

    // 驗證 Redis Session
    const sessionStr = await redis.get(`${SESSION_PREFIX}${decoded.userId}`);
    if (!sessionStr) {
      res.clearCookie('token');
      return res.status(401).json({ error: 'Session expired' });
    }

    const session = JSON.parse(sessionStr);
    res.json({ user: session });
  } catch (error) {
    res.clearCookie('token');
    res.status(401).json({ error: 'Invalid token' });
  }
});

/**
 * POST /api/auth/logout
 * 登出：清除 Redis Session + Cookie
 */
router.post('/logout', async (req, res) => {
  const token = req.cookies.token;

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      await redis.del(`${SESSION_PREFIX}${decoded.userId}`);
    } catch (error) {
      // token 無效也繼續清除 cookie
    }
  }

  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

module.exports = router;
