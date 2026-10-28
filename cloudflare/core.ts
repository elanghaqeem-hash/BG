import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  pbkdf2Sync,
  timingSafeEqual,
} from "node:crypto";

// Versioned domain snapshots mirror the original Python aggregate model.
export type Data = Record<string, any>;
export type Row = Data & { id: string };
export const TABLES = [
  "users",
  "sessions",
  "policies",
  "parties",
  "offices",
  "partners",
  "mandates",
  "applications",
  "documents",
  "approvals",
  "guarantees",
  "claims",
  "litigation",
  "tasks",
  "journals",
  "distributions",
  "command_receipts",
  "audit_log",
  "outbox",
  "notifications",
  "anchors",
] as const;
export type Table = (typeof TABLES)[number];
export interface Database {
  all(sql: string, ...values: (string | number | ArrayBuffer)[]): Data[];
  run(sql: string, ...values: (string | number | ArrayBuffer)[]): void;
}
export class DomainError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function requireValue(
  ok: unknown,
  code: string,
  message: string,
  status = 422,
): asserts ok {
  if (!ok) throw new DomainError(code, message, status);
}
export const uid = () => crypto.randomUUID();
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .filter((k) => (value as Data)[k] !== undefined)
        .map((k) => JSON.stringify(k) + ":" + canonical((value as Data)[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value ?? null);
}
export const hash = (value: unknown) =>
  createHash("sha256")
    .update(
      value instanceof Uint8Array
        ? value
        : typeof value === "string"
          ? value
          : canonical(value),
    )
    .digest("hex");
export function money(value: unknown): bigint {
  const v = String(value);
  requireValue(
    /^(0|[1-9]\d{0,19})(\.\d{1,2})?$/.test(v),
    "AMOUNT",
    "Nominal tidak valid; maksimal dua desimal",
  );
  const [whole, part = ""] = v.split(".");
  const n = BigInt(whole) * 100n + BigInt(part.padEnd(2, "0"));
  requireValue(n < 10n ** 22n, "AMOUNT", "Nominal tidak valid");
  return n;
}
export const amount = (v: bigint) =>
  (v / 100n).toString() + "." + (v % 100n).toString().padStart(2, "0");
export function timestamp(value: unknown) {
  requireValue(
    typeof value === "string" &&
      /(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      Number.isFinite(Date.parse(value)),
    "DATE",
    "Timestamp harus menyertakan zona waktu",
  );
  return Date.parse(value);
}
export function dateOnly(value: unknown): string {
  requireValue(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value,
    "DATE",
    "Tanggal tidak valid",
  );
  return value;
}
export const jakartaDate = (now: number) =>
  new Date(now + 7 * 3600000).toISOString().slice(0, 10);
export function businessDue(now: number, days: number, calendar: Data) {
  requireValue(
    calendar.timezone === "Asia/Jakarta" &&
      Number.isInteger(days) &&
      days >= 1 &&
      days <= 365,
    "POLICY",
    "Kalender/SLA tidak didukung",
  );
  let cursor = Date.parse(jakartaDate(now) + "T00:00:00Z");
  let remaining = days;
  let attempts = 0;
  while (remaining) {
    cursor += 86400000;
    requireValue(++attempts < 4000, "POLICY", "Kalender tidak valid");
    const day = (new Date(cursor).getUTCDay() + 6) % 7;
    if (
      calendar.working_days.includes(day) &&
      !calendar.holidays.includes(new Date(cursor).toISOString().slice(0, 10))
    )
      remaining--;
  }
  return new Date(
    Date.parse(
      new Date(cursor).toISOString().slice(0, 10) +
        "T" +
        calendar.cutoff +
        ":00+07:00",
    ),
  ).toISOString();
}
export function committee(category: string, nominal: unknown, p: Data) {
  const r = p.rules["BR-04"];
  return r.exempt_categories.includes(category)
    ? null
    : money(nominal) <= money(r.threshold)
      ? r.lower_role
      : r.upper_role;
}
export function splitUjrah(income: unknown, p: Data) {
  const rate = money(p.rules["BR-13"].rate);
  requireValue(rate <= 100n, "POLICY", "Rate split tidak valid");
  const split = (money(income) * rate + 50n) / 100n;
  return amount(
    split < money(p.rules["BR-13"].cap) ? split : money(p.rules["BR-13"].cap),
  );
}
export function predicate(p: Data, facts: Data): boolean {
  if (p.op === "all" || p.op === "any") {
    requireValue(Array.isArray(p.items), "POLICY", "Predicate tidak valid");
    return p.op === "all"
      ? p.items.every((x: Data) => predicate(x, facts))
      : p.items.some((x: Data) => predicate(x, facts));
  }
  if (p.op === "eq") return facts[p.field] === p.value;
  if (p.op === "in") return p.values.includes(facts[p.field]);
  if (p.op === "truthy") return Boolean(facts[p.field]);
  throw new DomainError("POLICY", "Operator tidak didukung");
}
export function validatePolicy(p: Data) {
  requireValue(
    p.assumption === true,
    "POLICY",
    "Policy harus bertanda asumsi sandbox",
  );
  requireValue(
    Object.keys(p.rules || {})
      .sort()
      .join(",") ===
      Array.from(
        { length: 20 },
        (_, i) => "BR-" + String(i + 1).padStart(2, "0"),
      ).join(","),
    "POLICY",
    "BR-01 sampai BR-20 wajib ada",
  );
  requireValue(
    dateOnly(p.effective_to) > dateOnly(p.effective_from),
    "POLICY",
    "Periode tidak valid",
  );
  for (const r of Object.values(p.rules)) predicate((r as Data).assert, {});
  for (const k of [
    "coverage",
    "admin_fee",
    "ijp",
    "broker_commission",
    "partner_limit",
    "principal_limit",
  ])
    money(p.pks[k]);
  requireValue(
    money(p.pks.coverage) > 0n && money(p.pks.coverage) <= 10000n,
    "POLICY",
    "Coverage tidak valid",
  );
  requireValue(
    Array.isArray(p.calendar.working_days) &&
      p.calendar.working_days.length &&
      p.calendar.working_days.every(
        (n: number) => Number.isInteger(n) && n >= 0 && n < 7,
      ),
    "POLICY",
    "Kalender tidak valid",
  );
  requireValue(
    p.calendar.timezone === "Asia/Jakarta" &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(p.calendar.cutoff),
    "POLICY",
    "Kalender tidak valid",
  );
  splitUjrah("0", p);
  businessDue(Date.now(), p.rules["BR-14"].business_days, p.calendar);
  businessDue(Date.now(), p.rules["BR-18"].business_days, p.calendar);
}
export function passwordHash(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  requireValue(
    typeof password === "string" &&
      password.length >= 12 &&
      password.length <= 256,
    "PASSWORD",
    "Password minimal 12 karakter",
  );
  return (
    salt +
    ":" +
    pbkdf2Sync(
      password,
      Buffer.from(salt, "hex"),
      100000,
      32,
      "sha256",
    ).toString("hex")
  );
}
export function checkPassword(password: string, encoded: string) {
  const [salt, digest] = encoded.split(":");
  const derived = pbkdf2Sync(
    password,
    Buffer.from(salt, "hex"),
    100000,
    32,
    "sha256",
  );
  const expected = Buffer.from(digest, "hex");
  return (
    expected.length === derived.length && timingSafeEqual(expected, derived)
  );
}
export function encrypt(raw: Uint8Array, key: string, aad: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from(aad));
  const bytes = Buffer.concat([cipher.update(raw), cipher.final()]);
  return {
    bytes,
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  };
}
export function decrypt(
  bytes: Uint8Array,
  key: string,
  meta: Data,
  aad: string,
) {
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    Buffer.from(meta.iv, "hex"),
  );
  cipher.setAAD(Buffer.from(aad));
  cipher.setAuthTag(Buffer.from(meta.tag, "hex"));
  return Buffer.concat([cipher.update(bytes), cipher.final()]);
}

