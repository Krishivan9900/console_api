"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisConnection = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const redisConfig = {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD ||  undefined,
    db: parseInt(process.env.REDIS_DB || '0'),
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
};
exports.redisConnection = new ioredis_1.default(redisConfig);
exports.redisConnection.on('connect', () => {
    console.log('✅ Redis connected successfully');
});
exports.redisConnection.on('error', (error) => {
    console.error('❌ Redis connection error:', error);
});
exports.default = redisConfig;
//# sourceMappingURL=redis.config.js.map