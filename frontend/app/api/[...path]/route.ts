import { proxyApi } from '../../../lib/api-proxy';
export const dynamic = 'force-dynamic';

async function proxy(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const development = process.env.NODE_ENV === 'development';
  return proxyApi(request, path, {
    baseUrl: process.env.BG_API_INTERNAL_URL || (development ? 'http://127.0.0.1:8000' : undefined),
    allowLocal: development,
  });
}
export { proxy as GET, proxy as POST };
