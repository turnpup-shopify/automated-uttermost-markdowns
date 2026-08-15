import { getPromotion } from '../../../lib/overstocks';
import { toCsv } from '../../../lib/csv';
import { resolveSource } from '../../../lib/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/csv?source=overstocks|quarterly -> downloads uttermost-<source>-YYYY-MM-DD.csv
export async function GET(request) {
  const source = resolveSource(new URL(request.url).searchParams.get('source'));
  try {
    const { products } = await getPromotion(source);
    const csv = toCsv(products);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="uttermost-${source}-${date}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[api/csv] failed:', err);
    return new Response(`Scrape failed: ${err?.message || 'unknown error'}`, { status: 500 });
  }
}
