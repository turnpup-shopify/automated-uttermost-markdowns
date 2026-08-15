'use client';

import { useState } from 'react';

export default function Home() {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);

  // Shared CRON_SECRET (used for clear-cache and Shopify sync).
  const [token, setToken] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testStatus, setTestStatus] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [cacheMsg, setCacheMsg] = useState('');

  const priced = rows.filter((r) => r.price);
  const skipped = rows.filter((r) => !r.price);

  async function clearCache() {
    setCacheMsg('Clearing cache…');
    try {
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      const res = await fetch(`/api/cache${qs}`, { method: 'POST' });
      const data = await res.json();
      if (res.status === 401) {
        setCacheMsg('Unauthorized — enter your CRON_SECRET above, then try again.');
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Clear failed');
      setCacheMsg(data.note || (data.cleared ? 'Cache cleared.' : 'Cache was empty.'));
    } catch (err) {
      setCacheMsg(`Error: ${err.message}`);
    }
  }

  async function testSync(apply) {
    setTestBusy(true);
    setTestResult(null);
    setTestStatus(apply ? 'Applying first row to Shopify…' : 'Dry-running first row…');
    try {
      const qs = new URLSearchParams({ test: '1' });
      if (apply) qs.set('apply', '1');
      if (token) qs.set('token', token);
      const res = await fetch(`/api/shopify?${qs.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: rows }),
      });
      const data = await res.json();
      if (res.status === 401) {
        throw new Error('Unauthorized — enter your CRON_SECRET in the field above and retry.');
      }
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setTestResult(data);
      const c = data.changes?.[0];
      setTestStatus(
        c
          ? `${apply ? 'Applied' : 'Dry run'}: ${c.sku} — ${c.status}. Recorded in /logs.`
          : `${apply ? 'Applied' : 'Dry run'}: nothing to sync (no priced row).`
      );
    } catch (err) {
      setTestStatus(`Error: ${err.message}`);
    } finally {
      setTestBusy(false);
    }
  }

  async function runScrape(fresh = false) {
    setBusy(true);
    setCacheMsg('');
    setStatus(
      fresh
        ? 'Bypassing cache — logging in and scraping fresh… (20–60s)'
        : 'Loading… (served from the 24h cache when available)'
    );
    setRows([]);
    try {
      const res = await fetch(`/api/scrape${fresh ? '?fresh=1' : ''}`);
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
      const cacheTag = data.cached
        ? ` · from 24h cache, ${cacheAge(data.cacheAgeMs)} old`
        : ' · freshly scraped';
      setStatus(
        `Done — ${data.count} products${priced} as of ${new Date(data.scrapedAt).toLocaleString()}${cacheTag}.`
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

      <p style={{ color: '#6b7075', fontSize: 13, marginTop: -6 }}>
        Results are cached for 24 hours to avoid over-hitting the site. Use
        “Scrape fresh” or “Clear cache” to force a new pull.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '20px 0 6px' }}>
        <button onClick={() => runScrape(false)} disabled={busy} style={btn(busy)}>
          {busy ? 'Working…' : 'Scrape & preview'}
        </button>
        <button onClick={() => runScrape(true)} disabled={busy} style={ghostBtn(busy)}>
          Scrape fresh
        </button>
        <a href="/api/csv" style={{ ...btn(false), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
          Download CSV
        </a>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '6px 0 20px' }}>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="CRON_SECRET (for clear-cache & sync)"
          style={input}
        />
        <button onClick={clearCache} disabled={busy} style={ghostBtn(busy)}>
          Clear cache
        </button>
        {cacheMsg && (
          <span style={{ color: cacheMsg.startsWith('Error') || cacheMsg.startsWith('Unauthorized') ? '#ff6b6b' : '#9aa0a6', fontSize: 13 }}>
            {cacheMsg}
          </span>
        )}
      </div>

      {status && (
        <p style={{ color: status.startsWith('Error') ? '#ff6b6b' : '#9aa0a6' }}>{status}</p>
      )}

      {priced.length > 0 && (
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
              {priced.map((r, i) => (
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

      {priced.length > 0 && (
        <div style={testPanel}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>🧪 Test mode — sync first row to Shopify</div>
          <p style={{ color: '#9aa0a6', fontSize: 13, margin: '0 0 12px', lineHeight: 1.6 }}>
            Syncs only <code>{priced[0].sku}</code> (the first priced row) so you can verify the
            Shopify connection and the 2.4× markup before running the full list. Requires the
            Shopify env vars set, and your <code>CRON_SECRET</code> in the field above. Result is
            recorded in <a href="/logs" style={linkInline}>/logs</a>.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => testSync(false)} disabled={testBusy} style={ghostBtn(testBusy)}>
              {testBusy ? 'Working…' : 'Dry-run first row'}
            </button>
            <button onClick={() => testSync(true)} disabled={testBusy} style={dangerBtn(testBusy)}>
              {testBusy ? 'Working…' : 'Apply first row (writes!)'}
            </button>
          </div>
          {testStatus && (
            <p style={{ color: testStatus.startsWith('Error') ? '#ff6b6b' : '#9aa0a6', marginTop: 10, fontSize: 13 }}>
              {testStatus}
            </p>
          )}
          {testResult?.changes?.[0] && (
            <table style={{ borderCollapse: 'collapse', marginTop: 8, fontSize: 13 }}>
              <tbody>
                {(() => {
                  const c = testResult.changes[0];
                  return (
                    <>
                      <tr><td style={rk}>SKU</td><td style={rv}>{c.sku}</td></tr>
                      <tr><td style={rk}>Product</td><td style={rv}>{c.product || '—'}</td></tr>
                      <tr><td style={rk}>Status</td><td style={rv}>{c.status}{c.error ? `: ${c.error}` : ''}</td></tr>
                      <tr><td style={rk}>Price</td><td style={rv}>{c.from?.price ? `$${c.from.price} → ` : ''}<strong>${c.to?.price}</strong></td></tr>
                      <tr><td style={rk}>Compare-at</td><td style={rv}>{c.from?.compareAtPrice ? `$${c.from.compareAtPrice} → ` : ''}<strong>{c.to?.compareAtPrice ? `$${c.to.compareAtPrice}` : '—'}</strong></td></tr>
                    </>
                  );
                })()}
              </tbody>
            </table>
          )}
        </div>
      )}

      {skipped.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <button
            onClick={() => setShowSkipped((s) => !s)}
            style={{
              background: 'transparent', color: '#9aa0a6', border: '1px solid #333',
              padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
            }}
          >
            {showSkipped ? '▼' : '▶'} Skipped — no price ({skipped.length})
          </button>
          {showSkipped && (
            <div style={{ marginTop: 8, color: '#9aa0a6', fontSize: 13, lineHeight: 1.8 }}>
              These SKUs had no price on the overstocks page and are left off the upload:
              <div style={{ marginTop: 4, fontFamily: 'ui-monospace, monospace', color: '#c9cdd2' }}>
                {skipped.map((r) => r.sku).join(', ')}
              </div>
            </div>
          )}
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
function cacheAge(ms) {
  if (ms == null) return '';
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))}m`;
  return `${h.toFixed(1)}h`;
}
const testPanel = { marginTop: 24, border: '1px solid #2a2f45', background: '#0e1220', borderRadius: 10, padding: 16 };
const linkInline = { color: '#3b82f6', textDecoration: 'none' };
const input = { background: '#0b0c0f', color: '#e8eaed', border: '1px solid #333', borderRadius: 6, padding: '8px 10px', fontSize: 13, minWidth: 180 };
const ghostBtn = (d) => ({ background: 'transparent', color: '#e8eaed', border: '1px solid #3b82f6', padding: '8px 14px', borderRadius: 6, cursor: d ? 'default' : 'pointer', fontSize: 13 });
const dangerBtn = (d) => ({ background: d ? '#5a2230' : '#e0335a', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: d ? 'default' : 'pointer', fontSize: 13 });
const rk = { padding: '3px 10px 3px 0', color: '#6b7075', whiteSpace: 'nowrap', verticalAlign: 'top' };
const rv = { padding: '3px 0', color: '#e8eaed' };
