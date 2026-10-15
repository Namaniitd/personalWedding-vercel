# Deploy on Vercel Hobby and Neon Free

This project uses **two Vercel projects from one private GitHub repository**, plus one Neon database. Both Vercel configurations choose Singapore (`sin1`), so choose **AWS Asia Pacific (Singapore)** in Neon. No purchased domain or paid plan is required for a small personal wedding website within the free allowances.

## 1. Create the accounts and source repository

1. Create or use your [GitHub account](https://github.com/signup).
2. Create a **private repository**, for example `personal-wedding-vercel`, and push the contents of this folder. Run Git commands from `personalWedding-vercel`, not the original project.
3. Create a [Vercel account](https://vercel.com/signup) using GitHub and choose **Hobby** for personal use.
4. Create a [Neon account](https://console.neon.tech/signup) and choose **Free**.

If this folder is not yet a Git repository:

```sh
git init
git add .
git status --short
```

Review the staged filenames before committing. `.deployment/`, `.env*` except examples, and generated build folders are ignored. Then commit and connect your private repository using GitHub's instructions. AWS apply/deploy workflows are not included in this version.

## 2. Set up Neon

1. Create a Neon project called `shaadi-companion` using **PostgreSQL 16** and **AWS Singapore**. The default `neondb` database is fine.
2. Open **Connect** and switch **connection pooling off** to get the direct owner connection URL. Keep the default owner role for migrations only.
3. Open `.deployment/neon-setup.env` on your computer. Set `DATABASE_SCHEMA_URL` to that direct URL. Change its SSL query to `?sslmode=verify-full`; this app requires certificate and hostname verification. Keep the generated runtime role, runtime password, and the two schema confirmation values.
4. From the project root, run:

```sh
pnpm --dir api install --frozen-lockfile
node --env-file=.deployment/neon-setup.env api/scripts/setup-neon.mjs
```

The helper applies the schema, creates a separate restricted login through SQL, applies the runtime grants, checks its connection, and writes the **pooled runtime URL** into `.deployment/api.env`. No `psql` installation is needed. It creates no wedding content or invitations.

Create the restricted runtime role through this helper, rather than the Neon dashboard: dashboard-created roles inherit administrative privileges. Use a dedicated database for this app; the helper removes public CREATE privileges. On later migrations you can rerun the helper using the same operator file. It does not rotate an existing role's password. If the generated password does not match an existing unrelated role, choose a new `DATABASE_RUNTIME_ROLE` first.

`DATABASE_SCHEMA_URL` and `DATABASE_RUNTIME_PASSWORD` belong only on your computer. Do not add them to either Vercel project. The API uses the restricted pooled `DATABASE_URL` instead.

The `.deployment/` files already exist in this working copy. For a fresh checkout without them, first run:

```sh
node scripts/create-deployment-env.mjs
```

The generator refuses to replace existing files, so it cannot silently rotate credentials or invalidate invitations.

## 3. Create the two Vercel projects

Import the private GitHub repository twice with **Add New → Project**:

| Setting | API project | Website project |
| --- | --- | --- |
| Suggested project name | `shaadi-companion-api` | `shaadi-companion-web` |
| Root Directory | `api` | `web` |
| Framework | Other | Next.js |
| Node.js | 22.x | 22.x |
| Function region | Singapore (`sin1`) | Singapore (`sin1`) |

The checked-in `vercel.json` files pin the pnpm commands and configure function routing/durations. Keep Fluid Compute enabled. If the dashboard shows conflicting build/install overrides, reset them to the repository configuration.

Deploy once without runtime secrets to obtain both **production domain aliases**. The health endpoint and public entry page can load; invitations and coordinator access remain unavailable until configuration is complete. Record the actual assigned domains; Vercel can add a suffix if a project name is already taken.

Use these stable production aliases, for example `https://shaadi-companion-api.vercel.app` and `https://shaadi-companion-web.vercel.app`. Do not use generated commit/deployment URLs or preview domains for real invitations.

## 4. Add the production environment variables

Fill the blank URLs in the private files:

- `.deployment/api.env`: set `PUBLIC_APP_ORIGIN` to the website's exact HTTPS production origin.
- `.deployment/web.env`: set the same `PUBLIC_APP_ORIGIN`, and `BACKEND_URL` to the API's exact HTTPS production origin.

Use origins with **no trailing slash**, path, query, or fragment. This version deliberately accepts only a single-label `*.vercel.app` backend domain. Use Vercel's assigned production API domain; a custom API domain would need an explicit backend validation change.

Import or paste each file's variables into **its corresponding Vercel project → Settings → Environment Variables**, selecting **Production**:

| API project only | Website project only |
| --- | --- |
| `DATABASE_URL` | `BACKEND_URL` |
| `DATABASE_INVITATION_TOKEN_PEPPER` | `COORDINATOR_GROOM_PASSWORD` |
| `DATABASE_ENTRY_PASS_TOKEN_PEPPER` | `COORDINATOR_BRIDE_PASSWORD` |
| `PUBLIC_APP_ORIGIN` | `COORDINATOR_SESSION_SECRET` |
| `BACKEND_SERVICE_TOKEN` | `COORDINATOR_GROOM_TOTP_SECRET` |
| | `COORDINATOR_BRIDE_TOTP_SECRET` |
| | `PUBLIC_APP_ORIGIN` |
| | `BACKEND_SERVICE_TOKEN` |

The generator uses the same service token in both files and separate random values for every other secret, including each team's password and authenticator key. Existing `COORDINATOR_PASSWORD` and `COORDINATOR_TOTP_SECRET` remain groom-only fallbacks when the corresponding `GROOM` values are absent; the bride team always needs its own values. Vercel supplies `VERCEL=1` and the production Node environment automatically. Do not set `LOCAL_STACK_MODE` on Vercel. Do not use `NEXT_PUBLIC_` for credentials. Avoid copying real production credentials into Preview or Development environments; use a separate database and secrets for staging.

Redeploy the API first, then the website, so the new environment variables take effect. Vercel's deployment authentication must allow the stable production aliases to be reachable: guests need the website, and the frontend needs the API. The API's own service-token validation rejects unauthenticated business requests. If Vercel returns a login page or redirect for the API domain, check **Deployment Protection** and ensure you're using the production alias instead of a protected preview/deployment URL.

## 5. Enroll each team's authenticator and enter wedding content

Open `.deployment/authenticator-groom.txt` and `.deployment/authenticator-bride.txt` privately with the corresponding team's operator. In Google Authenticator, 1Password, Authy, or another TOTP app, choose **add account → enter setup key** and enroll each generated key as a separate time-based account. The parameters are SHA1, six digits, and a 30-second period. Keep the setup files private so each team can recover access if a phone is replaced. Older generated `.deployment/authenticator.txt` still holds the existing groom key; do not replace it when upgrading.

Open `https://YOUR-WEBSITE.vercel.app/coordinator/g` for the groom team or `/coordinator/b` for the bride team. Sign in with that team's password from `.deployment/web.env` and its current six-digit authenticator code. A successful code is consumed once; wait for the next 30-second code before signing in from another browser for the same team. The replay record lasts two minutes. A coordinator session is bound to its team's workspace and cannot read or mutate the other team's data. Do not distribute coordinator credentials to guests.

In each team's **Content** workspace, enter the reviewed couple, contact, event, deadline, and venue details for that team's invitation. Each event can include a bilingual introduction and custom labels and values shown when guests choose its name. Then issue a synthetic invitation and check the guest flow before creating real household invitations. New links use `/i/g/[token]` or `/i/b/[token]`, while existing `/i/[token]` links remain valid. The invitation's raw link is shown once, so save or privately share it from the issuance panel.

## 6. Check the live deployment

1. Check the website's `/healthz` and `/readyz`; readiness should return 200.
2. Open `/coordinator/g` and `/coordinator/b` in signed-out browsers and confirm each requires its own sign-in. A wrong password or code must fail, and a session for one side must not enter the other side's workspace.
3. Issue one synthetic invitation, open it privately, submit an RSVP, reload it, and confirm the response persists.
4. Check calendar download, coordinator responses, QR check-in, duplicate check-in, revocation, and response erasure using synthetic data.
5. Revoke the test invitation and erase its response before sending real invitations.
6. Test the camera scanner on an actual phone over HTTPS if you plan to use it at the venue.

Do not run the disposable local smoke scripts against Neon or the live deployment. They are deliberately restricted to loopback targets. Avoid capturing real invitation tokens, QR credentials, passwords, or guest records in screenshots and logs.

## Existing wedding data

The copied source does not include the original database or local secret files. If you already issued invitations or collected real responses, migrate the `wedding` schema/data separately using an owner-side PostgreSQL backup and restore, then apply the updated schema and grants. Preserve the original `DATABASE_INVITATION_TOKEN_PEPPER` and `DATABASE_ENTRY_PASS_TOKEN_PEPPER` in the new API environment: newly generated peppers cannot resolve old links or passes. Review backup/restore with the original database before changing it. Invitation URLs still use the original website address until you privately redistribute the new domain's links or retain that domain.

For a new wedding database, the fresh generated peppers and coordinator-entered content are sufficient. Do not load `database/test-fixtures.sql` into Neon production.

## Upgrade an existing single workspace

Keep the existing `.env` and `.deployment/` files. Both generators refuse to overwrite existing credentials. `COORDINATOR_PASSWORD` and `COORDINATOR_TOTP_SECRET` continue to authenticate the groom team unless explicit `COORDINATOR_GROOM_PASSWORD` and `COORDINATOR_GROOM_TOTP_SECRET` values replace them. Privately add a new, different `COORDINATOR_BRIDE_PASSWORD` to the frontend environment. On Vercel also add a new `COORDINATOR_BRIDE_TOTP_SECRET`, then enroll that key in the bride team's authenticator with SHA1, six digits, and a 30-second period. Keep the existing service token, session secret, database credentials, and invitation/pass peppers. An existing local stack needs only the new bride password for its password-only mode; the root `.env` remains ignored and should retain restrictive permissions.

Deploy in this order:

1. Apply `api/database/schema.sql` and `api/database/grant-runtime-role.sql` using the existing owner tooling. The migration assigns existing settings, events, invitations, and responses to the groom side and preserves issued links and QR credentials. The bride content starts independently. PostgreSQL does not need to restart.
2. Deploy the API and confirm its authenticated `/v1/status` response includes `sideIsolation: true` before enabling the bride workspace.
3. Deploy the frontend with the reviewed team credentials. For Podman, replace only the application services using the existing Compose project and volume. Do not recreate PostgreSQL or apply synthetic fixtures to the persistent database.

Verify both sides with synthetic invitations in the disposable stack: each team must have its own content and response list, and cross-side reads, edits, revocation, RSVP correction, and check-in must fail. Review the production schema migration separately; the disposable smoke scripts must never target Neon or the persistent wedding database.

## Free-plan operation

[Vercel Hobby](https://vercel.com/docs/plans/hobby) is for personal, non-commercial projects. [Neon Free](https://neon.com/pricing) has no fixed trial expiry; compute/storage and Vercel usage limits still apply. This setup can remain free for two months if usage fits those allowances. The free Vercel URLs include HTTPS; a purchased custom domain is optional.

There is no Render-style one-minute application wake-up page. Vercel functions and Neon compute can still have cold starts. Connection and frontend timeouts allow the database time to wake. Do not schedule continuous `/readyz` checks or keep-alive pings; readiness queries the database, and frequent polling can prevent Neon from scaling to zero and consume its free compute allowance.

Keep a private backup/export of real RSVPs and check the providers' usage dashboards. After the wedding, export the data you need, remove guest information according to your own retention needs, and delete the two Vercel projects and Neon project when you no longer need them.

For future releases, push the reviewed changes to the repository's production branch. Apply required database schema changes with the operator helper first, then let Vercel deploy the paired projects. Changing environment variables requires redeployment. Keep the API/frontend contract compatible while the two deployments update independently.

The coordinator session and private media upgrade requires reapplying
`api/database/schema.sql` and `api/database/grant-runtime-role.sql` with the
documented owner tooling before deploying the API, followed by the frontend.
The new session function must be owned by the wedding schema owner. Existing
stateless coordinator cookies require a fresh sign-in; invitation and QR
peppers do not change. Invitation images are included in the private route's
server bundle through output tracing and their old public image URLs return
404. Keep only the generic share preview and attribution documents in
`web/public/images/`.

The updated frontend signs coordinator sessions with their owning side. Existing coordinator cookies require a fresh sign-in after the upgrade; issued guest links and welcome-pass credentials remain valid. A browser has one active coordinator team session, so use separate browser profiles when both teams share a device.
