import base64,json,secrets
from datetime import timedelta
from sqlalchemy import select,text
import pytest
from bg.db import *
from bg.service import load,dumps

class Journey:
    def __init__(self,env): self.e=env; self.c=env['client']; self.csrf=''; self.user=''; self.a=None
    def login(self,user):
        cached=self.e.setdefault('sessions',{}).get(user)
        if cached and (self.e['clock']()-cached['at']).total_seconds()<7*3600:
            self.c.cookies.clear();self.c.cookies.set('bg_session',cached['token']);self.csrf=cached['csrf'];self.user=user;return cached
        self.c.cookies.clear()
        r=self.c.post('/auth/login',json={'username':user,'password':self.e['passwords'][user]}); assert r.status_code==200,r.text
        self.csrf=r.json()['csrf']; self.user=user; self.e['sessions'][user]={'csrf':self.csrf,'token':self.c.cookies.get('bg_session'),'at':self.e['clock']()}; return r.json()
    def post(self,path,payload=None): return self.c.post(path,json=payload,headers={'X-CSRF-Token':self.csrf})
    def create(self,**changes):
        self.login('principal')
        body=dict(principal='principal-1',obligee='obligee-apbn',partner='partner-1',processing_office='cabang-1',issuing_office='cabang-1',project_name='Pembangunan Uji',amount='2000000000',issue_on='2026-10-27',expires_on='2027-04-27',bg_type='PELAKSANAAN')
        body.update(changes); r=self.post('/applications',body); assert r.status_code==201,r.text; self.a=r.json(); return self.a
    def doc(self,kind,user='principal',verify=True):
        self.login(user)
        r=self.post(f"/applications/{self.a['id']}/documents",{'kind':kind,'content_base64':base64.b64encode(('Bukti sandbox '+kind+' '+secrets.token_hex(8)).encode()).decode(),'source_reference':'Sumber primer sandbox'})
        assert r.status_code==201,r.text; d=r.json()
        if verify:
            self.login('compliance' if user!='compliance' else 'mpo')
            r=self.post('/documents/'+d['id']+'/verify',{'source_reference':'Sumber primer terverifikasi UAT'}); assert r.status_code==200,r.text
        return d['id']
    def command(self,name,user,payload=None,want=200,key=None,version=None):
        self.login(user)
        fresh=self.c.get('/applications/'+self.a['id']); assert fresh.status_code==200,fresh.text; self.a=fresh.json()
        r=self.post(f"/applications/{self.a['id']}/commands/{name}",{'expected_version':self.a['version'] if version is None else version,'idempotency_key':key or secrets.token_hex(12),'payload':payload or {}})
        assert r.status_code==want,r.text
        if want==200:self.a=r.json()
        return r
    def underwriting(self,**changes):
        self.create(**changes)
        for kind in ['NIB','CONTRACT','KYB']:self.doc(kind)
        self.command('submit','principal'); self.command('kyb_pass','compliance',{'screening_clear':True,'ubo_verified':True})
        slik=self.doc('SLIK','analyst'); self.command('record_slik','analyst',{'document':slik,'collectibility':1,'pulled_at':self.e['clock']().isoformat()})
        self.command('partner_start','penjamin'); sp2=self.doc('SP2KBG','penjamin')
        self.command('sp2_issue','penjamin',{'document':sp2,'reference':'SP2-UAT','issuing_unit':'CABANG-UJI','amount':self.a['amount'],'valid_to':'2027-01-01'})
        self.command('bank_underwrite','analyst')
        return self.a
    def issued(self,stop_before_issue=False,**changes):
        self.underwriting(**changes)
        if self.a.get('custom_format'):
            doc=self.doc('FORMAT_APPROVAL','penjamin'); draft=next(d for d in self.a['documents'] if d['kind']=='DRAFT_BG')
            self.command('approve_format','penjamin',{'document':doc,'draft_hash':draft['sha256'],'signed_and_stamped':True})
        self.command('approve','mpo')
        if self.a['committee_role']:self.command('approve','gh' if self.a['committee_role']=='GH_BISNIS' else 'direksi')
        self.command('sign_mkp','mpo'); self.command('sign_akad','principal'); self.command('sign_akad','mpo'); self.command('collect_fee','finance')
        if self.a['processing_office']!=self.a['issuing_office']:
            self.doc('PRINCIPAL_REQUEST')
            self.command('ememo','mpo',{'to':'PEMIMPIN_PENERBIT','cc':['GH_BISNIS','KADEP_SUPPORT','MPO_PEMROSES','MPO_PENERBIT'],'attachments':['PRINCIPAL_REQUEST','MKP','DRAFT_BG']})
        if not stop_before_issue:self.command('issue','issuer' if self.a['issuing_office']=='kpo-1' else 'mpo')
        return self.a
    def active(self,**changes):
        self.issued(**changes)
        cert=self.doc('CERTIFICATE','penjamin'); self.command('certificate','penjamin',{'document':cert,'reference':'CERT-UAT'})
        delivery=self.doc('DELIVERY','obligee'); self.command('deliver','mpo',{'document':delivery})
        return self.a
    def receive_claim(self):
        doc=self.doc('CLAIM','obligee'); self.login('obligee')
        r=self.post(f"/applications/{self.a['id']}/claims",{'document':doc,'amount':'100000000'}); assert r.status_code==201,r.text; return r.json()
    def claimcmd(self,c,name,user,payload=None,want=200):
        self.login(user)
        r=self.post(f"/claims/{c['id']}/commands/{name}",{'expected_version':c['version'],'idempotency_key':secrets.token_hex(12),'payload':payload or {}}); assert r.status_code==want,r.text
        return r.json() if want==200 else c

