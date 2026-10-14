# Shaadi Companion — Vercel + Neon

An invitation-only wedding website with a Next.js frontend, a protected Node API, and Neon PostgreSQL. This sibling project preserves the original application's invitation, RSVP, content-editor, and QR check-in behavior and runs on Vercel Hobby and Neon Free within their usage limits.

| Directory | Purpose |
| --- | --- |
| `web/` | Next.js frontend and browser-facing API; deploy as one Vercel project. |
| `api/` | Node Vercel function and database access; deploy as a second Vercel project. |
| `scripts/` | Private credential generation and local smoke checks. |
| `docs/vercel-neon-deployment.md` | Account creation, database setup, deployment, and launch checks. |

The browser calls only the frontend. The frontend calls the separate API over a configured HTTPS origin using a server-only service token. The API owns database credentials and invitation/pass peppers. Coordinator sign-in on Vercel requires a password and an authenticator code. Rate limits use PostgreSQL so they work across function instances. Both projects default to Singapore (`sin1`); choose Neon AWS Singapore as well.

**Start with [the deployment guide](docs/vercel-neon-deployment.md).** The private `.deployment/` files have already been generated in this working copy. They are ignored by Git and must stay on your computer. Fill their blank URLs using the guide. For another checkout, run `node scripts/create-deployment-env.mjs` once to create fresh private files.

This copy contains source, static assets, and the original wedding-content seed at `api/database/content.local.sql`. Local secrets, database exports, other `*.local.sql` files, build output, and AWS infrastructure and deployment workflows remain excluded. The original project remains in `../personalWedding`. The seed is not a database export; existing invitations and RSVP data must be migrated separately if you want to keep them. The guide explains how to preserve invitation credentials.

## Verify changes

Use Node.js 22 and pnpm 11.13.0:

```sh
pnpm --dir api install --frozen-lockfile
pnpm --dir web install --frozen-lockfile
pnpm --dir api verify
pnpm --dir web verify
node --test scripts/create-deployment-env.test.mjs
```

The GitHub workflow runs these package checks without deployment credentials. PostgreSQL integration tests are opt-in and must target a disposable loopback database.

## Run locally

The original local Podman workflow remains available in this copy:

```sh
node scripts/create-local-env.mjs
podman compose --env-file .env -p shaadi-vercel-local -f compose.yml up --build --detach
```

Open `http://127.0.0.1:3000/coordinator` and use `COORDINATOR_PASSWORD` from the root `.env`. The generator creates `.env` only when it is missing; if Compose reports a missing `POSTGRES_PASSWORD`, run the generator from this project before starting Compose. Local Compose uses password sign-in and the private Compose API address; deployed Vercel uses password plus TOTP and the HTTPS API address. Local database volumes belong to the chosen Compose project, so use the distinct `shaadi-vercel-local` project name above.

On this Mac's corporate network, prepare the locally trusted Node build image after generating `.env`:

```sh
node scripts/prepare-local-build.mjs --macos-ca-name 'Rakuten Corporate IT Root CA'
```

The helper verifies the npm registry with the existing trusted macOS certificate and adds only `LOCAL_NODE_IMAGE` to `.env`, preserving credentials. On another network, use its trusted CA name or `--ca /path/to/public-root.pem`. Keep certificate verification enabled.

### Local wedding content

Open `http://127.0.0.1:3000/coordinator`, sign in, and use the Content editor to enter the couple details, reply-to contacts, and events. **Save invitation content** writes the complete configuration through the coordinator API into the local PostgreSQL database. Changes in the open form remain unsaved until that save succeeds. A fresh database starts without wedding content.

Complete the required wedding settings, coordinator contact, RSVP deadline, and event fields before saving. The editor uses India Standard Time (`Asia/Kolkata`); for an event that continues past midnight, set its end date to the following day. You can edit the saved content from the same screen later. This local database is separate from Neon; deploying the source does not copy local wedding content to the hosted database.

The **Wedding moment** setting controls the live countdown on guest invitations. It shows days, hours, minutes, and seconds in English or Hindi and updates when you change the saved wedding moment.

### Restart without losing saved content

Run these commands from this project directory. Restart existing containers with:

```sh
podman compose --env-file .env -p shaadi-vercel-local -f compose.yml restart
```

After stopping the stack or restarting your computer, start it again with:

```sh
podman compose --env-file .env -p shaadi-vercel-local -f compose.yml up --detach
```

On macOS, start the Podman machine first with `podman machine start` if it is stopped. After code changes, add `--build` to the `up` command to rebuild the application images.

To stop and remove the containers while retaining the database:

```sh
podman compose --env-file .env -p shaadi-vercel-local -f compose.yml down
```

Saved content, invitations, and RSVPs persist in the named volume `shaadi-vercel-local_postgres_data`, including when application containers are rebuilt. Keep the same project name and root `.env` so the stack uses the same database and credentials. You do not need to re-enter or reapply saved content after an ordinary restart. `down --volumes`, `down -v`, or deleting the database volume erases that data; recreating an empty database requires restoring a backup or entering the content again.

For the disposable full-flow smoke test:

```sh
podman compose --env-file .env -p shaadi-vercel-smoke -f compose.smoke.yml up --build --detach
node --env-file=.env scripts/smoke-stack.mjs
podman compose --env-file .env -p shaadi-vercel-smoke -f compose.smoke.yml down
```

The smoke stack uses a separate database. Neither this local stack nor the test fixtures belongs in Neon production.

For Playwright checks, `scripts/security-browser-smoke.mjs` exports
`runWeddingSecurityBrowserSmoke(page, { password })`. Use a fresh, isolated
browser context and the disposable stack's synthetic coordinator password. The
suite is restricted to `http://127.0.0.1:3001` and checks copied-session
revocation, protected image formats, public URL and optimizer denial, and
desktop/mobile image loading. `scripts/browser-smoke.mjs` provides the broader
invitation, RSVP, content, and check-in regression suite for the same stack.
