"""Generate local-only Compose secrets; never overwrite an existing .env."""
import secrets
from pathlib import Path
from cryptography.fernet import Fernet
root=Path(__file__).resolve().parents[1]
target=root/".env"
if target.exists():raise SystemExit(".env sudah ada; tidak diubah")
target.write_text("BG_DB_PASSWORD="+secrets.token_urlsafe(32)+"\nBG_ENCRYPTION_KEY="+Fernet.generate_key().decode()+"\n")
target.chmod(0o600)
print("Konfigurasi lokal dibuat. Jangan masukkan .env ke repository.")
