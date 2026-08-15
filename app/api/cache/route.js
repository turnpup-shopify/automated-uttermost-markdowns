import { isAuthorized } from '../../../lib/auth';
import { clearCache, cacheEnabled, cacheDiag, CACHE_TTL_MS } from '../../../lib/cache';
import { resolveSource } from '../../../lib/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET  /api/cache?source=...          -> cache diagnostics for that source
// GET  /api/cache?source=...&write=1  -> also run a live write self-test
export async function GET(request) {
  const url = new URL(request.url);
  const source = resolveSource(url.searchParams.get('source'));
  const write = url.searchParams.get('write') === '1';
  const diag = await cacheDiag(source, { write });
  return Response.json(
    { build: 'multi-source-v5', ...diag, ttlHours: CACHE_TTL_MS / 3_600_000 },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

// POST /api/cache?source=... -> clear that source's cache (CRON_SECRET-protected)
export async function POST(request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const source = resolveSource(new URL(request.url).searchParams.get('source'));
  if (!cacheEnabled()) {
    return Response.json({ cleared: false, note: 'No Blob store connected — nothing to clear.' });
  }
  const cleared = await clearCache(source);
  return Response.json({
    cleared,
    source,
    note: cleared ? `Cache cleared for ${source} — next scrape runs fresh.` : 'Cache was already empty.',
  });
}
