import json
from pathlib import Path
from datetime import datetime,timezone
from decimal import Decimal
import pytest
from bg.rules import evaluate,committee,split_ujrah,business_due,money,DomainError

P=json.loads((Path(__file__).resolve().parents[2]/'config/policy.sandbox.json').read_text())

@pytest.mark.parametrize('code',list(P['rules']))
def test_each_business_rule_has_positive_and_negative_branch(code):
    field=P['rules'][code]['assert']['field']
    assert evaluate(code,{field:True},P)['passed']
    assert not evaluate(code,{field:False},P)['passed']

@pytest.mark.parametrize('amount,role',[('2999999999.99','GH_BISNIS'),('3000000000','GH_BISNIS'),('3000000000.01','DIREKSI')])
def test_approval_boundary(amount,role): assert committee('SWASTA_NASIONAL',amount,P)==role

def test_t1_apbn_no_committee(): assert committee('APBN','2000000000',P) is None
def test_jv_not_automatically_exempt(): assert committee('JV','2000000000',P)=='GH_BISNIS'
@pytest.mark.parametrize('income,want',[('30000000','5000000'),('12000000','3000000'),('0','0')])
def test_t7_split(income,want): assert split_ujrah(income,P)==Decimal(want)

def test_weekend_and_holiday_sla():
    calendar=dict(P['calendar']); calendar['holidays']=['2026-11-02']
    friday=datetime(2026,10,30,7,tzinfo=timezone.utc)
    assert business_due(friday,1,calendar).isoformat()=='2026-11-03T10:00:00+00:00'

@pytest.mark.parametrize('amount',['NaN','Infinity','-1','1.001','1e25','abc'])
def test_malformed_money(amount):
    with pytest.raises(DomainError): money(amount)
