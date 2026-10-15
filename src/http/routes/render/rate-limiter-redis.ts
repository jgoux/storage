import Redis from 'ioredis'
import { registerRateLimiterRedis } from './rate-limiter'

registerRateLimiterRedis((url, options) => new Redis(url, options))
