import portal from "../frontend/.open-next/worker.js";
import { sandboxRuntimePermitted } from "./runtime-mode.ts";
export { BankBackend } from "./bank-backend.ts";
export default {
  async fetch(
    request: Request,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    // Fail closed: this MVP is only permitted to serve its SANDBOX runtime.
    // Merely changing an environment variable cannot activate banking production.
    if (!sandboxRuntimePermitted(env.BG_MODE)) {
      return Response.json(
        { code: "RELEASE_BLOCKED", detail: "BG operational runtime is not enabled." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "POST") {
        const origin = request.headers.get("origin");
        if (
          (origin && origin !== url.origin) ||
          request.headers.get("sec-fetch-site") === "cross-site"
        )
          return Response.json(
            { code: "ORIGIN", detail: "Asal permintaan tidak diizinkan." },
            { status: 403, headers: { "Cache-Control": "no-store" } },
          );
      }
      if (url.pathname === "/api/health/deployment") {
        const health = await env.BG_BANK.getByName("bank-uat").fetch(
          new Request(url.origin + "/api/health"),
        );
        return Response.json(
          {
            portal: "ok",
            backend_configured: health.ok,
            backend_connectivity: health.ok ? "ok" : "setup_required",
            backend: "durable-object-sqlite",
            mode: "SANDBOX",
            production_enabled: false,
          },
          {
            status: health.ok ? 200 : 503,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }
      return env.BG_BANK.getByName("bank-uat").fetch(request);
    }
    return portal.fetch(request, env, ctx);
  },
};
