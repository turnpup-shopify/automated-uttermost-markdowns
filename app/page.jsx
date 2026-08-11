'use client';

import { useState } from 'react';

export default function Home() {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  async function runScrape() {
    setBusy(true);
    setStatus('Logging in and scraping… this can take 20–60 seconds.');
    setRows([]);
    try {
      const res = await fetch('/api/scrape');
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        // Not JSON — usually a Vercel platform page (e.g. a function timeout).
        const hint = /timeout|timed out|FUNCTION_INVOCATION_TIMEOUT/i.test(text)
          ? 'The scrape function timed out. Try again (cold starts are slower), or set BROWSER_WS_ENDPOINT for a faster hosted browser.'
          : `Server returned a non-JSON response (${res.status}). First bytes: ${text.slice(0, 120)}`;
        throw new Error(hint);
      }
      if (!res.ok) throw new Error(data.error || 'Scrape failed');
      setRows(data.products || []);
      const priced = typeof data.withPrice === 'number' ? ` (${data.withPrice} with a price)` : '';
      setStatus(
        `Done — ${data.count} products${priced} as of ${new Date(data.scrapedAt).toLocaleString()}.`
      );
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '48px 20px' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Uttermost Overstocks Scraper</h1>
      <p style={{ color: '#9aa0a6', marginTop: 0, lineHeight: 1.6 }}>
        Logs into uttermost.com, opens the overstocks page, and pulls the latest
        markdown prices (SKU, price, compare-at price).
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '24px 0' }}>
        <button onClick={runScrape} disabled={busy} style={btn(busy)}>
          {busy ? 'Working…' : 'Scrape & preview'}
        </button>
        <a href="/api/csv" style={{ ...btn(false), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
          Download CSV
        </a>
      </div>

      {status && (
        <p style={{ color: status.startsWith('Error') ? '#ff6b6b' : '#9aa0a6' }}>{status}</p>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 16 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
            <thead>
              <tr>
                {['SKU', 'Price', 'Compare At'].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.sku + i}>
                  <td style={td}>{r.sku}</td>
                  <td style={td}>{r.price ? `$${r.price}` : '—'}</td>
                  <td style={{ ...td, color: '#9aa0a6', textDecoration: r.compareAtPrice ? 'line-through' : 'none' }}>
                    {r.compareAtPrice ? `$${r.compareAtPrice}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <hr style={{ border: 'none', borderTop: '1px solid #222', margin: '40px 0 20px' }} />
      <p style={{ marginBottom: 12 }}>
        <a href="/logs" style={{ color: '#3b82f6', textDecoration: 'none' }}>
          → View Shopify price-sync log (last 7 days)
        </a>
      </p>
      <p style={{ color: '#6b7075', fontSize: 13, lineHeight: 1.6 }}>
        Endpoints: <code>/api/scrape</code> (JSON), <code>/api/csv</code> (download),
        <code> /api/cron</code> (scheduled snapshot), <code>/api/shopify</code> (price sync),
        <code> /api/logs</code> (sync log). Add <code>?debug=1</code> to{' '}
        <code>/api/scrape</code> if login needs tuning.
      </p>
    </main>
  );
}

const btn = (disabled) => ({
  background: disabled ? '#2a2d33' : '#3b82f6',
  color: '#fff',
  border: 'none',
  padding: '12px 20px',
  borderRadius: 8,
  fontSize: 15,
  cursor: disabled ? 'default' : 'pointer',
});
const th = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '1px solid #333',
  color: '#9aa0a6',
  fontWeight: 600,
};
const td = { padding: '8px 12px', borderBottom: '1px solid #1c1f24' };
