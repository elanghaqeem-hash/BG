import secrets
import pytest
from test_journeys import Journey
from bg.db import Application,Partner,Task,Claim
from bg.service import load,dumps

def test_br01_alternative_product_cannot_bypass_contra(env):
    j=Journey(env);j.create(product='OTHER',justification='Usulan produk lain');j.doc('NIB')
    r=j.command('submit','principal',want=422);assert r.json()['code']=='PRODUCT'

def test_br02_inactive_partner_blocks_issue(env):
    j=Journey(env);j.issued(stop_before_issue=True)
    with env['store'].transaction('bank-uat') as s:
        r=s.get(Partner,('bank-uat','partner-1'));d=load(r);d['active']=False;r.data=dumps(d)
    assert j.command('issue','mpo',want=422).json()['code']=='BR-02'

def test_br06_sp2_document_coverage_never_waives_nib(env):
    j=Journey(env);j.underwriting()
    with env['store'].transaction('bank-uat') as s:
        a=s.get(Application,('bank-uat',j.a['id']));d=load(a);d['sp2']['covered_documents']=['NIB','CONTRACT'];a.data=dumps(d)
        from bg.db import Document
        for doc in env['app'].state.service.docs(s,a):
            if doc.kind in {'NIB','CONTRACT'}:s.delete(doc)
        s.flush();facts=env['app'].state.service.facts(s,a)
        assert not facts['nib_present'] and not facts['documents_complete']

def test_br10_br11_br12_interoffice_handoff_guards(env):
    j=Journey(env);j.issued(stop_before_issue=True,issuing_office='kpo-1')
    # Completed handoff remains bound to its metadata and mandatory recipient list.
    with env['store'].transaction('bank-uat') as s:
        a=s.get(Application,('bank-uat',j.a['id']));d=load(a);d['ememo']['cc'].remove('GH_BISNIS');a.data=dumps(d)
    assert j.command('issue','issuer',want=422).json()['code']=='BR-12'

def test_br15_wrong_office_signer_and_br16_portfolio_tampering(env):
    j=Journey(env);j.issued(stop_before_issue=True,issuing_office='kpo-1')
    assert j.command('issue','mpo',want=403).json()['code']=='FORBIDDEN'
    with env['store'].transaction('bank-uat') as s:
        a=s.get(Application,('bank-uat',j.a['id']));d=load(a);d['portfolio_owner']='kpo-1';a.data=dumps(d)
    assert j.command('issue','issuer',want=422).json()['code']=='BR-16'

def test_br17_contra_claim_submitter_and_br19_monitoring(env):
    j=Journey(env);j.active();c=j.receive_claim()
    assert c['monitor_owner']=='UNIT_BISNIS' and c['cc']=='PENGEMBANGAN_BISNIS'
    c=j.claimcmd(c,'report','mpo');c=j.claimcmd(c,'approve_claim','mpo',{'instrument_conditions_met':True});c=j.claimcmd(c,'pay_bank','finance')
    doc=j.doc('CONTRA_CLAIM','mpo');j.claimcmd(c,'submit_contra','support',{'document':doc},want=403)

def test_br18_timely_report_preserves_receipt_clock(env):
    j=Journey(env);j.active();c=j.receive_claim();c=j.claimcmd(c,'report','mpo')
    with env['store'].transaction('bank-uat') as s:
        t=s.get(Task,('bank-uat','report:'+c['id']));assert t.status=='DONE' and not load(t)['late']
