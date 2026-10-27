import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"backend"))
from cryptography.fernet import Fernet
from sqlalchemy.schema import CreateTable,CreateIndex
from sqlalchemy.dialects import postgresql
from bg.api import make_app
from bg.db import Base,Store
root=Path(__file__).resolve().parents[1]
app=make_app(Store("sqlite:///:memory:"),Fernet(Fernet.generate_key()))
(root/"docs/openapi.json").write_text(json.dumps(app.openapi(),indent=2))
sql="-- Implemented MVP schema. Use backend Store.initialize() on a NEW sandbox database.\n"
for t in Base.metadata.sorted_tables:
    sql+=str(CreateTable(t).compile(dialect=postgresql.dialect()))+";\n"
    for i in t.indexes:sql+=str(CreateIndex(i).compile(dialect=postgresql.dialect()))+";\n"
(root/"migrations/0001_mvp_schema.postgresql.sql").write_text(sql)
print("OpenAPI 3.1 and PostgreSQL MVP schema exported")
