import { isAuthorized } from '../../../lib/auth';
import { clearCache, cacheEnabled, cacheDiag, CACHE_TTL_MS } from '../../../lib/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/cache  -> full cache diagnostics (token present? entry found? age?)
export async function GET() {
  const diag = await cacheDiag();
  return Response.json(
    { build: 'cache-diag-v2', ...diag, ttlHours: CACHE_TTL_MS / 3_600_000 },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

// POST /api/cache -> clear the cache (protected by CRON_SECRET when set)
export async function POST(request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!cacheEnabled()) {
    return Response.json({ cleared: false, note: 'No Blob store connected — nothing to clear.' });
  }
  const cleared = await clearCache();
  return Response.json({
    cleared,
    note: cleared ? 'Cache cleared — the next scrape will run fresh.' : 'Cache was already empty.',
  });
}
