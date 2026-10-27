import os, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"scripts"))
os.environ['APP_ENV']='test'
import pytest
from cryptography.fernet import Fernet
from datetime import datetime,timezone
from fastapi.testclient import TestClient
from bg.api import make_app
from bg.db import Store
from bootstrap import seed

class Clock:
    now=datetime(2026,10,27,7,tzinfo=timezone.utc)
    def __call__(self): return self.now

@pytest.fixture
def env(tmp_path):
    db_url=os.getenv('BG_TEST_DATABASE_URL') or f'sqlite:///{tmp_path}/test.db'
    store=Store(db_url)
    # PostgreSQL tests use a fresh isolated database; never point this URL at shared data.
    if os.getenv('BG_TEST_DATABASE_URL'):
        from bg.db import Base
        Base.metadata.drop_all(store.engine)
    passwords={name:'Test-'+name+'-Only-2026!' for name in ['principal','ao','analyst','compliance','mpo','issuer','support','gh','direksi','finance','finance_checker','penjamin','obligee','obligee_private','broker','litigation','legal','audit','admin','config_checker','worker']}
    seed(store,passwords)
    clock=Clock(); app=make_app(store,Fernet(Fernet.generate_key()),clock)
    with TestClient(app) as client:
        yield {'client':client,'store':store,'clock':clock,'passwords':passwords,'app':app}
    store.engine.dispose()
