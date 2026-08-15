// Persistent run log for Shopify price syncs, stored in Vercel Blob with a
// rolling 7-day retention. Works with public OR private stores (lib/blob.js).

import {
  getBlobToken,
  blobConfigured,
  blobEnvHint,
  putBlob,
  readBlobJson,
  listBlobs,
  delBlobs,
} from './blob';

// Re-export so existing imports (e.g. from routes) keep working.
export { getBlobToken, blobConfigured, blobEnvHint };

const PREFIX = 'shopify-logs/';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Append one run entry. Returns the blob URL, or null if Blob isn't configured. */
export async function writeLog(entry) {
  if (!getBlobToken()) return null;
  const stamp = String(entry.timestamp).replace(/[:.]/g, '-');
  const blob = await putBlob(`${PREFIX}${stamp}.json`, JSON.stringify(entry, null, 2), {
    contentType: 'application/json',
  });
  try {
    await pruneOldLogs();
  } catch {
    /* best-effort */
  }
  return blob.url;
}

/** Delete log entries older than the retention window. */
export async function pruneOldLogs() {
  if (!getBlobToken()) return;
  const cutoff = Date.now() - RETENTION_MS;
  const blobs = await listBlobs(PREFIX);
  const stale = blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff);
  if (stale.length) await delBlobs(stale.map((b) => b.url));
}

/** Read all run entries from the last 7 days, newest first. */
export async function readLogs() {
  if (!getBlobToken()) return [];
  const cutoff = Date.now() - RETENTION_MS;
  const blobs = await listBlobs(PREFIX);
  const recent = blobs
    .filter((b) => new Date(b.uploadedAt).getTime() >= cutoff)
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  const entries = await Promise.all(recent.map((b) => readBlobJson(b.pathname)));
  return entries.filter(Boolean);
}
