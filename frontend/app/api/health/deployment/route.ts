import { proxyApi } from '../../../../lib/api-proxy';

export const dynamic = 'force-dynamic';

function report(configured: boolean, connectivity: 'setup_required' | 'unhealthy' | 'ok', backend: string | null, status: number) {
  return Response.json({
    portal: 'ok',
    backend_configured: configured,
    backend_connectivity: connectivity,
    backend,
    mode: 'SANDBOX',
    production_enabled: false,
  }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  const baseUrl = process.env.BG_API_INTERNAL_URL?.trim();
  if (!baseUrl) return report(false, 'setup_required', null, 503);

  // A deployed UI alone must never be mistaken for a healthy transaction backend.
  const upstream = await proxyApi(request, ['health'], { baseUrl });
  if (!upstream.ok) return report(true, 'unhealthy', null, 503);

  try {
    const health = await upstream.json();
    const healthy = health?.status === 'ok'
      && health?.mode === 'SANDBOX'
      && health?.production_enabled === false
      && health?.backend === 'durable-object-sqlite'
      && health?.persistent === true;
    return report(true, healthy ? 'ok' : 'unhealthy', healthy ? health.backend : null, healthy ? 200 : 503);
  } catch {
    return report(true, 'unhealthy', null, 503);
  }
}
