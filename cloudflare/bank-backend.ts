import { DurableObject } from "cloudflare:workers";
import {
  initializeSchema,
  Store,
  DomainError,
  requireValue as req,
  hash,
  canonical,
  type Data,
  type Database,
} from "./core.ts";
import { bootstrap } from "./bootstrap.ts";
import { Service } from "./service.ts";
import { route, json, qr, type Input } from "./router.ts";

export class BankBackend extends DurableObject<CloudflareEnv> {
  private db: Database;
  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    this.db = {
      all: (sql, ...values) =>
        this.ctx.storage.sql.exec(sql, ...values).toArray(),
      run: (sql, ...values) => {
        this.ctx.storage.sql.exec(sql, ...values);
      },
    };
    // One object owns a bank tenant's limits, numbering, decisions and audit head.
    // Constructor schema work is synchronous; ordinary requests use transactions.
    initializeSchema(this.db);
  }
  private initialize() {
    req(
      this.env.BG_MODE === "SANDBOX",
      "MODE",
      "Backend ini hanya untuk sandbox",
      503,
    );
    this.ctx.storage.transactionSync(() =>
      bootstrap(
        new Store(this.db),
        this.env.BG_INITIAL_USERS,
        this.env.BG_ENCRYPTION_KEY,
      ),
    );
  }
  private limit(key: string, maximum: number) {
    const minute = Math.floor(Date.now() / 60000);
    const count = this.ctx.storage.transactionSync(() => {
      this.db.run("DELETE FROM request_limits WHERE minute<?", minute - 1);
      this.db.run(
        "INSERT INTO request_limits(key,minute,count) VALUES (?,?,1) ON CONFLICT(key,minute) DO UPDATE SET count=count+1",
        hash(key),
        minute,
      );
      return this.db.all(
        "SELECT count FROM request_limits WHERE key=? AND minute=?",
        hash(key),
        minute,
      )[0].count;
    });
    req(
      count <= maximum,
      "RATE_LIMIT",
      "Terlalu banyak permintaan; coba lagi nanti",
      429,
    );
  }
  async fetch(request: Request): Promise<Response> {
    try {
      this.initialize();
      const url = new URL(request.url),
        path = url.pathname
          .replace(/^\/api\//, "")
          .split("/")
          .map(decodeURIComponent);
      req(
        path.every(
          (p) =>
            p && p !== "." && p !== ".." && !/[/\\\u0000-\u001f\u007f]/.test(p),
        ),
        "PATH",
        "Alamat layanan tidak valid",
        400,
      );
      req(
        ["GET", "POST"].includes(request.method),
        "METHOD",
        "Metode tidak didukung",
        405,
      );
      if (
        (path[0] === "auth" && ["login", "password"].includes(path[1])) ||
        path[0] === "public"
      )
        this.limit(
          (request.headers.get("CF-Connecting-IP") || "unknown") +
            ":" +
            path[0],
          path[0] === "public" ? 60 : 30,
        );
      let body: Data = {};
      if (request.method === "POST") {
        req(
          Number(request.headers.get("content-length") || "0") <= 3000000,
          "SIZE",
          "Permintaan terlalu besar",
          413,
        );
        const reader = request.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader) {
          try {
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              size += part.value.byteLength;
              if (size > 3000000) {
                await reader.cancel();
                throw new DomainError("SIZE", "Permintaan terlalu besar", 413);
              }
              chunks.push(part.value);
            }
          } finally {
            reader.releaseLock();
          }
        }
        try {
          body = size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
        } catch {
          throw new DomainError("PAYLOAD", "JSON tidak valid", 422);
        }
        req(
          body && typeof body === "object" && !Array.isArray(body),
          "PAYLOAD",
          "Data harus berbentuk objek",
        );
      }
      if (path.join("/") === "auth/login")
        this.limit("username:" + String(body.username || ""), 15);
      if (path[0] === "public" && path[1] === "qr" && path.length === 3) {
        req(path[2].length <= 200, "TOKEN", "Token terlalu panjang");
        const s = new Store(this.db);
        const service = new Service(s, this.env.BG_ENCRYPTION_KEY);
        req(
          service.verify(path[2]).authentic,
          "NOT_FOUND",
          "BG tidak ditemukan",
          404,
        );
        const image = await qr(url.origin + "/verify/" + path[2]);
        return new Response(image, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      const input: Input = {
        method: request.method,
        path,
        body,
        cookie: request.headers.get("cookie") || "",
        csrf: request.headers.get("x-csrf-token") || "",
        secure: url.protocol === "https:",
      };
      return await this.ctx.storage.transaction(async () => {
        const s = new Store(this.db),
          service = new Service(s, this.env.BG_ENCRYPTION_KEY);
        const response = route(service, input);
        service.flush();
        if (
          request.method === "POST" &&
          (s.rows("tasks").some((t) => t.status === "OPEN") ||
            s
              .rows("applications")
              .some((a) => a.state === "DELIVERED_TO_OBLIGEE"))
        )
          await this.ctx.storage.setAlarm(Date.now() + 60000);
        return response;
      });
    } catch (error) {
      if (error instanceof DomainError)
        return json({ code: error.code, detail: error.message }, error.status);
      console.error(
        JSON.stringify({
          event: "BG_REQUEST_FAILED",
          type: error instanceof Error ? error.name : "unknown",
        }),
      );
      return json(
        {
          code: "INTERNAL",
          detail:
            "Layanan belum dapat memproses permintaan. Hubungi administrator.",
        },
        500,
      );
    }
  }
  async alarm() {
    this.initialize();
    await this.ctx.storage.transaction(async () => {
      const s = new Store(this.db),
        service = new Service(s, this.env.BG_ENCRYPTION_KEY);
      service.tick({ id: "worker", role: "WORKER", bank: "bank-uat" });
      service.flush();
      if (
        s.rows("tasks").some((t) => t.status === "OPEN") ||
        s.rows("applications").some((a) => a.state === "DELIVERED_TO_OBLIGEE")
      )
        await this.ctx.storage.setAlarm(Date.now() + 60000);
    });
  }
}
