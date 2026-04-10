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
 * GET /api/auth/sso/authorize?app=<name>&redirect_uri=<url>
 * SSO 授權端點：
 * - 用 app (白名單 name) 查詢，驗證 redirect_uri 的 origin 是否與該筆白名單 domain 匹配
 * - 已有中央 session → 產生一次性 auth code，帶 code 重導到 redirect_uri
 * - 無 session → 走 Microsoft 登入，登入後重導到 redirect_uri
 */
router.get('/authorize', async (req, res) => {
  const { app, redirect_uri } = req.query;

  if (!app || !redirect_uri) {
    return res.status(400).json({ error: 'Missing app or redirect_uri' });
  }

  // 用 name 查白名單
  const allowed = await allowedListService.findByName(app);
  if (!allowed) {
    return res.status(403).json({ error: `App "${app}" not found or not active in allowed list` });
  }

  // 驗證 redirect_uri 的 origin 是否與白名單中的 domain 匹配
  let redirectUrl;
  try {
    redirectUrl = new URL(redirect_uri);
    if (redirectUrl.origin !== allowed.domain) {
      return res.status(403).json({
        error: `redirect_uri origin "${redirectUrl.origin}" does not match registered domain "${allowed.domain}"`,
      });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid redirect_uri' });
  }

  // 檢查是否已有中央 session
  const token = req.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      const sessionStr = await redis.get(`${SESSION_PREFIX}${decoded.userId}`);
      if (sessionStr) {
        // 已登入，產生一次性 auth code
        const code = crypto.randomBytes(32).toString('hex');
        const sessionData = JSON.parse(sessionStr);

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
 * Auth Code 交換端點（server-to-server）：
 * Client App 後端用一次性 auth code 換取用戶資料 + JWT token
 * 使用 Lua script 確保原子性（防止 race condition 重複使用）
 */
router.post('/exchange', async (req, res) => {
  const { code } = req.body;

  if (!code || typeof code !== 'string' || code.length !== 64) {
    return res.status(400).json({ error: 'Invalid code format' });
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

  const userData = JSON.parse(dataStr);

  // 產生 JWT token 給 Client App 存儲（用於後續呼叫 /api/auth/me）
  const token = jwt.sign(
    { userId: userData.userId, email: userData.email, name: userData.name },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );

  res.json({ user: userData, token });
});

/**
 * GET /api/auth/sso/logout?redirect=<url>
 * 全域登出：清除中央 session + token cookie，back-channel 通知所有 client app
 * redirect 參數必須在白名單內，防止開放重導向攻擊
 */
router.get('/logout', async (req, res) => {
  const { redirect } = req.query;
  const token = req.cookies.token;

  let userId = null;

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      userId = decoded.userId;
      await redis.del(`${SESSION_PREFIX}${decoded.userId}`);
    } catch {
      // token 無效，繼續清除 cookie
    }
  }

  // Back-channel Logout：通知所有啟用的 client app
  if (userId) {
    try {
      const allowedDomains = await allowedListService.findAll();
      const backChannelPromises = allowedDomains
        .filter((d) => d.domain !== config.frontendUrl)
        .map((d) =>
          fetch(`${d.domain}/api/auth/back-channel-logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId }),
            signal: AbortSignal.timeout(5000),
          }).catch((err) => {
            console.warn(`Back-channel logout to ${d.domain} failed:`, err.message);
          })
        );
      await Promise.allSettled(backChannelPromises);
    } catch (err) {
      console.error('Back-channel logout error:', err.message);
    }
  }

  res.clearCookie('token', { ...(config.cookieDomain && { domain: config.cookieDomain }), path: '/' });

  // 驗證 redirect 是否在白名單中，防止開放重導向攻擊
  let safeRedirect = config.frontendUrl;
  if (redirect) {
    try {
      const redirectOrigin = new URL(redirect).origin;
      const allowedDomains = await allowedListService.findAll();
      const isAllowed = allowedDomains.some((d) => d.domain === redirectOrigin)
        || redirectOrigin === config.frontendUrl;
      if (isAllowed) {
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
