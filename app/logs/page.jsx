'use client';

import { useEffect, useState } from 'react';

const STATUS_COLORS = {
  updated: '#22c55e',
  'would-update': '#3b82f6',
  unchanged: '#6b7075',
  'no-shopify-match': '#f59e0b',
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
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '48px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 26, margin: 0 }}>Shopify price-sync log</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <a href="/" style={link}>← Home</a>
          <button onClick={load} style={smallBtn}>Refresh</button>
        </div>
      </div>
      <p style={{ color: '#9aa0a6', lineHeight: 1.6 }}>
        Every price sync (successful and failed) is recorded here and kept for{' '}
        <strong>7 days</strong>. Prices shown are the Shopify values after markup.
      </p>

      {loading && <p style={{ color: '#9aa0a6' }}>Loading…</p>}
      {error && <p style={{ color: '#ff6b6b' }}>Error: {error}</p>}

      {data && !data.configured && (
        <div style={notice}>
          No Vercel Blob store is connected, so runs aren’t being persisted. In Vercel:
          <strong> Storage → Create → Blob</strong>, connect it to this project, and redeploy.
          {Array.isArray(data.blobEnvVarsSeen) && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#b7a86a' }}>
              Blob env vars seen: {data.blobEnvVarsSeen.length ? data.blobEnvVarsSeen.join(', ') : '(none)'}
            </div>
          )}
        </div>
      )}

      {data && data.configured && data.count === 0 && (
        <p style={{ color: '#9aa0a6' }}>No sync runs in the last 7 days yet.</p>
      )}

      {data?.logs?.map((run, i) => (
        <RunCard key={run.timestamp + i} run={run} />
      ))}
    </main>
  );
}

function RunCard({ run }) {
  const [showSkipped, setShowSkipped] = useState(false);
  const skipped = run.skippedNoPrice || [];
  const rows = (run.changes || [])
    .slice()
    .sort((a, b) => rank(a.status) - rank(b.status));

  return (
    <section style={card}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 15 }}>{new Date(run.timestamp).toLocaleString()}</strong>
        <span style={badge(run.mode === 'apply' ? '#22c55e' : '#3b82f6')}>
          {run.mode === 'apply' ? 'APPLIED' : 'DRY RUN'}
        </span>
        <span style={{ color: '#6b7075', fontSize: 13 }}>source: {run.source}</span>
        {run.markup != null && (
          <span style={{ color: '#6b7075', fontSize: 13 }}>markup: {run.markup}×</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '10px 0', fontSize: 13 }}>
        <span style={{ color: '#22c55e' }}>✓ {run.summary.updated} {run.mode === 'apply' ? 'updated' : 'would update'}</span>
        <span style={{ color: '#6b7075' }}>= {run.summary.unchanged} unchanged</span>
        <span style={{ color: '#f59e0b' }}>⚠ {run.summary.noMatch ?? 0} no SKU match</span>
        <span style={{ color: '#ff6b6b' }}>✕ {run.summary.failed} failed</span>
        <span style={{ color: '#9aa0a6' }}>⊘ {run.summary.noPrice ?? skipped.length} skipped (no price)</span>
      </div>

      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                {['SKU', 'Product', 'Status', 'Price', 'Compare-at'].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c, j) => (
                <tr key={c.sku + j}>
                  <td style={td}>{c.sku}</td>
                  <td style={{ ...td, color: '#9aa0a6', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.product || '—'}</td>
                  <td style={{ ...td, color: STATUS_COLORS[c.status] || '#e8eaed' }}>
                    {c.status}{c.error ? `: ${c.error}` : ''}
                  </td>
                  <td style={td}>{arrow(c.from?.price, c.to?.price)}</td>
                  <td style={td}>{arrow(c.from?.compareAtPrice, c.to?.compareAtPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {skipped.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button onClick={() => setShowSkipped((s) => !s)} style={collapseBtn}>
            {showSkipped ? '▼' : '▶'} Skipped — no price ({skipped.length})
          </button>
          {showSkipped && (
            <div style={{ marginTop: 8, color: '#9aa0a6', fontSize: 13, lineHeight: 1.8 }}>
              These SKUs had no scraped price and were left off the upload:
              <div style={{ marginTop: 4, fontFamily: 'ui-monospace, monospace', color: '#c9cdd2' }}>
                {skipped.map((s) => s.sku).join(', ')}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// Render "before → after" for a money field. Bolds the "after" when it changed.
function arrow(before, after) {
  const b = money(before);
  const a = money(after);
  if (!before && !after) return '—';
  if (!before) return <strong>{a}</strong>;
  if (before === after) return <span style={{ color: '#6b7075' }}>{a}</span>;
  return (
    <span>
      <span style={{ color: '#9aa0a6' }}>{b}</span>
      <span style={{ color: '#6b7075' }}> → </span>
      <strong style={{ color: '#e8eaed' }}>{a}</strong>
    </span>
  );
}
function money(v) {
  if (v == null || v === '') return '—';
  return `$${v}`;
}
function rank(status) {
  const order = ['updated', 'would-update', 'update-failed', 'lookup-failed', 'no-shopify-match', 'unchanged'];
  const i = order.indexOf(status);
  return i === -1 ? 99 : i;
}

const link = { color: '#3b82f6', textDecoration: 'none', fontSize: 14, alignSelf: 'center' };
const smallBtn = { background: '#3b82f6', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14 };
const collapseBtn = { background: 'transparent', color: '#9aa0a6', border: '1px solid #333', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 };
const card = { border: '1px solid #222', borderRadius: 10, padding: 16, margin: '16px 0', background: '#0f1115' };
const badge = (c) => ({ background: c, color: '#03130a', fontWeight: 700, fontSize: 11, padding: '2px 8px', borderRadius: 999 });
const notice = { border: '1px solid #3a3320', background: '#1a1710', color: '#e8d9a0', padding: 14, borderRadius: 8, lineHeight: 1.6 };
const th = { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #333', color: '#9aa0a6', fontWeight: 600, whiteSpace: 'nowrap' };
const td = { padding: '6px 10px', borderBottom: '1px solid #1c1f24', whiteSpace: 'nowrap' };
