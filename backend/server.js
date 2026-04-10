require('dotenv').config();
const express = require('express');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const config = require('./config');
const authRoutes = require('./routes/auth');
const ssoRoutes = require('./routes/sso');
const allowedListRoutes = require('./routes/allowedList');
const loginLogRoutes = require('./routes/loginLog');
const allowedListService = require('./services/allowedList');

// 初始化連線
const db = require('./config/database');
const redis = require('./config/redis');

const app = express();

// Reverse proxy (Coolify/Nginx) 會設定 X-Forwarded-For
app.set('trust proxy', 1);

// ============================================
// 安全中間件
// ============================================

// Helmet：設定安全 HTTP headers
app.use(helmet({
  contentSecurityPolicy: false, // Next.js 前端需要 inline scripts
  crossOriginEmbedderPolicy: false,
}));

// Request logging
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

// Body size limit（防止大 payload DoS）
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Cookie parser
app.use(cookieParser());

// ============================================
// Rate Limiting
// ============================================

// 全域速率限制
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: 500,                  // 每 IP 最多 500 次
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use(globalLimiter);

// Auth 端點嚴格速率限制（防暴力攻擊，僅限登入/redirect 流程）
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: 30,                   // 每 IP 最多 30 次
  standardHeaders: true,
  legacyHeaders: false,
  // /me 和 POST /logout 是 Client App 高頻 server-to-server 呼叫，不套用嚴格限制
  skip: (req) => req.path === '/me' || (req.method === 'POST' && req.path === '/logout'),
  message: { error: 'Too many authentication attempts, please try again later' },
});

// /me 與 /logout 較寬鬆的速率限制（Client App 每次頁面載入都會呼叫）
const sessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: 100,                  // 每 IP 最多 100 次
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

// SSO exchange 端點速率限制
const exchangeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 分鐘
  max: 20,                   // 每 IP 最多 20 次
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many exchange attempts' },
});

// ============================================
// CORS（從 DB 白名單動態載入）
// ============================================

let corsOriginsCache = [];
let corsCacheTime = 0;
const CORS_CACHE_TTL = 60 * 1000; // 1 分鐘快取

async function loadCorsOrigins() {
  const now = Date.now();
  if (now - corsCacheTime < CORS_CACHE_TTL && corsOriginsCache.length > 0) {
    return corsOriginsCache;
  }
  try {
    const list = await allowedListService.findAll();
    corsOriginsCache = list.map((item) => item.domain);
    corsCacheTime = now;
  } catch (err) {
    console.error('Failed to load CORS origins from DB:', err.message);
  }
  return corsOriginsCache;
}

app.use(cors({
  origin: async function (origin, callback) {
    // 允許無 origin 的請求（如 server-to-server 的 exchange 呼叫）
    if (!origin) return callback(null, true);
    const origins = await loadCorsOrigins();
    if (origins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS not allowed for origin: ${origin}`));
  },
  credentials: true,
}));

// ============================================
// Session
// ============================================

app.use(session({
  store: new RedisStore({ client: redis, prefix: 'sess:' }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.nodeEnv === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000, // 10 分鐘（僅用於 OAuth state）
  },
}));

// ============================================
// Routes（搭配 rate limiting）
// ============================================

app.use('/api/auth/me', sessionLimiter);
app.use('/api/auth/logout', sessionLimiter);
app.use('/api/auth/sso/exchange', exchangeLimiter);
app.use('/api/auth/sso', authLimiter, ssoRoutes);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/allowed-list', allowedListRoutes);
app.use('/api/login-log', loginLogRoutes);

// Health check
app.get('/api/health', async (req, res) => {
  const health = { status: 'ok', timestamp: new Date().toISOString() };

  try {
    await db.query('SELECT 1');
    health.pg = 'connected';
  } catch {
    health.pg = 'disconnected';
    health.status = 'degraded';
  }

  try {
    await redis.ping();
    health.redis = 'connected';
  } catch {
    health.redis = 'disconnected';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// ============================================
// Global Error Handler
// ============================================

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler（CORS errors、unexpected errors）
app.use((err, req, res, _next) => {
  // CORS 錯誤
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({ error: err.message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// 啟動伺服器
// ============================================

const server = app.listen(config.port, () => {
  console.log(`DF-SSO Backend running on http://localhost:${config.port} [${config.nodeEnv}]`);
});

// ============================================
// Graceful Shutdown
// ============================================

function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    try {
      await db.end();
      console.log('PostgreSQL pool closed');
    } catch { /* ignore */ }
    try {
      redis.disconnect();
      console.log('Redis disconnected');
    } catch { /* ignore */ }
    process.exit(0);
  });

  // 強制關閉（10 秒後）
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown('uncaughtException');
});
