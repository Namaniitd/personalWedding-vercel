# Private invitation API

`api/` owns database access, invitation resolution, RSVP writes, coordinator data, content editing, and gate check-in. `web/` runs Next.js separately. Guests use the frontend; its server calls this API using a shared service token.

## Vercel and Neon

Import this repository into a separate Vercel project with **Root Directory `api`** and **Framework Preset Other**. The checked-in `vercel.json` supplies install/build commands, serves no static source files, and routes `/healthz`, `/readyz`, and `/v1/*` into the single Node 22 function at `api/index.ts`. It imports the request handler directly and never starts `src/server.ts`.

Set the runtime variables listed in `.env.example`: `BACKEND_SERVICE_TOKEN`, `PUBLIC_APP_ORIGIN`, `DATABASE_URL`, `DATABASE_INVITATION_TOKEN_PEPPER`, and `DATABASE_ENTRY_PASS_TOKEN_PEPPER`. `PUBLIC_APP_ORIGIN` must be the final frontend HTTPS origin. `DATABASE_URL` must use the least-privilege runtime role and Neon's **pooled** hostname with `sslmode=verify-full`. Keep Neon's other URL options. Vercel supplies its own `VERCEL=1` environment variable; do not set it locally.

The shared pool uses at most four connections per function instance and attaches to Vercel's pool lifecycle handling. The connection timeout allows 15 seconds for Neon to resume; query timeout remains four seconds. The frontend's backend request timeout must allow for this connection delay. The checked-in function region is Singapore (`sin1`); create Neon in AWS Singapore as described in the root deployment guide.

`DATABASE_SCHEMA_URL`, the schema apply confirmations, and `DATABASE_RUNTIME_ROLE` belong to local operator scripts, never the deployed API environment. Use a direct/unpooled owner connection for schema setup, then grant only the reviewed runtime permissions to a separate runtime login. See the root deployment guide for the complete account, database, and frontend steps.

Production `/healthz` should return 200. `/v1/status` without the service token should return 401. `/readyz` checks configuration and database connectivity; do not treat a successful build as proof that schema/grants are ready.

## Run

