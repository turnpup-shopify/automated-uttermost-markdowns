import { getOverstocks } from '../../../lib/overstocks';
import { toCsv } from '../../../lib/csv';
import { isAuthorized } from '../../../lib/auth';
import { getBlobToken, putBlob } from '../../../lib/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Scheduled by vercel.json ("0 9 * * 1" = every Monday 09:00 UTC).
// Also callable manually: /api/cron?token=<CRON_SECRET>
// Scrapes, then archives a timestamped CSV + JSON snapshot to Vercel Blob
// (if a Blob store is connected). Always returns the fresh data inline.
export async function GET(request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Weekly scheduled refresh: scrape fresh and repopulate the 24h cache.
    const result = await getOverstocks({ force: true });
    const csv = toCsv(result.products);
    const stamp = result.scrapedAt.replace(/[:.]/g, '-');

    let stored = null;
    if (getBlobToken()) {
      const [csvBlob, jsonBlob, latest] = await Promise.all([
        putBlob(`overstocks/${stamp}.csv`, csv, { contentType: 'text/csv' }),
        putBlob(`overstocks/${stamp}.json`, JSON.stringify({ ...result, logs: undefined }, null, 2), {
          contentType: 'application/json',
        }),
        putBlob(`overstocks/latest.csv`, csv, { contentType: 'text/csv' }),
      ]);
      stored = { csvUrl: csvBlob.url, jsonUrl: jsonBlob.url, latestUrl: latest.url };
    }

    return Response.json({
      ok: true,
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
