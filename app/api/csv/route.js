import { getOverstocks } from '../../../lib/overstocks';
import { toCsv } from '../../../lib/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/csv -> downloads uttermost-overstocks-YYYY-MM-DD.csv
export async function GET() {
  try {
    const { products } = await getOverstocks();
    const csv = toCsv(products);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="uttermost-overstocks-${date}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[api/csv] failed:', err);
    return new Response(`Scrape failed: ${err?.message || 'unknown error'}`, {
      status: 500,
    });
  }
}
