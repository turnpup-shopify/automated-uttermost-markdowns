import { getPromotion } from '../../../lib/overstocks';
import { toCsv } from '../../../lib/csv';
import { isAuthorized } from '../../../lib/auth';
import { getBlobToken, putBlob } from '../../../lib/blob';
import { resolveSource } from '../../../lib/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Scheduled by vercel.json (one entry per source). Also callable manually:
// /api/cron?source=quarterly&token=<CRON_SECRET>
// Scrapes fresh, refreshes the 24h cache, and archives a timestamped CSV + JSON
// snapshot to Vercel Blob under <source>/ (if a Blob store is connected).
export async function GET(request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const source = resolveSource(new URL(request.url).searchParams.get('source'));

  try {
    const result = await getPromotion(source, { force: true });
    const csv = toCsv(result.products);
    const stamp = result.scrapedAt.replace(/[:.]/g, '-');

    let stored = null;
    if (getBlobToken()) {
      const [csvBlob, jsonBlob, latest] = await Promise.all([
        putBlob(`${source}/${stamp}.csv`, csv, { contentType: 'text/csv' }),
        putBlob(`${source}/${stamp}.json`, JSON.stringify({ ...result, logs: undefined }, null, 2), {
          contentType: 'application/json',
        }),
        putBlob(`${source}/latest.csv`, csv, { contentType: 'text/csv' }),
      ]);
      stored = { csvUrl: csvBlob.url, jsonUrl: jsonBlob.url, latestUrl: latest.url };
    }

    return Response.json({
      ok: true,
      source,
      count: result.count,
      scrapedAt: result.scrapedAt,
      stored,
      note: stored
        ? 'Snapshot archived to Vercel Blob.'
        : 'No Blob store connected — data returned inline only. Connect a Blob store to archive snapshots.',
    });
  } catch (err) {
    console.error('[api/cron] failed:', err);
    return Response.json({ ok: false, error: err?.message || 'Scrape failed' }, {
      status: 500,
    });
  }
}