```sh
cd api
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

`pnpm build && pnpm start` runs the compiled production service. It listens on `HOST` (default `0.0.0.0`) and `PORT` (default `4000`). Production containers supply environment variables directly; the development command loads `.env.local`.

The frontend and API must share one random `BACKEND_SERVICE_TOKEN` of 32–256 URL-safe characters. Every `/v1/*` request sends it in `X-Backend-Service-Token`. The API verifies the token before reading a request body or accessing a database. A browser never receives it. `web/` must never receive `DATABASE_URL`, a Supabase service key, or invitation/entry-pass token peppers.

Choose one complete guest store:

- Direct PostgreSQL: `DATABASE_URL`, `DATABASE_INVITATION_TOKEN_PEPPER`, and `DATABASE_ENTRY_PASS_TOKEN_PEPPER`. This also enables the coordinator.
- Hosted Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INVITATION_TOKEN_PEPPER`, and `ENTRY_PASS_TOKEN_PEPPER`. This supports guest invitations and RSVPs; the coordinator requires direct PostgreSQL.

Partial or simultaneous store configurations disable invitation access. Production direct PostgreSQL requires an exact HTTPS `PUBLIC_APP_ORIGIN` and `sslmode=verify-full` with certificate validation.
Hosted Supabase also requires TLS certificate validation; setting `NODE_TLS_REJECT_UNAUTHORIZED=0` disables hosted access. The service rejects HTTP redirects so the Supabase `apikey` header cannot follow a response to another origin.

Built local Podman images may set `NODE_ENV=production`, `LOCAL_STACK_MODE=1`, and `PUBLIC_APP_ORIGIN` to exactly `http://127.0.0.1:3000`, `http://127.0.0.1:3001`, or `http://127.0.0.1:3002`. The personal stack defaults to port 3000 and supports `LOCAL_WEB_PORT=3002`; port 3001 is reserved for disposable smoke tests. Plaintext PostgreSQL is accepted only when the URL host is exactly `db`, port is 5432 or omitted, and no SSL query or `PGSSLMODE` override is present. Any other origin or host keeps the production HTTPS/TLS requirements. The matching frontend flag allows local HTTP cookies and disables only the CSP upgrade directive.

## Internal HTTP contract

All `/v1/*` responses are JSON with `Cache-Control: private, no-store`; there are no CORS response headers. Raw invitation and QR credentials appear only in JSON bodies, never in API paths or query strings.

| Method | Path | Request/response |
| --- | --- | --- |
| GET | `/v1/status` | `{mode, coordinatorAvailable}` |
| GET | `/v1/readyz` | Authenticated dependency readiness |
| POST | `/v1/invitations/resolve` | `{token}` → `{ok, resolved}`; 404 for inactive link |
| POST | `/v1/rsvp` | Current RSVP JSON → `{ok, mode, updatedAt?, entryPass?}` |
| GET | `/v1/coordinator/workspace` | `{ok, issuerOptions, invitations}` |
| GET | `/v1/coordinator/content` | `{ok, configuration}` |
| PUT | `/v1/coordinator/content` | Full validated editor snapshot → saved snapshot or 409 conflict |
| GET | `/v1/coordinator/invitations` | `{ok, invitations}` for content-editor fallback |
| POST | `/v1/coordinator/invitations` | Issuer JSON → `{ok, issued}` with a one-response raw token; web forms the public URL |
| POST | `/v1/coordinator/invitations/revoke` | `{invitationId}` → revoke audit |
| POST | `/v1/coordinator/invitations/rsvp/delete` | `{invitationId}` → erasure audit; requires revocation |
| POST | `/v1/coordinator/check-in` | `{passToken, eventId}` → eligible scan result |
| POST | `/v1/coordinator/rsvp` | `{invitationId, respondentName, status, attendances, comfortNote?, declineMessage?, expectedUpdatedAt}` → `{ok, updatedAt}`; 409 for a stale response |

`GET /healthz` is a cheap liveness check. `GET /readyz` checks service-token configuration and, in direct PostgreSQL mode, `SELECT 1` without reading guest data. The frontend `/readyz` calls the authenticated `/v1/readyz` endpoint. Use readiness for explicit launch verification, rather than continuous polling that keeps Neon compute awake.

`POST /v1/security/rate-limit` accepts an authenticated, bounded `{keyHash, maxRequests, windowMs}` request and returns `{allowed, retryAfterSeconds}`. On Vercel, frontend and API limits use the atomic `wedding.take_rate_limit` function. Only SHA-256 identifiers are stored, and API/database failures block the request. Runtime grants allow function execution without direct access to the short-lived counter table.

`POST /v1/security/coordinator-session` accepts `{action, sessionHash}` for
`validate` or `revoke`, and additionally `expiresAt` for `register`; it returns
`{ok}`. Only hashes of signed cookies cross this service boundary. The narrowly
granted `wedding.coordinator_session(text,text,timestamptz)` function tracks
eight-hour sessions, expires them, and persists revocation across all instances.
Registration cannot extend or reactivate a revoked session. The runtime role
cannot read or mutate `wedding.coordinator_sessions` directly. Apply the schema
and grants before deploying the API, then deploy the frontend. This upgrade
requires coordinators to sign in again.

`RUN_COORDINATOR_SESSION_DATABASE_TESTS=true` enables
`src/coordinator-session-postgres.integration.test.ts` only with separate owner
and runtime URLs on disposable loopback port 54329 and the synthetic smoke
fixtures. Use `API_TEST_DATABASE_OWNER_URL` and `DATABASE_URL` as for the other
restricted-role suites; never run these tests against the persistent stack.

The browser continues to use only the Next.js same-origin `/api/*` routes. Those routes enforce browser Origin, signed coordinator session, request size, and rate limits before forwarding to this API. The API independently validates all database mutations.

Coordinator invitation DTOs include each invitation's `eventLimits` array and the saved respondent name, dietary/accessibility note, and message to the couple. Lists return all records for this wedding. Treat coordinator pages and CSV exports as private guest information. Hosted invitation resolution also restores the saved RSVP on reload.

The coordinator RSVP action records responses received by phone and corrects a saved response after the online guest cutoff. `expectedUpdatedAt` is the last loaded RSVP timestamp, or `null` only when there is no response yet; a changed response returns 409 without overwriting it. Every invited celebration must be answered within that invitation's limits. Revoked or expired invitations remain unavailable. An eligible active pass remains usable with the latest counts; declining/confirming invalidates it, and returning to attending creates a fresh pass when the guest next opens their invitation. This action returns only a revision timestamp, never invitation or QR credentials.

## Schema and local data

`database/schema.sql` is the canonical direct PostgreSQL schema. The local Postgres bootstrap runs `database/init-local-postgres.sh`. For a managed database, use a separate schema-owner `DATABASE_SCHEMA_URL` and run `pnpm db:apply`. Production schema changes additionally require `DATABASE_SCHEMA_APPLY_TARGET=production` and `DATABASE_SCHEMA_APPLY_CONFIRMATION=apply-production-schema`.

Create a separate non-admin PostgreSQL login role for API traffic. After each schema migration, connect as the `wedding` schema owner and grant only the runtime permissions used by this API:

```sh
cd api
export DATABASE_RUNTIME_ROLE=shaadi_app
psql "$DATABASE_SCHEMA_URL" -v ON_ERROR_STOP=1 -v runtime_role="$DATABASE_RUNTIME_ROLE" \
  -f database/grant-runtime-role.sql
```

Provision the role and its password outside this repository, then put that role's connection URL in the API's `DATABASE_URL`. The grant file rejects admin or schema-owner roles, revokes older direct grants, and checks that the runtime role cannot create persistent database objects in any application schema, delete invitation/pass/content rows, or read the legacy invitation ciphertext column. It grants RSVP deletion only because the coordinator's explicit erase action needs it; a database trigger still requires revocation first. Re-run the grant file after schema changes, and test `/readyz` with the runtime URL before sending invitations. Do not put the schema-owner URL in the API container.

For this coordinator RSVP upgrade, apply `database/schema.sql` and then re-run `database/grant-runtime-role.sql` as the wedding schema owner **before deploying the API**. The new `wedding.save_coordinator_rsvp(uuid,jsonb,timestamptz)` function must remain owned by that schema owner. It is the narrowly granted `SECURITY DEFINER` operation that validates, locks, and audits the correction while bypassing the guest cutoff. Ordinary runtime RSVP INSERT/UPDATE cannot use the bypass by setting the coordinator marker. `wedding.coordinator_rsvp_audit` retains only invitation/revision timestamps and the database login; it does not retain erased names, notes, messages, or attendance snapshots, and runtime callers cannot alter it.

`pnpm test` skips PostgreSQL integration tests by default. For a disposable loopback database loaded with the schema and synthetic `database/test-fixtures.sql`, test the restricted runtime role with `RUN_DATABASE_RUNTIME_TESTS=true`, `DATABASE_URL` set to its runtime login, `API_TEST_DATABASE_OWNER_URL` set to its separate owner login, and both database peppers set to synthetic values, then run `pnpm exec vitest run src/coordinator-postgres.integration.test.ts`. These tests change the cutoff and create/delete synthetic invitations; never run them against the wedding database. The existing `RUN_DATABASE_TESTS=true` suite also requires a disposable loopback database, using its owner URL for teardown.

`database/content.local.sql` is the included original wedding-content seed, not a database export. It is the only local SQL file intentionally included in the source and project ZIP; other `*.local.sql` files remain ignored. Keep `.env.local`, imported household CSVs, database exports, guest data, and raw invitation links out of commits, archives, and images. `pnpm content:apply` applies the seed only to a loopback database; `CONTENT_SQL_FILE` can point to another local file. `pnpm import:households -- /secure/path/households.csv --dry-run` previews an operator-side import. Hosted Supabase migrations live in `supabase/migrations/`.

## Contract changes

`api/src/domain/` and `web/src/lib/` intentionally contain narrow copies of the pure RSVP, invitation, entry-pass, content-mapping, and TypeScript DTO code so each image builds alone. Update both copies when changing their JSON contract. `api/src/app.test.ts` checks API response DTOs; `web/src/lib/server/backend-client.test.ts` and browser BFF tests check the consumer boundary. Run `pnpm verify` in both packages after changes.
