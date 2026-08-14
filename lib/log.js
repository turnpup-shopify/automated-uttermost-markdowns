// Persistent run log for Shopify price syncs, stored in Vercel Blob with a
// rolling 7-day retention. Each sync writes one JSON entry; reads return only
// entries from the last 7 days, and old entries are pruned on every write.
//
// Requires a Blob store connected to the project. Vercel normally injects
// BLOB_READ_WRITE_TOKEN, but a store connected with a custom prefix uses a
// different env-var name — so we detect the token by its value too.

const PREFIX = 'shopify-logs/';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Find the Blob RW token regardless of the env-var name Vercel used. */
export function getBlobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  // Vercel Blob tokens always start with this prefix — match by value.
  for (const [, v] of Object.entries(process.env)) {
    if (typeof v === 'string' && v.startsWith('vercel_blob_rw_')) return v;
  }
  // Last resort: any custom-prefixed *_READ_WRITE_TOKEN var.
  const key = Object.keys(process.env).find((k) => k.endsWith('_READ_WRITE_TOKEN'));
  return key ? process.env[key] : undefined;
}

export function blobConfigured() {
  return !!getBlobToken();
}

/** Diagnostic: env-var NAMES (never values) that look Blob-related. */
export function blobEnvHint() {
  return Object.keys(process.env).filter(
    (k) => /BLOB/i.test(k) || k.endsWith('_READ_WRITE_TOKEN')
  );
}

/** Append one run entry. Returns the blob URL, or null if Blob isn't configured. */
export async function writeLog(entry) {
  const token = getBlobToken();
  if (!token) return null;
  const { put } = await import('@vercel/blob');
  const stamp = String(entry.timestamp).replace(/[:.]/g, '-');
  const blob = await put(`${PREFIX}${stamp}.json`, JSON.stringify(entry, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    token,
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
  const token = getBlobToken();
  if (!token) return;
  const { list, del } = await import('@vercel/blob');
  const cutoff = Date.now() - RETENTION_MS;
  const { blobs } = await list({ prefix: PREFIX, token });
  const stale = blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff);
  if (stale.length) await del(stale.map((b) => b.url), { token });
}

/** Read all run entries from the last 7 days, newest first. */
export async function readLogs() {
  const token = getBlobToken();
  if (!token) return [];
  const { list } = await import('@vercel/blob');
  const cutoff = Date.now() - RETENTION_MS;
  const { blobs } = await list({ prefix: PREFIX, token });
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
