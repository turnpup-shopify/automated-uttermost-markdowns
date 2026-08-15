// The promotions we scrape. Both pages are formatted identically, so they share
// all scrape/extraction logic — only the target URL (and cache key) differ.

export const SOURCES = {
  overstocks: {
    key: 'overstocks',
    label: 'Overstocks',
    url: 'https://uttermost.com/promotions/overstocks',
    envKey: 'UTTERMOST_OVERSTOCKS_URL',
  },
  quarterly: {
    key: 'quarterly',
    label: 'Quarterly',
    url: 'https://uttermost.com/promotions/quarterly',
    envKey: 'UTTERMOST_QUARTERLY_URL',
  },
};

export const DEFAULT_SOURCE = 'overstocks';

/** Normalize an arbitrary string to a known source key. */
export function resolveSource(s) {
  return s && SOURCES[s] ? s : DEFAULT_SOURCE;
}

/** The overstocks/quarterly page URL, overridable per-source via env. */
export function sourceUrl(s) {
  const src = SOURCES[resolveSource(s)];
  return process.env[src.envKey] || src.url;
}

export function sourceLabel(s) {
  return SOURCES[resolveSource(s)].label;
}
