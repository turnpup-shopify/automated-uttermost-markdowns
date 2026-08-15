import { isAuthorized } from '../../../lib/auth';
import { readCache, clearCache, cacheEnabled, CACHE_TTL_MS } from '../../../lib/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/cache  -> cache status (enabled, whether populated, age)
export async function GET() {
  const enabled = cacheEnabled();
  const cached = enabled ? await readCache() : null;
  const ageMs = cached?.scrapedAt ? Date.now() - new Date(cached.scrapedAt).getTime() : null;
  return Response.json(
    {
      enabled,
      cached: !!cached,
      scrapedAt: cached?.scrapedAt || null,
      count: cached?.count ?? null,
      ageHours: ageMs != null ? Number((ageMs / 3_600_000).toFixed(1)) : null,
      ttlHours: CACHE_TTL_MS / 3_600_000,
    },
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