/** A synchronous unit of work: no awaits inside a financial/audit transaction. */
export class Store {
  private cache = new Map<string, Row>();
  private originals = new Map<string, string>();
  private removed = new Set<string>();
  db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  maybe(table: Table, id: string): Row | undefined {
    const key = table + ":" + id;
    if (this.removed.has(key)) return undefined;
    if (this.cache.has(key)) return this.cache.get(key);
    const record = this.db.all(
      "SELECT data FROM " + table + " WHERE id=?",
      id,
    )[0];
    if (!record) return undefined;
    const row = JSON.parse(record.data);
    this.cache.set(key, row);
    this.originals.set(key, record.data);
    return row;
  }
  get(table: Table, id: string): Row {
    const row = this.maybe(table, id);
    requireValue(row, "NOT_FOUND", "Data tidak ditemukan", 404);
    return row;
  }
  rows(table: Table, filters: Data = {}): Row[] {
    const keys = Object.keys(filters);
    requireValue(
      keys.every((k) => /^[a-z_]+$/.test(k)),
      "FILTER",
      "Filter tidak valid",
    );
    const where = keys.length
      ? " WHERE " +
        keys.map((k) => "json_extract(data,'$." + k + "')=?").join(" AND ")
      : "";
    const records = this.db.all(
      "SELECT id FROM " + table + where + " LIMIT 2001",
      ...keys.map((k) => filters[k]),
    );
    requireValue(
      records.length <= 2000,
      "CAPACITY",
      "Kapasitas pilot tercapai; hubungi administrator",
      503,
    );
    const ids = new Set(records.map((x) => x.id));
    for (const [key, row] of this.cache)
      if (key.startsWith(table + ":")) ids.add(row.id);
    return [...ids]
      .map((id) => this.maybe(table, id))
      .filter(
        (r): r is Row =>
          !!r && Object.entries(filters).every(([k, v]) => r[k] === v),
      );
  }
  auditHead(): Row | undefined {
    const latest = this.db.all(
      "SELECT data FROM audit_log ORDER BY json_extract(data,'$.sequence') DESC LIMIT 1",
    )[0];
    let head = latest ? JSON.parse(latest.data) : undefined;
    for (const [key, row] of this.cache)
      if (
        key.startsWith("audit_log:") &&
        (!head || row.sequence > head.sequence)
      )
        head = row;
    return head;
  }
  add(table: Table, row: Row) {
    requireValue(
      !this.maybe(table, row.id),
      "DUPLICATE",
      "Referensi sudah ada",
      409,
    );
    this.cache.set(table + ":" + row.id, row);
    return row;
  }
  delete(table: Table, id: string) {
    requireValue(
      !["audit_log", "journals", "approvals"].includes(table),
      "IMMUTABLE",
      "Catatan bersifat append-only",
      409,
    );
    this.get(table, id);
    this.removed.add(table + ":" + id);
  }
  commit() {
    for (const key of this.removed) {
      const n = key.indexOf(":");
      this.db.run(
        "DELETE FROM " + key.slice(0, n) + " WHERE id=?",
        key.slice(n + 1),
      );
    }
    for (const [key, row] of this.cache) {
      if (this.removed.has(key)) continue;
      const n = key.indexOf(":");
      const data = canonical(row);
      if (this.originals.get(key) === data) continue;
      this.db.run(
        "INSERT INTO " +
          key.slice(0, n) +
          " (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        row.id,
        data,
      );
    }
  }
}

