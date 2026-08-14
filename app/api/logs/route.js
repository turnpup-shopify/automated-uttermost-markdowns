import { readLogs, blobConfigured, blobEnvHint } from '../../../lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/logs -> the last 7 days of Shopify price-sync runs (newest first).
export async function GET() {
  try {
    const configured = blobConfigured();
    const logs = configured ? await readLogs() : [];
    return Response.json(
      {
        configured,
        count: logs.length,
        // Diagnostic (names only, never values) to explain configured:false.
        ...(configured ? {} : { blobEnvVarsSeen: blobEnvHint() }),
        logs,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[api/logs] failed:', err);
    return Response.json({ error: err?.message || 'Failed to read logs' }, { status: 500 });
  }
}
