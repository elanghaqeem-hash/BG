# Native backend verification — 28 October 2026

## Outcome

The missing backend has been replaced for the Cloudflare deployment by a native
TypeScript Worker and SQLite-backed Durable Object. The original portal is reused.
The backend requires no paid container or external Python URL. All financial and
institutional integrations remain explicitly SANDBOX/MOCK.

## Evidence

| Check | Result |
| --- | --- |
| Domain/API tests, including existing proxy tests | 64 PASS |
| Worker TypeScript and generated binding types | PASS |
| Next.js/OpenNext build and Wrangler bundle dry-run | PASS |
| Native browser checks, desktop and emulated Android viewport | 15 PASS |
| Workerd persistence, concurrency, rate limit and security checks | 10 PASS |
| Source Python regression suite | Retained unchanged; also exercised by CI |

Native tests exercise all 20 declarative rules and critical journeys: application,
KYB/SLIK, penjamin/SP2KBG, private-entity committee thresholds, special-format hash
approval, MKP and two-party akad, fee/split arithmetic, interoffice routing,
issuance capacity, certificates, delivery, QR registry, claim payment simulation,
contra rejection/deferral, litigation closure and policy maker–checker. Failed
commands roll back. Integer cents preserve monetary boundaries.

Security cases cover role/organization isolation, broker mandate revocation,
CSRF, idempotency and version replay, independent document verification,
encrypted chunk storage with hash checks, administrative-only user management,
immutable balanced journals, and missing/changed-key refusal.

`evidence/browser.json` records the 15 native browser checks. These include user
registration by Admin and password change with session revocation and re-login.
`evidence/native-runtime.json` records restart persistence, concurrent requests,
real native readiness, audit verification and login rate limits in workerd.
The viewport is emulated; no physical Android device is claimed.

Initial passwords and the encryption key are generated randomly, stored privately,
and excluded from Git. Runtime data, test databases, browser screenshots and
build bundles are also excluded. Deployment instructions and recovery limits are
in `CLOUDFLARE_DEPLOYMENT.md`.
