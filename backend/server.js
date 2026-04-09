require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');
const authRoutes = require('./routes/auth');
const ssoRoutes = require('./routes/sso');
const allowedListRoutes = require('./routes/allowedList');
const loginLogRoutes = require('./routes/loginLog');

// 初始化連線
const db = require('./config/database');
const redis = require('./config/redis');

const app = express();

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // 允許無 origin 的請求（如 server-to-server）
    if (!origin) return callback(null, true);
    if (config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS not allowed for origin: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.nodeEnv === 'production',
    httpOnly: true,
    maxAge: 10 * 60 * 1000,
  },
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/auth/sso', ssoRoutes);
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
  }

  try {
    await redis.ping();
    health.redis = 'connected';
  } catch {
    health.redis = 'disconnected';
  }

  res.json(health);
});

app.listen(config.port, () => {
  console.log(`DF-SSO Backend running on http://localhost:${config.port}`);
});
