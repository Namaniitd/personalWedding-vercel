# Production database and data lifecycle

> Historical reference for the original project. For this Vercel copy, follow [Vercel + Neon deployment](vercel-neon-deployment.md); the original AWS infrastructure remains in `../personalWedding/infra`.

This document describes the implemented data paths and the operating decisions
needed before a public launch. Automatic post-wedding retention and a complete
personal-data purge are not implemented. Record the owner-approved retention
date and use a reviewed operator runbook for closeout.

## Choose one database path

| Path | Implemented scope | Schema source |
| --- | --- | --- |
| Direct PostgreSQL | Guest invitations and RSVPs, the built-in coordinator/content editor, and QR check-in. The private API is the only database client in the deployed app. | [`api/database/schema.sql`](../api/database/schema.sql), in the dedicated `wedding` schema. |
| Hosted Supabase | Guest invitations, RSVPs, and QR passes through the private API. A separate protected Supabase operator/import workflow is required; the built-in web coordinator requires Direct PostgreSQL. | [`api/supabase/migrations/`](../api/supabase/migrations/), applied in order. |

Do not split a guest list, invitation pepper, or RSVP record between these
paths. Configure one complete mode in the API. The frontend has neither a
database credential nor a Supabase service key.

## Current Direct PostgreSQL records

| Record | Stored information and lifecycle |
| --- | --- |
| `wedding.settings`, `contacts`, `events` | Reviewed bilingual content, dates, reply-to contacts, and event publication/guest limits. The coordinator Content editor manages these rows. |
| `wedding.invitations` | One household link with bilingual household names, event limits, status, expiry, and an HMAC-SHA-256 token digest. The current issuer never stores or retrieves a raw link after its one-time response. A nullable `token_ciphertext` column remains for schema compatibility; current API code does not use it. |
| `wedding.rsvps` | One current answer per invitation digest, including respondent name, selected event counts, and optional free text. The direct schema has no RSVP revision-history table. |
| `wedding.entry_passes`, `entry_check_ins` | HMAC lookup digest and non-secret version for a household QR pass; event-specific first check-in time, expected counts, and repeat-scan count. Raw QR credentials are not stored. |
| `wedding.coordinator_rsvp_audit` | Invitation ID, previous/current revision timestamps, recording time, and database login for manual corrections. No names, notes, messages, or attendance snapshots are retained here. Runtime callers cannot modify this audit. |

The direct schema enforces active-link and guest RSVP edit-window checks when an RSVP
is written. An authenticated coordinator can record or correct a phone/WhatsApp
response after the guest cutoff through the audited `save_coordinator_rsvp`
operation; the invitation must still be active and unexpired. Apply the schema
and runtime grants as the schema owner before deploying this API upgrade.
A check-in must still have an active link and pass, an attending
RSVP, and entitlement to the selected event. Revocation or an RSVP change away
from attending invalidates the active QR pass. Repeated scans of the same pass
at one event update its scan counter instead of creating another admission.

## Invitation, revocation, and deletion

1. Issue a link only after the settings and published events are reviewed.
   The API generates a 256-bit random bearer token and stores its keyed digest.
   The coordinator receives the raw URL once and must send it privately.
2. Resolution accepts only a valid, active, unexpired link. The browser posts
   the token to same-origin Next.js routes, which call the private API. Keep
   raw invitation paths, tokens, RSVP bodies, and QR credentials out of logs,
   analytics, screenshots, and support tickets.
3. Revoking a Direct PostgreSQL invitation blocks future guest access and
   invalidates its QR pass in the same database transaction. It does not
   delete the RSVP or create a replacement link. A new issue creates an
   independent invitation; the app does not migrate the old RSVP to it.
4. The coordinator's **Delete RSVP** action requires revocation first. It
   removes the current `wedding.rsvps` row and records only
   `rsvp_deleted_at` on the invitation. It does **not** erase the invitation
   household names, event limits, token digest, pass metadata, or check-in
   history. Do not present this action as a complete personal-data purge.

Hosted Supabase has separate invitation/event, RSVP revision, logistics, and
coordinator audit tables. Its migrations enforce RLS and named MFA/AAL2 role
checks for privileged operations. A Hosted Supabase purge must account for all
dependent rows and restrictive foreign keys; there is no automatic purge
procedure in this repository.

## Production access boundary

| Principal | Access |
| --- | --- |
| Guest browser | Only the public Next.js origin and its same-origin `/api/*` routes. No direct API or database access. |
| Next.js frontend | Coordinator password/session secrets and `BACKEND_SERVICE_TOKEN`; it calls API `/v1/*` on private task loopback. No database credential or invitation pepper. |
| Private API | The service token and the selected database-mode secrets. Direct PostgreSQL uses a runtime role with only the reviewed `wedding` schema/table privileges it needs. |
| Schema operator | Separate `DATABASE_SCHEMA_URL` schema-owner credential, used from a protected environment for reviewed forward schema changes; never in the running containers. |

The direct schema revokes `PUBLIC` table and function privileges, but it does
not create the production runtime role. Provision a separate non-admin login
and apply the reviewed
[`grant-runtime-role.sql`](../api/database/grant-runtime-role.sql) as schema
owner before deployment; its column-level grants exclude the legacy
`token_ciphertext` field.
Require verified TLS (`sslmode=verify-full`) on production PostgreSQL
connections. Store all production secrets in Secrets Manager and rotate the
shared service token in both containers together.

The AWS ALB authenticates both coordinator route families, including their
bare paths, against an administrator-created Cognito user pool with required
TOTP MFA. Unauthenticated pages redirect to Cognito; coordinator APIs return
401. The Next.js password and signed session remain an additional gate. Test
the protected routes and Cognito callback through CloudFront before launch.
The local Podman stack uses only the app password on loopback. Terraform does
not provision the production database.

Named Cognito login currently gates the whole coordinator workspace. The
Direct PostgreSQL app does not yet scope actions by an operator role or attach
the Cognito user identity to an action audit row. Give access only to the small
trusted operator group until role-specific permissions and attribution are
implemented.

## Backups, recovery, and closeout

1. Enable managed encrypted backups and point-in-time recovery for the chosen
   production database. Record the actual backup window, recovery point target,
   and recovery time target. Rehearse a restore into an isolated environment
   before sharing links; verify its schema and a synthetic RSVP without
   exposing restored guest data publicly.
2. Set an owner-approved closeout date before sending invitations. The MVP
   retention rule is to export required planning records, then delete guest
   contact and RSVP data 60–90 days after the wedding unless the owners state
   a reason to keep it. Account for earlier individual erasure requests and
   the actual backup retention window. This is an operating choice, not an
   automatic application setting.
3. At closeout, stop issuing links and revoke remaining active links. Delete
   Direct PostgreSQL RSVPs through the coordinator where appropriate. If full
   erasure is required, use a separately reviewed, access-controlled database
   procedure that also handles invitation names, QR/check-in rows, and any
   Hosted Supabase revisions, logistics, and activity. Verify the row counts
   without exporting personal data to CI or shared logs.
4. A restored backup can reintroduce erased records. Restore only into an
   isolated environment, repeat the reviewed erasure before data is reused,
   and let the backup window elapse before claiming backup copies are gone.
   Delete any offline wedding-day export and retire secrets/infrastructure
   after the retention and recovery obligations are complete.

If durable link reissue history, household-level retention, automatic expiry
jobs, or self-service full erasure become requirements, add them as schema and
API changes with migration and restore tests. The current direct schema models
one invitation as the household record and does not provide those workflows.
