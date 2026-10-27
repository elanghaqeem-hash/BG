import base64
import hashlib
import json
import os
import secrets
import time
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from cryptography.fernet import Fernet
from sqlalchemy import select
from .db import Store, User, Session, Application, Document, Party, Partner, Office, Policy, Mandate, Task, Claim, Litigation, Guarantee, Distribution, Audit, Journal, Anchor
from .service import Service, load, dumps, digest, uid, iso, parse, BANK_ROLES, OPS
from .rules import DomainError, require, money
from datetime import timedelta


def password_hash(password, salt=None):
    salt=salt or secrets.token_hex(16)
    value=hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=16384,r=8,p=1).hex()
    return salt+":"+value


class Strict(BaseModel): model_config=ConfigDict(extra="forbid")
class Login(Strict):
    username: str=Field(min_length=1,max_length=120)
    password: str=Field(min_length=1,max_length=256)
class ApplicationIn(Strict):
    principal: str; obligee: str; partner: str
    processing_office: str; issuing_office: str
    project_name: str=Field(min_length=1,max_length=200)
    amount: str; issue_on: str; expires_on: str
    bg_type: str="PELAKSANAAN"; currency: str="IDR"
    custom_format: bool=False; mandate: str|None=None; product: str|None=None; justification: str|None=None
class Command(Strict):
    expected_version: int=Field(ge=0)
    idempotency_key: str=Field(min_length=8,max_length=120)
    payload: dict=Field(default_factory=dict)
class DocumentIn(Strict):
    kind: str=Field(min_length=1,max_length=60)
    content_base64: str=Field(max_length=2_800_000)
    source_reference: str=Field(default="",max_length=500)
class VerifyDoc(Strict): source_reference: str=Field(min_length=3,max_length=500)
class ClaimIn(Strict):
    document: str; amount: str
class MandateIn(Strict):
    principal: str; broker: str; document: str
    application_id: str; expires: str
    commission_disclosed: bool
class PolicyIn(Strict): configuration: dict

APP_COMMANDS=Literal["submit","kyb_pass","record_slik","partner_start","sp2_issue","bank_underwrite","approve_format","approve","sign_mkp","sign_akad","collect_fee","ememo","issue","certificate","deliver","distribute","original_received"]
CLAIM_COMMANDS=Literal["report","approve_claim","pay_bank","submit_contra","contra_decision","confirm_contra_paid","withdraw","refer_dispute","request_close","confirm_close"]


