import { getPromotion } from '../../../lib/overstocks';
import { resolveSource } from '../../../lib/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/scrape?source=overstocks|quarterly  -> JSON { count, products, cached, ... }
//   Served from the 24h per-source cache when available; scrapes fresh otherwise.
// GET ...&fresh=1     -> bypass the cache and scrape fresh
// GET ...&debug=1     -> fresh scrape + diagnostics (never cached)
// GET ...&screenshot=1 -> also embeds a base64 screenshot (large payload)
export async function GET(request) {
  const url = new URL(request.url);
  const source = resolveSource(url.searchParams.get('source'));
  const debug = url.searchParams.get('debug') === '1';
  const screenshot = url.searchParams.get('screenshot') === '1';
  const force = url.searchParams.get('fresh') === '1' || url.searchParams.get('nocache') === '1';

  try {
    const result = await getPromotion(source, { force, debug, screenshot });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[api/scrape] failed:', err);
    return Response.json(
      { error: err?.message || 'Scrape failed', stack: debug ? err?.stack : undefined },
      { status: 500 }
    );
  }
}
