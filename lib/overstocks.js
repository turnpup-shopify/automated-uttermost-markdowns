// Single entry point for "get a promotion's data", with a 24h per-source cache
// in front of the (expensive, rate-limit-sensitive) browser scrape. Paginated
// sources (quarterly) resume across runs: an incomplete run flags where to
// continue, and the next run picks up from that page.

import { scrapeOverstocks } from './scrape';
import { readCache, writeCache, cacheEnabled, CACHE_TTL_MS } from './cache';
import { resolveSource, sourceUrl, sourcePagination } from './sources';

/**
 * @param {string} source - 'overstocks' | 'quarterly'
 * @param {{ force?: boolean, debug?: boolean, screenshot?: boolean }} opts
 *   force runs a scrape (resuming an incomplete paginated cache, else a fresh
 *   pass); without force, a fresh/complete cache is served as-is.
 * @returns scrape result plus { source, cached, cacheAgeMs?, complete, nextPage }
 */
export async function getPromotion(source, opts = {}) {
  const src = resolveSource(source);
  const { force = false, debug = false, screenshot = false } = opts;
  const bypass = force || debug || screenshot;
  const { paginate, maxPages } = sourcePagination(src);

  // Serve from cache on plain views (no force): a complete+fresh cache, or a
  // partial cache (so you can see progress) — flagged via `complete`.
  if (!bypass && cacheEnabled()) {
    const cached = await readCache(src);
    if (cached?.scrapedAt && cached.count > 0) {
      const age = Date.now() - new Date(cached.scrapedAt).getTime();
      const isComplete = cached.complete !== false;
      if ((isComplete && age < CACHE_TTL_MS) || !isComplete) {
        return { ...cached, source: src, cached: true, cacheAgeMs: age };
      }
      // complete but stale -> fall through and scrape a fresh pass
    }
  }

  // Determine resume state for a scrape run: continue an incomplete paginated
  // cache from its nextPage, otherwise start a fresh pass at page 1.
  let startPage = 1;
  let seedProducts = [];
  if (paginate && cacheEnabled() && !debug && !screenshot) {
    const cached = await readCache(src);
    if (cached && cached.complete === false && Number(cached.nextPage) > 1) {
      startPage = Number(cached.nextPage);
      seedProducts = Array.isArray(cached.products) ? cached.products : [];
      if (startPage > maxPages) {
        startPage = 1; // resumed past the cap -> start over
        seedProducts = [];
      }
    }
  }

  const result = await scrapeOverstocks({
    url: sourceUrl(src),
    debug,
    screenshot,
    paginate,
    maxPages,
    startPage,
    seedProducts,
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
          complete: result.complete,
          nextPage: result.nextPage,
          pagesCovered: result.pagesCovered,
        });
        cacheWritten = true;
      } catch (e) {
        cacheWriteError = String(e);
      }
    }
  }

  return {
    ...result,
    source: src,
    cached: false,
    cacheWritten,
    ...(cacheWriteError ? { cacheWriteError } : {}),
  };
}

// Back-compat alias (defaults to overstocks).
export async function getOverstocks(opts = {}) {
  return getPromotion('overstocks', opts);
}
