import {
  Store,
  requireValue as req,
  validatePolicy,
  hash,
  type Data,
} from "./core.ts";
import policy from "../config/policy.sandbox.json" with { type: "json" };
export const IDENTITIES = [
  ["principal", "PRINCIPAL", "principal-1", "cabang-1"],
  ["ao", "AO", "bank-org", "cabang-1"],
  ["analyst", "ANALYST", "bank-org", "cabang-1"],
  ["compliance", "COMPLIANCE", "bank-org", "cabang-1"],
  ["mpo", "MPO", "bank-org", "cabang-1"],
  ["issuer", "MPO_KPO", "bank-org", "kpo-1"],
  ["support", "SUPPORT", "bank-org", "cabang-1"],
  ["gh", "GH_BISNIS", "bank-org", "cabang-1"],
  ["direksi", "DIREKSI", "bank-org", "cabang-1"],
  ["finance", "FINANCE", "bank-org", "cabang-1"],
  ["finance_checker", "FINANCE", "bank-org", "cabang-1"],
  ["penjamin", "PENJAMIN", "partner-1", ""],
  ["obligee", "OBLIGEE", "obligee-apbn", ""],
  ["obligee_private", "OBLIGEE", "obligee-private", ""],
  ["broker", "BROKER", "broker-1", ""],
  ["litigation", "LITIGATION", "bank-org", "cabang-1"],
  ["legal", "LEGAL", "bank-org", "cabang-1"],
  ["audit", "AUDIT", "bank-org", "cabang-1"],
  ["admin", "ADMIN", "bank-org", "cabang-1"],
  ["config_checker", "CONFIG_CHECKER", "bank-org", "cabang-1"],
  ["worker", "WORKER", "bank-org", "cabang-1"],
] as const;
export function bootstrap(s: Store, encoded: string, key: string) {
  req(
    /^[a-f0-9]{64}$/.test(key || ""),
    "BACKEND_SETUP_REQUIRED",
    "Kunci penyimpanan belum dikonfigurasi",
    503,
  );
  const existing = s.maybe("policies", "policy-1");
  const marker = s.maybe("anchors", "storage-key");
  if (existing) {
    req(
      marker?.fingerprint === hash(key),
      "KEY_MISMATCH",
      "Kunci penyimpanan berubah; hubungi administrator",
      503,
    );
    return;
  }
  let passwords: Data;
  try {
    passwords = JSON.parse(encoded || "{}");
  } catch {
    passwords = {};
  }
  req(
    IDENTITIES.every(
      ([name]) =>
        typeof passwords[name] === "string" &&
        /^[a-f0-9]{32}:[a-f0-9]{64}$/.test(passwords[name]),
    ),
    "BACKEND_SETUP_REQUIRED",
    "Identitas awal belum dikonfigurasi",
    503,
  );
  validatePolicy(policy);
  s.add("anchors", {
    id: "storage-key",
    fingerprint: hash(key),
    algorithm: "AES-256-GCM",
    schema: 1,
  });
  s.add("policies", {
    id: "policy-1",
    version: 1,
    status: "ACTIVE",
    maker: "bootstrap",
    configuration: policy,
  });
  for (const [id, name, kind, extra] of [
    [
      "principal-1",
      "Kontraktor Uji",
      "PRINCIPAL",
      { nib: "1234567890123", entity_type: "COMPANY" },
    ],
    ["obligee-apbn", "Instansi APBN Uji", "OBLIGEE", { category: "APBN" }],
    ["obligee-bumd", "BUMD Uji", "OBLIGEE", { category: "BUMD" }],
    [
      "obligee-private",
      "Swasta Nasional Uji",
      "OBLIGEE",
      { category: "SWASTA_NASIONAL" },
    ],
    [
      "broker-1",
      "Broker Uji TEST ONLY",
      "BROKER",
      {
        license_verified: true,
        whitelisted: true,
        conflict: false,
        license_reference: "SANDBOX-NOT-OJK-LICENSE",
      },
    ],
  ] as [string, string, string, Data][])
    s.add("parties", { id, name, kind, ...extra });
  s.add("offices", {
    id: "cabang-1",
    name: "Kantor Pemroses Cabang Uji",
    type: "CABANG",
  });
  s.add("offices", {
    id: "kpo-1",
    name: "KPO Penerbit Warkat Uji",
    type: "KPO",
  });
  s.add("partners", {
    id: "partner-1",
    name: "Penjamin Syariah Uji",
    active: true,
    units: ["CABANG-UJI", "PUSAT-UJI"],
    pks: "PKS-SANDBOX-1",
  });
  for (const [id, role, org, office] of IDENTITIES)
    s.add("users", {
      id,
      username: id,
      password: passwords[id],
      role,
      org,
      office,
      active: true,
      name: id.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    });
  s.commit();
}
