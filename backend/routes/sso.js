const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const redis = require('../config/redis');
const allowedListService = require('../services/allowedList');

const router = express.Router();

const SESSION_PREFIX = 'sso:session:';
const AUTH_CODE_PREFIX = 'sso:code:';
const AUTH_CODE_TTL = 60; // 一次性授權碼有效期 60 秒

/**
 * GET /api/auth/sso/authorize?client_id=<app_id>&redirect_uri=<url>
 * SSO 授權端點（OAuth2 Authorization Code Flow）：
 * - 用 client_id (app_id) 查詢白名單
 * - 驗證 redirect_uri 的 origin 是否在該 App 的 redirect_uris 中
 * - 已有中央 session → 產生一次性 auth code，帶 code 重導到 redirect_uri
 * - 無 session → 走 Microsoft 登入，登入後重導到 redirect_uri
 */
router.get('/authorize', async (req, res) => {
  const { client_id, redirect_uri } = req.query;

  if (!client_id || !redirect_uri) {
    return res.status(400).json({ error: 'Missing client_id or redirect_uri' });
  }

  // 用 app_id 查白名單
  const app = await allowedListService.findByAppId(client_id);
  if (!app) {
    return res.status(403).json({ error: 'Invalid client_id' });
  }

  // 驗證 redirect_uri 的 origin 是否在已註冊的 redirect_uris 中
  let redirectUrl;
  try {
    redirectUrl = new URL(redirect_uri);
    const uris = app.redirect_uris || [];
    if (!uris.includes(redirectUrl.origin)) {
      return res.status(403).json({
        error: `redirect_uri origin "${redirectUrl.origin}" is not registered for this app`,
      });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid redirect_uri' });
  }

  // 檢查是否已有中央 session
  const token = req.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      const sessionStr = await redis.get(`${SESSION_PREFIX}${decoded.userId}`);
      if (sessionStr) {
        // 已登入，產生一次性 auth code
        const code = crypto.randomBytes(32).toString('hex');
        let sessionData;
        try {
          sessionData = JSON.parse(sessionStr);
        } catch {
          return res.status(401).json({ error: 'Invalid session' });
        }

        await redis.set(
          `${AUTH_CODE_PREFIX}${code}`,
          JSON.stringify({
            userId: sessionData.userId,
            email: sessionData.email,
            name: sessionData.name,
            erpData: sessionData.erpData,
          }),
          'EX',
          AUTH_CODE_TTL
        );

        // 刷新 token cookie（確保帶上最新的 domain 設定）
        res.cookie('token', token, {
          httpOnly: true,
          secure: config.nodeEnv === 'production',
          sameSite: 'lax',
          maxAge: 24 * 60 * 60 * 1000,
          ...(config.cookieDomain && { domain: config.cookieDomain }),
        });

        // 帶 code 重導回 client app
        redirectUrl.searchParams.set('code', code);
        return res.redirect(redirectUrl.toString());
      }
    } catch {
      // token 無效，繼續走登入
    }
  }

  // 未登入，記住要導回的位置，走 Microsoft 登入
  req.session.ssoRedirect = redirect_uri;
  res.redirect(`/api/auth/${config.azure.authPathSegment}/login`);
});

/**
 * POST /api/auth/sso/exchange
 * Auth Code 交換端點（server-to-server，OAuth2 Token Endpoint）：
 * Client App 後端用一次性 auth code + client credentials 換取用戶資料 + JWT token
 * 使用 Lua script 確保原子性（防止 race condition 重複使用）
 */
router.post('/exchange', async (req, res) => {
  const { code, client_id, client_secret } = req.body;

  if (!code || typeof code !== 'string' || code.length !== 64) {
    return res.status(400).json({ error: 'Invalid code format' });
  }

  // 驗證 client credentials
  if (!client_id || !client_secret) {
    return res.status(400).json({ error: 'Missing client_id or client_secret' });
  }

  const app = await allowedListService.findByAppId(client_id);
  if (!app || app.app_secret !== client_secret) {
    return res.status(401).json({ error: 'Invalid client credentials' });
  }

  const key = `${AUTH_CODE_PREFIX}${code}`;

  // 使用 Lua script 原子性地 GET + DEL（防止 race condition）
  const luaScript = `
    local val = redis.call('GET', KEYS[1])
    if val then
      redis.call('DEL', KEYS[1])
    end
    return val
  `;

  const dataStr = await redis.eval(luaScript, 1, key);

  if (!dataStr) {
    return res.status(401).json({ error: 'Invalid or expired code' });
  }

  let userData;
  try {
    userData = JSON.parse(dataStr);
  } catch {
    return res.status(500).json({ error: 'Invalid session data' });
  }

  // 產生 JWT token 給 Client App 存儲（用於後續呼叫 /api/auth/me）
  const token = jwt.sign(
    { userId: userData.userId, email: userData.email, name: userData.name },
    config.jwtSecret,
    { algorithm: 'HS256', expiresIn: config.jwtExpiresIn }
  );

  res.json({ user: userData, token });
});

/**
 * GET /api/auth/sso/logout?redirect=<url>
 * 全域登出：清除中央 session + token cookie，back-channel 通知所有 client app
 * redirect 參數必須在已註冊的 redirect_uris 中，防止開放重導向攻擊
 */
router.get('/logout', async (req, res) => {
  const { redirect } = req.query;
  const token = req.cookies.token;

  let userId = null;

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      userId = decoded.userId;
      await redis.del(`${SESSION_PREFIX}${decoded.userId}`);
    } catch {
      // token 無效，繼續清除 cookie
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

  // 驗證 redirect 是否在已註冊的 redirect_uris 中
  let safeRedirect = config.frontendUrl;
  if (redirect) {
    try {
      const redirectOrigin = new URL(redirect).origin;
      const origins = await allowedListService.getAllOrigins();
      if (origins.includes(redirectOrigin) || redirectOrigin === config.frontendUrl) {
        safeRedirect = redirect;
      } else {
        console.warn(`Blocked redirect to unauthorized origin: ${redirectOrigin}`);
      }
    } catch {
      console.warn(`Invalid redirect URL: ${redirect}`);
    }
  }

  res.redirect(safeRedirect);
});

module.exports = router;
