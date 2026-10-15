# Shaadi Companion — Vercel + Neon

An invitation-only wedding website with a Next.js frontend, a protected Node API, and Neon PostgreSQL. This sibling project preserves the original application's invitation, RSVP, content-editor, and QR check-in behavior and runs on Vercel Hobby and Neon Free within their usage limits.

| Directory | Purpose |
| --- | --- |
| `web/` | Next.js frontend and browser-facing API; deploy as one Vercel project. |
| `api/` | Node Vercel function and database access; deploy as a second Vercel project. |
| `scripts/` | Private credential generation and local smoke checks. |
| `docs/vercel-neon-deployment.md` | Account creation, database setup, deployment, and launch checks. |

The browser calls only the frontend. The frontend calls the separate API over a configured HTTPS origin using a server-only service token. The API owns database credentials and invitation/pass peppers. Groom and bride coordinators have separate passwords, workspaces, content, invitations, and RSVP lists. Vercel sign-in also requires each team's own authenticator code. Rate limits use PostgreSQL so they work across function instances. Both projects default to Singapore (`sin1`); choose Neon AWS Singapore as well.

**Start with [the deployment guide](docs/vercel-neon-deployment.md).** The private `.deployment/` files have already been generated in this working copy. They are ignored by Git and must stay on your computer. Fill their blank URLs using the guide. For another checkout, run `node scripts/create-deployment-env.mjs` once to create fresh private files.

This copy contains source, static assets, and the original wedding-content seed at `api/database/content.local.sql`. Local secrets, database exports, other `*.local.sql` files, build output, and AWS infrastructure and deployment workflows remain excluded. The original project remains in `../personalWedding`. The seed is not a database export; existing invitations and RSVP data must be migrated separately if you want to keep them. The guide explains how to preserve invitation credentials.

## Verify changes

Use Node.js 22 and pnpm 11.13.0:

```sh
pnpm --dir api install --frozen-lockfile
pnpm --dir web install --frozen-lockfile
pnpm --dir api verify
pnpm --dir web verify
node --test scripts/create-local-env.test.mjs scripts/create-deployment-env.test.mjs
```

The GitHub workflow runs these package checks without deployment credentials. PostgreSQL integration tests are opt-in and must target a disposable loopback database.

## Run locally

The original local Podman workflow remains available in this copy:

```sh
node scripts/create-local-env.mjs
podman compose --env-file .env -p shaadi-vercel-local -f compose.yml up --build --detach
```

Open `http://127.0.0.1:3000/coordinator/g` with `COORDINATOR_GROOM_PASSWORD`, or `/coordinator/b` with `COORDINATOR_BRIDE_PASSWORD`, from the root `.env`. Existing `COORDINATOR_PASSWORD` remains a groom-only fallback; `/coordinator` opens the signed-in team, or the groom entry when signed out. The generator creates `.env` only when it is missing and never adds or replaces values in an existing file. Local Compose uses password sign-in and the private Compose API address; deployed Vercel uses separate passwords and TOTP keys for both teams. Local database volumes belong to the chosen Compose project, so keep the `shaadi-vercel-local` project name above.

