import fastifyRateLimit from '@fastify/rate-limit'
import { ErrorCode } from '@internal/errors'
import { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import type Redis from 'ioredis'
import type { RedisOptions } from 'ioredis'
import { getConfig } from '../../../config'

const {
  rateLimiterDriver,
  rateLimiterRedisUrl,
  rateLimiterSkipOnError,
  rateLimiterRedisConnectTimeout,
  rateLimiterRedisCommandTimeout,
  rateLimiterRenderPathMaxReqSec,
} = getConfig()

type RedisClientFactory = (url: string, options: RedisOptions) => Redis

let createRedisClient: RedisClientFactory | undefined

/**
 * Provides the Redis client used when RATE_LIMITER_DRIVER=redis. It is
 * registered by the entry point (see ./rate-limiter-redis) rather than imported
 * here, so an entry that does not register it does not load ioredis.
 */
export function registerRateLimiterRedis(factory: RedisClientFactory) {
  createRedisClient = factory
}

export const rateLimiter = fp(
  (fastify: FastifyInstance, _ops: unknown, done: (err?: Error) => void) => {
    if (rateLimiterDriver === 'redis' && !createRedisClient) {
      done(new Error('RATE_LIMITER_DRIVER=redis is not supported by this entry point'))
      return
    }

    fastify.register(fastifyRateLimit, {
      global: true,
      max: rateLimiterRenderPathMaxReqSec * 4,
      timeWindow: 4 * 1000, //4s
      continueExceeding: true,
      nameSpace: 'image-transformation-ratelimit-',
      skipOnError: rateLimiterSkipOnError,
      errorResponseBuilder(_request, context) {
        return Object.assign(new Error(`Rate limit exceeded, retry in ${context.after}`), {
          name: 'Too Many Requests',
          code: ErrorCode.SlowDown,
          statusCode: context.statusCode,
        })
      },
      redis:
        rateLimiterDriver === 'redis' && createRedisClient
          ? createRedisClient(rateLimiterRedisUrl || '', {
              connectTimeout: rateLimiterRedisConnectTimeout * 1000,
              commandTimeout: rateLimiterRedisCommandTimeout * 1000,
            })
          : undefined,
      keyGenerator(request) {
        const tenant = request.tenantId
        const ip = request.headers['x-real-ip'] || request.headers['x-client-ip'] || request.ip

        // exclude query string
        const pathWithoutQuery = request.url.split('?').shift()

        return `${tenant}-${ip}-${pathWithoutQuery}`
      },
      addHeadersOnExceeding: {
        // default show all the response headers when rate limit is not reached
        'x-ratelimit-limit': false,
        'x-ratelimit-remaining': false,
        'x-ratelimit-reset': false,
      },
      addHeaders: {
        'x-ratelimit-limit': false,
        'x-ratelimit-remaining': false,
        'x-ratelimit-reset': false,
        'retry-after': false,
      },
    })

    done()
  }
)