def test_t1_complete_issue_certificate_delivery_qr(env):
    j=Journey(env); a=j.active(); assert a['state']=='ACTIVE' and a['committee_role'] is None
    link=j.c.get('/applications/'+a['id']+'/verification-link').json()
    r=j.c.get('/public/verify/'+link['token']).json(); assert r['authentic'] and r['valid'] and r['amount']=='2000000000'
    assert j.c.get('/public/qr/'+link['token']).headers['content-type']=='image/png'
    j.login('audit'); assert j.c.get('/audit/verify').json()['valid']

@pytest.mark.parametrize('amount,required,user',[('2500000000','GH_BISNIS','gh'),('4000000000','DIREKSI','direksi')])
def test_t2_t3_private_committee(env,amount,required,user):
    j=Journey(env); a=j.underwriting(obligee='obligee-private',amount=amount); assert a['committee_role']==required
    j.command('approve','mpo'); j.command('sign_mkp','mpo',want=409); j.command('approve',user); assert j.a['state']=='APPROVAL_GRANTED'

@pytest.mark.parametrize('col,days',[(2,0),(1,31)])
def test_t4_slik_hard_stop(env,col,days):
    j=Journey(env);j.create()
    for kind in ['NIB','CONTRACT','KYB']:j.doc(kind)
    j.command('submit','principal');j.command('kyb_pass','compliance',{'screening_clear':True,'ubo_verified':True})
    doc=j.doc('SLIK','analyst');j.command('record_slik','analyst',{'document':doc,'collectibility':col,'pulled_at':(env['clock']()-timedelta(days=days)).isoformat()},want=422)
    assert j.a['state']=='SLIK_CHECK'

def test_t5_tdp_does_not_replace_nib(env):
    j=Journey(env);j.create();j.doc('TDP','ao');j.command('submit','principal',want=422)

def test_t6_format_gate_hash_and_original(env):
    j=Journey(env);j.underwriting(custom_format=True); j.command('approve','mpo',want=409)
    doc=j.doc('FORMAT_APPROVAL','penjamin');j.command('approve_format','penjamin',{'document':doc,'draft_hash':'0'*64,'signed_and_stamped':True},want=422)
    draft=next(d for d in j.a['documents'] if d['kind']=='DRAFT_BG')
    j.command('approve_format','penjamin',{'document':doc,'draft_hash':draft['sha256'],'signed_and_stamped':True})
    j.command('approve','mpo');j.command('sign_mkp','mpo');j.command('sign_akad','principal');j.command('sign_akad','mpo');j.command('collect_fee','finance');j.command('issue','mpo');assert j.a['state']=='BG_ISSUED'
    j.login('mpo'); operations=j.c.get('/operations').json(); assert any(t['details']['kind']=='ORIGINAL' and t['status']=='OPEN' for t in operations['tasks'])

