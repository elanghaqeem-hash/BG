import hashlib,sqlite3,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
source=Path(sys.argv[2]) if len(sys.argv)>2 else root/'runtime/bg.db'
target=Path(sys.argv[1]) if len(sys.argv)>1 else root/'runtime/bg-backup.sqlite'
if target.exists():raise SystemExit('Target sudah ada; gunakan nama checkpoint baru')
with sqlite3.connect(source) as a,sqlite3.connect(target) as b:a.backup(b)
target.chmod(0o600)
check=sqlite3.connect(target)
assert check.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert not check.execute('PRAGMA foreign_key_check').fetchall()
check.close()
print('Backup verified SHA256 '+hashlib.sha256(target.read_bytes()).hexdigest())
