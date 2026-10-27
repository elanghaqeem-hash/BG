const MAX_BODY_BYTES = 3_000_000;
type ProxyOptions = { baseUrl?: string; allowLocal?: boolean; fetcher?: typeof fetch };

function failure(code: string, detail: string, status: number) {
  return Response.json({ code, detail }, {
    status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
class BodyTooLarge extends Error {}

async function limitedBody(request: Request) {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new BodyTooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

/** Preserve the existing FastAPI session/CSRF protocol in the Workers runtime. */
export async function proxyApi(request: Request, path: string[], options: ProxyOptions = {}) {
  if (!['GET', 'POST'].includes(request.method)) return failure('METHOD', 'Metode tidak didukung.', 405);
  if (!path.length || path.some(segment => !segment || segment === '.' || segment === '..' || /[/\\\u0000-\u001f\u007f]/.test(segment))) {
    return failure('PATH', 'Alamat layanan tidak valid.', 400);
  }
  const incoming = new URL(request.url);
  // Next.js may reconstruct an internal URL behind the OpenNext adapter. The
  // HTTP Host header preserves the browser-facing host and port at this boundary.
  const publicHost = request.headers.get('host') || incoming.host;
  if (request.method === 'POST') {
    const origin = request.headers.get('origin');
    let matchesOrigin = !origin;
    if (origin) {
      try { const parsed = new URL(origin); matchesOrigin = parsed.origin === origin && parsed.host === publicHost; }
      catch { matchesOrigin = false; }
    }
    if (!matchesOrigin || request.headers.get('sec-fetch-site') === 'cross-site') {
      return failure('ORIGIN', 'Asal permintaan tidak diizinkan.', 403);
    }
  }
  if (!options.baseUrl?.trim()) return failure('BACKEND_NOT_CONFIGURED', 'Layanan transaksi belum diaktifkan. Hubungi administrator.', 503);
  let base: URL;
  try {
    base = new URL(options.baseUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (base.username || base.password || base.search || base.hash ||
      (base.protocol !== 'https:' && !(base.protocol === 'http:' && local && options.allowLocal)) ||
      base.origin === incoming.origin || base.host === publicHost) throw new Error('Invalid backend');
  } catch { return failure('BACKEND_CONFIG_INVALID', 'Konfigurasi layanan transaksi perlu diperiksa administrator.', 503); }
  const target = new URL(base.toString().replace(/\/$/, '') + '/' + path.map(encodeURIComponent).join('/') + incoming.search);
  const headers = new Headers();
  for (const name of ['cookie', 'content-type', 'x-csrf-token']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > MAX_BODY_BYTES) return failure('BODY_SIZE', 'Permintaan terlalu besar.', 413);
  try {
    const body = request.method === 'GET' ? undefined : await limitedBody(request);
    const upstream = await (options.fetcher ?? fetch)(target, {
      method: request.method, headers, body, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(30_000),
    });
    // Never send browser session cookies on a redirected request to another host.
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      return failure('UPSTREAM_REDIRECT', 'Alamat layanan transaksi perlu diperiksa administrator.', 502);
    }
    const output = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    for (const name of ['content-type', 'content-disposition', 'x-request-id']) {
      const value = upstream.headers.get(name);
      if (value) output.set(name, value);
    }
    for (const cookie of upstream.headers.getSetCookie()) output.append('set-cookie', cookie);
    return new Response(upstream.body, { status: upstream.status, headers: output });
  } catch (error) {
    if (error instanceof BodyTooLarge) return failure('BODY_SIZE', 'Permintaan terlalu besar.', 413);
    return failure('UPSTREAM', 'Layanan transaksi belum tersedia. Coba lagi setelah koneksi pulih.', 503);
  }
}
