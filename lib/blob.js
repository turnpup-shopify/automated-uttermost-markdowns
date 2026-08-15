// Centralized Vercel Blob I/O that works with BOTH public and private stores.
// The store's access mode is auto-detected on first write/read (or forced via
// BLOB_ACCESS=public|private) and remembered for the lifetime of the function.

let resolvedAccess =
  process.env.BLOB_ACCESS === 'private'
    ? 'private'
    : process.env.BLOB_ACCESS === 'public'
    ? 'public'
    : null; // unknown -> detect at runtime

const other = (a) => (a === 'public' ? 'private' : 'public');
const isAccessMismatch = (err) =>
  /private store|public store|access on a/i.test(String(err?.message || err));

/** Find the Blob RW token regardless of the env-var name Vercel used. */
export function getBlobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const [, v] of Object.entries(process.env)) {
    if (typeof v === 'string' && v.startsWith('vercel_blob_rw_')) return v;
  }
  const key = Object.keys(process.env).find((k) => k.endsWith('_READ_WRITE_TOKEN'));
  return key ? process.env[key] : undefined;
}

export function blobConfigured() {
  return !!getBlobToken();
}

export function resolvedBlobAccess() {
  return resolvedAccess;
}

/** Env-var NAMES (never values) that look Blob-related — for diagnostics. */
export function blobEnvHint() {
  return Object.keys(process.env).filter(
    (k) => /BLOB/i.test(k) || k.endsWith('_READ_WRITE_TOKEN')
  );
}

/** Write JSON/text to a fixed pathname, adapting to the store's access mode. */
export async function putBlob(pathname, data, { contentType = 'application/json' } = {}) {
  const token = getBlobToken();
  if (!token) throw new Error('no-blob-token');
  const { put } = await import('@vercel/blob');
  const opts = { contentType, addRandomSuffix: false, allowOverwrite: true, token };

  const first = resolvedAccess || 'public';
  try {
    const r = await put(pathname, data, { access: first, ...opts });
    resolvedAccess = first;
    return r;
  } catch (err) {
    if (isAccessMismatch(err)) {
      const alt = other(first);
      const r = await put(pathname, data, { access: alt, ...opts });
      resolvedAccess = alt;
      return r;
    }
    throw err;
  }
}

/** Read + JSON-parse a blob by pathname, or null if missing/unreadable. */
export async function readBlobJson(pathname) {
  const token = getBlobToken();
  if (!token) return null;
  const { get } = await import('@vercel/blob');
  const order = resolvedAccess ? [resolvedAccess, other(resolvedAccess)] : ['public', 'private'];
  for (const access of order) {
    try {
      const res = await get(pathname, { access, token, useCache: false });
      if (!res) return null; // definitively not found for this access
      resolvedAccess = access;
      const text = await new Response(res.stream).text();
      return JSON.parse(text);
    } catch (err) {
      if (!isAccessMismatch(err)) return null; // real error (not access) -> give up
      // else try the other access mode
    }
  }
  return null;
}

export async function listBlobs(prefix) {
  const token = getBlobToken();
  if (!token) return [];
  const { list } = await import('@vercel/blob');
  const { blobs } = await list({ prefix, token });
  return blobs;
}

export async function delBlobs(urls) {
  const token = getBlobToken();
  if (!token || !urls?.length) return;
  const { del } = await import('@vercel/blob');
  await del(urls, { token });
}
