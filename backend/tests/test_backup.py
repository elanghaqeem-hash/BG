import subprocess,sys,sqlite3,hashlib
from pathlib import Path
from fastapi.testclient import TestClient
from bg.db import Store
from bg.api import make_app
from test_journeys import Journey

def test_backup_restore_preserves_registry_documents_and_audit(env,tmp_path):
    if not env['store'].sqlite:return
    j=Journey(env);j.active()
    source=env['store'].engine.url.database;target=tmp_path/'restored.sqlite'
    root=Path(__file__).resolve().parents[2]
    result=subprocess.run([sys.executable,str(root/'scripts/backup_sqlite.py'),str(target),source],capture_output=True,text=True,check=True)
    assert hashlib.sha256(target.read_bytes()).hexdigest() in result.stdout
    restored=Store('sqlite:///'+str(target))
    app=make_app(restored,env['app'].state.service.cipher,env['clock'])
    with TestClient(app) as c:
        r=c.post('/auth/login',json={'username':'audit','password':env['passwords']['audit']});assert r.status_code==200
        verify=c.get('/audit/verify').json();assert verify['valid'] and verify['events']>0
        assert c.get('/applications/'+j.a['id']).json()['state']=='ACTIVE'
    with sqlite3.connect(target) as c:
        assert c.execute('SELECT count(*) FROM guarantees').fetchone()[0]==1
        assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert not c.execute('PRAGMA foreign_key_check').fetchall()
    restored.engine.dispose()
