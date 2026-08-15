// 24-hour cache for the scraped overstocks result, stored in Vercel Blob.
// Keeps us from logging into uttermost.com more than necessary (avoids getting
// rate-limited / blocked). If no Blob store is connected, caching is a no-op
// and every call scrapes fresh.

import { getBlobToken } from './log';

const CACHE_PATH = 'cache/overstocks.json';
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function cacheEnabled() {
  return !!getBlobToken();
}

/** Read the cached scrape result, or null if absent/unreadable. */
export async function readCache() {
  const token = getBlobToken();
  if (!token) return null;
  const { list } = await import('@vercel/blob');
  const { blobs } = await list({ prefix: CACHE_PATH, token });
  const hit = blobs.find((b) => b.pathname === CACHE_PATH);
  if (!hit) return null;
  try {
    const res = await fetch(hit.url, { cache: 'no-store' });
    return await res.json();
  } catch {
    return null;
  }
}

/** Store a trimmed scrape result (products/count/scrapedAt) as the cache. */
export async function writeCache(payload) {
  const token = getBlobToken();
  if (!token) return;
  const { put } = await import('@vercel/blob');
  await put(CACHE_PATH, JSON.stringify(payload), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    token,
  });
}

/** Full self-test of the cache path for debugging why caching isn't sticking. */
export async function cacheDiag() {
  const token = getBlobToken();
  const out = { enabled: !!token, cachePath: CACHE_PATH };
  if (!token) return out;
  try {
    const { list } = await import('@vercel/blob');
    const { blobs } = await list({ prefix: 'cache/', token });
    out.listCount = blobs.length;
    out.paths = blobs.map((b) => b.pathname);
    const hit = blobs.find((b) => b.pathname === CACHE_PATH);
    out.found = !!hit;
    if (hit) {
      try {
        const res = await fetch(hit.url, { cache: 'no-store' });
        const data = await res.json();
        out.scrapedAt = data.scrapedAt;
        out.count = data.count;
        out.ageHours = data.scrapedAt
          ? Number(((Date.now() - new Date(data.scrapedAt).getTime()) / 3_600_000).toFixed(2))
          : null;
        out.fresh = out.ageHours != null && out.ageHours < CACHE_TTL_MS / 3_600_000;
      } catch (e) {
        out.readError = String(e);
      }
    }
  } catch (e) {
    out.listError = String(e);
  }
  return out;
}

/** Delete the cache entry. Returns true if something was removed. */
export async function clearCache() {
  const token = getBlobToken();
  if (!token) return false;
  const { list, del } = await import('@vercel/blob');
  const { blobs } = await list({ prefix: CACHE_PATH, token });
  const hit = blobs.find((b) => b.pathname === CACHE_PATH);
  if (hit) {
    await del(hit.url, { token });
    return true;
  }
  return false;
}