def make_app(store=None,cipher=None,clock=None):
    environment=os.getenv("APP_ENV","development")
    if environment not in {"development","test"}:
        raise RuntimeError("Distribusi MVP ini hanya development/test. Produksi memerlukan live adapters, OIDC/MFA, PKS/DPS, RLS dan release gate yang tervalidasi.")
    key=cipher
    if key is None:
        raw=os.getenv("BG_ENCRYPTION_KEY")
        if not raw: raise RuntimeError("BG_ENCRYPTION_KEY wajib; jalankan scripts/bootstrap.py")
        key=Fernet(raw.encode())
    store=store or Store(os.getenv("DATABASE_URL","sqlite:///./runtime/bg.db"))
    service=Service(store,key,clock)
    @asynccontextmanager
    async def lifespan(app):
        store.initialize(); yield
    app=FastAPI(title="BG Ecosystem Sandbox API",version="0.1.0",lifespan=lifespan,
                description="MVP pengembangan. Semua receipt integrasi bertanda MOCK; tidak untuk penerbitan BG nyata.")
    app.openapi_version="3.1.0"
    app.state.store=store; app.state.service=service
    origins=os.getenv("BG_ALLOWED_ORIGINS","http://localhost:3000,http://127.0.0.1:3000").split(",")
    app.add_middleware(CORSMiddleware,allow_origins=origins,allow_credentials=True,allow_methods=["GET","POST"],allow_headers=["Content-Type","X-CSRF-Token"])
    buckets={}
    @app.middleware("http")
    async def boundaries(request,call_next):
        start=time.monotonic(); ip=request.client.host if request.client else "unknown"
        if request.url.path in {"/auth/login"} or request.url.path.startswith("/public/"):
            minute=int(time.monotonic()/60); bkey=(ip,request.url.path.split("/")[1],minute)
            buckets[bkey]=buckets.get(bkey,0)+1
            if len(buckets)>2000:
                for k in list(buckets):
                    if k[2]<minute-1: del buckets[k]
            if buckets[bkey]>(30 if request.url.path.startswith("/public") else 15): return JSONResponse({"code":"RATE_LIMIT","detail":"Terlalu banyak permintaan"},429)
        if request.headers.get("content-length", "0").isdigit() and int(request.headers.get("content-length","0"))>3_000_000:
            return JSONResponse({"code":"SIZE","detail":"Permintaan terlalu besar"},413)
        response=await call_next(request)
        request_id=secrets.token_hex(8)
        logging.getLogger("bg.requests").info(json.dumps({"request_id":request_id,"method":request.method,"route":getattr(request.scope.get("route"),"path","unmatched"),"status":response.status_code,"duration_ms":round((time.monotonic()-start)*1000,2)}))
        response.headers.update({"X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Cache-Control":"no-store","X-Request-ID":request_id,"Server-Timing":f"app;dur={(time.monotonic()-start)*1000:.1f}"})
        return response

    @app.exception_handler(DomainError)
    async def domain_error(request,exc): return JSONResponse({"code":exc.code,"detail":exc.detail},status_code=exc.status)

    @app.exception_handler(KeyError)
    async def missing_field(request,exc): return JSONResponse({"code":"PAYLOAD","detail":"Data aksi belum lengkap; periksa field yang diwajibkan"},status_code=422)

    @app.exception_handler(ValueError)
    async def invalid_field(request,exc): return JSONResponse({"code":"PAYLOAD","detail":"Format data aksi tidak valid"},status_code=422)

    def actor(request):
        token=request.cookies.get("bg_session","")
        require(token,"AUTH","Silakan login",401)
        token_hash=hashlib.sha256(token.encode()).hexdigest()
        with store.transaction() as s:
            session=s.scalar(select(Session).where(Session.id==token_hash))
            require(session is not None,"AUTH","Sesi tidak valid",401)
            sd=load(session); require(parse(sd["expires"])>service.clock(),"AUTH","Sesi berakhir",401)
            user=service.get(s,User,session.bank,session.user_id); ud=load(user)
            require(ud.get("active"),"AUTH","User tidak aktif",401)
            if request.method!="GET": require(secrets.compare_digest(request.headers.get("x-csrf-token",""),sd["csrf"]),"CSRF","Token CSRF diperlukan",403)
            return {"bank":user.bank,"id":user.id,"username":user.username,**ud,"csrf":sd["csrf"],"session_id":session.id}

    @app.get("/health")
    def health(): return {"status":"ok","mode":"SANDBOX","production_enabled":False}

    @app.post("/auth/login")
    def login(body:Login,response:Response):
        with store.transaction() as s:
            u=s.scalar(select(User).where(User.username==body.username))
            valid=False
            if u:
                salt=u.password.split(":")[0]
                valid=secrets.compare_digest(password_hash(body.password,salt),u.password) and load(u).get("active",False)
            else: password_hash(body.password,"0"*32)
            require(valid,"AUTH","Username atau password tidak sesuai",401)
            token=secrets.token_urlsafe(40); csrf=secrets.token_urlsafe(32)
            s.add(Session(bank=u.bank,id=hashlib.sha256(token.encode()).hexdigest(),user_id=u.id,data=dumps({"expires":iso(service.clock()+timedelta(hours=8)),"csrf":csrf})))
            response.set_cookie("bg_session",token,httponly=True,samesite="strict",secure=os.getenv("BG_COOKIE_SECURE")=="1",max_age=28800)
            return {"username":u.username,**load(u),"csrf":csrf,"mode":"SANDBOX"}

    @app.get("/auth/me")
    def me(request:Request):
        a=actor(request); return {k:v for k,v in a.items() if k!="session_id"}

    @app.post("/auth/logout")
    def logout(request:Request,response:Response):
        a=actor(request)
        with store.transaction(a["bank"]) as s: s.delete(service.get(s,Session,a["bank"],a["session_id"]))
        response.delete_cookie("bg_session"); return {"logged_out":True}

    @app.get("/catalog")
    def catalog(request:Request):
        a=actor(request)
        with store.transaction(a["bank"]) as s:
            return {"parties":[{"id":r.id,"kind":r.kind,**{k:v for k,v in load(r).items() if k in {"name","category"}}} for r in service.rows(s,Party,a["bank"])],
                    "offices":[{"id":r.id,**load(r)} for r in service.rows(s,Office,a["bank"])],"partners":[{"id":r.id,"name":load(r)["name"]} for r in service.rows(s,Partner,a["bank"])],
                    "policies":[{"id":r.id,"version":r.version,"status":r.status,"assumption":load(r).get("assumption"),"configuration":load(r) if a["role"] in BANK_ROLES else {"pks":{"types":load(r)["pks"]["types"]}}} for r in service.rows(s,Policy,a["bank"]) if r.status=="ACTIVE"]}

    @app.get("/applications")
    def applications(request:Request):
        a=actor(request)
        with store.transaction(a["bank"]) as s:
            out=[]
            for r in service.rows(s,Application,a["bank"]):
                try: out.append(service.view(s,a,r))
                except DomainError as e:
                    if e.status!=404: raise
            return out

    @app.post("/applications",status_code=201)
    def create_application(body:ApplicationIn,request:Request):
        a=actor(request)
        with store.transaction(a["bank"]) as s: return service.create(s,a,body.model_dump())

    @app.get("/applications/{application_id}")
    def application(application_id:str,request:Request):
        a=actor(request)
        with store.transaction(a["bank"]) as s: return service.view(s,a,service.get(s,Application,a["bank"],application_id))

    @app.post("/applications/{application_id}/commands/{command}")
    def command(application_id:str,command:APP_COMMANDS,body:Command,request:Request):
        a=actor(request)
        with store.transaction(a["bank"]) as s:
            return service.execute(s,a,service.get(s,Application,a["bank"],application_id),command,body.payload,body.expected_version,body.idempotency_key)

    @app.post("/applications/{application_id}/documents",status_code=201)
    def upload(application_id:str,body:DocumentIn,request:Request):
        a=actor(request)
        with store.transaction(a["bank"]) as s:
            application=service.get(s,Application,a["bank"],application_id); service.access(s,a,application,write=a["role"]=="BROKER")
            allowed={"PRINCIPAL":{"NIB","CONTRACT","KYB","PRINCIPAL_REQUEST","MANDATE"},"BROKER":{"NIB","CONTRACT","KYB","PRINCIPAL_REQUEST"},"PENJAMIN":{"SP2KBG","FORMAT_APPROVAL","CERTIFICATE","CONTRA_DECISION","CONTRA_PAYMENT"},"OBLIGEE":{"CLAIM","WITHDRAWAL","DELIVERY"}}
            require(a["role"] in BANK_ROLES or body.kind in allowed.get(a["role"],set()),"FORBIDDEN","Tidak berwenang mengunggah jenis dokumen ini",403)
            require(a["role"] not in {"AUDIT","MONITOR","ADMIN","WORKER"},"FORBIDDEN","Peran hanya baca/administratif",403)
            require(body.kind!="DRAFT_BG" or application.state=="DRAFT","BR-08","Draft disubmit terkunci")
            try: raw=base64.b64decode(body.content_base64,validate=True)
            except ValueError: raise DomainError("DOCUMENT","Base64 tidak valid")
            # Sandbox accepts safe text and PDF evidence only; a production malware/CDR service is a release gate.
            require(raw.startswith(b"%PDF-") or (b"\0" not in raw and raw.decode("utf-8",errors="replace").encode("utf-8")==raw),"DOCUMENT","Hanya teks UTF-8 atau PDF")
            doc=service.add_document(s,a,application,body.kind,raw,body.source_reference)
            return {"id":doc.id,"kind":doc.kind,"sha256":doc.digest,"verified":False}

    @app.post("/documents/{document_id}/verify")
    def verify_doc(document_id:str,body:VerifyDoc,request:Request):
        a=actor(request); service.role(a,{"COMPLIANCE"}|OPS)
        with store.transaction(a["bank"]) as s:
            doc=service.get(s,Document,a["bank"],document_id); ap=service.get(s,Application,a["bank"],doc.application_id); service.access(s,a,ap)
            d=load(doc); require(d["uploaded_by"]!=a["id"],"SOD","Uploader tidak boleh memverifikasi dokumennya sendiri",403)
            require(not d.get("verified"),"DOCUMENT","Dokumen sudah diverifikasi",409)
            d.update(verified=True,verified_by=a["id"],verified_at=iso(service.clock()),source=body.source_reference); doc.data=dumps(d)
            service.audit(s,a,"DocumentVerified",doc.id,{"hash":doc.digest,"source_digest":digest(body.source_reference)})
            return {"id":doc.id,"verified":True}

    @app.get("/documents/{document_id}/download")
    def download(document_id:str,request:Request):
        a=actor(request)
        with store.transaction(a["bank"]) as s:
            doc=service.get(s,Document,a["bank"],document_id); ap=service.get(s,Application,a["bank"],doc.application_id); service.access(s,a,ap)
            if a["role"] in {"PENJAMIN","OBLIGEE","BROKER"}:
                allowed={"PENJAMIN":{"SP2KBG","CONTRACT","DRAFT_BG","FORMAT_APPROVAL","CERTIFICATE"},"OBLIGEE":{"BG","CLAIM","WITHDRAWAL","DELIVERY"},"BROKER":{"NIB","CONTRACT","PRINCIPAL_REQUEST"}}
                require(doc.kind in allowed[a["role"]],"FORBIDDEN","Dokumen di luar scope",403)
            require(a["role"] not in {"ADMIN","MONITOR","WORKER"},"FORBIDDEN","Tidak berwenang membaca isi dokumen",403)
            service.audit(s,a,"DocumentDownloaded",doc.id,{"hash":doc.digest})
            raw=service.cipher.decrypt(doc.encrypted_bytes.encode())
            require(digest(raw)==doc.digest,"INTEGRITY","Hash dokumen tidak cocok",409)
            return Response(raw,media_type="application/octet-stream",headers={"Content-Disposition":f'attachment; filename="{doc.id}.bin"'})

    @app.post("/mandates")
    def mandate(body:MandateIn,request:Request):
        a=actor(request); service.role(a,{"PRINCIPAL"}); require(a["org"]==body.principal,"FORBIDDEN","Principal berbeda",403)
        with store.transaction(a["bank"]) as s:
            application=service.get(s,Application,a["bank"],body.application_id); service.access(s,a,application)
            doc=service.doc(s,application,body.document,"MANDATE")
            broker=service.get(s,Party,a["bank"],body.broker); bd=load(broker)
            require(broker.kind=="BROKER" and bd.get("license_verified") and bd.get("whitelisted") and not bd.get("conflict"),"BROKER","Broker belum berizin/terverifikasi atau berkonflik")
            require(parse(body.expires)>service.clock() and body.commission_disclosed,"MANDATE","Kuasa/disclosure tidak valid")
            m=Mandate(bank=a["bank"],id=uid(),principal=body.principal,broker=body.broker,data=dumps({"expires":body.expires,"document":doc.id,"scope":["submit"],"commission_disclosed":True,"signature":service.signature.sign(doc.digest,a["id"])})); s.add(m)
            service.audit(s,a,"MandateGranted",m.id,{"broker":body.broker}); return {"id":m.id,**load(m)}

    @app.post("/mandates/{mandate_id}/revoke")
    def revoke(mandate_id:str,request:Request):
        a=actor(request); service.role(a,{"PRINCIPAL"})
        with store.transaction(a["bank"]) as s:
            m=service.get(s,Mandate,a["bank"],mandate_id); require(a["org"]==m.principal,"NOT_FOUND","Kuasa tidak ditemukan",404)
            d=load(m); d["revoked_at"]=iso(service.clock()); m.data=dumps(d); service.audit(s,a,"MandateRevoked",m.id,{})
            return {"revoked":True}

    @app.get("/applications/{application_id}/verification-link")
    def verification_link(application_id:str,request:Request):
        a=actor(request)
        with store.transaction(a["bank"]) as s:
            application=service.get(s,Application,a["bank"],application_id); service.access(s,a,application)
            require(a["role"] in BANK_ROLES|{"PRINCIPAL","OBLIGEE"},"FORBIDDEN","Tidak berwenang",403)
            g=service.get(s,Guarantee,a["bank"],application_id); token=service.cipher.decrypt(load(g)["token_cipher"].encode()).decode()
            return {"token":token,"url":f"/verify/{token}","mode":"SANDBOX"}

    @app.get("/public/verify/{token}")
    def public_verify(token:str):
        require(len(token)<=200,"TOKEN","Token terlalu panjang")
        with store.transaction() as s: return service.verify(s,token)

    @app.get("/public/qr/{token}")
    def public_qr(token:str):
        import io,qrcode
        require(len(token)<=200,"TOKEN","Token terlalu panjang")
        with store.transaction() as s: require(service.verify(s,token)["authentic"],"NOT_FOUND","BG tidak ditemukan",404)
        url=os.getenv("BG_PUBLIC_WEB_URL","http://localhost:3000")+"/verify/"+token
        buf=io.BytesIO(); qrcode.make(url).save(buf,format="PNG"); return Response(buf.getvalue(),media_type="image/png")

    @app.post("/applications/{application_id}/claims",status_code=201)
    def receive_claim(application_id:str,body:ClaimIn,request:Request):
        a=actor(request)
        with store.transaction(a["bank"]) as s: return service.receive_claim(s,a,service.get(s,Application,a["bank"],application_id),body.model_dump())

    @app.get("/claims")
    def claims(request:Request):
        a=actor(request)
        with store.transaction(a["bank"]) as s:
            out=[]
            for c in service.rows(s,Claim,a["bank"]):
                try: service.access(s,a,service.get(s,Application,a["bank"],c.application_id))
                except DomainError: continue
                if a["role"]=="BROKER": continue
                cd=load(c)
                if a["role"]=="OBLIGEE": cd={k:v for k,v in cd.items() if k in {"amount","received_at","bank_paid_at","withdrawn_at"}}
                out.append({"id":c.id,"application_id":c.application_id,"state":c.state,"version":c.version,"details":cd})
            return out

    @app.post("/claims/{claim_id}/commands/{command}")
    def claim_command(claim_id:str,command:CLAIM_COMMANDS,body:Command,request:Request):
        a=actor(request)
        with store.transaction(a["bank"]) as s: return service.claim_command(s,a,service.get(s,Claim,a["bank"],claim_id),command,body.payload,body.expected_version,body.idempotency_key)

    @app.get("/operations")
    def operations(request:Request):
        a=actor(request); service.role(a,BANK_ROLES)
        with store.transaction(a["bank"]) as s:
            result={}
            for name,model in [("tasks",Task),("litigation",Litigation),("distributions",Distribution)]:
                visible=[]
                for r in service.rows(s,model,a["bank"]):
                    try: service.access(s,a,service.get(s,Application,a["bank"],r.application_id))
                    except DomainError: continue
                    visible.append({"id":r.id,"application_id":r.application_id,"status":r.state if isinstance(r,Litigation) else r.status,"due":getattr(r,"due",None),"details":load(r)})
                result[name]=visible
            return result

    @app.post("/operations/sweep")
    def sweep(request:Request):
        a=actor(request)
        with store.transaction(a["bank"]) as s: return service.tick(s,a)

    @app.get("/audit/verify")
    def verify_audit(request:Request):
        a=actor(request); service.role(a,{"AUDIT","LEGAL"})
        with store.transaction(a["bank"]) as s:
            previous="0"*64; sequence=0
            for r in sorted(service.rows(s,Audit,a["bank"]),key=lambda r:r.sequence):
                sequence+=1; d=load(r)
                require(d["previous_hash"]==previous and r.sequence==sequence and digest(d)==r.digest,"AUDIT_INTEGRITY","Rantai audit tidak cocok",409)
                previous=r.digest
            return {"valid":True,"events":sequence,"head":previous,"external_anchor_verified":False}

    @app.get("/audit/events")
    def audit_events(request:Request):
        a=actor(request); service.role(a,{"AUDIT","LEGAL"})
        with store.transaction(a["bank"]) as s:
            return [{"digest":r.digest,**load(r)} for r in sorted(service.rows(s,Audit,a["bank"]),key=lambda r:r.sequence)[-200:]]

    @app.post("/policies",status_code=201)
    def propose_policy(body:PolicyIn,request:Request):
        from .policy import validate_policy
        a=actor(request); service.role(a,{"ADMIN"}); validate_policy(body.configuration)
        with store.transaction(a["bank"]) as s:
            version=max([p.version for p in service.rows(s,Policy,a["bank"])]+[0])+1
            p=Policy(bank=a["bank"],id=uid(),version=version,status="DRAFT",maker=a["id"],data=dumps(body.configuration)); s.add(p)
            service.audit(s,a,"PolicyProposed",p.id,{"version":version}); return {"id":p.id,"version":version,"status":"DRAFT"}

    @app.post("/policies/{policy_id}/approve")
    def approve_policy(policy_id:str,request:Request):
        a=actor(request); service.role(a,{"CONFIG_CHECKER"})
        with store.transaction(a["bank"]) as s:
            p=service.get(s,Policy,a["bank"],policy_id); require(p.maker!=a["id"],"SOD","Maker konfigurasi tidak boleh approve",403)
            require(p.status=="DRAFT","STATE","Policy bukan draft",409)
            for old in service.rows(s,Policy,a["bank"],status="ACTIVE"): old.status="SUPERSEDED"
            p.status="ACTIVE"; service.audit(s,a,"PolicyActivated",p.id,{"version":p.version,"mode":"SANDBOX"}); return {"active":True}
    return app
