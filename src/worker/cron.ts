import { Env } from './types';

/**
 * Cron-triggered tasks:
 * 1. Container cold-start warming — pings the CV container to keep it hot
 * 2. R2/KV session cleanup — deletes expired sessions and orphaned R2 objects
 */
export async function handleScheduled(env: Env): Promise<void> {
  await Promise.allSettled([
    warmContainer(env),
    cleanupExpiredSessions(env),
  ]);
}

/**
 * Warm the CV container by sending a lightweight health-check request.
 * This prevents cold starts when users upload videos.
 */
async function warmContainer(env: Env): Promise<void> {
  try {
    const id = env.CV_PIPELINE.idFromName('warmer');
    const stub = env.CV_PIPELINE.get(id);
    const resp = await stub.fetch('http://container/health', {
      signal: AbortSignal.timeout(10_000),
    });
    console.log(`[cron] Container warm ping: ${resp.status}`);
  } catch (err) {
    console.warn('[cron] Container warm failed (may be scaling up):', err);
  }
}

/**
 * Clean up expired R2 objects.
 * Sessions in KV auto-expire via TTL (24h), but R2 objects don't.
 * List R2 objects with known prefixes and delete those older than 48h.
 */
async function cleanupExpiredSessions(env: Env): Promise<void> {
  const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours
  const now = Date.now();
  let deleted = 0;

  for (const prefix of ['videos/', 'frames/', 'exports/']) {
    let cursor: string | undefined;
    do {
      const listed = await env.R2.list({ prefix, cursor, limit: 100 });
      for (const obj of listed.objects) {
        const age = now - obj.uploaded.getTime();
        if (age > MAX_AGE_MS) {
          await env.R2.delete(obj.key);
          deleted++;
        }
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }

  if (deleted > 0) {
    console.log(`[cron] Cleaned up ${deleted} expired R2 objects`);
  }
}
