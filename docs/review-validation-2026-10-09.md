# Wedding project fixes and validation — 9 October 2026

> Historical reference for the original project. For this Vercel copy, follow [Vercel + Neon deployment](vercel-neon-deployment.md); the original AWS infrastructure remains in `../personalWedding/infra`.

The [12 October container validation](review-validation-2026-10-12.md) supersedes this report's container-build limitation: both production images built and passed the HTTP and Playwright suites.

The reviewed issues are fixed. Coordinator records now show respondent names, hospitality requests, wishes, and per-event replies. Coordinators can record phone replies after the guest deadline, with stale-edit protection and an audit timestamp. Invitation listing no longer stops at 500 records. CSV exports preserve per-event counts, Hindi text, notes, contacts, and full timestamps while escaping spreadsheet formulas. Calendar newline escaping and hosted RSVP reloads are corrected.

The gate scanner now decodes QR codes when the browser has no native barcode detector. Camera cancellation prevents old frames or late permission responses from submitting a check-in. Production dependencies were updated, secret access was narrowed, and release promotion now requires staging validation tied to the exact commit and both image digests.

| Validation | Result |
| --- | --- |
| Frontend lint, typecheck, 82 tests, production build | Passed |
| API typecheck, 36 tests, build | Passed |
| PostgreSQL integration tests, including restricted runtime role | 8 passed |
| Production dependency audits for both packages | No reported vulnerabilities |
| Release-promotion tests | 6 passed |
| Terraform formatting and validation | All three stacks passed |
| GitHub workflow actionlint | Passed |
| HTTP smoke: auth, guest/manual replies, conflicts, deadline, pass lifecycle, revoke/erase | Passed |
| Playwright wedding suite in Chromium 154.0.8037.98 | 14 stages passed |
| Playwright camera suite | 6 checks passed |

Playwright exercised English and Hindi invitations, required choices and invitation caps, saved RSVP reloads, calendar/CSV downloads, coordinator content save/discard, phone editing, concurrent conflicts, cutoff enforcement, filters/search, repeated check-in, pass invalidation, UI revocation/erasure, and sign-out/access gates. Guest pages and all six workspace routes fit 320, 390, and 1440 pixel viewports without document overflow. No unexpected browser JavaScript, CSP, HTTP 400, or server errors were detected.

Camera checks used a generated QR through a canvas stream with native detection disabled. They verified attendance counts, repeated scans, permission denial/manual fallback, manual camera stop, and cancellation of pending permission when switching modes or backgrounding the desk. Canceled attempts made no check-in request and stopped late streams.

The reusable suites are [browser-smoke.mjs](../scripts/browser-smoke.mjs) and [camera-smoke.mjs](../scripts/camera-smoke.mjs). Sanitized results and screenshots are saved locally in [web/test-results/fixes-20261009](../web/test-results/fixes-20261009/). Screenshots omit passwords, one-time invitation links, and entry credentials.

Only synthetic data was used. The browser run used the built Next.js standalone server and compiled API on the host, with a disposable PostgreSQL 16 fixture. The API used development configuration for its loopback database connection. Container image assembly could not finish because the local Podman VM was nearly out of memory; the application builds and browser flows passed using the host fallback. Physical phone cameras, native sharing/WhatsApp, and deployed Cognito/AWS behavior were not exercised by these browser tests.

Before deploying the API, apply the updated `api/database/schema.sql` and then `api/database/grant-runtime-role.sql` with the schema-owner credential, as documented in [api/README.md](../api/README.md). The global IAM changes require a separate Terraform rollout. No real wedding database or infrastructure was changed.
