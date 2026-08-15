// 24-hour cache for the scraped overstocks result, stored in Vercel Blob.
// Works with public OR private stores (see lib/blob.js). If no Blob store is
// connected, caching is a no-op and every call scrapes fresh.

import {
  getBlobToken,
  blobConfigured,
  putBlob,
  readBlobJson,
  listBlobs,
  delBlobs,
  resolvedBlobAccess,
} from './blob';

const CACHE_PATH = 'cache/overstocks.json';
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function cacheEnabled() {
  return blobConfigured();
}

export async function readCache() {
  return readBlobJson(CACHE_PATH);
}

export async function writeCache(payload) {
  if (!getBlobToken()) return;
  await putBlob(CACHE_PATH, JSON.stringify(payload), { contentType: 'application/json' });
}

export async function clearCache() {
  const blobs = await listBlobs(CACHE_PATH);
  const hit = blobs.find((b) => b.pathname === CACHE_PATH);
  if (hit) {
    await delBlobs([hit.url]);
    return true;
  }
  return false;
}

/** Full self-test of the cache path for debugging why caching isn't sticking. */
export async function cacheDiag({ write = false } = {}) {
  const token = getBlobToken();
  const out = { enabled: !!token, cachePath: CACHE_PATH };
  if (!token) return out;

  if (write) {
    try {
      await putBlob('cache/_writetest.json', JSON.stringify({ t: new Date().toISOString() }), {
        contentType: 'application/json',
      });
      out.writeTest = { ok: true };
    } catch (e) {
      out.writeTest = { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }

  try {
    const blobs = await listBlobs('cache/');
    out.listCount = blobs.length;
    out.paths = blobs.map((b) => b.pathname);
    const hit = blobs.find((b) => b.pathname === CACHE_PATH);
    out.found = !!hit;
    if (hit) {
      const data = await readCache();
      if (data?.scrapedAt) {
        out.scrapedAt = data.scrapedAt;
        out.count = data.count;
        out.ageHours = Number(
          ((Date.now() - new Date(data.scrapedAt).getTime()) / 3_600_000).toFixed(2)
        );
        out.fresh = out.ageHours < CACHE_TTL_MS / 3_600_000;
      } else {
        out.readError = 'entry present but unreadable';
      }
    }
  } catch (e) {
    out.listError = String(e && e.message ? e.message : e);
  }

  out.accessMode = resolvedBlobAccess() || '(auto)';
  return out;
}
