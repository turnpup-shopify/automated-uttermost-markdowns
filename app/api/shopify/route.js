import { scrapeOverstocks } from '../../../lib/scrape';
import { syncPricesToShopify } from '../../../lib/shopify';
import { isAuthorized } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/shopify            -> scrape, then DRY-RUN a Shopify price sync
// POST /api/shopify?apply=1    -> actually write prices (also needs SHOPIFY_DRY_RUN=false OR ?apply=1)
// Protected by CRON_SECRET (Bearer header or ?token=).
//
// You can also POST a JSON body { products: [...] } to sync a specific list
// instead of scraping fresh.
export async function POST(request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const apply = url.searchParams.get('apply') === '1';

  try {
    let products;
    const body = await request.json().catch(() => null);
    if (body?.products?.length) {
      products = body.products;
    } else {
      const scraped = await scrapeOverstocks();
      products = scraped.products;
    }

    const result = await syncPricesToShopify(products, {
      dryRun: apply ? false : undefined, // undefined => honor SHOPIFY_DRY_RUN
    });

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[api/shopify] failed:', err);
    return Response.json({ error: err?.message || 'Sync failed' }, { status: 500 });
  }
}
