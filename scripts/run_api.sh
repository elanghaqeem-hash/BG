#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export APP_ENV=development
export BG_ENCRYPTION_KEY="$(cat runtime/encryption.key)"
export PYTHONPATH="$PWD/backend${PYTHONPATH:+:$PYTHONPATH}"
exec python -m uvicorn bg.main:app --host 127.0.0.1 --port 8000 --no-access-log
