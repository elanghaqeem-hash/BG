import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone, date
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo
from sqlalchemy import select, func
from .db import *
from .rules import require, DomainError, money, enforce, evaluate, committee, split_ujrah, business_due
from .adapters import DevelopmentCore, DevelopmentSignature

BANK_ROLES = {"AO", "ANALYST", "COMPLIANCE", "MPO", "SUPPORT", "MPO_KPO", "KADEP_SUPPORT", "GH_BISNIS", "DIREKSI", "FINANCE", "LITIGATION", "LEGAL", "AUDIT", "MONITOR", "ADMIN", "CONFIG_CHECKER", "WORKER"}
OPS = {"MPO", "SUPPORT", "MPO_KPO", "KADEP_SUPPORT"}


def dumps(v): return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
def load(r): return json.loads(r.data)
def digest(v): return hashlib.sha256(v if isinstance(v, bytes) else dumps(v).encode()).hexdigest()
def uid(): return str(uuid4())
def iso(t): return t.astimezone(timezone.utc).isoformat()
def parse(t):
    value=datetime.fromisoformat(t)
    require(value.tzinfo is not None,"DATE","Timestamp harus menyertakan zona waktu")
    return value


class Service:
    def __init__(self, store, cipher, clock=None):
        self.store, self.cipher = store, cipher
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.core, self.signature = DevelopmentCore(), DevelopmentSignature()

    def get(self, s, cls, bank, key):
        r = s.get(cls, (bank, key))
        require(r is not None, "NOT_FOUND", "Data tidak ditemukan", 404)
        return r

    def rows(self, s, cls, bank, **filters):
        stmt = select(cls).where(cls.bank == bank)
        for k, v in filters.items(): stmt = stmt.where(getattr(cls, k) == v)
        return list(s.scalars(stmt))

    def role(self, actor, roles):
        require(actor["role"] in roles, "FORBIDDEN", "Peran tidak berwenang", 403)

    def access(self, s, actor, a, write=False):
        d, role = load(a), actor["role"]
        require(a.bank == actor["bank"], "NOT_FOUND", "Data tidak ditemukan", 404)
        if role in BANK_ROLES:
            if role in {"AO", "ANALYST", "MPO", "SUPPORT", "MPO_KPO", "KADEP_SUPPORT"}:
                require(actor["office"] in {d["processing_office"], d["issuing_office"]}, "NOT_FOUND", "Di luar scope kantor", 404)
            return
        if role == "PRINCIPAL": ok = actor["org"] == a.principal
        elif role == "OBLIGEE": ok = actor["org"] == a.obligee
        elif role == "PENJAMIN": ok = actor["org"] == a.partner
        elif role == "BROKER":
            m = s.get(Mandate, (a.bank, d.get("mandate", "")))
            md = load(m) if m else {}
            b = s.get(Party, (a.bank, actor["org"]))
            bd = load(b) if b else {}
            ok = bool(m and m.broker == actor["org"] and m.principal == a.principal and not md.get("revoked_at") and parse(md["expires"]) > self.clock() and bd.get("whitelisted") and bd.get("license_verified") and not bd.get("conflict"))
            if write: ok = ok and a.state == "DRAFT" and "submit" in md.get("scope", [])
        else: ok = False
        require(ok, "NOT_FOUND", "Data tidak ditemukan atau kuasa tidak aktif", 404)

    def audit(self, s, actor, kind, entity, details):
        bank = actor["bank"]
        previous = s.scalar(select(Audit).where(Audit.bank == bank).order_by(Audit.sequence.desc()).limit(1))
        payload = {"sequence": previous.sequence + 1 if previous else 1, "previous_hash": previous.digest if previous else "0" * 64,
                   "actor": actor["id"], "role": actor["role"], "event": kind, "entity": entity, "at": iso(self.clock()), "details": details}
        e = Audit(bank=bank, id=uid(), sequence=payload["sequence"], digest=digest(payload), data=dumps(payload))
        s.add(e)
        s.add(Outbox(bank=bank, id=e.id, data=dumps({"event": kind, "entity": entity, "at": payload["at"], "mode": "MOCK", "status": "PENDING"})))
        s.flush()

    def policy(self, s, a):
        p = self.get(s, Policy, a.bank, a.policy_id)
        return load(p)

    def docs(self, s, a):
        return self.rows(s, Document, a.bank, application_id=a.id)

    def doc(self, s, a, doc_id, kind=None, verified=True):
        r = self.get(s, Document, a.bank, doc_id)
        d = load(r)
        require(r.application_id == a.id and (not kind or r.kind == kind), "DOCUMENT", "Dokumen tidak cocok dengan transaksi/jenis")
        require(not verified or d.get("verified"), "DOCUMENT", "Dokumen belum diverifikasi ke sumber primer")
        return r

    def latest(self, s, a, kind, verified=True):
        docs = [r for r in self.docs(s, a) if r.kind == kind and (not verified or load(r).get("verified"))]
        require(docs, "DOCUMENT", f"Dokumen {kind} terverifikasi diperlukan")
        return max(docs, key=lambda r: load(r)["created_at"])

    def add_document(self, s, actor, a, kind, raw, source="", generated=False):
        require(0 < len(raw) <= 2_000_000, "DOCUMENT", "Ukuran dokumen 1 byte sampai 2 MB")
        r = Document(bank=a.bank, id=uid(), application_id=a.id, kind=kind, digest=digest(raw),
                     encrypted_bytes=self.cipher.encrypt(raw).decode(), data=dumps({"created_at": iso(self.clock()), "uploaded_by": actor["id"], "source": source,
                     "verified": generated, "mode": "MOCK", "retention_until": iso(self.clock()+timedelta(days=3660)), "legal_hold": False}))
        s.add(r); s.flush()
        self.audit(s, actor, "DocumentAdded", a.id, {"document": r.id, "kind": kind, "hash": r.digest})
        return r

    def create(self, s, actor, body):
        self.role(actor, {"PRINCIPAL", "AO", "BROKER"})
        for field in ("principal", "obligee", "partner", "processing_office", "issuing_office"):
            self.get(s, Partner if field == "partner" else Office if "office" in field else Party, actor["bank"], body[field])
        require(money(body["amount"]) > 0, "AMOUNT", "Nominal harus positif")
        require(body.get("currency", "IDR") == "IDR", "CURRENCY", "MVP hanya melayani IDR")
        require(date.fromisoformat(body["expires_on"]) >= date.fromisoformat(body["issue_on"]), "TENOR", "Tanggal akhir tidak valid")
        policies = [p for p in self.rows(s, Policy, actor["bank"], status="ACTIVE") if load(p)["effective_from"] <= body["issue_on"] < load(p)["effective_to"]]
        require(len(policies) == 1, "POLICY", "Harus tersedia tepat satu policy efektif")
        p = load(policies[0]); d = dict(body)
        principal, obligee = self.get(s, Party, actor["bank"], body["principal"]), self.get(s, Party, actor["bank"], body["obligee"])
        require(principal.kind == "PRINCIPAL" and obligee.kind == "OBLIGEE", "PARTY", "Jenis pihak tidak sesuai")
        if actor["role"] == "PRINCIPAL": require(actor["org"] == principal.id, "FORBIDDEN", "Principal berbeda", 403)
        if actor["role"] == "AO": require(actor["office"] == d["processing_office"], "FORBIDDEN", "Scope kantor berbeda", 403)
        require(d["bg_type"] in p["pks"]["types"], "PRODUCT", "Jenis BG tidak dijamin PKS")
        require((date.fromisoformat(d["expires_on"])-date.fromisoformat(d["issue_on"])).days <= p["pks"]["max_tenor_days"], "TENOR", "Tenor di luar PKS")
        d.update(amount=str(money(body["amount"])), currency="IDR", product=body.get("product") or p["rules"]["BR-01"]["default_product"],
                 category=load(obligee)["category"], revision=1, created_at=iso(self.clock()), portfolio_owner=d["processing_office"],
                 fee_disclosure={"bank": p["pks"]["admin_fee"], "ijp": p["pks"]["ijp"], "broker": p["pks"]["broker_commission"] if body.get("mandate") else "0"}, evaluations=[])
        a = Application(bank=actor["bank"], id=uid(), principal=principal.id, obligee=obligee.id, partner=d["partner"], maker=actor["id"], policy_id=policies[0].id, state="DRAFT", version=0, data=dumps(d))
        s.add(a); s.flush(); self.access(s, actor, a, write=True)
        self.audit(s, actor, "ApplicationCreated", a.id, {"policy": policies[0].id, "snapshot_hash": digest(d)})
        draft = self.add_document(s, actor, a, "DRAFT_BG", dumps({"template": "BG syariah sandbox", "principal": a.principal, "obligee": a.obligee, "amount": d["amount"], "expires_on": d["expires_on"], "type": d["bg_type"]}).encode(), generated=True)
        d["draft_document"] = draft.id; a.data = dumps(d)
        return self.view(s, actor, a)

    def facts(self, s, a, now=None):
        d, p, now = load(a), self.policy(s, a), now or self.clock()
        docs = self.docs(s, a); kinds = {x.kind for x in docs if load(x).get("verified")}
        required = set(p["rules"]["BR-06"]["required_documents"])
        covered = set(d.get("sp2", {}).get("covered_documents", [])) if p["rules"]["BR-06"]["sp2_coverage_allowed"] else set()
        covered -= set(p["rules"]["BR-06"]["nonwaivable"])
        principal = load(self.get(s, Party, a.bank, a.principal))
        slik = d.get("slik", {}); sp2 = d.get("sp2", {})
        local = now.astimezone(ZoneInfo(p["rules"]["BR-05"]["timezone"]))
        month_ok = bool(slik.get("pulled_at") and parse(slik["pulled_at"]).astimezone(ZoneInfo(p["rules"]["BR-05"]["timezone"])).strftime("%Y-%m") == local.strftime("%Y-%m"))
        partner = load(self.get(s, Partner, a.bank, a.partner))
        required_role = committee(d["category"], d["amount"], p)
        decisions = self.rows(s, Approval, a.bank, application_id=a.id)
        roles = {load(x)["role"] for x in decisions if load(x)["fingerprint"] == self.fingerprint(d)}
        fmt = d.get("format", {})
        current_draft = self.get(s, Document, a.bank, d["draft_document"])
        inter = d["processing_office"] != d["issuing_office"]
        ememo = d.get("ememo", {})
        return {"default_or_justified": d["product"] == p["rules"]["BR-01"]["default_product"] or bool(d.get("justification")),
                "sp2_valid": bool(sp2 and partner["active"] and sp2["valid_to"] >= local.date().isoformat() and sp2["fingerprint"] == self.fingerprint(d) and money(sp2["amount"]) >= money(d["amount"])),
                "eligible": d["category"] in p["rules"]["BR-03"]["eligible_categories"],
                "committee_complete": required_role is None or required_role in roles,
                "slik_current": bool(slik and slik.get("collectibility") in p["rules"]["BR-05"]["allowed_collectibility"] and (month_ok or not p["rules"]["BR-05"]["same_month"])),
                "documents_complete": required <= (kinds | covered),
                "format_approved": not d.get("custom_format") or fmt.get("status") in p["rules"]["BR-07"]["accepted_states"],
                "format_hash_matches": not d.get("custom_format") or fmt.get("hash") == current_draft.digest,
                "nib_present": bool(principal.get("nib") and "NIB" in kinds),
                "principal_office_request": not inter or "PRINCIPAL_REQUEST" in kinds,
                "mkp_interoffice": not inter or bool(d.get("mkp", {}).get("interoffice")),
                "ememo_complete": not inter or (ememo.get("to") == p["rules"]["BR-12"]["to"] and set(ememo.get("cc", [])) >= set(p["rules"]["BR-12"]["cc"]) and set(ememo.get("attachments", [])) >= set(p["rules"]["BR-12"]["attachments"])),
                "split_correct": True, "split_timely": True, "signer_authorized": True,
                "portfolio_owned": d["portfolio_owner"] == d["processing_office"],
                "claim_submitter_authorized": False, "claim_report_timely": False, "monitoring_assigned": False, "litigation_routed": False}

    def fingerprint(self, d):
        return digest({k: d.get(k) for k in ("principal", "obligee", "partner", "amount", "bg_type", "expires_on", "processing_office", "issuing_office", "custom_format", "revision", "draft_document")})

    def guard(self, s, a, d, codes, facts=None):
        results = enforce(codes, facts or self.facts(s, a), self.policy(s, a))
        d["evaluations"] = (d.get("evaluations", []) + [{"at": iso(self.clock()), "results": results}])[-50:]

    def task(self, s, a, task_id, kind, days, data):
        if not s.get(Task, (a.bank, task_id)):
            due = business_due(self.clock(), days, self.policy(s, a)["calendar"])
            s.add(Task(bank=a.bank, id=task_id, application_id=a.id, due=iso(due), status="OPEN", data=dumps({"kind": kind, **data})))

    def post(self, s, actor, a, ref, amount, debit, credit):
        require(money(amount)>0, "JOURNAL", "Jumlah jurnal harus positif")
        s.add(Journal(bank=a.bank, id=ref, application_id=a.id, data=dumps({"at": iso(self.clock()), "actor": actor["id"], "currency": "IDR", "mode": "MOCK", "lines": [{"account": debit, "debit": str(amount), "credit": "0"}, {"account": credit, "debit": "0", "credit": str(amount)}]})))

    def execute(self, s, actor, a, command, payload, version, key):
        self.access(s, actor, a, write=actor["role"] == "BROKER")
        request_hash = digest({"application": a.id, "command": command, "payload": payload, "version": version})
        receipt = s.get(Receipt, (a.bank, key))
        if receipt:
            rd = load(receipt)
            require(rd["actor"] == actor["id"] and rd["request_hash"] == request_hash, "IDEMPOTENCY", "Kunci idempotensi sudah digunakan", 409)
            return rd["result"]
        require(a.version == version, "VERSION", "Versi berubah; muat ulang transaksi", 409)
        d, p, before = load(a), self.policy(s, a), a.state
        self._command(s, actor, a, d, p, command, payload)
        a.version += 1; a.data = dumps(d)
        self.audit(s, actor, command, a.id, {"from": before, "to": a.state, "version": a.version, "evidence_hash": digest(payload), "policy": a.policy_id})
        result = self.view(s, actor, a)
        s.add(Receipt(bank=a.bank, id=key, data=dumps({"actor": actor["id"], "request_hash": request_hash, "result": result})))
        return result

    def _command(self, s, actor, a, d, p, cmd, x):
        role, now = actor["role"], self.clock()
        if cmd == "submit":
            self.role(actor, {"PRINCIPAL", "AO", "BROKER"}); self.state(a, "DRAFT")
            self.guard(s,a,d,["BR-01","BR-03","BR-09"])
            require(d["product"] == "BG_CONTRA", "PRODUCT", "Skema alternatif memerlukan produk dan persetujuan kebijakan terpisah")
            require(not d.get("mandate") or x.get("commission_accepted") is True, "DISCLOSURE", "Komisi broker wajib diungkapkan dan disetujui Principal")
            if d.get("mandate"):
                m = self.get(s,Mandate,a.bank,d["mandate"])
                require(load(m).get("commission_disclosed") is True, "DISCLOSURE", "Kuasa belum memuat disclosure Principal")
            d["submitted_by"] = actor["id"]; a.state="KYC_KYB_CHECK"
        elif cmd == "kyb_pass":
            self.role(actor,{"COMPLIANCE"}); self.state(a,"KYC_KYB_CHECK")
            self.guard(s,a,d,["BR-09"])
            for kind in ("KYB",): self.latest(s,a,kind)
            require(x.get("screening_clear") is True and x.get("ubo_verified") is True,"KYB","UBO dan screening belum selesai")
            d["kyb"]={"at":iso(now),"checker":actor["id"]}; a.state="SLIK_CHECK"
        elif cmd == "record_slik":
            self.role(actor,{"ANALYST"}); self.state(a,"SLIK_CHECK")
            doc=self.doc(s,a,x["document"],"SLIK")
            require(type(x["collectibility"]) is int and 1 <= x["collectibility"] <= 5,"BR-05","Kolektibilitas tidak valid")
            pulled=parse(x["pulled_at"]); require(pulled<=now,"BR-05","Tanggal tarik di masa depan")
            d["slik"]={"collectibility":x["collectibility"],"pulled_at":iso(pulled),"document":doc.id}
            a.data=dumps(d); self.guard(s,a,d,["BR-05"]); a.state="PENJAMIN_REQUESTED"
        elif cmd == "partner_start":
            self.role(actor,{"PENJAMIN"}); self.state(a,"PENJAMIN_REQUESTED"); a.state="PENJAMIN_UNDERWRITING"
        elif cmd == "sp2_issue":
            self.role(actor,{"PENJAMIN"}); self.state(a,"PENJAMIN_UNDERWRITING")
            doc=self.doc(s,a,x["document"],"SP2KBG")
            partner=load(self.get(s,Partner,a.bank,a.partner)); require(partner["active"],"BR-02","Penjamin tidak aktif")
            require(x.get("issuing_unit") in partner["units"],"BR-02","Unit penerbit tidak tercatat")
            require(money(x["amount"])>=money(d["amount"]),"BR-02","Nilai SP2KBG tidak cukup")
            require(date.fromisoformat(x["valid_to"])>=now.date(),"BR-02","SP2KBG kedaluwarsa")
            d["sp2"]={"reference":x["reference"],"issuing_unit":x["issuing_unit"],"document":doc.id,"amount":str(money(x["amount"])),"valid_to":x["valid_to"],"fingerprint":self.fingerprint(d),"coverage":p["pks"]["coverage"],"covered_documents":x.get("covered_documents",[])}
            a.state="SP2KBG_ISSUED"
        elif cmd == "bank_underwrite":
            self.role(actor,{"ANALYST"}); self.state(a,"SP2KBG_ISSUED")
            self.guard(s,a,d,["BR-02","BR-03","BR-05","BR-06"])
            d["committee_role"]=committee(d["category"],d["amount"],p); a.state="CUSTOM_FORMAT_REVIEW" if d.get("custom_format") else "APPROVAL"
        elif cmd == "approve_format":
            self.role(actor,{"PENJAMIN"}); self.state(a,"CUSTOM_FORMAT_REVIEW")
            evidence=self.doc(s,a,x["document"],"FORMAT_APPROVAL")
            require(x.get("signed_and_stamped") is True,"BR-08","Bukti TTD dan stempel penjamin diperlukan")
            draft=self.get(s,Document,a.bank,d["draft_document"])
            require(x.get("draft_hash")==draft.digest,"BR-08","Hash draft tidak cocok")
            d["format"]={"status":"APPROVED_SCAN","hash":draft.digest,"document":evidence.id,"approver":actor["id"]}
            self.task(s,a,"original:"+a.id,"ORIGINAL",p["rules"]["BR-07"]["original_business_days"],{})
            a.state="APPROVAL"
        elif cmd == "approve":
            self.state(a,"APPROVAL"); required={"MPO"}
            if d.get("committee_role"): required.add(d["committee_role"])
            self.role(actor,required)
            require(actor["id"] not in {a.maker,d.get("submitted_by")},"SOD","Maker tidak boleh approve",403)
            require(not any(load(r)["role"]==role for r in self.rows(s,Approval,a.bank,application_id=a.id)),"APPROVAL","Keputusan peran sudah ada",409)
            s.add(Approval(bank=a.bank,id=uid(),application_id=a.id,data=dumps({"actor":actor["id"],"role":role,"fingerprint":self.fingerprint(d),"at":iso(now)}))); s.flush()
            roles={load(r)["role"] for r in self.rows(s,Approval,a.bank,application_id=a.id)}
            if required<=roles: self.guard(s,a,d,["BR-04","BR-07","BR-08"]); a.state="APPROVAL_GRANTED"
        elif cmd == "sign_mkp":
            self.role(actor,OPS); self.state(a,"APPROVAL_GRANTED")
            content=dumps({"application":a.id,"fingerprint":self.fingerprint(d),"interoffice":d["processing_office"]!=d["issuing_office"]}).encode()
            doc=self.add_document(s,actor,a,"MKP",content,generated=True)
            d["mkp"]={"document":doc.id,"interoffice":d["processing_office"]!=d["issuing_office"],"signature":self.signature.sign(doc.digest,actor["id"])}; a.state="MKP_SIGNED"
        elif cmd == "sign_akad":
            self.role(actor,{"PRINCIPAL"}|OPS); self.state(a,"MKP_SIGNED")
            require(role!="PRINCIPAL" or actor["org"]==a.principal,"SOD","Principal akad berbeda",403)
            signatures=d.get("akad_signatures",{})
            signatures["PRINCIPAL" if role=="PRINCIPAL" else "BANK"]=self.signature.sign(self.fingerprint(d),actor["id"])
            d["akad_signatures"]=signatures
            if {"PRINCIPAL","BANK"}<=set(signatures):
                doc=self.add_document(s,actor,a,"AKAD",dumps({"type":"KAFALAH_BIL_UJRAH","fees":d["fee_disclosure"],"dps":p["pks"]["dps_reference"],"signatures":signatures}).encode(),generated=True)
                d["akad_document"]=doc.id; a.state="AKAD_SIGNED"
        elif cmd == "collect_fee":
            self.role(actor,{"FINANCE"}); self.state(a,"AKAD_SIGNED")
            amount=money(p["pks"]["admin_fee"])+money(p["pks"]["ijp"])
            d["fee"]={"amount":str(amount),"admin_income":p["pks"]["admin_fee"],"booked_at":iso(now),"actor":actor["id"],"receipt":self.core.settle(a.id, str(amount))}
            self.post(s,actor,a,"fee:"+a.id,str(amount),"CASH","FEE_AND_IJP_PAYABLE")
            if d["processing_office"]!=d["issuing_office"]:
                split=split_ujrah(p["pks"]["admin_fee"],p)
                s.add(Distribution(bank=a.bank,id=a.id,application_id=a.id,status="DUE",data=dumps({"amount":str(split),"booked_at":iso(now),"maker":actor["id"],"source":d["processing_office"],"target":d["issuing_office"]})))
                self.task(s,a,"split:"+a.id,"SPLIT",p["rules"]["BR-14"]["business_days"],{})
            a.state="FEE_COLLECTED"
        elif cmd == "ememo":
            self.role(actor,OPS); self.state(a,"FEE_COLLECTED")
            self.latest(s,a,"PRINCIPAL_REQUEST")
            require(d["processing_office"]!=d["issuing_office"],"BR-10","Bukan penerbitan antar kantor")
            d["ememo"]={"to":x["to"],"cc":x["cc"],"attachments":x["attachments"]}
            a.data=dumps(d); self.guard(s,a,d,["BR-10","BR-11","BR-12"])
            doc=self.add_document(s,actor,a,"EMEMO",dumps(d["ememo"]).encode(),generated=True); d["ememo"]["document"]=doc.id; a.state="INTER_OFFICE_ISSUANCE"
        elif cmd == "issue":
            self.state(a,"FEE_COLLECTED","INTER_OFFICE_ISSUANCE")
            office=load(self.get(s,Office,a.bank,d["issuing_office"]))
            self.role(actor,set(p["rules"]["BR-15"]["signers"][office["type"]]))
            require(actor["office"]==d["issuing_office"],"BR-15","Signer bukan Kantor Penerbit",403)
            require(actor["id"]!=a.maker,"SOD","Maker tidak boleh menerbitkan",403)
            require(p["effective_from"]<=now.date().isoformat()<p["effective_to"],"POLICY","Policy tidak lagi efektif")
            require(date.fromisoformat(d["expires_on"])>=now.astimezone(ZoneInfo("Asia/Jakarta")).date(),"TENOR","BG telah kedaluwarsa")
            self.guard(s,a,d,[f"BR-{n:02}" for n in (1,2,3,4,5,6,7,8,9,10,11,12,15,16)])
            others=[r for r in self.rows(s,Application,a.bank) if r.state in {"BG_ISSUED","KONTRA_BG_ISSUED","DELIVERED_TO_OBLIGEE","ACTIVE"}]
            total=sum((money(load(r)["amount"]) for r in others if r.partner==a.partner),Decimal(0))
            own=sum((money(load(r)["amount"]) for r in others if r.principal==a.principal),Decimal(0))
            require(total+money(d["amount"])<=money(p["pks"]["partner_limit"]) and own+money(d["amount"])<=money(p["pks"]["principal_limit"]),"LIMIT","Kapasitas penjamin atau Principal tidak cukup")
            count=s.scalar(select(func.count()).select_from(Guarantee).where(Guarantee.bank==a.bank))+1
            token=secrets.token_urlsafe(32); number=f"BG-{now.year}-{count:08}"
            signed=self.signature.sign(self.get(s,Document,a.bank,d["draft_document"]).digest,actor["id"])
            g=Guarantee(bank=a.bank,id=a.id,application_id=a.id,token_hash=hashlib.sha256(token.encode()).hexdigest(),number=number,data=dumps({"token_cipher":self.cipher.encrypt(token.encode()).decode(),"signature":signed,"issued_at":iso(now),"claim_deadline":iso(datetime.combine(date.fromisoformat(d["expires_on"]),datetime.max.time(),ZoneInfo("Asia/Jakarta"))+timedelta(days=p["pks"]["claim_window_days"])),"mode":"MOCK"}))
            s.add(g); a.state="BG_ISSUED"; d["bg_number"]=number
            self.add_document(s,actor,a,"BG",dumps({"number":number,"principal":a.principal,"obligee":a.obligee,"amount":d["amount"],"expires_on":d["expires_on"],"approved_draft_hash":signed["signed_digest"],"signature":signed,"mode":"MOCK"}).encode(),generated=True)
            self.post(s,actor,a,"contingent:"+a.id,d["amount"],"OFF_BALANCE_BG","OFF_BALANCE_CONTRA")
        elif cmd == "certificate":
            self.role(actor,{"PENJAMIN"}); self.state(a,"BG_ISSUED")
            doc=self.doc(s,a,x["document"],"CERTIFICATE"); d["certificate"]={"reference":x["reference"],"document":doc.id}; a.state="KONTRA_BG_ISSUED"
        elif cmd == "deliver":
            self.role(actor,OPS); self.state(a,"KONTRA_BG_ISSUED")
            doc=self.doc(s,a,x["document"],"DELIVERY"); d["delivery"]={"document":doc.id,"at":iso(now)}
            a.state="ACTIVE" if date.fromisoformat(d["issue_on"])<=now.date() else "DELIVERED_TO_OBLIGEE"
        elif cmd == "distribute":
            self.role(actor,{"FINANCE"})
            r=self.get(s,Distribution,a.bank,a.id); rd=load(r)
            require(rd["maker"]!=actor["id"],"SOD","Pembuku dan checker distribusi wajib berbeda",403)
            require(r.status=="DUE","STATE","Distribusi sudah diselesaikan",409)
            rd.update(settled_at=iso(now),receipt=self.core.settle("split:"+a.id,rd["amount"])); r.status="SETTLED"; r.data=dumps(rd)
            self.post(s,actor,a,"split:"+a.id,rd["amount"],"PROCESSING_OFFICE_DUE","ISSUING_OFFICE_RECEIVABLE")
            self.finish_task(s,a.bank,"split:"+a.id)
        elif cmd == "original_received":
            self.role(actor,OPS); self.doc(s,a,x["document"],"ORIGINAL_RECEIPT")
            require(d.get("format",{}).get("status")=="APPROVED_SCAN","STATE","Tidak ada asli outstanding",409)
            d["format"]["status"]="ORIGINAL_RECEIVED"; self.finish_task(s,a.bank,"original:"+a.id)
        else:
            raise DomainError("COMMAND","Perintah tidak didukung",422)

    def state(self, a, *states): require(a.state in states,"STATE",f"Aksi tidak tersedia pada status {a.state}",409)

    def finish_task(self,s,bank,key):
        task=self.get(s,Task,bank,key); td=load(task); td["completed_at"]=iso(self.clock()); td["late"]=self.clock()>parse(task.due); task.data=dumps(td); task.status="DONE"

    def view(self,s,actor,a):
        self.access(s,actor,a); d=load(a)
        public={k:d.get(k) for k in ("project_name","amount","currency","bg_type","category","issue_on","expires_on","processing_office","issuing_office","portfolio_owner","custom_format","fee_disclosure","bg_number","committee_role")}
        out={"id":a.id,"state":a.state,"version":a.version,"principal":a.principal,"obligee":a.obligee,"partner":a.partner,"mode":"SANDBOX",**public}
        if actor["role"] in BANK_ROLES|{"PRINCIPAL","PENJAMIN"}: out["workflow"]=d
        out["documents"]=[{"id":r.id,"kind":r.kind,"sha256":r.digest,"verified":load(r).get("verified",False)} for r in self.docs(s,a)] if actor["role"] in BANK_ROLES|{"PRINCIPAL","PENJAMIN"} else []
        if actor["role"]=="OBLIGEE":
            out["documents"]=[{"id":r.id,"kind":r.kind,"sha256":r.digest,"verified":load(r).get("verified",False)} for r in self.docs(s,a) if r.kind in {"BG","CLAIM","WITHDRAWAL","DELIVERY"}]
        if actor["role"]=="PENJAMIN":
            out["workflow"]={k:d.get(k) for k in ("sp2","format","certificate","draft_document")}
            out["documents"]=[v for v in out["documents"] if v["kind"] in {"SP2KBG","CONTRACT","DRAFT_BG","FORMAT_APPROVAL","CERTIFICATE"}]
        return out

    def verify(self,s,token):
        g=s.scalar(select(Guarantee).where(Guarantee.token_hash==hashlib.sha256(token.encode()).hexdigest()))
        if not g: return {"authentic":False,"valid":False,"status":"NOT_FOUND","message":"BG tidak ditemukan atau tidak valid"}
        a=self.get(s,Application,g.bank,g.application_id); d,gd=load(a),load(g); now=self.clock()
        valid=d["issue_on"]<=now.astimezone(ZoneInfo("Asia/Jakarta")).date().isoformat()<=d["expires_on"]
        return {"authentic":True,"valid":valid,"status":"AUTHENTIC_ACTIVE" if valid else "AUTHENTIC_EXPIRED" if now.date().isoformat()>d["expires_on"] else "NOT_YET_EFFECTIVE","message":"BG asli dan masih berlaku" if valid else "BG asli tetapi tidak berlaku saat ini","number":g.number,"amount":d["amount"],"currency":"IDR","principal":load(self.get(s,Party,g.bank,a.principal))["name"],"obligee":load(self.get(s,Party,g.bank,a.obligee))["name"],"expires_on":d["expires_on"],"claim_window_open":now<=parse(gd["claim_deadline"]),"mode":"SANDBOX"}

    def receive_claim(self,s,actor,a,body):
        self.access(s,actor,a); self.role(actor,{"OBLIGEE"})
        g=self.get(s,Guarantee,a.bank,a.id); require(self.clock()<=parse(load(g)["claim_deadline"]),"CLAIM_WINDOW","Batas penerimaan klaim telah berlalu")
        doc=self.doc(s,a,body["document"],"CLAIM",verified=False)
        require(load(doc)["uploaded_by"]==actor["id"],"CLAIM","Bukti klaim harus dari Obligee")
        amount=money(body["amount"]); require(amount>0,"CLAIM","Nominal klaim harus positif")
        total=sum((money(load(c)["amount"]) for c in self.rows(s,Claim,a.bank,application_id=a.id) if c.state not in {"WITHDRAWN","REJECTED"}),Decimal(0))
        require(total+amount<=money(load(a)["amount"]),"CLAIM_LIMIT","Klaim melebihi sisa kewajiban")
        c=Claim(bank=a.bank,id=uid(),application_id=a.id,version=0,state="CLAIM_RECEIVED",data=dumps({"amount":str(amount),"document":doc.id,"received_at":iso(self.clock()),"monitor_owner":self.policy(s,a)["rules"]["BR-19"]["owner"],"cc":self.policy(s,a)["rules"]["BR-19"]["cc"]}))
        s.add(c); s.flush(); self.task(s,a,"report:"+c.id,"CLAIM_REPORT",self.policy(s,a)["rules"]["BR-18"]["business_days"],{"claim":c.id,"recipients":self.policy(s,a)["rules"]["BR-18"]["recipients"]})
        self.audit(s,actor,"ClaimReceived",c.id,{"application":a.id,"amount":str(amount)})
        return {"id":c.id,"state":c.state,"version":c.version,**load(c)}

    def claim_command(self,s,actor,c,cmd,x,version,key):
        a=self.get(s,Application,c.bank,c.application_id); self.access(s,actor,a)
        rh=digest({"claim":c.id,"cmd":cmd,"payload":x,"version":version})
        old=s.get(Receipt,(c.bank,key))
        if old:
            rd=load(old); require(rd["actor"]==actor["id"] and rd["request_hash"]==rh,"IDEMPOTENCY","Kunci sudah digunakan",409); return rd["result"]
        require(c.version==version,"VERSION","Versi klaim berubah",409)
        d,p=load(c),self.policy(s,a); now=self.clock(); before=c.state
        if cmd=="report":
            self.role(actor,OPS); require(c.state=="CLAIM_RECEIVED","STATE","Klaim belum dapat dilaporkan",409)
            self.finish_task(s,c.bank,"report:"+c.id); d["reported_at"]=iso(now); c.state="CLAIM_VALIDATION"
        elif cmd=="approve_claim":
            self.role(actor,OPS); require(c.state=="CLAIM_VALIDATION","STATE","Klaim belum tervalidasi",409)
            self.doc(s,a,d["document"],"CLAIM"); require(x.get("instrument_conditions_met") is True,"CLAIM","Syarat warkat belum terpenuhi")
            d["approved_by"]=actor["id"]; c.state="CLAIM_APPROVED"
        elif cmd=="pay_bank":
            self.role(actor,{"FINANCE"}); require(c.state=="CLAIM_APPROVED","STATE","Klaim belum disetujui",409)
            require(d["approved_by"]!=actor["id"],"SOD","Maker payout harus berbeda",403)
            d["bank_payment"]=self.core.settle("claim:"+c.id,d["amount"]); d["bank_paid_at"]=iso(now); c.state="CLAIM_PAID_BY_BANK"
            self.post(s,actor,a,"claim:"+c.id,d["amount"],"CLAIM_RECEIVABLE","CASH")
            self.task(s,a,"contra-submit:"+c.id,"CONTRA_SUBMIT",p["pks"]["submit_business_days"],{"claim":c.id})
        elif cmd=="submit_contra":
            office=load(self.get(s,Office,c.bank,load(a)["processing_office"]))
            self.role(actor,set(p["rules"]["BR-17"]["submitters"][office["type"]]))
            require(actor["office"]==load(a)["processing_office"],"BR-17","Scope kantor pemroses diperlukan",403)
            require(c.state=="CLAIM_PAID_BY_BANK","STATE","Bank belum membayar klaim",409)
            self.doc(s,a,x["document"],"CONTRA_CLAIM"); d["submitted_at"]=iso(now); c.state="KONTRA_CLAIM_SUBMITTED"
            self.finish_task(s,c.bank,"contra-submit:"+c.id)
            self.task(s,a,"contra-pay:"+c.id,"CONTRA_PAY",p["pks"]["payment_business_days"],{"claim":c.id})
        elif cmd=="contra_decision":
            self.role(actor,{"PENJAMIN"}); require(c.state=="KONTRA_CLAIM_SUBMITTED","STATE","Klaim kontra tidak dalam review",409)
            self.doc(s,a,x["document"],"CONTRA_DECISION")
            decision=x.get("decision"); require(decision in {"PAID","REJECTED","DEFERRED"},"CLAIM","Keputusan tidak valid")
            d["contra_decision"]={"value":decision,"at":iso(now),"document":x["document"],"reason":x.get("reason","")}
            c.state="KONTRA_SETTLEMENT_PENDING" if decision=="PAID" else "KONTRA_CLAIM_"+decision
            if decision in p["rules"]["BR-20"]["triggers"]:
                self._litigation(s,actor,a,c,decision)
        elif cmd=="confirm_contra_paid":
            self.role(actor,{"FINANCE"}); require(c.state in {"KONTRA_SETTLEMENT_PENDING","KONTRA_CLAIM_REJECTED","KONTRA_CLAIM_DEFERRED"},"STATE","Tidak ada settlement yang dapat dikonfirmasi",409)
            self.doc(s,a,x["document"],"CONTRA_PAYMENT")
            d["contra_payment"]=self.core.settle("contra:"+c.id,d["amount"]); c.state="KONTRA_CLAIM_PAID"
            self.post(s,actor,a,"contra:"+c.id,d["amount"],"CASH","CLAIM_RECEIVABLE"); self.finish_task(s,c.bank,"contra-pay:"+c.id)
        elif cmd=="withdraw":
            self.role(actor,{"OBLIGEE"}); self.doc(s,a,x["document"],"WITHDRAWAL")
            d["withdrawn_at"]=iso(now); c.state="WITHDRAWN"
        elif cmd=="refer_dispute":
            self.role(actor,{"LEGAL"}|OPS); self.doc(s,a,x["document"],"DISPUTE")
            self._litigation(s,actor,a,c,"PROBLEMATIC_DISPUTE")
        elif cmd in {"request_close","confirm_close"}:
            case=self.get(s,Litigation,c.bank,c.id); cd=load(case)
            paid=bool(d.get("contra_payment")); withdrawn=bool(d.get("withdrawn_at") and not d.get("bank_paid_at"))
            require(paid or withdrawn,"BR-20","Kasus hanya ditutup setelah pembayaran atau pencabutan dan rekonsiliasi keuangan")
            if cmd=="request_close":
                self.role(actor,{"LITIGATION"}); self.doc(s,a,x["document"],"RESOLUTION"); cd.update(close_maker=actor["id"],resolution_document=x["document"]); case.state="CLOSURE_PENDING"
            else:
                self.role(actor,{"LEGAL"}); require(case.state=="CLOSURE_PENDING" and cd.get("close_maker")!=actor["id"],"SOD","Diperlukan checker Legal yang berbeda",403); case.state="CLOSED"; cd["closed_at"]=iso(now)
            case.data=dumps(cd)
        else: raise DomainError("COMMAND","Perintah klaim tidak didukung")
        c.version+=1; c.data=dumps(d); self.audit(s,actor,cmd,c.id,{"from":before,"to":c.state,"version":c.version})
        result={"id":c.id,"application_id":a.id,"state":c.state,"version":c.version,**d}
        s.add(Receipt(bank=c.bank,id=key,data=dumps({"actor":actor["id"],"request_hash":rh,"result":result})))
        return result

    def _litigation(self,s,actor,a,c,reason):
        if not s.get(Litigation,(c.bank,c.id)):
            s.add(Litigation(bank=c.bank,id=c.id,application_id=a.id,claim_id=c.id,state="OPEN",data=dumps({"reason":reason,"owner":"LITIGATION","opened_at":iso(self.clock())})))
            self.audit(s,actor,"LitigationOpened",c.id,{"reason":reason,"application":a.id})

    def tick(self,s,actor):
        self.role(actor,{"WORKER"}); count=0
        for t in self.rows(s,Task,actor["bank"]):
            if t.status=="OPEN" and parse(t.due)<self.clock():
                t.status="OVERDUE"; td=load(t); td["escalated_at"]=iso(self.clock()); t.data=dumps(td); count+=1
                s.add(Notification(bank=t.bank,id=t.id,data=dumps({"task":t.id,"application":t.application_id,"status":"IN_APP_ESCALATED","owner":"SUPPORT_OR_MPO","cc":"PENGEMBANGAN_BISNIS"})))
                self.audit(s,actor,"SLAOverdue",t.application_id,{"task":t.id,"due":t.due})
        for a in self.rows(s,Application,actor["bank"]):
            if a.state=="DELIVERED_TO_OBLIGEE" and load(a)["issue_on"]<=self.clock().date().isoformat():
                a.state="ACTIVE"; a.version+=1; self.audit(s,actor,"BGActivated",a.id,{})
        return {"escalated":count}
