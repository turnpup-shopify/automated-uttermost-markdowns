import { getOverstocks } from '../../../lib/overstocks';
import { syncPricesToShopify } from '../../../lib/shopify';
import { isAuthorized } from '../../../lib/auth';
import { writeLog, blobConfigured } from '../../../lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/shopify            -> scrape fresh, then DRY-RUN a Shopify price sync
// POST /api/shopify?apply=1    -> actually write prices (overrides SHOPIFY_DRY_RUN)
// Body { products: [{sku, price, compareAtPrice}, ...] } -> sync that exact list
//   instead of scraping (matches the example payload format).
// Protected by CRON_SECRET (Bearer header or ?token=). Each run is logged to
// the 7-day persistent log (viewable at /logs).
export async function POST(request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const apply = url.searchParams.get('apply') === '1';
  // Test mode: only sync the FIRST row that has a price — a safe end-to-end check.
  const test = url.searchParams.get('test') === '1';

  try {
    let products;
    let source;
    const body = await request.json().catch(() => null);
    if (body?.products?.length) {
      products = body.products;
      source = 'payload';
    } else {
      const scraped = await getOverstocks(); // uses the 24h cache
      products = scraped.products;
      source = scraped.cached ? 'scrape-cache' : 'scrape';
    }

    if (test) {
      const first = products.find((p) => p.price && String(p.price).trim());
      products = first ? [first] : [];
      source = `${source}:test-first-row`;
    }

    const result = await syncPricesToShopify(products, {
      dryRun: apply ? false : undefined, // undefined => honor SHOPIFY_DRY_RUN
    });

    // Persist a log entry (best-effort — never fail the sync over logging).
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      mode: result.dryRun ? 'dry-run' : 'apply',
      test,
      source,
      inputCount: products.length,
      markup: result.markup,
      summary: {
        updated: result.updated,
        unchanged: result.unchanged,
        noMatch: result.noMatch,
        failed: result.failed,
        noPrice: result.noPrice,
      },
      changes: result.changes,
      skippedNoPrice: result.skippedNoPrice,
    };
    let logUrl = null;
    try {
      logUrl = await writeLog(entry);
    } catch (err) {
      console.error('[api/shopify] log write failed:', err);
    }

    return Response.json(
      {
        ...result,
        test,
        source,
        timestamp,
        logged: !!logUrl,
        logNote: blobConfigured()
          ? 'Run recorded in the 7-day log (see /logs).'
          : 'No Blob store connected — this run was NOT logged. Connect a Blob store to persist logs.',
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[api/shopify] failed:', err);
    return Response.json({ error: err?.message || 'Sync failed' }, { status: 500 });
  }
}
