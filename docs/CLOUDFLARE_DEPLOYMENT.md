# Cloudflare deployment — BG portal

## Scope and root cause

The initial GitHub main branch contained only AGENTS.md, so `npx wrangler deploy`
had neither an entry point nor any application assets. This change restores the
existing MVP source and adds a buildable Next.js/OpenNext Worker. It preserves
the FastAPI/SQLAlchemy/PostgreSQL/Temporal backend. It does not convert that
backend to D1, remove the sandbox restrictions, or activate banking integrations.

## Workers Builds settings

| Setting | Value |
| --- | --- |
| Repository | elanghaqeem-hash/BG |
| Project / Worker name | bg |
| Root directory | / (repository root) |
| Build command | Leave empty |
| Deploy command | npx wrangler deploy |
| Node version | 22 or later |

The root `wrangler.jsonc` runs `npm run build` before deployment. That installs
the locked frontend dependencies, builds Next.js, and adapts it with OpenNext.
Wrangler then uploads `frontend/.open-next/worker.js` and its assets. An explicit
dashboard build command is unnecessary and would duplicate this work.

`frontend/wrangler.jsonc` is the equivalent app-relative configuration consumed
by OpenNext and local Workers tests. Keep its Worker name, compatibility date,
flags and assets binding synchronized with the root configuration.

## Connect the existing backend

1. Host the existing FastAPI sandbox on a container-capable environment with
   persistent database, encryption key and document storage. Use the existing
   Compose/runbook instructions; bootstrap is sandbox-only.
2. Configure the published Worker's **runtime** variable `BG_API_INTERNAL_URL`
   with the backend HTTPS origin. This variable is server-only; do not prefix
   it with `NEXT_PUBLIC_`. Do not point it back at the portal itself.
3. Set backend `BG_PUBLIC_WEB_URL` to the portal HTTPS origin for QR links,
   `BG_ALLOWED_ORIGINS` to the same origin, and `BG_COOKIE_SECURE=1` for HTTPS.
4. Keep `BG_ALLOW_LOCAL_API` unset in Cloudflare. It only permits local HTTP
   loopback in the isolated automated test harness.

The Worker preserves dashboard-set variables with `keep_vars: true`. No backend
endpoint, credentials, encryption key or session secret is committed. A valid
configuration alone does not prove that the backend is reachable or healthy.

## Validation

```bash
npm ci
npm test
npm run check:deploy
npm run typecheck
npm run cf-typegen
```

`check:deploy` exercises the original failing command with `--dry-run`: it builds
and bundles the Worker without publishing. It requires no production credentials.

Run the existing full sandbox browser suite in the Workers runtime after installing
backend/frontend dependencies and bootstrapping local sandbox identities:

```bash
python scripts/bootstrap.py
node frontend/node_modules/playwright/cli.js install chromium --only-shell
BG_WEB_RUNTIME=workers BG_PYTHON=.venv/bin/python node scripts/browser_smoke.cjs
```

Use an absolute `BG_PYTHON` path if the Python environment is outside the repository.
The script creates a disposable SQLite database and performs login, draft creation,
upload, independent verification, role portals, QR rejection and mobile checks.
Screenshots/logs remain in ignored runtime storage, with no credentials committed.

After publishing:

- `/` must render the portal login.
- `/api/health/deployment` reports the portal and whether a backend URL is set;
  it deliberately does not claim backend connectivity or production readiness.
- `/api/health` must return the real backend health response.
- `/api/auth/me` must return 401 before login; login must set an HttpOnly session,
  and logout must revoke it. Confirm persistence and role isolation on the actual backend.

Without a backend URL, API calls return 503 `BACKEND_NOT_CONFIGURED`; the login
page displays an actionable service-unavailable message. There is no mocked
login or fallback transaction success. The original MVP remains SANDBOX.

## Release boundary and rollback

Task changes are pushed to a dedicated branch and proposed through a pull request.
Merge and live publication remain separate release actions. The initial main
contained no application deployment to roll back to. For later deployments,
record the prior Worker version and backend database backup before promoting;
roll back the Worker version without discarding database or encryption keys.
