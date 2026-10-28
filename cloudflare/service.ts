import {
  Store,
  DomainError,
  requireValue as req,
  uid,
  hash,
  canonical,
  money,
  amount,
  committee,
  splitUjrah,
  businessDue,
  jakartaDate,
  timestamp,
  dateOnly,
  encrypt,
  decrypt,
  predicate,
  type Data,
  type Row,
} from "./core.ts";
import { buildDocumentChecklist } from "./document-checklist.ts";
import { recordFiveC, reviewFiveC, counterReview, registerCollateral, approveCollateral,
  reserveCapacity, capacity, requestServicing, requestClosure, confirmClosure } from "./enterprise-controls.ts";
import {reviewServicing, partnerEndorse, approveServicing, rejectServicing,
  withdrawServicing, cancelApprovedServicing} from "./servicing-engine.ts";
export const BANK = new Set([
  "AO",
  "ANALYST",
  "COMPLIANCE",
  "MPO",
  "SUPPORT",
  "MPO_KPO",
  "KADEP_SUPPORT",
  "GH_BISNIS",
  "DIREKSI",
  "FINANCE",
  "LITIGATION",
  "LEGAL",
  "AUDIT",
  "MONITOR",
  "ADMIN",
  "CONFIG_CHECKER",
  "WORKER",
]);
export const OPS = ["MPO", "SUPPORT", "MPO_KPO", "KADEP_SUPPORT"];
const ACTIVE = [
  "BG_ISSUED",
  "KONTRA_BG_ISSUED",
  "DELIVERED_TO_OBLIGEE",
  "ACTIVE",
];
const signature = (digest: string, actor: string) => ({
  mode: "MOCK",
  signed_digest: digest,
  actor,
  reference: "DEV-SIGN-" + hash(digest + actor).slice(0, 20),
  notice: "Simulasi pengembangan; bukan tanda tangan PSrE",
});
const settle = (reference: string, value: string) => ({
  mode: "MOCK",
  status: "SETTLED",
  reference: "DEV-CORE-" + reference,
  amount: value,
  notice: "Bukan posting core banking nyata",
});
export class Service {
  chunks: { document: string; ordinal: number; bytes: ArrayBuffer }[] = [];
  s: Store;
  key: string;
  now: number;
  constructor(s: Store, key: string, now = Date.now()) {
    this.s = s;
    this.key = key;
    this.now = now;
  }
  get iso() {
    return new Date(this.now).toISOString();
  }
  role(actor: Data, roles: Iterable<string>) {
    req(
      [...roles].includes(actor.role),
      "FORBIDDEN",
      "Peran tidak berwenang",
      403,
    );
  }
  access(actor: Data, a: Row, write = false) {
    const role = actor.role;
    req(actor.bank === "bank-uat", "NOT_FOUND", "Data tidak ditemukan", 404);
    if (BANK.has(role)) {
      if (["AO", "ANALYST", ...OPS].includes(role))
        req(
          [a.processing_office, a.issuing_office].includes(actor.office),
          "NOT_FOUND",
          "Di luar scope kantor",
          404,
        );
      return;
    }
    let ok = false;
    if (role === "PRINCIPAL") ok = actor.org === a.principal;
    else if (role === "OBLIGEE") ok = actor.org === a.obligee;
    else if (role === "PENJAMIN") ok = actor.org === a.partner;
    else if (role === "BROKER") {
      const m = this.s.maybe("mandates", a.mandate || "");
      const b = this.s.maybe("parties", actor.org);
      ok = !!(
        m &&
        m.broker === actor.org &&
        m.principal === a.principal &&
        !m.revoked_at &&
        timestamp(m.expires) > this.now &&
        b?.whitelisted &&
        b.license_verified &&
        !b.conflict
      );
      if (write) ok = ok && a.state === "DRAFT" && m?.scope.includes("submit");
    }
    req(ok, "NOT_FOUND", "Data tidak ditemukan atau kuasa tidak aktif", 404);
  }
  audit(actor: Data, event: string, entity: string, details: Data) {
    const previous = this.s.auditHead();
    const payload = {
      sequence: previous ? previous.sequence + 1 : 1,
      previous_hash: previous?.digest || "0".repeat(64),
      actor: actor.id,
      role: actor.role,
      event,
      entity,
      at: this.iso,
      details,
    };
    const id = uid();
    this.s.add("audit_log", { id, ...payload, digest: hash(payload) });
    this.s.add("outbox", {
      id,
      event,
      entity,
      at: this.iso,
      mode: "MOCK",
      status: "PENDING",
    });
  }
  policy(a: Row) {
    return this.s.get("policies", a.policy_id).configuration;
  }
  docs(a: Row) {
    return this.s.rows("documents", { application_id: a.id });
  }
  doc(a: Row, id: string, kind?: string, verified = true) {
    const d = this.s.get("documents", id);
    req(
      d.application_id === a.id && (!kind || d.kind === kind),
      "DOCUMENT",
      "Dokumen tidak cocok dengan transaksi/jenis",
    );
    req(!verified || d.verified,
      "DOCUMENT", "Dokumen belum diverifikasi ke sumber primer");
    if(verified && kind)
      req(this.latest(a,kind).id===d.id,"DOCUMENT",
        "Versi dokumen yang dirujuk bukan versi terbaru",409);
    return d;
  }
  latest(a: Row, kind: string) {
    const docs = this.docs(a).filter(x => x.kind === kind)
      .sort((x,y) => (y.revision||0)-(x.revision||0) ||
        y.created_at.localeCompare(x.created_at));
    req(docs[0]?.verified, "DOCUMENT",
      "Versi dokumen terbaru " + kind + " harus diverifikasi");
    return docs[0];
  }
  addDocument(
    actor: Data,
    a: Row,
    kind: string,
    raw: Uint8Array,
    source = "",
    generated = false,
  ) {
    req(
      raw.length > 0 && raw.length <= 2000000,
      "DOCUMENT",
      "Ukuran dokumen 1 byte sampai 2 MB",
    );
    const id = uid();
    const encrypted = encrypt(raw, this.key, id);
    const doc = this.s.add("documents", {
      id,
      application_id: a.id,
      kind,
      revision: this.docs(a).filter(d=>d.kind===kind).length+1,
      digest: hash(raw),
      iv: encrypted.iv,
      tag: encrypted.tag,
      created_at: this.iso,
      uploaded_by: actor.id,
      source,
      verified: generated,
      mode: "MOCK",
      retention_until: new Date(this.now + 3660 * 86400000).toISOString(),
      legal_hold: false,
    });
    for (
      let offset = 0, ordinal = 0;
      offset < encrypted.bytes.length;
      offset += 262144, ordinal++
    )
      this.chunks.push({
        document: id,
        ordinal,
        bytes: Uint8Array.from(
          encrypted.bytes.subarray(offset, offset + 262144),
        ).buffer,
      });
    this.audit(actor, "DocumentAdded", a.id, {
      document: id,
      kind,
      hash: doc.digest,
    });
    return doc;
  }
  flush() {
    this.s.commit();
    for (const c of this.chunks)
      this.s.db.run(
        "INSERT INTO document_chunks(document_id,ordinal,bytes) VALUES (?,?,?)",
        c.document,
        c.ordinal,
        c.bytes,
      );
  }
  fingerprint(a: Data) {
    return hash(
      Object.fromEntries(
        [
          "principal",
          "obligee",
          "partner",
          "amount",
          "bg_type",
          "expires_on",
          "processing_office",
          "issuing_office",
          "custom_format",
          "revision",
          "draft_document",
        ].map((k) => [k, a[k] ?? null]),
      ),
    );
  }
  facts(a: Row) {
    const p = this.policy(a);
    const latestDocs = new Map<string,Row>();
    for(const d of this.docs(a)) {
      const current=latestDocs.get(d.kind);
      if(!current || (d.revision||0)>(current.revision||0) ||
        ((d.revision||0)===(current.revision||0) && d.created_at>current.created_at))
        latestDocs.set(d.kind,d);
    }
    const kinds = new Set([...latestDocs.values()].filter(d=>d.verified).map(d=>d.kind));
    const covered = new Set(
      p.rules["BR-06"].sp2_coverage_allowed
        ? (a.sp2?.covered_documents || []).filter(
            (x: string) => !p.rules["BR-06"].nonwaivable.includes(x),
          )
        : [],
    );
    const principal = this.s.get("parties", a.principal),
      partner = this.s.get("partners", a.partner),
      required = committee(a.category, a.amount, p);
    const roles = this.s
      .rows("approvals", { application_id: a.id })
      .filter((x) => x.fingerprint === this.fingerprint(a))
      .map((x) => x.role);
    const inter = a.processing_office !== a.issuing_office;
    return {
      default_or_justified:
        a.product === p.rules["BR-01"].default_product || !!a.justification,
      sp2_valid: !!(
        a.sp2 &&
        partner.active &&
        a.sp2.valid_to >= jakartaDate(this.now) &&
        a.sp2.fingerprint === this.fingerprint(a) &&
        money(a.sp2.amount) >= money(a.amount)
      ),
      eligible: p.rules["BR-03"].eligible_categories.includes(a.category),
      committee_complete: !required || roles.includes(required),
      slik_current: !!(
        a.slik &&
        p.rules["BR-05"].allowed_collectibility.includes(
          a.slik.collectibility,
        ) &&
        (!p.rules["BR-05"].same_month ||
          jakartaDate(timestamp(a.slik.pulled_at)).slice(0, 7) ===
            jakartaDate(this.now).slice(0, 7))
      ),
      documents_complete: p.rules["BR-06"].required_documents.every(
        (x: string) => kinds.has(x) || covered.has(x),
      ),
      format_approved:
        !a.custom_format ||
        p.rules["BR-07"].accepted_states.includes(a.format?.status),
      format_hash_matches:
        !a.custom_format ||
        a.format?.hash === this.s.get("documents", a.draft_document).digest,
      nib_present: !!principal.nib && kinds.has("NIB"),
      principal_office_request: !inter || kinds.has("PRINCIPAL_REQUEST"),
      mkp_interoffice: !inter || !!a.mkp?.interoffice,
      ememo_complete:
        !inter ||
        (a.ememo?.to === p.rules["BR-12"].to &&
          p.rules["BR-12"].cc.every((x: string) => a.ememo?.cc?.includes(x)) &&
          p.rules["BR-12"].attachments.every((x: string) =>
            a.ememo?.attachments?.includes(x),
          )),
      split_correct: true,
      split_timely: true,
      signer_authorized: true,
      portfolio_owned: a.portfolio_owner === a.processing_office,
    };
  }
  guard(a: Row, codes: string[]) {
    const p = this.policy(a),
      facts = this.facts(a);
    const results = codes.map((rule) => {
      const r = p.rules[rule];
      req(r, "POLICY", "Rule tidak ditemukan");
      const applicable = !r.when || predicate(r.when, facts);
      return {
        rule,
        applicable,
        passed: !applicable || predicate(r.assert, facts),
        message: r.message,
      };
    });
    const error = results.find((r) => !r.passed);
    req(
      !error,
      error?.rule || "RULE",
      error?.message || "Aturan tidak terpenuhi",
    );
    a.evaluations = [...(a.evaluations || []), { at: this.iso, results }].slice(
      -50,
    );
  }
  state(a: Row, ...states: string[]) {
    req(
      states.includes(a.state),
      "STATE",
      "Aksi tidak tersedia pada status " + a.state,
      409,
    );
  }
  task(a: Row, id: string, kind: string, days: number, details: Data = {}) {
    if (!this.s.maybe("tasks", id))
      this.s.add("tasks", {
        id,
        application_id: a.id,
        due: businessDue(this.now, days, this.policy(a).calendar),
        status: "OPEN",
        kind,
        ...details,
      });
  }
  finishTask(id: string) {
    const t = this.s.get("tasks", id);
    t.completed_at = this.iso;
    t.late = this.now > timestamp(t.due);
    t.status = "DONE";
  }
  post(
    actor: Data,
    a: Row,
    id: string,
    value: string,
    debit: string,
    credit: string,
  ) {
    req(money(value) > 0n, "JOURNAL", "Jumlah jurnal harus positif");
    this.s.add("journals", {
      id,
      application_id: a.id,
      at: this.iso,
      actor: actor.id,
      currency: "IDR",
      mode: "MOCK",
      lines: [
        { account: debit, debit: value, credit: "0" },
        { account: credit, debit: "0", credit: value },
      ],
    });
  }
  create(actor: Data, body: Data) {
    this.role(actor, ["PRINCIPAL", "AO", "BROKER"]);
    for (const field of [
      "principal",
      "obligee",
      "partner",
      "processing_office",
      "issuing_office",
    ])
      this.s.get(
        field === "partner"
          ? "partners"
          : field.includes("office")
            ? "offices"
            : "parties",
        body[field],
      );
    req(money(body.amount) > 0n, "AMOUNT", "Nominal harus positif");
    req((body.currency || "IDR") === "IDR", "CURRENCY", "Hanya IDR");
    req(
      dateOnly(body.expires_on) >= dateOnly(body.issue_on),
      "TENOR",
      "Tanggal akhir tidak valid",
    );
    const policies = this.s
      .rows("policies", { status: "ACTIVE" })
      .filter(
        (p) =>
          p.configuration.effective_from <= body.issue_on &&
          body.issue_on < p.configuration.effective_to,
      );
    req(
      policies.length === 1,
      "POLICY",
      "Harus tersedia tepat satu policy efektif",
    );
    const p = policies[0].configuration,
      principal = this.s.get("parties", body.principal),
      obligee = this.s.get("parties", body.obligee);
    req(
      principal.kind === "PRINCIPAL" && obligee.kind === "OBLIGEE",
      "PARTY",
      "Jenis pihak tidak sesuai",
    );
    if (actor.role === "PRINCIPAL")
      req(actor.org === principal.id, "FORBIDDEN", "Principal berbeda", 403);
    if (actor.role === "AO")
      req(
        actor.office === body.processing_office,
        "FORBIDDEN",
        "Scope kantor berbeda",
        403,
      );
    req(
      p.pks.types.includes(body.bg_type),
      "PRODUCT",
      "Jenis BG tidak dijamin PKS",
    );
    req(
      (Date.parse(body.expires_on) - Date.parse(body.issue_on)) / 86400000 <=
        p.pks.max_tenor_days,
      "TENOR",
      "Tenor di luar PKS",
    );
    const a = this.s.add("applications", {
      ...body,
      id: uid(),
      principal: principal.id,
      obligee: obligee.id,
      partner: body.partner,
      maker: actor.id,
      policy_id: policies[0].id,
      state: "DRAFT",
      version: 0,
      amount: amount(money(body.amount)),
      currency: "IDR",
      product: body.product || p.rules["BR-01"].default_product,
      category: obligee.category,
      revision: 1,
      created_at: this.iso,
      portfolio_owner: body.processing_office,
      fee_disclosure: {
        bank: p.pks.admin_fee,
        ijp: p.pks.ijp,
        broker: body.mandate ? p.pks.broker_commission : "0",
      },
      evaluations: [],
    });
    this.access(actor, a, true);
    this.audit(actor, "ApplicationCreated", a.id, {
      policy: policies[0].id,
      snapshot_hash: hash(a),
    });
    const draft = this.addDocument(
      actor,
      a,
      "DRAFT_BG",
      Buffer.from(
        canonical({
          template: "BG syariah sandbox",
          principal: a.principal,
          obligee: a.obligee,
          amount: a.amount,
          expires_on: a.expires_on,
          type: a.bg_type,
        }),
      ),
      "",
      true,
    );
    a.draft_document = draft.id;
    return this.view(actor, a);
  }
  view(actor: Data, a: Row) {
    this.access(actor, a);
    const fields = [
      "project_name",
      "amount",
      "currency",
      "bg_type",
      "category",
      "issue_on",
      "expires_on",
      "processing_office",
      "issuing_office",
      "portfolio_owner",
      "custom_format",
      "fee_disclosure",
      "bg_number",
      "committee_role",
    ];
    const out: Data = {
      id: a.id,
      state: a.state,
      version: a.version,
      principal: a.principal,
      obligee: a.obligee,
      partner: a.partner,
      mode: "SANDBOX",
      ...Object.fromEntries(fields.map((k) => [k, a[k] ?? null])),
      documents: [],
    };
    if (["PRINCIPAL","BROKER","PENJAMIN"].includes(actor.role) || BANK.has(actor.role)) {
      out.document_checklist = buildDocumentChecklist(a, this.docs(a), actor.role);
    }
    if (
      BANK.has(actor.role) ||
      ["PRINCIPAL", "PENJAMIN"].includes(actor.role)
    ) {
      out.workflow = structuredClone(a);
      out.documents = this.docs(a).map((d) => ({
        id: d.id,
        kind: d.kind,
        sha256: d.digest,
        verified: d.verified,
      }));
    }
    if (actor.role === "OBLIGEE")
      out.documents = this.docs(a)
        .filter((d) =>
          ["BG", "CLAIM", "WITHDRAWAL", "DELIVERY"].includes(d.kind),
        )
        .map((d) => ({
          id: d.id,
          kind: d.kind,
          sha256: d.digest,
          verified: d.verified,
        }));
    if (actor.role === "PENJAMIN") {
      out.workflow = Object.fromEntries(
        ["sp2", "format", "certificate", "draft_document"].map((k) => [
          k,
          a[k] ?? null,
        ]),
      );
      out.documents = out.documents.filter((d: Data) =>
        [
          "SP2KBG",
          "CONTRACT",
          "DRAFT_BG",
          "FORMAT_APPROVAL",
          "CERTIFICATE",
        ].includes(d.kind),
      );
    }
    return out;
  }
  execute(
    actor: Data,
    a: Row,
    cmd: string,
    x: Data,
    version: number,
    key: string,
  ) {
    this.access(actor, a, actor.role === "BROKER");
    const rh = hash({ application: a.id, command: cmd, payload: x, version }),
      old = this.s.maybe("command_receipts", key);
    if (old) {
      req(
        old.actor === actor.id && old.request_hash === rh,
        "IDEMPOTENCY",
        "Kunci idempotensi sudah digunakan",
        409,
      );
      return old.result;
    }
    req(
      a.version === version,
      "VERSION",
      "Versi berubah; muat ulang transaksi",
      409,
    );
    const before = a.state;
    this.command(actor, a, cmd, x);
    a.version++;
    this.audit(actor, cmd, a.id, {
      from: before,
      to: a.state,
      version: a.version,
      evidence_hash: hash(x),
      policy: a.policy_id,
    });
    const result = this.view(actor, a);
    this.s.add("command_receipts", {
      id: key,
      actor: actor.id,
      request_hash: rh,
      result,
    });
    return result;
  }
  command(actor: Data, a: Row, cmd: string, x: Data) {
    const p = this.policy(a),
      role = actor.role,
      inter = a.processing_office !== a.issuing_office;
    switch (cmd) {
      case "record_5c":
        recordFiveC(this,actor,a,x);
        break;
      case "review_5c":
        reviewFiveC(this,actor,a,x);
        break;
      case "review_counter":
        counterReview(this,actor,a,x);
        break;
      case "register_collateral":
        registerCollateral(this,actor,a,x);
        break;
      case "approve_collateral":
        approveCollateral(this,actor,a,x);
        break;
      case "reserve_limit":
        reserveCapacity(this,actor,a);
        break;
      case "request_servicing":
        requestServicing(this,actor,a,x);
        break;
      case "review_servicing":
        reviewServicing(this,actor,a,x);
        break;
      case "partner_endorse":
        partnerEndorse(this,actor,a,x);
        break;
      case "approve_servicing":
        approveServicing(this,actor,a,x);
        break;
      case "reject_servicing":
        rejectServicing(this,actor,a,x);
        break;
      case "withdraw_servicing":
        withdrawServicing(this,actor,a,x);
        break;
      case "cancel_approved_servicing":
        cancelApprovedServicing(this,actor,a,x);
        break;
      case "request_bg_closure":
        requestClosure(this,actor,a,x);
        break;
      case "confirm_bg_closure":
        confirmClosure(this,actor,a);
        break;
      case "submit":
        this.role(actor, ["PRINCIPAL", "AO", "BROKER"]);
        this.state(a, "DRAFT");
        this.guard(a, ["BR-01", "BR-03", "BR-09"]);
        req(
          a.product === "BG_CONTRA",
          "PRODUCT",
          "Skema alternatif memerlukan persetujuan kebijakan terpisah",
        );
        req(
          !a.mandate || x.commission_accepted === true,
          "DISCLOSURE",
          "Komisi broker wajib diungkapkan dan disetujui Principal",
        );
        if (a.mandate)
          req(
            this.s.get("mandates", a.mandate).commission_disclosed === true,
            "DISCLOSURE",
            "Kuasa belum memuat disclosure",
          );
        a.submitted_by = actor.id;
        a.state = "KYC_KYB_CHECK";
        break;
      case "kyb_pass":
        this.role(actor, ["COMPLIANCE"]);
        this.state(a, "KYC_KYB_CHECK");
        this.guard(a, ["BR-09"]);
        this.latest(a, "KYB");
        req(
          x.screening_clear === true && x.ubo_verified === true,
          "KYB",
          "UBO dan screening belum selesai",
        );
        a.kyb = { at: this.iso, checker: actor.id };
        a.state = "SLIK_CHECK";
        break;
      case "record_slik":
        this.role(actor, ["ANALYST"]);
        this.state(a, "SLIK_CHECK");
        this.doc(a, x.document, "SLIK");
        req(
          Number.isInteger(x.collectibility) &&
            x.collectibility >= 1 &&
            x.collectibility <= 5,
          "BR-05",
          "Kolektibilitas tidak valid",
        );
        req(
          timestamp(x.pulled_at) <= this.now,
          "BR-05",
          "Tanggal tarik di masa depan",
        );
        a.slik = {
          collectibility: x.collectibility,
          pulled_at: new Date(timestamp(x.pulled_at)).toISOString(),
          document: x.document,
        };
        this.guard(a, ["BR-05"]);
        a.state = "PENJAMIN_REQUESTED";
        break;
      case "partner_start":
        this.role(actor, ["PENJAMIN"]);
        this.state(a, "PENJAMIN_REQUESTED");
        a.state = "PENJAMIN_UNDERWRITING";
        break;
      case "sp2_issue": {
        this.role(actor, ["PENJAMIN"]);
        this.state(a, "PENJAMIN_UNDERWRITING");
        this.doc(a, x.document, "SP2KBG");
        const partner = this.s.get("partners", a.partner);
        req(
          partner.active && partner.units.includes(x.issuing_unit),
          "BR-02",
          "Unit penjamin tidak aktif/tercatat",
        );
        req(
          money(x.amount) >= money(a.amount),
          "BR-02",
          "Nilai SP2KBG tidak cukup",
        );
        req(
          dateOnly(x.valid_to) >= jakartaDate(this.now),
          "BR-02",
          "SP2KBG kedaluwarsa",
        );
        a.sp2 = {
          reference: x.reference,
          issuing_unit: x.issuing_unit,
          document: x.document,
          amount: amount(money(x.amount)),
          valid_to: x.valid_to,
          fingerprint: this.fingerprint(a),
          coverage: p.pks.coverage,
          covered_documents: x.covered_documents || [],
        };
        a.state = "SP2KBG_ISSUED";
        break;
      }
      case "bank_underwrite":
        this.role(actor, ["ANALYST"]);
        this.state(a, "SP2KBG_ISSUED");
        // New structured 5C cases are fail-closed; legacy sandbox applications remain
        // compatible until the institutional policy activates mandatory 5C.
        if (a.underwriting_id) {
          const review = this.s.get("underwritings",a.underwriting_id);
          req(review.state==="REVIEWED" && review.application_fingerprint===this.fingerprint(a) &&
            review.recommendation==="LAYAK",
            "UNDERWRITING","5C harus disetujui dengan rekomendasi layak",409);
        }
        if (a.counter_review) {
          req(a.counter_review.application_fingerprint===this.fingerprint(a) &&
            a.counter_review.status==="VERIFIED_SANDBOX",
            "COUNTER","Review KBG tidak lagi valid",409);
        }
        this.guard(a, ["BR-02", "BR-03", "BR-05", "BR-06"]);
        a.committee_role = committee(a.category, a.amount, p);
        a.state = a.custom_format ? "CUSTOM_FORMAT_REVIEW" : "APPROVAL";
        break;
      case "approve_format": {
        this.role(actor, ["PENJAMIN"]);
        this.state(a, "CUSTOM_FORMAT_REVIEW");
        this.doc(a, x.document, "FORMAT_APPROVAL");
        req(
          x.signed_and_stamped === true,
          "BR-08",
          "Bukti TTD/stempel diperlukan",
        );
        const draft = this.s.get("documents", a.draft_document);
        req(x.draft_hash === draft.digest, "BR-08", "Hash draft tidak cocok");
        a.format = {
          status: "APPROVED_SCAN",
          hash: draft.digest,
          document: x.document,
          approver: actor.id,
        };
        this.task(
          a,
          "original:" + a.id,
          "ORIGINAL",
          p.rules["BR-07"].original_business_days,
        );
        a.state = "APPROVAL";
        break;
      }
      case "approve": {
        this.state(a, "APPROVAL");
        const required = [
          "MPO",
          ...(a.committee_role ? [a.committee_role] : []),
        ];
        this.role(actor, required);
        req(
          ![a.maker, a.submitted_by].includes(actor.id),
          "SOD",
          "Maker tidak boleh approve",
          403,
        );
        const decisions = this.s.rows("approvals", { application_id: a.id });
        req(
          !decisions.some((r) => r.role === role),
          "APPROVAL",
          "Keputusan peran sudah ada",
          409,
        );
        this.s.add("approvals", {
          id: uid(),
          application_id: a.id,
          actor: actor.id,
          role,
          fingerprint: this.fingerprint(a),
          at: this.iso,
        });
        if (
          required.every((r) =>
            [...decisions.map((d) => d.role), role].includes(r),
          )
        ) {
          this.guard(a, ["BR-04", "BR-07", "BR-08"]);
          a.state = "APPROVAL_GRANTED";
        }
        break;
      }
      case "sign_mkp": {
        this.role(actor, OPS);
        this.state(a, "APPROVAL_GRANTED");
        const doc = this.addDocument(
          actor,
          a,
          "MKP",
          Buffer.from(
            canonical({
              application: a.id,
              fingerprint: this.fingerprint(a),
              interoffice: inter,
            }),
          ),
          "",
          true,
        );
        a.mkp = {
          document: doc.id,
          interoffice: inter,
          signature: signature(doc.digest, actor.id),
        };
        a.state = "MKP_SIGNED";
        break;
      }
      case "sign_akad":
        this.role(actor, ["PRINCIPAL", ...OPS]);
        this.state(a, "MKP_SIGNED");
        req(
          role !== "PRINCIPAL" || actor.org === a.principal,
          "SOD",
          "Principal akad berbeda",
          403,
        );
        a.akad_signatures = {
          ...(a.akad_signatures || {}),
          [role === "PRINCIPAL" ? "PRINCIPAL" : "BANK"]: signature(
            this.fingerprint(a),
            actor.id,
          ),
        };
        if (a.akad_signatures.PRINCIPAL && a.akad_signatures.BANK) {
          const doc = this.addDocument(
            actor,
            a,
            "AKAD",
            Buffer.from(
              canonical({
                type: "KAFALAH_BIL_UJRAH",
                fees: a.fee_disclosure,
                dps: p.pks.dps_reference,
                signatures: a.akad_signatures,
              }),
            ),
            "",
            true,
          );
          a.akad_document = doc.id;
          a.state = "AKAD_SIGNED";
        }
        break;
      case "collect_fee": {
        this.role(actor, ["FINANCE"]);
        this.state(a, "AKAD_SIGNED");
        const value = amount(money(p.pks.admin_fee) + money(p.pks.ijp));
        a.fee = {
          amount: value,
          admin_income: p.pks.admin_fee,
          booked_at: this.iso,
          actor: actor.id,
          receipt: settle(a.id, value),
        };
        this.post(
          actor,
          a,
          "fee:" + a.id,
          value,
          "CASH",
          "FEE_AND_IJP_PAYABLE",
        );
        if (inter) {
          this.s.add("distributions", {
            id: a.id,
            application_id: a.id,
            status: "DUE",
            amount: splitUjrah(p.pks.admin_fee, p),
            booked_at: this.iso,
            maker: actor.id,
            source: a.processing_office,
            target: a.issuing_office,
          });
          this.task(
            a,
            "split:" + a.id,
            "SPLIT",
            p.rules["BR-14"].business_days,
          );
        }
        a.state = "FEE_COLLECTED";
        break;
      }
      case "ememo": {
        this.role(actor, OPS);
        this.state(a, "FEE_COLLECTED");
        this.latest(a, "PRINCIPAL_REQUEST");
        req(inter, "BR-10", "Bukan penerbitan antar kantor");
        a.ememo = { to: x.to, cc: x.cc, attachments: x.attachments };
        this.guard(a, ["BR-10", "BR-11", "BR-12"]);
        const doc = this.addDocument(
          actor,
          a,
          "EMEMO",
          Buffer.from(canonical(a.ememo)),
          "",
          true,
        );
        a.ememo.document = doc.id;
        a.state = "INTER_OFFICE_ISSUANCE";
        break;
      }
      case "issue": {
        this.state(a, "FEE_COLLECTED", "INTER_OFFICE_ISSUANCE");
        const office = this.s.get("offices", a.issuing_office);
        this.role(actor, p.rules["BR-15"].signers[office.type]);
        req(
          actor.office === a.issuing_office,
          "BR-15",
          "Signer bukan kantor penerbit",
          403,
        );
        req(actor.id !== a.maker, "SOD", "Maker tidak boleh menerbitkan", 403);
        req(
          p.effective_from <= jakartaDate(this.now) &&
            jakartaDate(this.now) < p.effective_to,
          "POLICY",
          "Policy tidak lagi efektif",
        );
        req(a.expires_on >= jakartaDate(this.now), "TENOR", "BG kedaluwarsa");
        this.guard(
          a,
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16].map(
            (n) => "BR-" + String(n).padStart(2, "0"),
          ),
        );
        // A guarantee keeps consuming capacity through all issued states and open claims.
        // Reservations from *other* applications also consume capacity.
        const exposure = capacity(this,a);
        req(
          exposure.partner + money(a.amount) <= money(p.pks.partner_limit) &&
            exposure.principal + money(a.amount) <= money(p.pks.principal_limit),
          "LIMIT","Kapasitas penjamin atau Principal tidak cukup",
        );
        const collateral = this.s.rows("collaterals",{application_id:a.id});
        req(collateral.every(c=>c.state==="VERIFIED" &&
          c.application_fingerprint===this.fingerprint(a)),
          "COLLATERAL","Agunan harus diverifikasi dan sesuai revisi transaksi",409);
        if (a.counter_review) {
          req(a.counter_review.application_fingerprint===this.fingerprint(a) &&
            a.counter_review.status==="VERIFIED_SANDBOX" &&
            a.counter_review.pks_reference===this.s.get("partners",a.partner).pks,
            "COUNTER","PKS/analisa KBG perlu diperiksa ulang",409);
        }
        const reservation = this.s.maybe("limit_reservations",a.id);
        if (reservation) {
          req(reservation.status==="RESERVED" &&
            reservation.application_fingerprint===this.fingerprint(a),
            "LIMIT","Reservasi tidak lagi valid",409);
          reservation.status="CONSUMED";
          reservation.consumed_at=this.iso;
        }
        const number =
            "BG-" +
            new Date(this.now).getUTCFullYear() +
            "-" +
            String(this.s.rows("guarantees").length + 1).padStart(8, "0"),
          token = randomToken();
        const encrypted = encrypt(Buffer.from(token), this.key, a.id);
        const signed = signature(
          this.s.get("documents", a.draft_document).digest,
          actor.id,
        );
        this.s.add("guarantees", {
          id: a.id,
          application_id: a.id,
          token_hash: hash(token),
          number,
          token_cipher: encrypted.bytes.toString("base64"),
          iv: encrypted.iv,
          tag: encrypted.tag,
          signature: signed,
          issued_at: this.iso,
          claim_deadline: new Date(
            Date.parse(a.expires_on + "T23:59:59.999+07:00") +
              p.pks.claim_window_days * 86400000,
          ).toISOString(),
          mode: "MOCK",
        });
        a.state = "BG_ISSUED";
        a.bg_number = number;
        this.addDocument(
          actor,
          a,
          "BG",
          Buffer.from(
            canonical({
              number,
              principal: a.principal,
              obligee: a.obligee,
              amount: a.amount,
              expires_on: a.expires_on,
              approved_draft_hash: signed.signed_digest,
              signature: signed,
              mode: "MOCK",
            }),
          ),
          "",
          true,
        );
        this.post(
          actor,
          a,
          "contingent:" + a.id,
          a.amount,
          "OFF_BALANCE_BG",
          "OFF_BALANCE_CONTRA",
        );
        break;
      }
      case "certificate":
        this.role(actor, ["PENJAMIN"]);
        this.state(a, "BG_ISSUED");
        this.doc(a, x.document, "CERTIFICATE");
        a.certificate = { reference: x.reference, document: x.document };
        a.state = "KONTRA_BG_ISSUED";
        break;
      case "deliver":
        this.role(actor, OPS);
        this.state(a, "KONTRA_BG_ISSUED");
        this.doc(a, x.document, "DELIVERY");
        a.delivery = { document: x.document, at: this.iso };
        a.state =
          a.issue_on <= jakartaDate(this.now)
            ? "ACTIVE"
            : "DELIVERED_TO_OBLIGEE";
        break;
      case "distribute": {
        this.role(actor, ["FINANCE"]);
        const d = this.s.get("distributions", a.id);
        req(
          d.maker !== actor.id,
          "SOD",
          "Pembuku dan checker wajib berbeda",
          403,
        );
        req(d.status === "DUE", "STATE", "Distribusi sudah selesai", 409);
        d.settled_at = this.iso;
        d.receipt = settle("split:" + a.id, d.amount);
        d.status = "SETTLED";
        this.post(
          actor,
          a,
          "split:" + a.id,
          d.amount,
          "PROCESSING_OFFICE_DUE",
          "ISSUING_OFFICE_RECEIVABLE",
        );
        this.finishTask("split:" + a.id);
        break;
      }
      case "original_received":
        this.role(actor, OPS);
        this.doc(a, x.document, "ORIGINAL_RECEIPT");
        req(
          a.format?.status === "APPROVED_SCAN",
          "STATE",
          "Tidak ada asli outstanding",
          409,
        );
        a.format.status = "ORIGINAL_RECEIVED";
        this.finishTask("original:" + a.id);
        break;
      default:
        throw new DomainError("COMMAND", "Perintah tidak didukung");
    }
  }
  verify(token: string) {
    const g = this.s
      .rows("guarantees")
      .find((g) => g.token_hash === hash(token));
    if (!g)
      return {
        authentic: false,
        valid: false,
        status: "NOT_FOUND",
        message: "BG tidak ditemukan atau tidak valid",
      };
    const a = this.s.get("applications", g.id),
      today = jakartaDate(this.now),
      valid = g.status!=="CLOSED" && a.state!=="CLOSED" &&
        a.issue_on <= today && today <= a.expires_on;
    return {
      authentic: true,
      valid,
      status: valid
        ? "AUTHENTIC_ACTIVE"
        : g.status==="CLOSED" || a.state==="CLOSED" ? "AUTHENTIC_CLOSED"
        : today > a.expires_on
          ? "AUTHENTIC_EXPIRED"
          : "NOT_YET_EFFECTIVE",
      message: valid
        ? "BG asli dan masih berlaku"
        : "BG asli tetapi tidak berlaku saat ini",
      number: g.number,
      amount: a.amount,
      currency: "IDR",
      principal: this.s.get("parties", a.principal).name,
      obligee: this.s.get("parties", a.obligee).name,
      expires_on: a.expires_on,
      claim_window_open: g.status!=="CLOSED" && this.now <= timestamp(g.claim_deadline),
      mode: "SANDBOX",
    };
  }
  receiveClaim(actor: Data, a: Row, body: Data) {
    this.access(actor, a);
    this.role(actor, ["OBLIGEE"]);
    const g = this.s.get("guarantees", a.id);
    req(
      this.now <= timestamp(g.claim_deadline),
      "CLAIM_WINDOW",
      "Batas penerimaan klaim telah berlalu",
    );
    const doc = this.doc(a, body.document, "CLAIM", false);
    req(doc.uploaded_by === actor.id, "CLAIM", "Bukti harus dari Obligee");
    const value = money(body.amount);
    req(value > 0n, "CLAIM", "Nominal klaim harus positif");
    const total = this.s
      .rows("claims", { application_id: a.id })
      .filter((c) => !["WITHDRAWN", "REJECTED"].includes(c.state))
      .reduce((n, c) => n + money(c.amount), 0n);
    req(
      total + value <= money(a.amount),
      "CLAIM_LIMIT",
      "Klaim melebihi sisa kewajiban",
    );
    const p = this.policy(a),
      c = this.s.add("claims", {
        id: uid(),
        application_id: a.id,
        state: "CLAIM_RECEIVED",
        version: 0,
        amount: amount(value),
        document: doc.id,
        received_at: this.iso,
        monitor_owner: p.rules["BR-19"].owner,
        cc: p.rules["BR-19"].cc,
      });
    this.task(
      a,
      "report:" + c.id,
      "CLAIM_REPORT",
      p.rules["BR-18"].business_days,
      { claim: c.id, recipients: p.rules["BR-18"].recipients },
    );
    this.audit(actor, "ClaimReceived", c.id, {
      application: a.id,
      amount: c.amount,
    });
    return c;
  }
  litigation(actor: Data, a: Row, c: Row, reason: string) {
    if (!this.s.maybe("litigation", c.id)) {
      this.s.add("litigation", {
        id: c.id,
        application_id: a.id,
        claim_id: c.id,
        state: "OPEN",
        reason,
        owner: "LITIGATION",
        opened_at: this.iso,
      });
      this.audit(actor, "LitigationOpened", c.id, {
        reason,
        application: a.id,
      });
    }
  }
  claimCommand(
    actor: Data,
    c: Row,
    cmd: string,
    x: Data,
    version: number,
    key: string,
  ) {
    const a = this.s.get("applications", c.application_id);
    this.access(actor, a);
    const rh = hash({ claim: c.id, cmd, payload: x, version }),
      old = this.s.maybe("command_receipts", key);
    if (old) {
      req(
        old.actor === actor.id && old.request_hash === rh,
        "IDEMPOTENCY",
        "Kunci sudah digunakan",
        409,
      );
      return old.result;
    }
    req(c.version === version, "VERSION", "Versi klaim berubah", 409);
    const p = this.policy(a),
      before = c.state;
    switch (cmd) {
      case "report":
        this.role(actor, OPS);
        this.state(c, "CLAIM_RECEIVED");
        this.finishTask("report:" + c.id);
        c.reported_at = this.iso;
        c.state = "CLAIM_VALIDATION";
        break;
      case "approve_claim":
        this.role(actor, OPS);
        this.state(c, "CLAIM_VALIDATION");
        this.doc(a, c.document, "CLAIM");
        req(
          x.instrument_conditions_met === true,
          "CLAIM",
          "Syarat warkat belum terpenuhi",
        );
        c.approved_by = actor.id;
        c.state = "CLAIM_APPROVED";
        break;
      case "pay_bank":
        this.role(actor, ["FINANCE"]);
        this.state(c, "CLAIM_APPROVED");
        req(
          c.approved_by !== actor.id,
          "SOD",
          "Maker payout harus berbeda",
          403,
        );
        c.bank_payment = settle("claim:" + c.id, c.amount);
        c.bank_paid_at = this.iso;
        c.state = "CLAIM_PAID_BY_BANK";
        this.post(
          actor,
          a,
          "claim:" + c.id,
          c.amount,
          "CLAIM_RECEIVABLE",
          "CASH",
        );
        this.task(
          a,
          "contra-submit:" + c.id,
          "CONTRA_SUBMIT",
          p.pks.submit_business_days,
          { claim: c.id },
        );
        break;
      case "submit_contra": {
        const office = this.s.get("offices", a.processing_office);
        this.role(actor, p.rules["BR-17"].submitters[office.type]);
        req(
          actor.office === a.processing_office,
          "BR-17",
          "Scope kantor pemroses diperlukan",
          403,
        );
        this.state(c, "CLAIM_PAID_BY_BANK");
        this.doc(a, x.document, "CONTRA_CLAIM");
        c.submitted_at = this.iso;
        c.state = "KONTRA_CLAIM_SUBMITTED";
        this.finishTask("contra-submit:" + c.id);
        this.task(
          a,
          "contra-pay:" + c.id,
          "CONTRA_PAY",
          p.pks.payment_business_days,
          { claim: c.id },
        );
        break;
      }
      case "contra_decision":
        this.role(actor, ["PENJAMIN"]);
        this.state(c, "KONTRA_CLAIM_SUBMITTED");
        this.doc(a, x.document, "CONTRA_DECISION");
        req(
          ["PAID", "REJECTED", "DEFERRED"].includes(x.decision),
          "CLAIM",
          "Keputusan tidak valid",
        );
        c.contra_decision = {
          value: x.decision,
          at: this.iso,
          document: x.document,
          reason: x.reason || "",
        };
        c.state =
          x.decision === "PAID"
            ? "KONTRA_SETTLEMENT_PENDING"
            : "KONTRA_CLAIM_" + x.decision;
        if (p.rules["BR-20"].triggers.includes(x.decision))
          this.litigation(actor, a, c, x.decision);
        break;
      case "confirm_contra_paid":
        this.role(actor, ["FINANCE"]);
        this.state(
          c,
          "KONTRA_SETTLEMENT_PENDING",
          "KONTRA_CLAIM_REJECTED",
          "KONTRA_CLAIM_DEFERRED",
        );
        this.doc(a, x.document, "CONTRA_PAYMENT");
        c.contra_payment = settle("contra:" + c.id, c.amount);
        c.state = "KONTRA_CLAIM_PAID";
        this.post(
          actor,
          a,
          "contra:" + c.id,
          c.amount,
          "CASH",
          "CLAIM_RECEIVABLE",
        );
        this.finishTask("contra-pay:" + c.id);
        break;
      case "withdraw":
        this.role(actor, ["OBLIGEE"]);
        this.doc(a, x.document, "WITHDRAWAL");
        c.withdrawn_at = this.iso;
        c.state = "WITHDRAWN";
        break;
      case "refer_dispute":
        this.role(actor, ["LEGAL", ...OPS]);
        this.doc(a, x.document, "DISPUTE");
        this.litigation(actor, a, c, "PROBLEMATIC_DISPUTE");
        break;
      case "request_close":
      case "confirm_close": {
        const l = this.s.get("litigation", c.id);
        req(
          c.contra_payment || (c.withdrawn_at && !c.bank_paid_at),
          "BR-20",
          "Kasus hanya ditutup setelah pembayaran atau pencabutan dan rekonsiliasi keuangan",
        );
        if (cmd === "request_close") {
          this.role(actor, ["LITIGATION"]);
          this.doc(a, x.document, "RESOLUTION");
          l.close_maker = actor.id;
          l.resolution_document = x.document;
          l.state = "CLOSURE_PENDING";
        } else {
          this.role(actor, ["LEGAL"]);
          req(
            l.state === "CLOSURE_PENDING" && l.close_maker !== actor.id,
            "SOD",
            "Diperlukan checker Legal berbeda",
            403,
          );
          l.state = "CLOSED";
          l.closed_at = this.iso;
        }
        break;
      }
      default:
        throw new DomainError("COMMAND", "Perintah klaim tidak didukung");
    }
    c.version++;
    this.audit(actor, cmd, c.id, {
      from: before,
      to: c.state,
      version: c.version,
    });
    const result = structuredClone(c);
    this.s.add("command_receipts", {
      id: key,
      actor: actor.id,
      request_hash: rh,
      result,
    });
    return result;
  }
  tick(actor: Data) {
    this.role(actor, ["WORKER"]);
    let count = 0;
    for (const t of this.s.rows("tasks"))
      if (t.status === "OPEN" && timestamp(t.due) < this.now) {
        t.status = "OVERDUE";
        t.escalated_at = this.iso;
        count++;
        if (!this.s.maybe("notifications", t.id))
          this.s.add("notifications", {
            id: t.id,
            task: t.id,
            application: t.application_id,
            status: "IN_APP_ESCALATED",
            owner: "SUPPORT_OR_MPO",
            cc: "PENGEMBANGAN_BISNIS",
          });
        this.audit(actor, "SLAOverdue", t.application_id, {
          task: t.id,
          due: t.due,
        });
      }
    for (const a of this.s.rows("applications"))
      if (
        a.state === "DELIVERED_TO_OBLIGEE" &&
        a.issue_on <= jakartaDate(this.now)
      ) {
        a.state = "ACTIVE";
        a.version++;
        this.audit(actor, "BGActivated", a.id, {});
      }
    return { escalated: count };
  }
  download(actor: Data, id: string) {
    const doc = this.s.get("documents", id),
      a = this.s.get("applications", doc.application_id);
    this.access(actor, a);
    const scopes: Data = {
      PENJAMIN: [
        "SP2KBG",
        "CONTRACT",
        "DRAFT_BG",
        "FORMAT_APPROVAL",
        "CERTIFICATE",
      ],
      OBLIGEE: ["BG", "CLAIM", "WITHDRAWAL", "DELIVERY"],
      BROKER: ["NIB", "CONTRACT", "PRINCIPAL_REQUEST"],
    };
    if (scopes[actor.role])
      req(
        scopes[actor.role].includes(doc.kind),
        "FORBIDDEN",
        "Dokumen di luar scope",
        403,
      );
    req(
      !["ADMIN", "MONITOR", "WORKER"].includes(actor.role),
      "FORBIDDEN",
      "Tidak berwenang membaca isi dokumen",
      403,
    );
    const chunks = this.s.db.all(
      "SELECT bytes FROM document_chunks WHERE document_id=? ORDER BY ordinal",
      id,
    );
    const bytes = Buffer.concat(chunks.map((x) => Buffer.from(x.bytes)));
    const raw = decrypt(bytes, this.key, doc, id);
    req(hash(raw) === doc.digest, "INTEGRITY", "Hash dokumen tidak cocok", 409);
    this.audit(actor, "DocumentDownloaded", id, { hash: doc.digest });
    return raw;
  }
}
export function randomToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
}
