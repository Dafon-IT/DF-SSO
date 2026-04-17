import Redis from 'ioredis';
import config from './index.js';

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  db: config.redis.db,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 3000);
    return delay;
  },
});

redis.on('connect', () => {
  console.log(`[Redis] Connected to ${config.redis.host}:${config.redis.port} DB ${config.redis.db}`);
});

redis.on('error', (err) => {
  console.error('[Redis] Error:', err.message);
});

export default redis;
