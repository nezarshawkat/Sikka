import { redis } from '../config/redis.js';

const TTL_SECONDS = 600;

export async function getCachedRoute(cacheKey) {
  const value = await redis.get(cacheKey);
  return value ? JSON.parse(value) : null;
}

export async function setCachedRoute(cacheKey, payload) {
  await redis.set(cacheKey, JSON.stringify(payload), 'EX', TTL_SECONDS);
}