@pytest.mark.parametrize('income,expected',[('30000000','5000000.00'),('12000000','3000000.00')])
def test_t7_interoffice_settlement(env,income,expected):
    with env['store'].transaction('bank-uat') as s:
        p=s.get(Policy,('bank-uat','policy-1'));d=load(p);d['pks']['admin_fee']=income;p.data=dumps(d)
    j=Journey(env);j.issued(issuing_office='kpo-1');j.command('distribute','finance',want=403);j.command('distribute','finance_checker')
    with env['store'].transaction('bank-uat') as s:
        dist=s.get(Distribution,('bank-uat',j.a['id']));assert load(dist)['amount']==expected and dist.status=='SETTLED'
        task=s.get(Task,('bank-uat','split:'+j.a['id']));assert not load(task)['late']

def test_t8_report_escalation_survives_sweep_retry(env):
    j=Journey(env);j.active();c=j.receive_claim();env['clock'].now+=timedelta(days=2)
    j.login('worker');assert j.post('/operations/sweep').json()['escalated']>=1; assert j.post('/operations/sweep').json()['escalated']==0
    c=j.claimcmd(c,'report','mpo')
    with env['store'].transaction('bank-uat') as s: assert load(s.get(Task,('bank-uat','report:'+c['id'])))['late']

@pytest.mark.parametrize('decision',['REJECTED','DEFERRED'])
def test_t9_rejected_contra_auto_litigation_and_protected_closure(env,decision):
    j=Journey(env);j.active();c=j.receive_claim();c=j.claimcmd(c,'report','mpo');c=j.claimcmd(c,'approve_claim','mpo',{'instrument_conditions_met':True});c=j.claimcmd(c,'pay_bank','finance')
    doc=j.doc('CONTRA_CLAIM','mpo');c=j.claimcmd(c,'submit_contra','mpo',{'document':doc})
    decision_doc=j.doc('CONTRA_DECISION','penjamin');c=j.claimcmd(c,'contra_decision','penjamin',{'document':decision_doc,'decision':decision,'reason':'Dokumen diperselisihkan'})
    c=j.claimcmd(c,'request_close','litigation',want=422)
    with env['store'].transaction('bank-uat') as s: assert s.get(Litigation,('bank-uat',c['id'])).state=='OPEN'
    payment=j.doc('CONTRA_PAYMENT','penjamin');c=j.claimcmd(c,'confirm_contra_paid','finance',{'document':payment})
    resolution=j.doc('RESOLUTION','legal');c=j.claimcmd(c,'request_close','litigation',{'document':resolution});c=j.claimcmd(c,'confirm_close','legal')
    with env['store'].transaction('bank-uat') as s: assert s.get(Litigation,('bank-uat',c['id'])).state=='CLOSED'

def test_t10_broker_mandate_revocation_and_no_approval(env):
    j=Journey(env);j.create(); doc=j.doc('MANDATE');j.login('principal')
    r=j.post('/mandates',{'principal':'principal-1','broker':'broker-1','document':doc,'application_id':j.a['id'],'expires':'2027-01-01T00:00:00+00:00','commission_disclosed':True});assert r.status_code==200,r.text;mid=r.json()['id']
    j.create(mandate=mid)
    for kind in ['NIB','CONTRACT','KYB']:j.doc(kind)
    j.command('approve','broker',want=409)
    j.command('submit','broker',{'commission_accepted':True})
    j.login('broker');r=j.post('/applications/'+j.a['id']+'/documents',{'kind':'NIB','content_base64':base64.b64encode(b'late edit').decode()});assert r.status_code==404
    j.login('principal'); assert j.post('/mandates/'+mid+'/revoke').status_code==200
    j.login('broker'); assert j.c.get('/applications/'+j.a['id']).status_code==404
    j.login('principal'); assert j.c.get('/applications/'+j.a['id']).status_code==200

def test_t11_fake_and_expired_distinguish_claim_window(env):
    j=Journey(env);j.issued();link=j.c.get('/applications/'+j.a['id']+'/verification-link').json()
    assert j.c.get('/public/verify/fake-token').json()['status']=='NOT_FOUND'
    env['clock'].now=env['clock'].now.replace(year=2027,month=4,day=28)
    out=j.c.get('/public/verify/'+link['token']).json();assert out['authentic'] and not out['valid'] and out['claim_window_open']

def test_csrf_version_and_idempotency(env):
    j=Journey(env);j.create();j.doc('NIB');j.login('principal')
    assert j.c.post('/auth/logout').status_code==403
    v=j.c.get('/applications/'+j.a['id']).json()['version'];key=secrets.token_hex(12)
    r=j.command('submit','principal',key=key,version=v);again=j.command('submit','principal',key=key,version=v);assert r.json()==again.json()
    j.command('kyb_pass','compliance',want=409,version=v)

