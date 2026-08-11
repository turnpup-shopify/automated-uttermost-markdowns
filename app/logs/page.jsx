'use client';

import { useEffect, useState } from 'react';

const STATUS_COLORS = {
  updated: '#22c55e',
  'would-update': '#3b82f6',
  unchanged: '#6b7075',
  'no-shopify-match': '#f59e0b',
  'no-price-scraped': '#f59e0b',
  'update-failed': '#ff6b6b',
  'lookup-failed': '#ff6b6b',
};

export default function Logs() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/logs');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load logs');
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '48px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 26, margin: 0 }}>Shopify price-sync log</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <a href="/" style={link}>← Home</a>
          <button onClick={load} style={smallBtn}>Refresh</button>
        </div>
      </div>
      <p style={{ color: '#9aa0a6', lineHeight: 1.6 }}>
        Every Shopify price sync is recorded here and kept for <strong>7 days</strong>.
      </p>

      {loading && <p style={{ color: '#9aa0a6' }}>Loading…</p>}
      {error && <p style={{ color: '#ff6b6b' }}>Error: {error}</p>}

      {data && !data.configured && (
        <div style={notice}>
          No Vercel Blob store is connected, so runs aren’t being persisted. In Vercel:
          <strong> Storage → Create → Blob</strong>, connect it to this project, and redeploy.
        </div>
      )}

      {data && data.configured && data.count === 0 && (
        <p style={{ color: '#9aa0a6' }}>No sync runs in the last 7 days yet.</p>
      )}

      {data?.logs?.map((run, i) => (
        <section key={run.timestamp + i} style={card}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <strong style={{ fontSize: 15 }}>
              {new Date(run.timestamp).toLocaleString()}
            </strong>
            <span style={badge(run.mode === 'apply' ? '#22c55e' : '#3b82f6')}>
              {run.mode === 'apply' ? 'APPLIED' : 'DRY RUN'}
            </span>
            <span style={{ color: '#6b7075', fontSize: 13 }}>source: {run.source}</span>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '10px 0', fontSize: 13 }}>
            <span style={{ color: '#22c55e' }}>✓ {run.summary.updated} {run.mode === 'apply' ? 'updated' : 'would update'}</span>
            <span style={{ color: '#6b7075' }}>= {run.summary.unchanged} unchanged</span>
            <span style={{ color: '#f59e0b' }}>⚠ {run.summary.skippedNoMatch} skipped</span>
            <span style={{ color: '#ff6b6b' }}>✕ {run.summary.failed} failed</span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  {['SKU', 'Product', 'Status', 'From', 'To'].map((h) => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(run.changes || [])
                  .slice()
                  .sort((a, b) => rank(a.status) - rank(b.status))
                  .map((c, j) => (
                    <tr key={c.sku + j}>
                      <td style={td}>{c.sku}</td>
                      <td style={{ ...td, color: '#9aa0a6' }}>{c.product || '—'}</td>
                      <td style={{ ...td, color: STATUS_COLORS[c.status] || '#e8eaed' }}>
                        {c.status}{c.error ? `: ${c.error}` : ''}
                      </td>
                      <td style={td}>{fmt(c.from)}</td>
                      <td style={td}>{fmt(c.to)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </main>
  );
}

function fmt(p) {
  if (!p || (!p.price && !p.compareAtPrice)) return '—';
  const price = p.price ? `$${p.price}` : '—';
  const cmp = p.compareAtPrice ? ` (was $${p.compareAtPrice})` : '';
  return price + cmp;
}
function rank(status) {
  const order = ['updated', 'would-update', 'update-failed', 'lookup-failed', 'no-shopify-match', 'no-price-scraped', 'unchanged'];
  const i = order.indexOf(status);
  return i === -1 ? 99 : i;
}

const link = { color: '#3b82f6', textDecoration: 'none', fontSize: 14, alignSelf: 'center' };
const smallBtn = { background: '#3b82f6', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14 };
const card = { border: '1px solid #222', borderRadius: 10, padding: 16, margin: '16px 0', background: '#0f1115' };
const badge = (c) => ({ background: c, color: '#03130a', fontWeight: 700, fontSize: 11, padding: '2px 8px', borderRadius: 999 });
const notice = { border: '1px solid #3a3320', background: '#1a1710', color: '#e8d9a0', padding: 14, borderRadius: 8, lineHeight: 1.6 };
const th = { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #333', color: '#9aa0a6', fontWeight: 600, whiteSpace: 'nowrap' };
const td = { padding: '6px 10px', borderBottom: '1px solid #1c1f24', whiteSpace: 'nowrap' };
