export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({
    portal: 'ok',
    backend_configured: Boolean(process.env.BG_API_INTERNAL_URL?.trim()),
    backend_connectivity: 'not_checked',
    mode: 'SANDBOX',
    production_enabled: false,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
