/**
 * Rate limit 動態管理
 *
 * 原本 express-rate-limit 的 limiter instance 是在 server 啟動時 snapshot 建好，
 * 改 max/windowMs 不能原地生效。這裡改用 wrapper middleware 指向 module-level
 * 可變 instance，搭配 reload() 從 sso_setting 表重建 instance，讓管理員在
 * Dashboard 改完立即生效。
 *
 * 注意：重建會清掉舊 instance 的計數（視窗歸零），這是預期行為。
 */

const rateLimit = require('express-rate-limit');
const ssoSettingService = require('./ssoSetting');

const DEFAULTS = {
  'rate_limit.global':   { windowMs: 15 * 60 * 1000, max: 500 },
  'rate_limit.auth':     { windowMs: 15 * 60 * 1000, max: 30 },
  'rate_limit.session':  { windowMs: 15 * 60 * 1000, max: 100 },
  'rate_limit.exchange': { windowMs: 1 * 60 * 1000,  max: 20 },
};

const MESSAGES = {
  global:   { error: 'Too many requests, please try again later' },
  auth:     { error: 'Too many authentication attempts, please try again later' },
  session:  { error: 'Too many requests, please try again later' },
  exchange: { error: 'Too many exchange attempts' },
};

// Auth limiter 對 /me 與 POST /logout 放行（Client App 高頻 server-to-server）
const authSkip = (req) =>
  req.path === '/me' || (req.method === 'POST' && req.path === '/logout');

function build({ windowMs, max }, { skip, message } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(skip ? { skip } : {}),
    ...(message ? { message } : {}),
  });
}

// 模組載入時先用 hardcoded 預設值，確保即使 DB 尚未可用 server 也能起來
const current = {
  global:   build(DEFAULTS['rate_limit.global'],   { message: MESSAGES.global }),
  auth:     build(DEFAULTS['rate_limit.auth'],     { skip: authSkip, message: MESSAGES.auth }),
  session:  build(DEFAULTS['rate_limit.session'],  { message: MESSAGES.session }),
  exchange: build(DEFAULTS['rate_limit.exchange'], { message: MESSAGES.exchange }),
};

function pickValue(map, key) {
  const v = map[key];
  if (
    v &&
    typeof v === 'object' &&
    Number.isFinite(v.windowMs) &&
    Number.isFinite(v.max) &&
    v.windowMs >= 1000 &&
    v.max >= 1
  ) {
    return { windowMs: v.windowMs, max: v.max };
  }
  return DEFAULTS[key];
}

/**
 * 從 DB 讀 rate_limit category 的所有設定並重建四個 limiter instance。
 * 任一筆缺失或格式錯會 fallback 到 DEFAULTS，不 throw。
 */
async function reload() {
  try {
    const map = await ssoSettingService.getMapByCategory('rate_limit');
    current.global   = build(pickValue(map, 'rate_limit.global'),   { message: MESSAGES.global });
    current.auth     = build(pickValue(map, 'rate_limit.auth'),     { skip: authSkip, message: MESSAGES.auth });
    current.session  = build(pickValue(map, 'rate_limit.session'),  { message: MESSAGES.session });
    current.exchange = build(pickValue(map, 'rate_limit.exchange'), { message: MESSAGES.exchange });
    return true;
  } catch (err) {
    console.error('rateLimitManager.reload failed, keeping existing limiters:', err.message);
    return false;
  }
}

// Wrapper middleware：永遠呼叫「當前」instance
const globalLimiter   = (req, res, next) => current.global(req, res, next);
const authLimiter     = (req, res, next) => current.auth(req, res, next);
const sessionLimiter  = (req, res, next) => current.session(req, res, next);
const exchangeLimiter = (req, res, next) => current.exchange(req, res, next);

module.exports = {
  reload,
  globalLimiter,
  authLimiter,
  sessionLimiter,
  exchangeLimiter,
  DEFAULTS,
};
