// Persistent run log for Shopify price syncs, stored in Vercel Blob with a
// rolling 7-day retention. Each sync writes one JSON entry; reads return only
// entries from the last 7 days, and old entries are pruned on every write.
//
// Requires a Blob store connected to the project (injects BLOB_READ_WRITE_TOKEN).
// Without it, logging is a no-op and the /logs page shows a setup hint.

const PREFIX = 'shopify-logs/';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function blobConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** Append one run entry. Returns the blob URL, or null if Blob isn't configured. */
export async function writeLog(entry) {
  if (!blobConfigured()) return null;
  const { put } = await import('@vercel/blob');
  const stamp = String(entry.timestamp).replace(/[:.]/g, '-');
  const blob = await put(`${PREFIX}${stamp}.json`, JSON.stringify(entry, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  // Best-effort prune; never let cleanup fail the request.
  try {
    await pruneOldLogs();
  } catch {
    /* ignore */
  }
  return blob.url;
}

/** Delete log entries older than the retention window. */
export async function pruneOldLogs() {
  if (!blobConfigured()) return;
  const { list, del } = await import('@vercel/blob');
  const cutoff = Date.now() - RETENTION_MS;
  const { blobs } = await list({ prefix: PREFIX });
  const stale = blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff);
  if (stale.length) await del(stale.map((b) => b.url));
}

/** Read all run entries from the last 7 days, newest first. */
export async function readLogs() {
  if (!blobConfigured()) return [];
  const { list } = await import('@vercel/blob');
  const cutoff = Date.now() - RETENTION_MS;
  const { blobs } = await list({ prefix: PREFIX });
  const recent = blobs
    .filter((b) => new Date(b.uploadedAt).getTime() >= cutoff)
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  const entries = await Promise.all(
    recent.map(async (b) => {
      try {
        const res = await fetch(b.url, { cache: 'no-store' });
        return await res.json();
      } catch {
        return null;
      }
    })
  );
  return entries.filter(Boolean);
}
