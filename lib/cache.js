// 24-hour cache for each scraped promotion, stored in Vercel Blob under a
// per-source path (cache/<source>.json). Works with public OR private stores.

import {
  getBlobToken,
  blobConfigured,
  putBlob,
  readBlobJson,
  listBlobs,
  delBlobs,
  resolvedBlobAccess,
} from './blob';
import { resolveSource } from './sources';

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function cachePath(source) {
  return `cache/${resolveSource(source)}.json`;
}

export function cacheEnabled() {
  return blobConfigured();
}

export async function readCache(source) {
  return readBlobJson(cachePath(source));
}

export async function writeCache(source, payload) {
  if (!getBlobToken()) return;
  await putBlob(cachePath(source), JSON.stringify(payload), { contentType: 'application/json' });
}

export async function clearCache(source) {
  const path = cachePath(source);
  const blobs = await listBlobs(path);
  const hit = blobs.find((b) => b.pathname === path);
  if (hit) {
    await delBlobs([hit.url]);
    return true;
  }
  return false;
}

/** Self-test of the cache path for a source, for debugging. */
export async function cacheDiag(source, { write = false } = {}) {
  const token = getBlobToken();
  const path = cachePath(source);
  const out = { enabled: !!token, source: resolveSource(source), cachePath: path };
  if (!token) return out;

  if (write) {
    try {
      await putBlob(`cache/_writetest.json`, JSON.stringify({ t: new Date().toISOString() }), {
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
    const hit = blobs.find((b) => b.pathname === path);
    out.found = !!hit;
    if (hit) {
      const data = await readCache(source);
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
