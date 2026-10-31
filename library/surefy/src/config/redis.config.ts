import 'dotenv/config';
import Redis, { RedisOptions } from 'ioredis';

const redisConfig: RedisOptions = {
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy: times => Math.min(times * 100, 3000),
};

// All API nodes and workers must use the same Redis database. Never log credentials.
export const redisConnection = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, redisConfig)
  : new Redis({
    ...redisConfig,
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD?.trim() || undefined,
    db: Number(process.env.REDIS_DB || 0),
  });

redisConnection.on('connect', () => console.log('Redis connected successfully'));
redisConnection.on('error', error => console.error('Redis connection error:', error.message));

export default redisConfig;
