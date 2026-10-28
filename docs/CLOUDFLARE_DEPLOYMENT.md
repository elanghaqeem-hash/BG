# BG on Cloudflare Free

The Cloudflare deployment now runs the Next.js portal and a native TypeScript
backend in one Worker. A SQLite-backed Durable Object owns each bank workspace's
records, document chunks, approval decisions, ledger and audit head. The initial
workspace is the explicitly labelled `bank-uat` sandbox. There is no public
parameter that selects another tenant or Durable Object.

No Python container, external VPS, PostgreSQL service or `BG_API_INTERNAL_URL`
is needed for this deployment. The original Python implementation is retained as
a reference and for regression comparison. Cloudflare Free quotas still apply;
the change does not upgrade the account or create a paid subscription.

## Workers Builds

| Setting | Value |
| --- | --- |
| Repository | elanghaqeem-hash/BG |
| Branch | main |
| Worker | bg |
| Root directory | / |
| Build command | Empty |
| Deploy command | npx wrangler deploy |
| Node for builds/tests | 24 recommended |

The root Wrangler build installs the locked frontend dependencies and runs
Next.js/OpenNext. `cloudflare/worker.ts` routes `/api/*` to `BankBackend` and other
requests to the existing portal. Both Wrangler configurations declare the same
SQLite class migration and binding. Compatibility date stays at 2026-10-27,
a supported date shared by the installed workerd and Cloudflare runtime.

## One-time setup

`node --experimental-strip-types scripts/provision_native.mjs` creates random,
independent passwords for the 21 sandbox identities, PBKDF2-SHA256 password
hashes, and an AES-256-GCM document encryption key in ignored local runtime
storage. It refuses to overwrite an existing secret file. None of these
credentials belongs in Git, a public issue or a build log.

Install the values as Worker runtime secrets named `BG_INITIAL_USERS` and
`BG_ENCRYPTION_KEY`. Keep `BG_MODE=SANDBOX`. On the first request, the backend
atomically initializes the sandbox master data and users from those hashes.
Subsequent requests preserve existing users and passwords, even after a deploy.
A persisted encryption-key fingerprint rejects a changed key. Missing secrets
return 503; there is no default password or fabricated authentication success.

Credentials and the private key-recovery copy are delivered separately to the
owner. They are not project source files. Use **Keamanan** after login to change
a password; all existing sessions for that identity are revoked. Admin can
register and deactivate users in **Pengguna**. Deactivation revokes sessions.

## Security and transaction boundaries

- Synchronous domain operations execute inside one Durable Object SQLite
  transaction. Session authorization, version checks, idempotency, ledger writes,
  workflow changes, document chunks and audit entries commit or roll back together.
- The bank workspace serializes issuance numbering, cumulative exposure and the
  audit head. Concurrent requests using one version cannot both advance it.
- Separate identities enforce approval, document verification and settlement
  maker–checker controls. Roles and organizations come from stored user records.
- Session tokens are random and stored as SHA-256 hashes. HTTPS cookies are
  HttpOnly, Secure and SameSite=Strict. State-changing requests require CSRF;
  the outer Worker also rejects cross-site browser origins.
- Login/public endpoints have persisted rate counters. Request bodies are capped
  at 3 MB. Document plaintext is capped at 2 MB and is encrypted with independent
  AES-GCM nonces and document-specific authenticated data. Ciphertext is split
  into small SQLite blob rows and checked against its plaintext SHA-256 on read.
- Financial arithmetic uses integer cents (BigInt). Journal, approval and audit
  tables are protected by append-only triggers; numbering and usernames are unique.
- Durable Object alarms replace the sandbox Temporal sweep for task escalation
  and activation dates. Sweep retries do not create duplicate notifications.

This is a functional sandbox, not a banking production release. Core banking,
SLIK/registry lookups, PSrE, payments and insurer integrations remain explicitly
simulated as in the original MVP. No real BG is issued by this version.

## Validation

```bash
npm ci
npm test
npm run cf-typegen
npm run typecheck:worker
npm run check:deploy
npm run typecheck
```

For local browser and persistence tests, generate an isolated environment file
with test-only initial identity hashes and a test encryption key. Store it as
`runtime/native-test.env`; store the corresponding test passwords as
`runtime/sandbox-credentials.json`. Use the original fixture username set.
No production secrets or customer data should be used by this harness.

```bash
node frontend/node_modules/playwright/cli.js install chromium --only-shell
BG_WEB_RUNTIME=native node scripts/browser_smoke.cjs
node scripts/native-runtime-check.mjs
```

The native browser harness skips the Python server and uses a disposable
SQLite-backed Durable Object directory. The persistence test restarts workerd
and verifies the same session, application and encrypted document afterwards.

After publishing, `/api/health/deployment` must report `backend_connectivity=ok`
and `backend=durable-object-sqlite`. `/api/health` reports persistence and sandbox
mode. Before login, `/api/auth/me` must return 401. Check login/logout and stored
role behavior using the separately supplied identities.

## Recovery and scope

Preserve the Durable Object namespace and the original encryption key. Do not
replace them as a way to repair a login error. Cloudflare SQL storage recovery
and a separately stored key are required for a usable restore; a Worker rollback
alone does not roll back business data. A full backup/restore and real-user UAT
remain banking production gates.

Collections are explicitly bounded for this pilot; exceeding the supported
collection size fails with `CAPACITY` rather than silently dropping records.
Audit appends use the indexed head and integrity checks use bounded pages.
Additional bank onboarding, external identity/MFA, institutional policy sign-off,
production integrations and regulator reporting are separate release work.
