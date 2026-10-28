/** Generate deployment secrets locally. Never print or commit generated values. */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { passwordHash } from "../cloudflare/core.ts";
import { IDENTITIES } from "../cloudflare/bootstrap.ts";
const target = path.resolve("runtime/native-live");
fs.mkdirSync(target, { recursive: true, mode: 0o700 });
const secretsPath = path.join(target, "cloudflare-secrets.json");
if (fs.existsSync(secretsPath))
  throw new Error("Existing native secrets preserved; refusing to overwrite");
const credentials = Object.fromEntries(
  IDENTITIES.map(([name]) => [name, randomBytes(24).toString("base64url")]),
);
const encoded = Object.fromEntries(
  Object.entries(credentials).map(([name, password]) => [
    name,
    passwordHash(password),
  ]),
);
const encryptionKey = randomBytes(32).toString("hex");
fs.writeFileSync(
  secretsPath,
  JSON.stringify(
    {
      BG_INITIAL_USERS: JSON.stringify(encoded),
      BG_ENCRYPTION_KEY: encryptionKey,
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
fs.writeFileSync(
  path.join(target, "credentials.json"),
  JSON.stringify(credentials, null, 2) + "\n",
  { mode: 0o600 },
);
const lines = [
  "# Akses BG Ecosystem — Sandbox Cloudflare Free",
  "",
  "Alamat: https://bg.elang-haqeem.workers.dev/",
  "Dibuat: 28 Oktober 2026 (WIB).",
  "Gunakan menu Keamanan setelah login untuk mengganti password masing-masing akun.",
  "Admin dapat mendaftarkan atau menonaktifkan pengguna melalui menu Pengguna.",
  "Semua peran memiliki identitas berbeda. Jangan gunakan akun orang lain untuk melewati maker–checker.",
  "",
  "| Username | Peran | Password awal |",
  "| --- | --- | --- |",
  ...IDENTITIES.map(
    ([name, role]) =>
      "| " + name + " | " + role + " | " + credentials[name] + " |",
  ),
  "",
  "Simpan dokumen akses ini secara privat. Jangan unggah ke repository publik.",
  "Lingkungan SANDBOX: transaksi tersimpan, tetapi adapter bank, tanda tangan, pembayaran dan penjaminan masih simulasi. Tidak untuk penerbitan BG nyata.",
  "",
];
fs.writeFileSync(
  path.join(target, "BG_Akses_Sandbox_20261028.md"),
  lines.join("\n"),
  { mode: 0o600 },
);
fs.writeFileSync(
  path.join(target, "BG_Pemulihan_Kunci_20261028.json"),
  JSON.stringify(
    {
      purpose: "Private recovery copy; never commit or share publicly",
      site: "https://bg.elang-haqeem.workers.dev/",
      BG_ENCRYPTION_KEY: encryptionKey,
      note: "Restore the same key with the same Durable Object namespace. A changed key is rejected; do not replace an existing key without a tested data migration.",
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    generated: true,
    identities: IDENTITIES.length,
    secret_file: secretsPath,
    credentials_file: path.join(target, "BG_Akses_Sandbox_20261028.md"),
  }),
);