export function safeEqual(a: string, b: string) {
  return timingSafeEqual(
    Buffer.from(hash(a), "hex"),
    Buffer.from(hash(b), "hex"),
  );
}

export function initializeSchema(db: Database) {
  for (const table of TABLES)
    db.run(
      `CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,data TEXT NOT NULL CHECK(json_valid(data)))`,
    );
  db.run(
    "CREATE TABLE IF NOT EXISTS document_chunks(document_id TEXT NOT NULL REFERENCES documents(id),ordinal INTEGER NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(document_id,ordinal))",
  );
  db.run(
    "CREATE TABLE IF NOT EXISTS request_limits(key TEXT NOT NULL,minute INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(key,minute))",
  );
  for (const table of ["audit_log", "journals", "approvals"])
    for (const operation of ["UPDATE", "DELETE"])
      db.run(
        `CREATE TRIGGER IF NOT EXISTS ${table}_${operation.toLowerCase()}_deny BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'append only'); END`,
      );
  for (const [table, field] of [
    ["documents", "application_id"],
    ["approvals", "application_id"],
    ["claims", "application_id"],
    ["tasks", "application_id"],
    ["applications", "principal"],
    ["applications", "partner"],
    ["sessions", "user_id"],
  ])
    db.run(
      `CREATE INDEX IF NOT EXISTS ${table}_${field}_index ON ${table}(json_extract(data,'$.${field}'))`,
    );
  for (const [table, field] of [
    ["users", "username"],
    ["guarantees", "number"],
    ["guarantees", "token_hash"],
    ["audit_log", "sequence"],
    ["policies", "version"],
  ])
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_${field}_unique ON ${table}(json_extract(data,'$.${field}'))`,
    );
}
