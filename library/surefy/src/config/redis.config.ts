import Redis, { RedisOptions } from 'ioredis';

const redisUrl =
  process.env.REDIS_URL || 'rediss://red-d83efonavr4c739o2k80:5o0DIhre9hQxjRGHTInLZNFmIpLdKl8n@oregon-keyvalue.render.com:6379';


console.log("Redis URL", redisUrl)

const redisConfig: RedisOptions = {
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,

  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    console.log(`🔄 Redis reconnect attempt #${times}`);
    return delay;
  },

  reconnectOnError(err) {
    console.error('❌ Redis reconnect error:', err.message);
    return true;
  },
};

export const redisConnection = new Redis(redisUrl, redisConfig);

redisConnection.on('connect', () => {
  console.log('✅ Redis connected successfully');
});

redisConnection.on('ready', () => {
  console.log('🚀 Redis is ready to use');
});

redisConnection.on('error', (error) => {
  console.error('❌ Redis connection error:', error);
});

redisConnection.on('close', () => {
  console.warn('⚠️ Redis connection closed');
});

export default redisConfig;


// import Redis from 'ioredis';

// const redisConfig = {
//   host: process.env.REDIS_HOST || 'redis', // docker-safe default
//   port: Number(process.env.REDIS_PORT || 6379),
//   password: process.env.REDIS_PASSWORD?.trim() ||  undefined,
//   db: Number(process.env.REDIS_DB || 0),

//   maxRetriesPerRequest: null,
//   enableReadyCheck: false,
//   lazyConnect: true,
// };


// export const redisConnection = new Redis(redisConfig);

// redisConnection.on('connect', () => {
//   console.log('✅ Redis connected successfully');
// });

// redisConnection.on('error', (error) => {
//   console.error('❌ Redis connection error:', error);
// });

// export default redisConfig;


