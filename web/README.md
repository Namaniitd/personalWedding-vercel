# Frontend and browser API

This package is the public Next.js 16 service for Shaadi Companion. It renders private guest invitations and coordinator pages, and its same-origin `/api/*` routes validate browser requests before calling the separate private API. Database credentials, Supabase service keys, and invitation peppers belong only in `api/`.

Start with the [Vercel and Neon deployment guide](../docs/vercel-neon-deployment.md). Deploy this directory as a Next.js Vercel project, separately from the API. The [repository guide](../README.md) also covers the local Podman stack.

## Develop this package

With an API already available on `127.0.0.1:4000`, copy [`.env.example`](.env.example) to ignored `.env.local`, give both services the same random `BACKEND_SERVICE_TOKEN`, and set independent coordinator credentials. Then run:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm verify
```

The browser uses only the frontend origin. On Vercel, `BACKEND_URL` is the separate API's exact HTTPS production `*.vercel.app` origin. Public deployments use an exact HTTPS `PUBLIC_APP_ORIGIN` and leave local mode unset. For host development use `http://127.0.0.1:4000` and omit `PUBLIC_APP_ORIGIN`; `LOCAL_STACK_MODE=1` is only for the documented built-image Podman stack on loopback HTTP.

Vercel coordinator sign-in requires `COORDINATOR_PASSWORD`, `COORDINATOR_SESSION_SECRET`, and `COORDINATOR_TOTP_SECRET`. The authenticator code is verified server-side and consumed once through the API's shared PostgreSQL limiter. Changing the password, session key, or authenticator secret invalidates existing sessions.

Signed cookies must also be registered in the API's PostgreSQL session store.
Every protected request checks that registration without caching a positive
result. Sign-out persists revocation before clearing the browser cookie and
leaves the authenticated client router state through a document navigation.
Missing schema/grants or an unavailable session store blocks access. Apply the
session schema and runtime grants, deploy the API, then deploy this frontend;
existing stateless cookies require a fresh sign-in after this upgrade.

Invitation images live in [`private-media/`](private-media/README.md), outside
the public asset directory. They load through `/i/[token]/media/[asset]` only
while that invitation is active and unexpired. Those responses are not cached,
and the Next.js image optimizer cannot fetch them. The generic share preview
and attribution documents remain public.

The frontend owns coordinator sign-in, signed HTTP-only sessions, same-origin checks, rate limits, CSP, private response headers, and the one-time link presentation. A newly issued invitation can be privately shared or copied with bilingual message text. The raw link cannot be recovered after dismissal. The private API owns invitation and RSVP data, content, and check-in decisions; see [`api/README.md`](../api/README.md).

On **Responses**, coordinators can read respondent names, hospitality requests, and messages for the couple, or record and correct a phone/WhatsApp reply without retrieving the guest’s private link. These updates remain available after online RSVPs close for active, unexpired invitations. Saving detects an intervening guest or coordinator edit and asks you to reload before overwriting it. CSV exports contain one row for each invited household and celebration, with separate attendance counts, requests, messages, and the current coordination contact. Keep these exports private.

The production image is built from [`Dockerfile`](Dockerfile), runs as a non-root user, and uses `/readyz` for dependency readiness. `/healthz` is liveness only.
