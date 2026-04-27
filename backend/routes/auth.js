import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import redis from '../config/redis.js';
import { cca } from '../config/msal.js';
import loginLogService from '../services/loginLog.js';
import erpApi from '../services/erpApi.js';
import allowedListService from '../services/allowedList.js';
import adminManager from '../services/adminManager.js';

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
    return res.redirect(`${config.frontendUrl}?error=authentication_failed`);
  }

  if (
    !state || !req.session.oauthState ||
    state.length !== req.session.oauthState.length ||
    !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(req.session.oauthState))
  ) {
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

  const email = (claims.email || claims.preferred_username || '').toLowerCase().trim();

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
        errorMessage: 'Domain not in allowed list',
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
    // 新進管理員首次登入：自動填入 azure_oid、name
    await adminManager.activateIfNewer(claims.oid, email, claims.name);
  }

  // Session fixation 防護：登入成功後重新產生 session ID
  await new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });

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
 * 登出：清除中央 Redis Session + Cookie + Back-channel 通知所有 Client App。
 *
 * 設計原則（兩層 Session 模型）：
 *   只清「中央 + App 兩層」，不動 AD（Microsoft）那層 — 避免使用者每次登入
 *   都被迫重打密碼 / MFA。
 *   「登出真的有效」由 Client App 端契約保障（登入頁不可自動 redirect 到 /authorize）。
 *
 * 支援兩種 token 來源：
 *   1. Cookie: token（SSO Frontend 使用）
 *   2. Authorization: Bearer <token>（Client App server-to-server 使用）
 *
 * Body / Query: { redirect?: string }
 *   登出後最終落地的 URL（origin 必須在 sso_allowed_list）。
 *   未提供時 fallback 到 SSO frontend。
 *
 * Response: { message: string, redirect: string }
 *   redirect 為驗證後的最終 URL，呼叫方應 302 過去（path/query 保留以攜帶 ?logged_out=1 之類旗標）。
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

  // Back-channel Logout：通知所有已註冊的 client app（帶 HMAC 簽章防偽造）
  if (userId) {
    try {
      const apps = await allowedListService.getAllAppsForBackChannel();
      const timestamp = Date.now();
      const backChannelPromises = apps
        .filter(({ origin }) => origin !== config.frontendUrl)
        .map(({ origin, appSecret }) => {
          const signature = crypto
            .createHmac('sha256', appSecret)
            .update(`${userId}:${timestamp}`)
            .digest('hex');
          return fetch(`${origin}/api/auth/back-channel-logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, timestamp, signature }),
            signal: AbortSignal.timeout(5000),
          }).catch((err) => {
            console.warn(`Back-channel logout to ${origin} failed:`, err.message);
          });
        });
      await Promise.allSettled(backChannelPromises);
    } catch (err) {
      console.error('Back-channel logout error:', err.message);
    }
  }

  res.clearCookie('token', { ...(config.cookieDomain && { domain: config.cookieDomain }), path: '/' });

  // 驗證 redirect（origin 必須在白名單）；保留 path/query 給 Client App 攜帶 ?logged_out=1 旗標
  const requestedRedirect =
    (req.body && typeof req.body.redirect === 'string' && req.body.redirect) ||
    (typeof req.query.redirect === 'string' && req.query.redirect) ||
    '';

  let finalRedirect = config.frontendUrl;
  if (requestedRedirect) {
    try {
      const parsed = new URL(requestedRedirect);
      if (['http:', 'https:'].includes(parsed.protocol)) {
        const origins = await allowedListService.getAllOrigins();
        if (origins.includes(parsed.origin) || parsed.origin === config.frontendUrl) {
          finalRedirect = requestedRedirect;
        } else {
          console.warn(`Blocked logout redirect to unauthorized origin: ${parsed.origin}`);
        }
      }
    } catch {
      console.warn('Invalid redirect URL in logout request');
    }
  }

  res.json({ message: 'Logged out', redirect: finalRedirect });
});

export default router;
