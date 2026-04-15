import { Context, Next } from 'hono';
import { Env, AppError } from '../types';

const WINDOW_MS = 60_000; // 1 minute sliding window
const MAX_REQUESTS = 30;  // 30 requests per minute per IP

/**
 * KV-based sliding window rate limiter.
 * Uses a single KV key per IP with a counter and window start timestamp.
 * Lightweight — no external packages needed.
 */
export async function rateLimiter(c: Context<{ Bindings: Env }>, next: Next) {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const key = `ratelimit:${ip}`;

  const raw = await c.env.KV.get(key);
  let bucket: { count: number; windowStart: number };

  if (raw) {
    bucket = JSON.parse(raw);
    const now = Date.now();
    if (now - bucket.windowStart > WINDOW_MS) {
      // Window expired, reset
      bucket = { count: 1, windowStart: now };
    } else {
      bucket.count++;
    }
  } else {
    bucket = { count: 1, windowStart: Date.now() };
  }

  if (bucket.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((bucket.windowStart + WINDOW_MS - Date.now()) / 1000);
    c.header('Retry-After', String(Math.max(retryAfter, 1)));
    throw new AppError('RATE_LIMITED', 'Too many requests. Please slow down.', 429);
  }

  // Store with TTL slightly longer than window to auto-clean
  await c.env.KV.put(key, JSON.stringify(bucket), { expirationTtl: 120 });

  c.header('X-RateLimit-Limit', String(MAX_REQUESTS));
  c.header('X-RateLimit-Remaining', String(Math.max(0, MAX_REQUESTS - bucket.count)));

  await next();
}
