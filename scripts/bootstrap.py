"""Create sandbox master data and independent identities. Never run in production."""
import argparse, json, os, secrets, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"backend"))
from cryptography.fernet import Fernet
from bg.db import Store,User,Policy,Party,Office,Partner
from bg.api import password_hash
from bg.service import dumps


def seed(store,passwords=None,bank="bank-uat"):
    root=Path(__file__).resolve().parents[1]
    passwords=passwords or {}
    roles=[("principal","PRINCIPAL","principal-1","cabang-1"),("ao","AO","bank-org","cabang-1"),("analyst","ANALYST","bank-org","cabang-1"),("compliance","COMPLIANCE","bank-org","cabang-1"),("mpo","MPO","bank-org","cabang-1"),("issuer","MPO_KPO","bank-org","kpo-1"),("support","SUPPORT","bank-org","cabang-1"),("gh","GH_BISNIS","bank-org","cabang-1"),("direksi","DIREKSI","bank-org","cabang-1"),("finance","FINANCE","bank-org","cabang-1"),("finance_checker","FINANCE","bank-org","cabang-1"),("penjamin","PENJAMIN","partner-1",""),("obligee","OBLIGEE","obligee-apbn",""),("obligee_private","OBLIGEE","obligee-private",""),("broker","BROKER","broker-1",""),("litigation","LITIGATION","bank-org","cabang-1"),("legal","LEGAL","bank-org","cabang-1"),("audit","AUDIT","bank-org","cabang-1"),("admin","ADMIN","bank-org","cabang-1"),("config_checker","CONFIG_CHECKER","bank-org","cabang-1"),("worker","WORKER","bank-org","cabang-1")]
    store.initialize()
    with store.transaction(bank) as s:
        if s.get(Policy,(bank,"policy-1")): return passwords
        s.add(Policy(bank=bank,id="policy-1",version=1,status="ACTIVE",maker="bootstrap",data=(root/"config/policy.sandbox.json").read_text()))
        for key,name,kind,extra in [
            ("principal-1","Kontraktor Uji","PRINCIPAL",{"nib":"1234567890123","entity_type":"COMPANY"}),
            ("obligee-apbn","Instansi APBN Uji","OBLIGEE",{"category":"APBN"}),
            ("obligee-bumd","BUMD Uji","OBLIGEE",{"category":"BUMD"}),
            ("obligee-private","Swasta Nasional Uji","OBLIGEE",{"category":"SWASTA_NASIONAL"}),
            ("broker-1","Broker Uji TEST ONLY","BROKER",{"license_verified":True,"whitelisted":True,"conflict":False,"license_reference":"SANDBOX-NOT-OJK-LICENSE"})]:
            s.add(Party(bank=bank,id=key,kind=kind,data=dumps({"name":name,**extra})))
        s.add(Office(bank=bank,id="cabang-1",data=dumps({"name":"Kantor Pemroses Cabang Uji","type":"CABANG"})))
        s.add(Office(bank=bank,id="kpo-1",data=dumps({"name":"KPO Penerbit Warkat Uji","type":"KPO"})))
        s.add(Partner(bank=bank,id="partner-1",data=dumps({"name":"Penjamin Syariah Uji","active":True,"units":["CABANG-UJI","PUSAT-UJI"],"pks":"PKS-SANDBOX-1"})))
        for key,role,org,office in roles:
            passwords.setdefault(key,secrets.token_urlsafe(18))
            s.add(User(bank=bank,id=key,username=key if bank=="bank-uat" else bank+"-"+key,password=password_hash(passwords[key]),data=dumps({"role":role,"org":org,"office":office,"active":True,"name":key.replace("_"," ").title()})))
    return passwords


if __name__=="__main__":
    if os.getenv("APP_ENV","development") not in {"development","test"}: raise SystemExit("Seed dilarang pada produksi")
    root=Path(__file__).resolve().parents[1]; runtime=root/"runtime"; runtime.mkdir(exist_ok=True,mode=0o700)
    keyfile=runtime/"encryption.key"
    configured_key=os.getenv("BG_ENCRYPTION_KEY")
    if configured_key and keyfile.exists() and keyfile.read_bytes().strip()!=configured_key.encode():
        raise SystemExit("Kunci environment berbeda dari kunci runtime; hentikan dan rekonsiliasi sebelum melanjutkan")
    if not keyfile.exists(): keyfile.write_bytes(configured_key.encode() if configured_key else Fernet.generate_key()); keyfile.chmod(0o600)
    url=os.getenv("DATABASE_URL",f"sqlite:///{runtime}/bg.db")
    passwords=seed(Store(url))
    target=runtime/"sandbox-credentials.json"
    if passwords: target.write_text(json.dumps(passwords,indent=2)); target.chmod(0o600)
    print("Sandbox siap. Kredensial lokal: runtime/sandbox-credentials.json. Kunci: runtime/encryption.key")
