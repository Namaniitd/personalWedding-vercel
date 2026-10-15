# Database content provisioning

> Historical reference for the original project. For this Vercel copy, follow [Vercel + Neon deployment](vercel-neon-deployment.md); the original AWS infrastructure remains in `../personalWedding/infra`.

This guide contains no real wedding, event, contact, household, invitation, or
RSVP data. Keep those details in the chosen database and send bearer links only
to their intended households.

## Direct PostgreSQL

The canonical schema is [`api/database/schema.sql`](../api/database/schema.sql).
The local Podman database applies it when its volume is first created. For a
managed database, apply it from a protected operator environment with a
separate schema-owner `DATABASE_SCHEMA_URL` using `pnpm --dir api db:apply`.
Production use also requires
`DATABASE_SCHEMA_APPLY_TARGET=production` and
`DATABASE_SCHEMA_APPLY_CONFIRMATION=apply-production-schema`. The runtime
`DATABASE_URL` must belong to a narrower role. Apply the reviewed
[`grant-runtime-role.sql`](../api/database/grant-runtime-role.sql) as the schema
owner after creating that login role; see [`api/README.md`](../api/README.md).

Fresh local Compose databases apply `api/database/content.local.sql` after the
schema to create separate groom and bride settings, named reply-to contacts,
and a suggested Haryana wedding schedule. The seed includes placeholder times,
exact addresses, RSVP cutoffs, and phone numbers that need review. Existing
database volumes keep their saved content. Open `/coordinator/g` or
`/coordinator/b` and use **Content** to review that team's configuration. The
editor writes to the private API and can update the same records later. It
needs a reviewed English and Hindi name, date, location, RSVP deadline, edit
cutoff, and coordinator
contact. For each event, review both languages, start/end times, venue,
address, map URL, arrival notes, dress code, guest limits, and publication
state. Publish an event only when its guest-facing details are ready. Keep
event IDs and slugs stable once invitations have been issued.

The built-in Direct PostgreSQL coordinator also issues invitations. On AWS,
the ALB requires a named Cognito account with TOTP MFA before the coordinator
password and signed session can be used. Local Podman access stays on loopback
and uses only the app password. The raw link is shown once after issue. Copy or
share it privately then; it cannot be fetched again from the coordinator list.

The original wedding-content seed, `api/database/content.local.sql`, is included
in the source and project ZIP. It is not a database export. For an independently
exposed *loopback* PostgreSQL instance, an operator may apply the reviewed seed
with `pnpm --dir api content:apply` and `api/.env.local`. That command refuses
non-loopback database hosts. The root Podman stack intentionally does not
publish its database port; use the Content editor there, or the explicit
container-local reapply command in the root README after reviewing the seed.
Reapplying replaces matching seed content but does not delete other records.

## Hosted Supabase

Apply the five migrations in [`api/supabase/migrations/`](../api/supabase/migrations/)
in order (`0001` through `0005`). Create one reviewed `wedding_settings` row
with `id = 1`, then the reviewed `events` rows, in the protected Supabase
operator environment. The hosted guest API uses these rows, but the built-in
web coordinator requires Direct PostgreSQL. The hosted operator/import workflow
is separate.

`api/scripts/import-households.mjs` is only for Hosted Supabase. Preview a
private CSV with `--dry-run` before issuing links with `--print-links` on a
protected workstation. It validates event slugs and prints each new raw link
once; never save that output to CI logs or a shared terminal transcript.

In either mode, `guest_content` is an optional, reviewed JSON document for
decorative and travel copy. The API validates a strict allowlist before guest
pages receive it. Keep HTML, scripts, remote image URLs, and personal guest
details out of that document. The included original seed is the only local SQL
file intentionally shared. Keep other `*.local.sql` files, `.env` files,
household CSVs, database exports, invitation links, and RSVP records out of
commits, archives, and images.
