import { scrapeOverstocks } from '../../../lib/scrape';
import { toCsv } from '../../../lib/csv';
import { isAuthorized } from '../../../lib/auth';

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
    const result = await scrapeOverstocks();
    const csv = toCsv(result.products);
    const stamp = result.scrapedAt.replace(/[:.]/g, '-');

    let stored = null;
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { put } = await import('@vercel/blob');
      const [csvBlob, jsonBlob] = await Promise.all([
        put(`overstocks/${stamp}.csv`, csv, {
          access: 'public',
          contentType: 'text/csv',
          addRandomSuffix: false,
        }),
        put(
          `overstocks/${stamp}.json`,
          JSON.stringify({ ...result, logs: undefined }, null, 2),
          { access: 'public', contentType: 'application/json', addRandomSuffix: false }
        ),
      ]);
      // Also overwrite a stable "latest" pointer for easy consumption.
      const latest = await put(`overstocks/latest.csv`, csv, {
        access: 'public',
        contentType: 'text/csv',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
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
