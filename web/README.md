# Frontend and browser API

This package is the public Next.js 16 service for Shaadi Companion. It renders private invitations, public RSVP pages, and coordinator pages, and its same-origin `/api/*` routes validate browser requests before calling the separate private API. Database credentials, Supabase service keys, and invitation peppers belong only in `api/`.

Start with the [Vercel and Neon deployment guide](../docs/vercel-neon-deployment.md). Deploy this directory as a Next.js Vercel project, separately from the API. The [repository guide](../README.md) also covers the local Podman stack.

## Develop this package

With an API already available on `127.0.0.1:4000`, copy [`.env.example`](.env.example) to ignored `.env.local`, give both services the same random `BACKEND_SERVICE_TOKEN`, and set independent coordinator credentials. Then run:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm verify
```

The browser uses only the frontend origin. On Vercel, `BACKEND_URL` is the separate API's exact HTTPS production `*.vercel.app` origin. Public deployments use an exact HTTPS `PUBLIC_APP_ORIGIN` and leave local mode unset. For host development use `http://127.0.0.1:4000` and omit `PUBLIC_APP_ORIGIN`; `LOCAL_STACK_MODE=1` is only for the documented built-image Podman stack on loopback HTTP.

Vercel coordinator sign-in requires `COORDINATOR_GROOM_PASSWORD` and `COORDINATOR_GROOM_TOTP_SECRET` for `/coordinator/g`, and a different `COORDINATOR_BRIDE_PASSWORD` with its own `COORDINATOR_BRIDE_TOTP_SECRET` for `/coordinator/b`. Both use the server-only `COORDINATOR_SESSION_SECRET`. Existing `COORDINATOR_PASSWORD` and `COORDINATOR_TOTP_SECRET` remain groom-only fallbacks. Local password-only sign-in leaves the TOTP keys unset. Each team sees its own content, invitations, responses, and check-in records. The authenticator code is verified server-side and consumed once through the API's shared PostgreSQL limiter. Changing a team's password or authenticator secret invalidates that team's sessions; changing the shared session key invalidates both.

Existing `.env` and `.deployment/` files are preserved by the generators. Add a separate bride password privately; on Vercel also add a separate bride TOTP key and enroll it in that team's authenticator. Keep the existing groom credentials, service/session secrets, and database peppers. Apply the side-aware schema and grants first, then deploy an API reporting `sideIsolation: true`, and finally deploy this frontend. The bride workspace refuses older APIs that lack that capability. See the [upgrade guide](../docs/vercel-neon-deployment.md#upgrade-an-existing-single-workspace).

Signed cookies must also be registered in the API's PostgreSQL session store.
Every protected request checks that registration without caching a positive
result. Sign-out persists revocation before clearing the browser cookie and
leaves the authenticated client router state through a document navigation.
Missing schema/grants or an unavailable session store blocks access. Apply the
session schema and runtime grants, deploy the API, then deploy this frontend;
existing stateless cookies require a fresh sign-in after this upgrade.

Invitation images live in [`private-media/`](private-media/README.md), outside
the public asset directory. Private invitations load them through token-bound routes
while that invitation is active and unexpired; public RSVP pages use separate
routes that check the team's public invitation configuration. Those responses are not cached,
and the Next.js image optimizer cannot fetch them. The generic share preview
and attribution documents remain public. The hero uses responsive WebP variants
for its six pre-wedding and engagement portraits, pauses while the tab is hidden, and starts
paused for reduced motion. Event names open accessible dialogs containing
that event's optional description, custom plain-text fields, and visit details.

Guest invitations use the version 2 ceremonial entrance, scroll scenery, and
photo story in the existing burgundy, gold, and ivory palette. Story chapters
come only from that invitation's resolved events. Guests can pause motion;
reduced-motion settings show every chapter without pinning or animation.
Links directly to a section skip the opening cover, and invitation details
remain readable without JavaScript. The existing teaser and RSVP flows stay
connected to their original media and API routes.

The Sound control plays the selected [Raabta instrumental cover](https://www.youtube.com/watch?v=Fa8AXcfLXs4)
by Havana The Band / Sound Spirit from a local AAC recording at
`private-media/music/raabta-instrumental.m4a` (3:31 with the first 8 seconds removed,
about 3.3 MiB).
Sound is enabled by default and starts with the Open your invitation gesture.
Direct section links also attempt playback; if the browser blocks autoplay,
guests can use Play music. It loops at 35% volume and pauses for the teaser or
when the tab is hidden. Turning sound off stops playback and
releases the audio source. A Play music / Retry button handles browser playback
restrictions or network errors. The compact panel collapses during playback so
it does not cover invitation or RSVP content. Audio uses the existing invitation media gate,
private headers and bounded byte ranges; no YouTube embed or third-party
request is needed to listen. The recording's source is credited in the player.

**Content → Wedding details → Parents’ names** optionally adds bilingual names
beneath either partner, on both the opening cover and the invitation. These
are stored as `guestContent.hero.parents.groom` and `.bride`, each containing
`en` and `hi` text (up to 240 characters per language). Blank families are
omitted. Existing content requires no migration; update the API alongside the
frontend before saving this new optional content.

The frontend owns coordinator sign-in, signed HTTP-only sessions, same-origin checks, rate limits, CSP, private response headers, and the one-time link presentation. A newly issued invitation can be privately shared or copied with bilingual message text. The raw link cannot be recovered after dismissal. The private API owns invitation and RSVP data, content, and check-in decisions; see [`api/README.md`](../api/README.md).

**Invitations** also offers reusable `/rsvp/g` and `/rsvp/b` public links and a CSV upload for up to 200 private invitations. Public pages use each team's published, default-selected events and guest limits. The public RSVP requires a contact number and returns a personal private link for subsequent edits. CSV imports accept `name,contactnumber`, use the existing form's event selections, and show all new links once for copying or downloading. Contact numbers are optional on manually created private invitations and private RSVP forms, and appear in coordinator responses and exports. See [the usage and migration instructions](../README.md#public-rsvps-and-bulk-private-invitations).

On **Responses**, coordinators can read respondent names, hospitality requests, and messages for the couple, or record and correct a phone/WhatsApp reply without retrieving the guest’s private link. These updates remain available after online RSVPs close for active, unexpired invitations. Saving detects an intervening guest or coordinator edit and asks you to reload before overwriting it. CSV exports contain one row for each invited household and celebration, with separate attendance counts, requests, messages, and the current coordination contact. Keep these exports private.

The production image is built from [`Dockerfile`](Dockerfile), runs as a non-root user, and uses `/readyz` for dependency readiness. `/healthz` is liveness only.
