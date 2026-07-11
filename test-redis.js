const Redis = require('ioredis');

const redis = new Redis(
  'rediss://red-d83efonavr4c739o2k80:5o0DIhre9hQxjRGHTInLZNFmIpLdKl8n@oregon-keyvalue.render.com:6379',
  {
    tls: {},
  }
);

redis.on('connect', () => {
  console.log('✅ Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

(async () => {
  try {
    await redis.set('test_key', 'hello_render');
    const value = await redis.get('test_key');

    console.log('✅ Value:', value);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();