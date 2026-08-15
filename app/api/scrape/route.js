import { getOverstocks } from '../../../lib/overstocks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/scrape            -> JSON { count, withPrice, products, cached, ... }
//   Served from the 24h cache when available; scrapes fresh otherwise.
// GET /api/scrape?fresh=1     -> bypass the cache and scrape fresh
// GET /api/scrape?debug=1     -> fresh scrape + diagnostics (never cached)
// GET /api/scrape?screenshot=1 -> also embeds a base64 screenshot (large payload)
export async function GET(request) {
  const url = new URL(request.url);
  const debug = url.searchParams.get('debug') === '1';
  const screenshot = url.searchParams.get('screenshot') === '1';
  const force = url.searchParams.get('fresh') === '1' || url.searchParams.get('nocache') === '1';

  try {
    const result = await getOverstocks({ force, debug, screenshot });
    return Response.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[api/scrape] failed:', err);
    return Response.json(
      { error: err?.message || 'Scrape failed', stack: debug ? err?.stack : undefined },
      { status: 500 }
    );
  }
}
