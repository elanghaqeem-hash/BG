# BG Cloudflare remediation — 27 October 2026

## Result

The deployment failure is repaired in the task branch. The original command
`npx wrangler deploy`, run from the repository root with `--dry-run`, now builds
Next.js, creates the OpenNext Worker bundle, discovers the static assets and
finishes successfully. No live Worker was published by these checks.

The recovered MVP source is from the previously approved
`BG_Ecosystem_MVP_v0.1_20261027.zip`, SHA-256
`0b24a26f8bfd0f144ceb2a5b53e19ad1f8f4260adbca1ce984c9fe5ecc8ffd2d`.
Repository AGENTS.md is preserved. Build output, runtime data, encryption keys,
random sandbox passwords and browser screenshots are excluded from the commit.

## Changes

- Restore frontend, backend, policies, migrations, documentation and existing tests.
- Add root package/lockfile, Wrangler configuration and OpenNext configuration.
- Make the original deploy command build its required Worker and assets automatically.
- Add HTTPS backend configuration, explicit local-only test opt-in, bounded uploads,
  session/CSRF forwarding, multiple Set-Cookie handling and private response caching rules.
- Preserve browser-facing Host/port for origin validation behind OpenNext's internal URLs.
- Show an explicit unavailable-service message when no backend exists; never simulate login.
- Validate session and QR response shapes and cancel unmounted session requests.
- Extend CI to test the proxy, build the Worker and run a deploy dry-run.

## Verification evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Backend regression tests, disposable SQLite | PASS: 66 tests | Local pytest execution; existing test suite |
| API proxy security and session contract | PASS: 8 tests | `tests/api-proxy.test.mjs` |
| Next.js production build | PASS | OpenNext build invokes Next.js 16.4.3 |
| TypeScript | PASS | `npm run typecheck` |
| Root Wrangler build and bundle | PASS | Original command with `--dry-run`; 18 static assets |
| Root/app Wrangler consistency | PASS | Name, date, flags, binding and relative paths checked |
| Browser using Cloudflare workerd and real local FastAPI | PASS: 13 checks | `evidence/browser.json` |
| Missing-backend API and browser behavior in workerd | PASS | `evidence/cloudflare-fail-closed.json` |

Browser checks cover desktop login; Principal login; persistent draft creation;
evidence upload; verification by an independent Compliance user; MPO, Penjamin,
Obligee and Broker portals; rejection of a fake QR token; mobile 393×852 layout;
long-form usability; and no uncaught browser errors. Login/logout are exercised
between role changes. The mobile viewport is emulated, not a physical Android device.

The missing-backend test confirms HTTP 503 for session lookup, login and public QR
verification, no session cookie, a visible service-unavailable message and no
uncaught browser errors. Deployment diagnostics correctly report backend not
configured, connectivity not checked, SANDBOX mode and production disabled.

## Release limitations

This repairs portal packaging and deployment. The Python/PostgreSQL/Temporal
backend still needs a persistent container host and a real HTTPS URL configured
as `BG_API_INTERNAL_URL`. No endpoint or credentials were available for a live
backend, so a deployed end-to-end banking service is not claimed. The original
MVP production startup gate and sandbox adapters remain intact.

No production migration, live financial transaction, real Android test, live
Cloudflare deployment or real user acceptance test was performed. The original
backend release gates remain documented in `RELEASE_GATE.md`.

Deployment instructions are in `CLOUDFLARE_DEPLOYMENT.md`.
