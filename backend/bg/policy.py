from datetime import date
from .rules import require,money,predicate

def validate_policy(p):
    require(p.get("assumption") is True,"POLICY","Distribusi ini hanya menerima policy sandbox bertanda asumsi")
    require(set(p.get("rules",{}))=={f"BR-{i:02}" for i in range(1,21)},"POLICY","Seluruh BR-01 sampai BR-20 wajib ada")
    require(date.fromisoformat(p["effective_to"])>date.fromisoformat(p["effective_from"]),"POLICY","Periode tidak valid")
    for rule in p["rules"].values(): predicate(rule["assert"],{})
    require(0<=money(p["rules"]["BR-13"]["rate"])<=1,"POLICY","Rate split tidak valid")
    for k in ("coverage","admin_fee","ijp","broker_commission","partner_limit","principal_limit"): money(p["pks"][k])
    require(0<money(p["pks"]["coverage"])<=100,"POLICY","Coverage tidak valid")
    require(p["calendar"]["working_days"] and set(p["calendar"]["working_days"])<=set(range(7)),"POLICY","Kalender tidak valid")
    require(p["rules"]["BR-14"]["business_days"]>=1 and p["rules"]["BR-18"]["business_days"]>=1,"POLICY","SLA tidak valid")
