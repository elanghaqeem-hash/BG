import {
  Store,
  requireValue as req,
  DomainError,
  uid,
  hash,
  canonical,
  timestamp,
  money,
  validatePolicy,
  checkPassword,
  passwordHash,
  safeEqual,
  decrypt,
  type Data,
} from "./core.ts";
import { Service, BANK, OPS, randomToken } from "./service.ts";
import { enterpriseSnapshot, policySimulation } from "./enterprise-controls.ts";
import { recoverySnapshot } from "./recovery-engine.ts";
import {servicingListing} from "./servicing-engine.ts";
import {visitSnapshot} from "./visit-reports.ts";
import {standardAnalysisSnapshot} from "./standard-analysis.ts";
import { IDENTITIES } from "./bootstrap.ts";
import QRCode from "qrcode";
import { detectUploadedFormat } from "./upload-validation.ts";
export type Input = {
  method: string;
  path: string[];
  body: Data;
  cookie: string;
  csrf: string;
  secure: boolean;
};
export const json = (
  value: unknown,
  status = 200,
  extra: Record<string, string> = {},
) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      ...extra,
    },
  });
export function fields(body: Data, allowed: string[], required: string[] = []) {
  req(
    body && typeof body === "object" && !Array.isArray(body),
    "PAYLOAD",
    "Data harus berbentuk objek",
  );
  req(
    Object.keys(body).every((k) => allowed.includes(k)),
    "PAYLOAD",
    "Field tidak dikenal",
  );
  for (const k of required)
    req(
      body[k] !== undefined && body[k] !== null,
      "PAYLOAD",
      "Data aksi belum lengkap: " + k,
    );
}
const str = (value: unknown, min = 1, max = 200) => {
  req(
    typeof value === "string" && value.length >= min && value.length <= max,
    "PAYLOAD",
    "Panjang teks tidak valid",
  );
  return value;
};
function actor(s: Store, input: Input, now: number) {
  const token =
    input.cookie
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("bg_session="))
      ?.slice(11) || "";
  req(token, "AUTH", "Silakan login", 401);
  const session = s.maybe("sessions", hash(token));
  req(
    session && timestamp(session.expires) > now,
    "AUTH",
    "Sesi tidak valid atau berakhir",
    401,
  );
  const user = s.get("users", session.user_id);
  req(user.active, "AUTH", "User tidak aktif", 401);
  if (input.method !== "GET")
    req(
      safeEqual(input.csrf, session.csrf),
      "CSRF",
      "Token CSRF diperlukan",
      403,
    );
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    org: user.org,
    office: user.office,
    bank: "bank-uat",
    csrf: session.csrf,
    session_id: session.id,
  };
}
const publicUser = (user: Data, csrf: string) => ({
  username: user.username,
  name: user.name,
  role: user.role,
  org: user.org,
  office: user.office,
  csrf,
  mode: "SANDBOX",
});
export function route(service: Service, input: Input): Response {
  const { s, now } = service,
    { path: p, body: b, method } = input,
    post = method === "POST";
  const matches = (...parts: string[]) =>
    p.length === parts.length && parts.every((x, i) => x === "*" || x === p[i]);
  if (matches("health") && method === "GET")
    return json({
      status: "ok",
      mode: "SANDBOX",
      production_enabled: false,
      backend: "durable-object-sqlite",
      persistent: true,
    });
  if (matches("auth", "login") && post) {
    fields(b, ["username", "password"], ["username", "password"]);
    const name = str(b.username, 1, 120);
    str(b.password, 1, 256);
    const u = s.rows("users").find((u) => u.username === name);
    const valid = checkPassword(
      b.password,
      u?.password || "0".repeat(32) + ":" + "0".repeat(64),
    );
    req(valid && u?.active, "AUTH", "Username atau password tidak sesuai", 401);
    for (const old of s.rows("sessions"))
      if (timestamp(old.expires) < now) s.delete("sessions", old.id);
    const token = randomToken(),
      csrf = randomToken();
    s.add("sessions", {
      id: hash(token),
      user_id: u.id,
      expires: new Date(now + 8 * 3600000).toISOString(),
      csrf,
    });
    service.audit({ ...u, bank: "bank-uat" }, "SessionCreated", u.id, {});
    return json(publicUser(u, csrf), 200, {
      "Set-Cookie": `bg_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${input.secure ? "; Secure" : ""}`,
    });
  }
  if (
    p[0] === "public" &&
    p[1] === "verify" &&
    p.length === 3 &&
    method === "GET"
  ) {
    str(p[2], 1, 200);
    return json(service.verify(p[2]));
  }
  if (p[0] === "public" && p[1] === "qr" && p.length === 3 && method === "GET")
    throw new DomainError("QR_ROUTE", "Gunakan rute QR pada handler", 500);
  const a = actor(s, input, now);
  if (matches("auth", "me") && method === "GET")
    return json(publicUser(a, a.csrf));
  if (matches("auth", "logout") && post) {
    s.delete("sessions", a.session_id);
    service.audit(a, "SessionRevoked", a.id, {});
    return json({ logged_out: true }, 200, {
      "Set-Cookie": `bg_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${input.secure ? "; Secure" : ""}`,
    });
  }
  if (matches("auth", "password") && post) {
    fields(
      b,
      ["current_password", "new_password"],
      ["current_password", "new_password"],
    );
    const u = s.get("users", a.id);
    req(
      checkPassword(str(b.current_password, 1, 256), u.password),
      "AUTH",
      "Password saat ini tidak sesuai",
      401,
    );
    u.password = passwordHash(str(b.new_password, 12, 256));
    for (const session of s.rows("sessions", { user_id: a.id }))
      s.delete("sessions", session.id);
    service.audit(a, "PasswordChanged", a.id, {});
    return json({ changed: true, reauthenticate: true }, 200, {
      "Set-Cookie":
        "bg_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
    });
  }
  if (matches("users") && method === "GET") {
    service.role(a, ["ADMIN"]);
    return json(s.rows("users").map(({ password, ...user }) => user));
  }
  if (matches("users") && post) {
    service.role(a, ["ADMIN"]);
    fields(
      b,
      ["username", "password", "name", "role", "org", "office"],
      ["username", "password", "name", "role", "org", "office"],
    );
    const role = str(b.role);
    req(
      IDENTITIES.some((x) => x[1] === role),
      "ROLE",
      "Peran tidak dikenal",
    );
    req(
      !s.rows("users").some((u) => u.username === b.username),
      "DUPLICATE",
      "Username sudah terdaftar",
      409,
    );
    const office = String(b.office),
      org = str(b.org);
    if (["PRINCIPAL", "BROKER", "OBLIGEE"].includes(role))
      req(
        s.get("parties", org).kind === role,
        "PARTY",
        "Jenis organisasi tidak sesuai",
      );
    else if (role === "PENJAMIN") s.get("partners", org);
    else {
      req(org === "bank-org", "PARTY", "Organisasi bank tidak valid");
      s.get("offices", office);
    }
    const u = s.add("users", {
      id: uid(),
      username: str(b.username, 1, 120),
      name: str(b.name),
      password: passwordHash(str(b.password, 12, 256)),
      role,
      org,
      office,
      active: true,
    });
    service.audit(a, "UserCreated", u.id, { role, org });
    return json({ id: u.id, username: u.username, role: u.role }, 201);
  }
  if (matches("users", "*", "status") && post) {
    service.role(a, ["ADMIN"]);
    fields(b, ["active"], ["active"]);
    req(typeof b.active === "boolean", "PAYLOAD", "Status tidak valid");
    const u = s.get("users", p[1]);
    req(u.id !== a.id, "SOD", "Tidak dapat menonaktifkan akun sendiri", 403);
    u.active = b.active;
    for (const sess of s.rows("sessions", { user_id: u.id }))
      s.delete("sessions", sess.id);
    service.audit(a, "UserStatusChanged", u.id, { active: u.active });
    return json({ id: u.id, active: u.active });
  }
  if (matches("catalog") && method === "GET")
    return json({
      parties: s
        .rows("parties")
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          name: r.name,
          ...(r.category ? { category: r.category } : {}),
        })),
      offices: s.rows("offices"),
      partners: s.rows("partners").map((r) => ({ id: r.id, name: r.name })),
      policies: s
        .rows("policies", { status: "ACTIVE" })
        .map((r) => ({
          id: r.id,
          version: r.version,
          status: r.status,
          assumption: r.configuration.assumption,
          configuration: BANK.has(a.role)
            ? r.configuration
            : { pks: { types: r.configuration.pks.types } },
        })),
    });
  if (matches("applications") && method === "GET")
    return json(
      s.rows("applications").flatMap((r) => {
        try {
          return [service.view(a, r)];
        } catch (e) {
          if (e instanceof DomainError && e.status === 404) return [];
          throw e;
        }
      }),
    );
  if (matches("applications") && post) {
    fields(
      b,
      [
        "principal",
        "obligee",
        "partner",
        "processing_office",
        "issuing_office",
        "project_name",
        "amount",
        "issue_on",
        "expires_on",
        "bg_type",
        "currency",
        "custom_format",
        "mandate",
        "product",
        "justification",
        "project_reference","project_source","project_value","project_start_on","project_end_on","guarantee_scheme",
      ],
      [
        "principal",
        "obligee",
        "partner",
        "processing_office",
        "issuing_office",
        "project_name",
        "amount",
        "issue_on",
        "expires_on",
      ],
    );
    str(b.project_name);
    if (b.project_reference !== undefined) str(b.project_reference,0,120);
    if (b.project_source !== undefined) req(b.project_source === "SELF_DECLARED","PROJECT","Sumber data proyek eksternal belum terintegrasi");
    if (b.guarantee_scheme !== undefined) req(b.guarantee_scheme === "COUNTER_BG","SCHEME","Skema setoran jaminan / surety langsung belum didukung",422);
    if (b.project_value !== undefined) req(Number.isFinite(Number(b.project_value)) && Number(b.project_value)>0,"PROJECT","Nilai proyek tidak valid");
    for(const field of ["project_start_on","project_end_on"]) if(b[field] !== undefined)
      req(typeof b[field]==="string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(b[field]),"PROJECT","Tanggal proyek tidak valid");
    if(b.project_start_on && b.project_end_on) req(b.project_end_on>=b.project_start_on,"PROJECT","Tanggal akhir proyek mendahului awal",422);
    if (b.custom_format !== undefined)
      req(
        typeof b.custom_format === "boolean",
        "PAYLOAD",
        "Format khusus harus boolean",
      );
    return json(
      service.create(a, { bg_type: "PELAKSANAAN", custom_format: false, ...b }),
      201,
    );
  }
  if (matches("applications", "*", "standard-analysis") && method === "GET") {
    return json(standardAnalysisSnapshot(service,a,s.get("applications",p[1])));
  }
  if (matches("applications", "*", "visit") && method === "GET") {
    return json(visitSnapshot(service,a,s.get("applications",p[1])));
  }
  if (matches("applications", "*", "servicing") && method === "GET") {
    return json(servicingListing(service,a,s.get("applications",p[1])));
  }
  if (matches("applications", "*", "enterprise") && method === "GET") {
    return json(enterpriseSnapshot(service,a,s.get("applications",p[1])));
  }
  if (matches("applications", "*") && method === "GET")
    return json(service.view(a, s.get("applications", p[1])));
  // Role-scoped portal inbox; external email/WhatsApp delivery is not implied.
  if (matches("applications", "*", "messages") && ["GET","POST"].includes(method)) {
    const app=s.get("applications",p[1]);
    service.access(a,app);
    const sender=BANK.has(a.role)?"BANK":String(a.role);
    req(["BANK","PRINCIPAL","PENJAMIN","BROKER"].includes(sender),
      "FORBIDDEN","Peran ini tidak dapat memakai komunikasi pengajuan",403);
    const all: Data[]=Array.isArray(app.portal_messages)?app.portal_messages:[];
    const visible=()=>all.filter((m:Data)=>sender==="BANK"||m.from===sender||m.to===sender);
    if(!post) return json(visible());
    fields(b,["recipient","topic","message"],["recipient","topic","message"]);
    const recipient=str(b.recipient,1,20);
    const allowed: Record<string,string[]>={
      BANK:["PRINCIPAL","PENJAMIN","BROKER"],
      PRINCIPAL:["BANK","PENJAMIN"],
      PENJAMIN:["BANK","PRINCIPAL"],
      BROKER:["BANK","PRINCIPAL"]
    };
    req(allowed[sender].includes(recipient),"RECIPIENT","Tujuan pesan tidak berwenang",403);
    const topic=str(b.topic,1,30);
    req(["KLARIFIKASI","KELENGKAPAN_DOKUMEN","JADWAL_KUNJUNGAN","LAINNYA"].includes(topic),
      "TOPIC","Kategori pesan tidak dikenal",422);
    const message=str(b.message,3,1000).trim();
    req(message.length>=3,"MESSAGE","Isi pesan terlalu singkat",422);
    req(all.length<100,"LIMIT","Batas pesan aplikasi sandbox tercapai",429);
    const item={id:uid(),from:sender,to:recipient,topic,message,at:service.iso};
    all.push(item);app.portal_messages=all;
    service.audit(a,"PortalMessageCreated",app.id,{message_id:item.id,recipient,topic});
    return json(item,201);
  }
  if (matches("applications", "*", "commands", "*") && post) {
    fields(
      b,
      ["expected_version", "idempotency_key", "payload"],
      ["expected_version", "idempotency_key"],
    );
    req(
      Number.isInteger(b.expected_version) && b.expected_version >= 0,
      "VERSION",
      "Versi tidak valid",
    );
    str(b.idempotency_key, 8, 120);
    req(
      !b.payload ||
        (typeof b.payload === "object" && !Array.isArray(b.payload)),
      "PAYLOAD",
      "Payload tidak valid",
    );
    validateCommand(p[3], b.payload || {});
    return json(
      service.execute(
        a,
        s.get("applications", p[1]),
        p[3],
        b.payload || {},
        b.expected_version,
        b.idempotency_key,
      ),
    );
  }
  if (matches("applications", "*", "documents") && post) {
    fields(
      b,
      ["kind", "content_base64", "source_reference"],
      ["kind", "content_base64"],
    );
    const app = s.get("applications", p[1]);
    service.access(a, app, a.role === "BROKER");
    const allowed: Data = {
      PRINCIPAL: [
        "AMENDMENT_REQUEST",
        "NIB","CONTRACT","KYB","PRINCIPAL_REQUEST","MANDATE",
        "AKTA_PENDIRIAN","IDENTITAS_PENGURUS","NPWP","TDR",
        "LAPORAN_KEUANGAN","SIUJK","ASOSIASI_PROFESI","IZIN_LAINNYA",
        "UNDANGAN_TENDER","PERMOHONAN_BG","PERMOHONAN_KBG",
        "SP2D_SATKER","SP2D_PERJANJIAN","SP2D_KPPN","FORMAT_TEMPLATE",
        "BUKTI_BIAYA","SURAT_KUASA_PEMBLOKIRAN",
      ],
      BROKER: [
        "AMENDMENT_REQUEST",
        "NIB","CONTRACT","KYB","PRINCIPAL_REQUEST",
        "AKTA_PENDIRIAN","IDENTITAS_PENGURUS","NPWP","TDR",
        "LAPORAN_KEUANGAN","SIUJK","ASOSIASI_PROFESI","IZIN_LAINNYA",
        "UNDANGAN_TENDER","PERMOHONAN_BG","PERMOHONAN_KBG","FORMAT_TEMPLATE",
        "SP2D_SATKER","SP2D_PERJANJIAN","SP2D_KPPN",
      ],
      PENJAMIN: [
        "SP2KBG",
        "COUNTER_ENDORSEMENT",
        "FORMAT_APPROVAL",
        "CERTIFICATE",
        "CONTRA_DECISION",
        "CONTRA_PAYMENT",
      ],
      OBLIGEE: ["CLAIM", "WITHDRAWAL", "DELIVERY"],
    };
    str(b.kind, 1, 60);
    req(
      BANK.has(a.role) || allowed[a.role]?.includes(b.kind),
      "FORBIDDEN",
      "Tidak berwenang mengunggah jenis dokumen ini",
      403,
    );
    req(
      !["AUDIT", "MONITOR", "ADMIN", "WORKER"].includes(a.role),
      "FORBIDDEN",
      "Peran hanya baca/administratif",
      403,
    );
    req(
      b.kind !== "DRAFT_BG" || app.state === "DRAFT",
      "BR-08",
      "Draft disubmit terkunci",
    );
    const encoded = str(b.content_base64, 1, 2800000);
    req(
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        encoded,
      ),
      "DOCUMENT",
      "Base64 tidak valid",
    );
    const raw = Buffer.from(encoded, "base64");
    let format: ReturnType<typeof detectUploadedFormat>;
    try {
      format = detectUploadedFormat(raw);
    } catch (e) {
      throw new DomainError("DOCUMENT", e instanceof Error ? e.message : "Format dokumen tidak valid", 422);
    }
    if (b.kind === "LKN_PHOTOS")
      req(["application/pdf","image/jpeg","image/png"].includes(format.mime),
        "DOCUMENT", "Foto LKN hanya menerima PDF, JPG atau PNG");
    const d = service.addDocument(
      a,
      app,
      b.kind,
      raw,
      b.source_reference ? str(b.source_reference, 0, 500) : "",
      false,
      format.mime,
    );
    return json(
      { id: d.id, kind: d.kind, sha256: d.digest, verified: false, media_type: format.mime },
      201,
    );
  }
  if (matches("documents", "*", "verify") && post) {
    fields(b, ["source_reference"], ["source_reference"]);
    str(b.source_reference, 3, 500);
    service.role(a, ["COMPLIANCE", ...OPS]);
    const d = s.get("documents", p[1]);
    service.access(a, s.get("applications", d.application_id));
    req(
      d.uploaded_by !== a.id,
      "SOD",
      "Uploader tidak boleh memverifikasi dokumennya sendiri",
      403,
    );
    req(!d.verified, "DOCUMENT", "Dokumen sudah diverifikasi", 409);
    Object.assign(d, {
      verified: true,
      verified_by: a.id,
      verified_at: service.iso,
      source: b.source_reference,
    });
    service.audit(a, "DocumentVerified", d.id, {
      hash: d.digest,
      source_digest: hash(b.source_reference),
    });
    return json({ id: d.id, verified: true });
  }
  if (matches("documents", "*", "download") && method === "GET") {
    const raw = service.download(a, p[1]);
    const stored = s.get("documents", p[1]);
    const ext: Record<string, string> = {"application/pdf":"pdf","image/jpeg":"jpg","image/png":"png","text/plain":"txt"};
    const extension = ext[String(stored.media_type || "")] || "bin";
    return new Response(raw, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename="${p[1].replace(/[^a-zA-Z0-9-]/g, "")}.${extension}"`,
      },
    });
  }
  if (matches("mandates") && post) {
    fields(
      b,
      [
        "principal",
        "broker",
        "document",
        "application_id",
        "expires",
        "commission_disclosed",
      ],
      [
        "principal",
        "broker",
        "document",
        "application_id",
        "expires",
        "commission_disclosed",
      ],
    );
    service.role(a, ["PRINCIPAL"]);
    req(a.org === b.principal, "FORBIDDEN", "Principal berbeda", 403);
    const app = s.get("applications", b.application_id);
    service.access(a, app);
    const doc = service.doc(app, b.document, "MANDATE"),
      broker = s.get("parties", b.broker);
    req(
      broker.kind === "BROKER" &&
        broker.license_verified &&
        broker.whitelisted &&
        !broker.conflict,
      "BROKER",
      "Broker belum berizin/terverifikasi",
    );
    req(
      timestamp(b.expires) > now && b.commission_disclosed === true,
      "MANDATE",
      "Kuasa/disclosure tidak valid",
    );
    const m = s.add("mandates", {
      id: uid(),
      principal: b.principal,
      broker: b.broker,
      expires: b.expires,
      document: doc.id,
      scope: ["submit"],
      commission_disclosed: true,
    });
    service.audit(a, "MandateGranted", m.id, { broker: b.broker });
    return json(m);
  }
  if (matches("mandates", "*", "revoke") && post) {
    service.role(a, ["PRINCIPAL"]);
    const m = s.get("mandates", p[1]);
    req(a.org === m.principal, "NOT_FOUND", "Kuasa tidak ditemukan", 404);
    m.revoked_at = service.iso;
    service.audit(a, "MandateRevoked", m.id, {});
    return json({ revoked: true });
  }
  if (matches("applications", "*", "verification-link") && method === "GET") {
    const app = s.get("applications", p[1]);
    service.access(a, app);
    req(
      BANK.has(a.role) || ["PRINCIPAL", "OBLIGEE"].includes(a.role),
      "FORBIDDEN",
      "Tidak berwenang",
      403,
    );
    const g = s.get("guarantees", app.id),
      token = decrypt(
        Buffer.from(g.token_cipher, "base64"),
        service.key,
        g,
        g.id,
      ).toString();
    return json({ token, url: "/verify/" + token, mode: "SANDBOX" });
  }
  if (matches("applications", "*", "claims") && post) {
    fields(b, ["document", "amount"], ["document", "amount"]);
    return json(service.receiveClaim(a, s.get("applications", p[1]), b), 201);
  }
  if (matches("claims") && method === "GET") {
    if (a.role === "BROKER") return json([]);
    return json(
      s.rows("claims").flatMap((c) => {
        try {
          service.access(a, s.get("applications", c.application_id));
          const details =
            a.role === "OBLIGEE"
              ? Object.fromEntries(
                  ["amount", "received_at", "bank_paid_at", "withdrawn_at"]
                    .filter((k) => c[k])
                    .map((k) => [k, c[k]]),
                )
              : c;
          return [
            {
              id: c.id,
              application_id: c.application_id,
              state: c.state,
              version: c.version,
              details,
            },
          ];
        } catch (e) {
          if (e instanceof DomainError && e.status === 404) return [];
          throw e;
        }
      }),
    );
  }
  if (matches("claims", "*", "recovery") && method === "GET") {
    const claim = s.get("claims", p[1]);
    return json(recoverySnapshot(service,a,
      s.get("applications",claim.application_id),claim));
  }
  if (matches("claims", "*", "commands", "*") && post) {
    fields(
      b,
      ["expected_version", "idempotency_key", "payload"],
      ["expected_version", "idempotency_key"],
    );
    req(
      Number.isInteger(b.expected_version) && b.expected_version >= 0,
      "VERSION",
      "Versi tidak valid",
    );
    str(b.idempotency_key, 8, 120);
    req(
      !b.payload ||
        (typeof b.payload === "object" && !Array.isArray(b.payload)),
      "PAYLOAD",
      "Payload tidak valid",
    );
    validateCommand(p[3], b.payload || {});
    return json(
      service.claimCommand(
        a,
        s.get("claims", p[1]),
        p[3],
        b.payload || {},
        b.expected_version,
        b.idempotency_key,
      ),
    );
  }
  if (matches("operations") && method === "GET") {
    service.role(a, BANK);
    const result: Data = {};
    for (const table of ["tasks", "litigation", "distributions"] as const)
      result[table] = s.rows(table).flatMap((r) => {
        try {
          service.access(a, s.get("applications", r.application_id));
          return [
            {
              id: r.id,
              application_id: r.application_id,
              status: r.state || r.status,
              due: r.due || null,
              details: r,
            },
          ];
        } catch (e) {
          if (e instanceof DomainError && e.status === 404) return [];
          throw e;
        }
      });
    return json(result);
  }
  if (matches("operations", "sweep") && post) return json(service.tick(a));
  if (matches("audit", "events") && method === "GET") {
    service.role(a, ["AUDIT", "LEGAL"]);
    return json(
      s.db
        .all(
          "SELECT data FROM audit_log ORDER BY json_extract(data,'$.sequence') DESC LIMIT 200",
        )
        .map((r) => JSON.parse(r.data))
        .reverse(),
    );
  }
  if (matches("audit", "verify") && method === "GET") {
    service.role(a, ["AUDIT", "LEGAL"]);
    let previous = "0".repeat(64),
      sequence = 0;
    while (true) {
      const page = s.db.all(
        "SELECT data FROM audit_log WHERE json_extract(data,'$.sequence')>? ORDER BY json_extract(data,'$.sequence') LIMIT 250",
        sequence,
      );
      if (!page.length) break;
      for (const raw of page) {
        const { id, digest, ...data } = JSON.parse(raw.data);
        req(
          data.previous_hash === previous &&
            data.sequence === ++sequence &&
            hash(data) === digest,
          "AUDIT_INTEGRITY",
          "Rantai audit tidak cocok",
          409,
        );
        previous = digest;
      }
    }
    return json({
      valid: true,
      events: sequence,
      head: previous,
      external_anchor_verified: false,
    });
  }
  if (matches("policies","*","simulate") && post) {
    fields(b,["facts","codes"],["facts"]);
    return json(policySimulation(service,a,p[1],b.facts,b.codes));
  }
  if (matches("policies") && post) {
    service.role(a, ["ADMIN"]);
    fields(b, ["configuration"], ["configuration"]);
    validatePolicy(b.configuration);
    const version =
      Math.max(...s.rows("policies").map((p) => p.version), 0) + 1;
    const p = s.add("policies", {
      id: uid(),
      version,
      status: "DRAFT",
      maker: a.id,
      configuration: b.configuration,
    });
    service.audit(a, "PolicyProposed", p.id, { version });
    return json({ id: p.id, version, status: "DRAFT" }, 201);
  }
  if (matches("policies", "*", "approve") && post) {
    service.role(a, ["CONFIG_CHECKER"]);
    const policy = s.get("policies", p[1]);
    req(
      policy.maker !== a.id,
      "SOD",
      "Maker konfigurasi tidak boleh approve",
      403,
    );
    req(policy.status === "DRAFT", "STATE", "Policy bukan draft", 409);
    for (const old of s.rows("policies", { status: "ACTIVE" }))
      old.status = "SUPERSEDED";
    policy.status = "ACTIVE";
    service.audit(a, "PolicyActivated", policy.id, {
      version: policy.version,
      mode: "SANDBOX",
    });
    return json({ active: true });
  }
  throw new DomainError("NOT_FOUND", "Layanan tidak ditemukan", 404);
}
export async function qr(url: string) {
  return QRCode.toBuffer(url, {
    type: "png",
    width: 256,
    errorCorrectionLevel: "M",
  });
}

function validateCommand(command: string, x: Data) {
  const required: Record<string, string[]> = {
    record_slik: ["document", "collectibility", "pulled_at"],
    sp2_issue: ["document", "reference", "issuing_unit", "amount", "valid_to"],
    approve_format: ["document", "draft_hash", "signed_and_stamped"],
    ememo: ["to", "cc", "attachments"],
    certificate: ["document", "reference"],
    deliver: ["document"],
    original_received: ["document"],
    submit_contra: ["document"],
    contra_decision: ["document", "decision"],
    confirm_contra_paid: ["document"],
    withdraw: ["document"],
    refer_dispute: ["document"],
    request_close: ["document"],
    record_standard_analysis: ["checklist_complete","owner","owner_other","project_type","project_type_other","project_value","funding_source","funding_other","project_document","contract_reference","contract_date","completion_months","guarantee_amount","guarantee_type","guarantee_other","customer_relationship","business_years","management","slik_document","slik_comment","projects_completed","projects_last_year","last_year_project_value","business_condition","profit_history","financial_document","bank_support","bank_support_details","additional_collateral","collateral_type_other","recommendation","reason"],
    review_standard_analysis: ["accepted","reason"],
    record_visit: ["visited_at","customer_type","request_type","location","environment","facilities_within_1km","notes","photo_categories","photo_document","attested"],
    review_visit: ["accepted","reason","report_document"],
    record_5c: ["five_c","financial_document","financials","recommendation","narrative"],
    review_5c: ["accepted","reason"],
    review_counter: ["scheme","pks_reference","pks_document"],
    register_collateral: ["type","value","document","binding_reference"],
    approve_collateral: ["collateral_id","accepted","reason"],
    request_servicing: ["kind","document","reason"],
    review_servicing: ["servicing_id","collectibility","pulled_at","screening_clear","ubo_verified","recommendation","narrative"],
    partner_endorse: ["servicing_id","document","reference","cover_amount","cover_until"],
    approve_servicing: ["servicing_id"],
    reject_servicing: ["servicing_id","reason"],
    withdraw_servicing: ["servicing_id","reason"],
    cancel_approved_servicing: ["servicing_id","document","reason"],
    request_bg_closure: ["document"],
    open_recovery: ["kind","document","reason"],
    review_recovery: ["accepted","reason"],
    record_recovery_action: ["action_type","document","reason"],
    review_recovery_action: ["action_id","accepted","reason"],
    request_recovery_closure: ["document","reason"],
    confirm_recovery_closure: ["accepted","reason"],
  };
  for (const field of required[command] || [])
    req(
      x[field] !== undefined && x[field] !== null,
      "PAYLOAD",
      "Data aksi belum lengkap: " + field,
    );
  for (const field of [
    "document",
    "reference",
    "issuing_unit",
    "draft_hash",
    "financial_document",
    "pks_reference",
    "pks_document",
    "collateral_id",
    "servicing_id",
    "action_id",
    "binding_reference",
    "to",
    "decision",
  ])
    if (x[field] !== undefined) str(x[field], 1, 500);
  for (const field of ["cc", "attachments", "covered_documents"])
    if (x[field] !== undefined)
      req(
        Array.isArray(x[field]) &&
          x[field].length <= 50 &&
          x[field].every(
            (v: unknown) => typeof v === "string" && v.length <= 100,
          ),
        "PAYLOAD",
        "Daftar isian tidak valid",
      );
}
