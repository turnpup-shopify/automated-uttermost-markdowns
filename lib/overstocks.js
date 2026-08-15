// Single entry point for "get the overstocks data", with a 24h cache in front
// of the (expensive, rate-limit-sensitive) browser scrape.

import { scrapeOverstocks } from './scrape';
import { readCache, writeCache, cacheEnabled, CACHE_TTL_MS } from './cache';

/**
 * @param {{ force?: boolean, debug?: boolean, screenshot?: boolean }} opts
 *   force     - ignore the cache and scrape fresh (then refresh the cache)
 *   debug/screenshot - always scrape fresh (diagnostics), never cached
 * @returns scrape result plus { cached: boolean, cacheAgeMs?: number }
 */
export async function getOverstocks(opts = {}) {
  const { force = false, debug = false, screenshot = false } = opts;
  const bypass = force || debug || screenshot;

  if (!bypass && cacheEnabled()) {
    const cached = await readCache();
    if (cached?.scrapedAt && cached.count > 0) {
      const age = Date.now() - new Date(cached.scrapedAt).getTime();
      if (age < CACHE_TTL_MS) {
        return { ...cached, cached: true, cacheAgeMs: age };
      }
    }
  }

  const result = await scrapeOverstocks({ debug, screenshot });

  // Only cache real, non-diagnostic results that actually found products.
  if (result.count > 0 && !debug && !screenshot) {
    try {
      await writeCache({
        products: result.products,
        count: result.count,
        withPrice: result.withPrice,
        scrapedAt: result.scrapedAt,
      });
    } catch {
      /* caching is best-effort */
    }
  }

  return { ...result, cached: false };
}
