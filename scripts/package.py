import hashlib,json,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
ignored={'node_modules','.next','.open-next','.wrangler','runtime','.venv','__pycache__','.pytest_cache','.git'}
files=[p for p in root.rglob('*') if p.is_file() and not any(part in ignored for part in p.relative_to(root).parts) and p.name != 'MANIFEST.sha256' and (not p.name.startswith('.env') or p.name == '.env.example') and not p.name.startswith('.dev.vars') and not p.name.endswith(('.pyc','.tsbuildinfo','.zip'))]
manifest=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(root).as_posix()+'\n' for p in sorted(files))
(root/'MANIFEST.sha256').write_text(manifest)
target=root.parent/'BG_Ecosystem_MVP_v0.1_20261027.zip'
with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED) as z:
    for p in sorted(files)+[root/'MANIFEST.sha256']:z.write(p,Path('bg_ecosystem')/p.relative_to(root))
with zipfile.ZipFile(target) as z:assert z.testzip() is None
print(json.dumps({'file':str(target),'files':len(files)+1,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}))
