// Single entry point for "get a promotion's data", with a 24h per-source cache
// in front of the (expensive, rate-limit-sensitive) browser scrape.

import { scrapeOverstocks } from './scrape';
import { readCache, writeCache, cacheEnabled, CACHE_TTL_MS } from './cache';
import { resolveSource, sourceUrl, sourcePagination } from './sources';

/**
 * @param {string} source - 'overstocks' | 'quarterly'
 * @param {{ force?: boolean, debug?: boolean, screenshot?: boolean }} opts
 * @returns scrape result plus { source, cached, cacheAgeMs? }
 */
export async function getPromotion(source, opts = {}) {
  const src = resolveSource(source);
  const { force = false, debug = false, screenshot = false } = opts;
  const bypass = force || debug || screenshot;

  if (!bypass && cacheEnabled()) {
    const cached = await readCache(src);
    if (cached?.scrapedAt && cached.count > 0) {
      const age = Date.now() - new Date(cached.scrapedAt).getTime();
      if (age < CACHE_TTL_MS) {
        return { ...cached, source: src, cached: true, cacheAgeMs: age };
      }
    }
  }

  const { paginate, maxPages } = sourcePagination(src);
  const result = await scrapeOverstocks({
    url: sourceUrl(src),
    debug,
    screenshot,
    paginate,
    maxPages,
  });

  let cacheWriteError;
  let cacheWritten = false;
  if (result.count > 0 && !debug && !screenshot) {
    if (!cacheEnabled()) {
      cacheWriteError = 'no-blob-token';
    } else {
      try {
        await writeCache(src, {
          products: result.products,
          count: result.count,
          withPrice: result.withPrice,
          scrapedAt: result.scrapedAt,
        });
        cacheWritten = true;
      } catch (e) {
        cacheWriteError = String(e);
      }
    }
  }

  return { ...result, source: src, cached: false, cacheWritten, ...(cacheWriteError ? { cacheWriteError } : {}) };
}

// Back-compat alias (defaults to overstocks).
export async function getOverstocks(opts = {}) {
  return getPromotion('overstocks', opts);
}