def test_broker_no_mandate_and_cross_tenant(env):
    j=Journey(env);j.create();j.login('broker'); assert j.c.get('/applications/'+j.a['id']).status_code==404
    assert j.c.get('/applications/not-a-real-id').status_code==404
    with env['store'].transaction('bank-other') as s:
        from bg.api import password_hash
        s.add(User(bank='bank-other',id='foreign',username='foreign',password=password_hash('separate-password'),data=dumps({'role':'AUDIT','org':'other','office':'','active':True})))
    r=j.c.post('/auth/login',json={'username':'foreign','password':'separate-password'});assert r.status_code==200
    assert j.c.get('/applications/'+j.a['id']).status_code==404

def test_audit_append_only_and_journal_balance(env):
    j=Journey(env);j.issued()
    with env['store'].transaction('bank-uat') as s:
        for r in s.scalars(select(Journal)):
            lines=load(r)['lines'];from decimal import Decimal
            assert sum(Decimal(l['debit']) for l in lines)==sum(Decimal(l['credit']) for l in lines)
    if env['store'].sqlite:
        with pytest.raises(Exception):
            with env['store'].engine.begin() as c:c.execute(text("DELETE FROM audit_log"))

def test_production_boot_is_fail_closed(monkeypatch):
    from bg.api import make_app
    monkeypatch.setenv('APP_ENV','production')
    with pytest.raises(RuntimeError):make_app()

def test_issue_rechecks_slik_on_month_rollover(env):
    j=Journey(env);j.issued(stop_before_issue=True)
    env['clock'].now=env['clock'].now.replace(month=11,day=1)
    r=j.command('issue','mpo',want=422);assert r.json()['code']=='BR-05'
    with env['store'].transaction('bank-uat') as s:assert s.get(Guarantee,('bank-uat',j.a['id'])) is None

def test_two_concurrent_issues_cannot_oversubscribe_limit(env):
    from concurrent.futures import ThreadPoolExecutor
    from bg.rules import DomainError
    j=Journey(env)
    with env['store'].transaction('bank-uat') as s:
        p=s.get(Policy,('bank-uat','policy-1'));d=load(p);d['pks']['principal_limit']='3000000000';p.data=dumps(d)
    first=j.issued(stop_before_issue=True);second=j.issued(stop_before_issue=True)
    def issue(a):
        try:
            with env['store'].transaction('bank-uat') as s:
                u=s.get(User,('bank-uat','mpo'));actor={'id':u.id,'bank':u.bank,**load(u)}
                env['app'].state.service.execute(s,actor,s.get(Application,('bank-uat',a['id'])),'issue',{},a['version'],secrets.token_hex(12))
            return 'ISSUED'
        except DomainError as e:return e.code
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(issue,[first,second]))
    assert sorted(results)==['ISSUED','LIMIT']

def test_unauthorized_direct_command_and_payload_validation(env):
    j=Journey(env);j.create();j.command('issue','audit',want=409)
    j.login('principal');r=j.post('/applications',{**{'principal':'principal-1'},'actor_id':'admin'});assert r.status_code==422
    j.doc('NIB');j.command('submit','principal');j.command('kyb_pass','compliance',{},want=422)

def test_document_encrypted_and_download_hash_verified(env):
    j=Journey(env);j.create();doc=j.doc('NIB')
    with env['store'].transaction('bank-uat') as s:
        r=s.get(Document,('bank-uat',doc));assert 'Bukti sandbox' not in r.encrypted_bytes
        r.digest='0'*64
    j.login('principal');r=j.c.get('/documents/'+doc+'/download');assert r.status_code==409

def test_configuration_is_versioned_maker_checker(env):
    from pathlib import Path
    policy=json.loads((Path(__file__).resolve().parents[2]/'config/policy.sandbox.json').read_text())
    j=Journey(env);j.login('admin');r=j.post('/policies',{'configuration':policy});assert r.status_code==201
    pid=r.json()['id'];assert j.post('/policies/'+pid+'/approve').status_code==403
    j.login('config_checker');assert j.post('/policies/'+pid+'/approve').status_code==200
    assert j.c.get('/catalog').json()['policies'][0]['version']==2
