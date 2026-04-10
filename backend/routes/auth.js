const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const redis = require('../config/redis');
const { cca } = require('../config/msal');
const loginLogService = require('../services/loginLog');
const erpApi = require('../services/erpApi');
const allowedListService = require('../services/allowedList');
const adminManager = require('../services/adminManager');

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
    { algorithm: 'HS256', expiresIn: config.jwtExpiresIn }
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
    return res.redirect(`${config.frontendUrl}?error=${encodeURIComponent(oauthError)}`);
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

  // 檢查是否有 SSO 重導目標（來自客戶端 App 的 authorize 流程）
  const ssoRedirect = req.session.ssoRedirect;

  // 若非 SSO 流程（直接登入管理後台），檢查管理員權限
  if (!ssoRedirect) {
    const isAdmin = await adminManager.isAdminByOidOrEmail(claims.oid, email);
    if (!isAdmin) {
      return res.redirect(`${config.frontendUrl}?error=not_admin`);
    }
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
    ...(config.cookieDomain && { domain: config.cookieDomain }),
  });

  if (ssoRedirect) {
    delete req.session.ssoRedirect;

    // 產生一次性 auth code，帶 code 重導回 client app
    const authCode = crypto.randomBytes(32).toString('hex');
    const AUTH_CODE_PREFIX = 'sso:code:';
    await redis.set(
      `${AUTH_CODE_PREFIX}${authCode}`,
      JSON.stringify({
        userId: sessionData.userId,
        email: sessionData.email,
        name: sessionData.name,
        erpData: sessionData.erpData,
      }),
      'EX',
      60 // 60 秒過期
    );

    const redirectUrl = new URL(ssoRedirect);
    redirectUrl.searchParams.set('code', authCode);
    return res.redirect(redirectUrl.toString());
  }

  res.redirect(config.loginRedirectUrl);
});

/**
 * GET /api/auth/me
 * 取得目前登入使用者資訊（驗證 JWT + Redis Session）
 * 支援兩種方式：
 *   1. Cookie: token（SSO Frontend 使用）
 *   2. Authorization: Bearer <token>（Client App server-to-server 使用）
 */
router.get('/me', async (req, res) => {
  // 從 cookie 或 Authorization header 取得 token
  let token = req.cookies.token;
  if (!token) {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      token = auth.slice(7);
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });

    // 驗證 Redis Session
    const sessionStr = await redis.get(`${SESSION_PREFIX}${decoded.userId}`);
    if (!sessionStr) {
      res.clearCookie('token', { ...(config.cookieDomain && { domain: config.cookieDomain }), path: '/' });
      return res.status(401).json({ error: 'Session expired' });
    }

    let session;
    try {
      session = JSON.parse(sessionStr);
    } catch {
      res.clearCookie('token', { ...(config.cookieDomain && { domain: config.cookieDomain }), path: '/' });
      return res.status(401).json({ error: 'Invalid session' });
    }
    res.json({ user: session });
  } catch (error) {
    res.clearCookie('token', { ...(config.cookieDomain && { domain: config.cookieDomain }), path: '/' });
    res.status(401).json({ error: 'Invalid token' });
  }
});

/**
 * POST /api/auth/logout
 * 登出：清除 Redis Session + Cookie + Back-channel 通知其他 Client App
 * 支援兩種方式：
 *   1. Cookie: token（SSO Frontend 使用）
 *   2. Authorization: Bearer <token>（Client App server-to-server 使用）
 */
router.post('/logout', async (req, res) => {
  let token = req.cookies.token;
  if (!token) {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      token = auth.slice(7);
    }
  }

  let userId = null;

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      userId = decoded.userId;
      await redis.del(`${SESSION_PREFIX}${decoded.userId}`);
    } catch {
      // token 無效也繼續清除 cookie
    }
  }

  // Back-channel Logout：通知所有已註冊的 client app
  if (userId) {
    try {
      const origins = await allowedListService.getAllOrigins();
      const backChannelPromises = origins
        .filter((origin) => origin !== config.frontendUrl)
        .map((origin) =>
          fetch(`${origin}/api/auth/back-channel-logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId }),
            signal: AbortSignal.timeout(5000),
          }).catch((err) => {
            console.warn(`Back-channel logout to ${origin} failed:`, err.message);
          })
        );
      await Promise.allSettled(backChannelPromises);
    } catch (err) {
      console.error('Back-channel logout error:', err.message);
    }
  }

  res.clearCookie('token', { ...(config.cookieDomain && { domain: config.cookieDomain }), path: '/' });
  res.json({ message: 'Logged out' });
});

module.exports = router;
