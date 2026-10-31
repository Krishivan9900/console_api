"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisConnection = void 0;
require("dotenv/config");
const ioredis_1 = __importDefault(require("ioredis"));
const redisConfig = {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: times => Math.min(times * 100, 3000),
};
// All API nodes and workers must use the same Redis database. Never log credentials.
exports.redisConnection = process.env.REDIS_URL
    ? new ioredis_1.default(process.env.REDIS_URL, redisConfig)
    : new ioredis_1.default(Object.assign(Object.assign({}, redisConfig), { host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT || 6379), password: ((_a = process.env.REDIS_PASSWORD) === null || _a === void 0 ? void 0 : _a.trim()) || undefined, db: Number(process.env.REDIS_DB || 0) }));
exports.redisConnection.on('connect', () => console.log('Redis connected successfully'));
exports.redisConnection.on('error', error => console.error('Redis connection error:', error.message));
exports.default = redisConfig;
//# sourceMappingURL=redis.config.js.map