For an existing local stack, keep all current credentials and privately add a new, different `COORDINATOR_BRIDE_PASSWORD` to the ignored root `.env`; generate it with a password manager or `openssl rand -hex 32`. The bride workspace stays unavailable until it has its own password. Do not regenerate the file or change database credentials, service/session secrets, or invitation/pass peppers. Apply the reviewed schema and runtime grants online, deploy the API, confirm its authenticated `/v1/status` reports `sideIsolation: true`, and then recreate the frontend with the updated environment. PostgreSQL does not need a restart. See the [migration instructions](docs/vercel-neon-deployment.md#upgrade-an-existing-single-workspace).

On this Mac's corporate network, prepare the locally trusted Node build image after generating `.env`:

```sh
node scripts/prepare-local-build.mjs --macos-ca-name 'Rakuten Corporate IT Root CA'
```

The helper verifies the npm registry with the existing trusted macOS certificate and adds only `LOCAL_NODE_IMAGE` to `.env`, preserving credentials. On another network, use its trusted CA name or `--ca /path/to/public-root.pem`. Keep certificate verification enabled.

### Local wedding content

Fresh local Compose databases load `api/database/content.local.sql` after the schema, populating independent groom and bride settings, reply-to contacts, and a suggested Haryana wedding schedule. Each team's home rituals use its own home town, while shared ceremonies have separate event records for the two teams. Ceremony times, exact venue addresses, RSVP cutoffs, and contact numbers remain local testing placeholders; confirm them before issuing real invitations. Smaller family rituals and optional post-wedding gatherings are available but are not selected by default.

Open your team's `/coordinator/g` or `/coordinator/b` workspace, sign in, and use the Content editor to review the couple details, reply-to contacts, and events for that team's guests. **Save invitation content** writes that team's complete configuration through the coordinator API into the local PostgreSQL database. Changes in the open form remain unsaved until that save succeeds. Existing database volumes retain their saved content when containers restart or rebuild.

To explicitly reapply the reviewed seed to an existing running local stack:

```sh
podman compose --env-file .env -p shaadi-vercel-local -f compose.yml exec -T db \
  psql --no-psqlrc --set ON_ERROR_STOP=on --username shaadi_local --dbname shaadi_companion \
  < api/database/content.local.sql
```

Reapplying updates matching seed settings, contacts, and events, including their placeholder values. Use the Content editor to preserve custom details instead. The seed keeps existing groom event IDs, creates distinct bride event IDs, and does not delete other events, invitations, or RSVPs. The disposable smoke stack continues to use only synthetic `test-fixtures.sql`.

Complete the required wedding settings, coordinator contact, RSVP deadline, and event fields before saving. The editor uses India Standard Time (`Asia/Kolkata`); for an event that continues past midnight, set its end date to the following day. You can edit the saved content from the same screen later. This local database is separate from Neon; deploying the source does not copy local wedding content to the hosted database.

The **Wedding moment** setting controls the live countdown on guest invitations. It shows days, hours, minutes, and seconds in English or Hindi and updates when you change the saved wedding moment.

Guests can choose an event name to open its details. In the event editor, add an optional bilingual description and any custom labels and values that event needs; each event keeps its own fields. The invitation hero loops through the three engagement portraits, with manual controls and reduced-motion support. All photographs remain behind the active invitation link.

Below the banner, guests can choose to watch the pre-wedding teaser. It downloads only after play is selected, starts with sound, and keeps its landscape framing on phones. Native video controls let guests pause, seek, or mute. The film and preview remain behind the invitation link; see [the private media guide](web/private-media/README.md) to replace them later.

Under **Content → Wedding details → Invitation introduction**, each team can edit the English and Hindi sentence above the couple names. It defaults to “Together with our families, we invite you to celebrate the wedding of” in English. **Use default wording** restores the original text while keeping other invitation sections.

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
podman compose --env-file .env -p shaadi-smoke -f compose.smoke.yml up --build --detach
node --env-file=.env scripts/smoke-stack.mjs
podman compose --env-file .env -p shaadi-smoke -f compose.smoke.yml down
```

The smoke stack uses a separate database. Neither this local stack nor the test fixtures belongs in Neon production.

For Playwright checks, `scripts/security-browser-smoke.mjs` exports
`runWeddingSecurityBrowserSmoke(page, { password })`. Use a fresh, isolated
browser context and the disposable stack's synthetic coordinator password. The
suite is restricted to `http://127.0.0.1:3001` and checks copied-session
revocation, protected image formats, public URL and optimizer denial, and
desktop/mobile image loading. `scripts/browser-smoke.mjs` provides the broader
invitation, RSVP, content, and check-in regression suite for the same stack.

`scripts/side-features-browser-smoke.mjs` exports `runSideFeaturesBrowserSmoke(browser, { groomPassword, bridePassword, artifactDir })` for isolated Playwright contexts against the same disposable stack. It checks independent team access and venues, navigation from an old tab after switching teams, the custom popup editor in both languages, desktop/mobile dialogs, automatic photo looping, and each team's RSVP/pass/check-in flow. Run browser suites sequentially because they edit synthetic content. Screenshots contain synthetic households and exclude invitation links and welcome-pass credentials. Chromium captures visual artifacts; WebKit runs the same interaction and layout checks without screenshots because Playwright's WebKit capture injects an inline stylesheet that violates the production CSP.
