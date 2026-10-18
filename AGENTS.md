# Project guide

This guide applies to the whole Vercel + Neon project. `web/AGENTS.md` adds
Next.js-specific instructions for frontend work. Use the checked-in READMEs and
`docs/vercel-neon-deployment.md` for detailed setup.

## Structure and runtime

- `web/`: Next.js 16, React 19, coordinator UI, guest invitations, and same-origin
  `/api/*` routes. Deploy this directory as a Next.js Vercel project.
- `api/`: Node 22 TypeScript API, database access, RSVP/content mutations, and
  check-in. Deploy this directory as a separate Vercel project using Other.
- `api/api/index.ts`: Vercel function adapter around `src/app.ts`; it does not
  start a listening server. `api/src/server.ts` serves local/container runs.
- `api/database/schema.sql`: canonical direct PostgreSQL schema;
  `grant-runtime-role.sql` defines restricted runtime permissions.
- `scripts/`: credential generation, local build helpers, and smoke checks.
- Each package has its own manifest and lockfile; there is no root package.
  Use Node 22 and pnpm 11.28.6 and run commands in the appropriate package.
- API TypeScript uses ESM. Keep `.js` extensions on relative runtime imports.
  The frontend uses its existing `@/` alias and Next.js conventions.
- Pure DTO/domain code is intentionally copied in `api/src/domain/` and
  `web/src/lib/` so the packages build independently. Update both sides when
  changing the shared JSON contract.

## Working and validation

Install dependencies with `pnpm --dir api install --frozen-lockfile` and
`pnpm --dir web install --frozen-lockfile`. Package `dev` scripts support host
development with their own ignored `.env.local`; the API must be available for
frontend flows. Consult each package README for the matching environment.

Choose validation to fit the change. Focused tests and type checks are useful
while editing; package verification covers the usual release checks:

```sh
pnpm --dir api verify
pnpm --dir web verify
node --test scripts/create-deployment-env.test.mjs
```

API verification runs type checking, Vitest, and the build; frontend verification
also runs ESLint. Use both packages for contract changes, and relevant script
tests for tooling changes. Documentation-only edits do not require builds.
PostgreSQL integration tests are opt-in, mutate data, and must use a disposable
loopback database with synthetic fixtures. See `api/README.md` for their flags.
Use `compose.smoke.yml` and `scripts/smoke-stack.mjs` only for disposable local
smoke runs; never target the persistent wedding database or Neon production.

## Persistent local stack

Run these from the project root:

```sh
node scripts/create-local-env.mjs
podman compose --env-file .env -p shaadi-vercel-local -f compose.yml up --build --detach
```

The generator preserves an existing `.env`. Keep the Compose project name
`shaadi-vercel-local` so the persistent `postgres_data` volume stays attached.
Open exactly `http://127.0.0.1:3000` (coordinator at `/coordinator`); `localhost`
is a different origin. The API and database stay on the private Compose network.
Local built images use `LOCAL_STACK_MODE=1` and password-only coordinator login.
Stop with the same Compose options and `down` to preserve data; `down --volumes`
erases it. Preserve existing UI/database content and credentials during changes.
If a build requires an additional trusted CA, use `scripts/prepare-local-build.mjs`
as documented in README; keep certificate verification enabled.

## Vercel and Neon

Use the two checked-in `vercel.json` configurations and production domain aliases.
Both projects use Singapore (`sin1`); Neon setup uses PostgreSQL 16 in AWS
Singapore. The browser calls only the frontend, which calls the API with a
server-only `BACKEND_SERVICE_TOKEN` shared by both services.

Set exact HTTPS `PUBLIC_APP_ORIGIN` values without a trailing slash, path, or
query. The frontend `BACKEND_URL` accepts the API's production `*.vercel.app`
origin. Keep `LOCAL_STACK_MODE` unset on Vercel. Production coordinator login
requires password, session secret, and TOTP; rate limits and replay protection
use PostgreSQL so separate function instances share their state.

Use an unpooled owner URL only in local schema tooling and the restricted pooled
runtime `DATABASE_URL` only in the API, with `sslmode=verify-full`. Follow the
deployment guide and `api/scripts/setup-neon.mjs` for schema/grant updates. Keep
paired API/frontend changes compatible while the projects deploy independently.
`/healthz` checks liveness; `/readyz` checks dependencies. Avoid continuous
readiness polling that prevents Neon from scaling to zero.

## Private data and credentials

Keep `.env*` (except examples), `.deployment/`, `.vercel/`, `*.local.sql`, household
imports, exports, backups, raw invitation links, QR credentials, and real guest
data out of commits, images, logs, screenshots, and test fixtures. Read only the
private values necessary for the task and do not print them. Preserve existing
invitation/pass peppers when migrating data so issued links continue to work.
Database credentials and invitation/pass peppers belong only in the API runtime.
The frontend's backend-service token and coordinator credentials stay in its
server runtime. Do not put secrets in `NEXT_PUBLIC_` variables or browser responses.
Retain authentication, origin checks, private response headers, and concurrency
guards.
