# Container build and browser validation — 12 October 2026

> Historical reference for the original project. For this Vercel copy, follow [Vercel + Neon deployment](vercel-neon-deployment.md); the original AWS infrastructure remains in `../personalWedding/infra`.

The local Podman certificate failure is fixed. Both production API and Next.js images built successfully, and the HTTP and Playwright suites passed against those images in the disposable `shaadi-smoke` stack. This supersedes the container-build limitation in the [9 October report](review-validation-2026-10-09.md).

The corporate inspection CA was already trusted by macOS. [prepare-local-build.mjs](../scripts/prepare-local-build.mjs) exports only the public trusted certificate, verifies the npm registry's certificate chain and hostname, and creates a local Node base with the pinned pnpm version. The generated image is bound to the inspected Node base image ID, CA fingerprint, and build instructions. Both local Compose files select it through `LOCAL_NODE_IMAGE`; existing `.env` secrets are preserved. The certificate and manifest remain in ignored `.local-build/`, and the AWS image defaults remain official Node images.

The public CA inside the image is readable by the non-root runtime users. Registry TLS verification was also checked as a non-root user. Certificate verification remains enabled for Node, Corepack, and package downloads.

Another local project was already listening on port 3000. The personal Compose stack now supports `LOCAL_WEB_PORT=3002`, with matching public origins in the API and frontend. The default remains 3000; the disposable smoke stack keeps 3001. Both services accept only the explicitly listed loopback origins, and database host and TLS restrictions are preserved.

Testing the empty personal database exposed a first-time setup failure: signing in redirected to the unavailable page until wedding settings existed. Missing settings now produce empty coordinator options, and the overview and Invite links pages direct to Content. Invitation creation remains disabled until configured. Invalid saved configuration and failed database queries still report unavailable; guest links retain the strict configuration checks.

| Validation | Result |
| --- | --- |
| Local-build helper tests: secret preservation, dotenv variants, image references, CA validity, malformed/private PEM rejection | 10 passed |
| Production API image build | Passed |
| Production Next.js image build | Passed |
| Non-root registry TLS verification with the generated CA image | Passed |
| Alternate-port origin, authentication, backend and CSP boundary tests | 57 passed |
| Both service typechecks and edited frontend-file lint | Passed |
| First-time setup and backend failure regression tests | 32 passed |
| HTTP smoke: authentication, guest/manual replies, conflicts, deadline, pass lifecycle, revocation and erasure | Passed |
| Playwright wedding suite in Chromium 154.0.8037.98 | 14 stages passed |
| Playwright camera suite | 6 checks passed |
| Playwright first-time setup: sign-in, Content link, issuing disabled, mobile and desktop layouts | Passed |
| Personal stack liveness/readiness, access gate, login/logout and all six coordinator routes | Passed |
| Browser JavaScript and CSP errors | 0 |

Playwright covered coordinator login and sign-out, content save/discard, English and Hindi invitations, guest validation and saved RSVP reloads, calendar and CSV downloads, coordinator notes and filters, phone-reply editing, concurrent conflicts, cutoff enforcement, repeated check-in, pass invalidation, revocation, and response erasure. Guest and coordinator layouts were checked at 320, 390, and 1440 pixels.

The camera suite decoded a generated QR through a canvas video stream with native barcode detection disabled. It checked attendance counts, duplicate scans, denied permission/manual fallback, stopping the camera, and cancellation of pending permission when switching modes or backgrounding the desk. Canceled camera attempts created no admission and ended late video tracks.

Sanitized results are saved in [playwright-results.json](../web/test-results/fixes-20261012/playwright-results.json), with screenshots in [web/test-results/fixes-20261012](../web/test-results/fixes-20261012/). Screenshots omit passwords, one-time invitation links, and entry credentials. The reusable suites are [browser-smoke.mjs](../scripts/browser-smoke.mjs) and [camera-smoke.mjs](../scripts/camera-smoke.mjs).

The personal stack is running at [127.0.0.1:3002/coordinator](http://127.0.0.1:3002/coordinator), with all three services healthy. The original `up --build --detach` command completed successfully. Both services were then rebuilt and replaced with the final setup fix; the personal and smoke containers used the same image IDs recorded in the Playwright results. Podman Compose retained older tagged images on a plain `up --no-build`, so the README also documents recreating API/frontend containers after a rebuild while keeping the database running.

Read-only [personal access checks](../web/test-results/fixes-20261012/personal-stack-results.json) and [fresh setup browser checks](../web/test-results/fixes-20261012/fresh-setup-playwright-results.json) passed. The setup prompt and disabled issuing state fit 320, 390, and 1440 pixel viewports, and its link opened Content. These checks changed no personal content, invitations, or RSVPs.

All guest, RSVP, and content mutations in the HTTP and browser tests used synthetic data in the disposable stack. The test suites revoked their synthetic invitations, erased replies, restored settings, and archived the added test celebration. The disposable stack and its temporary environment files were removed after validation. The personal stack was checked through sign-in and read-only navigation. Physical phone cameras, native sharing/WhatsApp, and deployed Cognito/AWS behavior were not exercised.

The database and infrastructure rollout requirements from the [9 October report](review-validation-2026-10-09.md) still apply before deployment: apply the updated schema and runtime grants with the schema-owner credential, and roll out the global IAM changes separately.
