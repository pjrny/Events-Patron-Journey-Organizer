// KV is a CACHE ONLY. Nothing here is authoritative; every miss falls through to Odoo.
import type { Env } from "./env";

export const CACHE_TTL = {
  venues: 300,
  tags: 3600,
  websites: 3600,
  eventSummary: 60,
} as const;

export async function cacheGet<T>(env: Env, key: string): Promise<T | null> {
  return (await env.CACHE.get<T>(key, "json")) ?? null;
}

export async function cachePut(env: Env, key: string, value: unknown, ttlSeconds: number): Promise<void> {
  // KV minimum TTL is 60s.
  await env.CACHE.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttlSeconds) });
}

export async function cacheDel(env: Env, key: string): Promise<void> {
  await env.CACHE.delete(key);
}

/** Read-through helper: return cached value or compute, store, and return it. */
export async function cached<T>(env: Env, key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(env, key);
  if (hit !== null) return hit;
  const val = await load();
  await cachePut(env, key, val, ttlSeconds);
  return val;
}

export const cacheKeys = {
  venues: (websiteId: number | string) => `odoo:venues:${websiteId}`,
  tags: () => "odoo:event_tags",
  websites: () => "odoo:websites",
  eventSummary: (eventId: number) => `odoo:event:${eventId}:summary`,
};
