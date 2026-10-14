# AWS deployment plan

> Historical reference for the original project. For this Vercel copy, follow [Vercel + Neon deployment](vercel-neon-deployment.md); the original AWS infrastructure remains in `../personalWedding/infra`.

This is the production shape implemented by [`infra/`](../infra/). The repository contains two independently built images, but AWS runs them together in one ECS Fargate task and scales them together.

```text
Guest browser ─HTTPS─> CloudFront + WAF ─HTTPS─> ALB ─HTTP─> Next.js app:3000
                                                             │ private task loopback
                                                             v
                                                        Node API:4000
                                                             │ verified TLS
                                                             v
                                               managed PostgreSQL or Supabase
```

Route 53 points the canonical domain to CloudFront. The ALB requires Cognito login on coordinator pages and APIs, then forwards browser paths to Next.js; it never forwards to the API container. Next.js uses `BACKEND_URL=http://127.0.0.1:4000` and a shared service token to call private `/v1/*` endpoints. The task security group accepts only frontend port 3000 from the ALB. The API holds database credentials and invitation/entry-pass peppers. The frontend holds coordinator password/session credentials and the service token, but no database credential or service-role key.

## Database and identity prerequisites

Terraform does not create a production database. Choose `database_mode = "direct"` for an independently managed PostgreSQL service or `"hosted"` for Hosted Supabase. Direct PostgreSQL gives the built-in coordinator, content editor, invitation issuer, and gate scanner. Use a separate schema-owner credential only for migrations, a narrower runtime role for API traffic, `sslmode=verify-full`, backups, and a tested restore. Hosted Supabase supports guest invitations and RSVPs but requires its separate MFA operator/import workflow. See [`api/README.md`](../api/README.md) for the modes and schema commands.

Terraform creates a separate Cognito user pool in each environment. Only an administrator can create named users; the pool requires TOTP MFA and its managed login guides first-use enrollment. The ALB protects `/coordinator`, `/coordinator/*`, `/api/coordinator`, and `/api/coordinator/*` before requests reach Next.js. Unauthenticated pages redirect to Cognito; unauthenticated coordinator APIs return 401. The Next.js password and signed session remain a second gate. Create accounts for only the operators who need access, test account recovery and revocation, and never share an account.

The Cognito app client accepts only `https://<app-domain>/oauth2/idpresponse` as its callback. CloudFront's default behavior forwards that path to the ALB over HTTPS with all viewer cookies, query strings, and the original Host header; caching is disabled. Those settings are required for ALB authentication. ECS supplies the frontend with the exact Cognito `/logout` URL and canonical root return URI. Complete first-use TOTP enrollment, sign out, and sign in again before giving an operator the app password. Verify browser login, callback, logout, and unauthenticated access in staging before sending invitations. The local Podman stack remains loopback-only and does not use Cognito.

Both containers require the same exact canonical HTTPS `PUBLIC_APP_ORIGIN`. Production cannot use `LOCAL_STACK_MODE`; its loopback HTTP exception exists only for the documented Podman smoke stack. Store runtime secrets in AWS Secrets Manager, never in `.tfvars`, images, or CI build arguments. `BACKEND_SERVICE_TOKEN`, `COORDINATOR_PASSWORD`, and `COORDINATOR_SESSION_SECRET` are distinct random values. Direct PostgreSQL also needs `DATABASE_URL`, `DATABASE_INVITATION_TOKEN_PEPPER`, and `DATABASE_ENTRY_PASS_TOKEN_PEPPER`; hosted mode needs its four Supabase settings. Only the API receives the selected database-mode secrets.

## Release and traffic checks

The GitHub workflow verifies both packages, builds two immutable ECR images for one commit, checks scans, and deploys the image pair to staging. A release tag requires a successful main-branch staging workflow for that commit and its retained validation artifact, recorded after deployment and smoke checks. Production compares both artifact digests with ECR, rechecks image scans, then deploys after the protected GitHub environment gate. Missing or expired validation blocks promotion; rerun staging for that commit to refresh it. ECS waits for the API `/readyz` before starting the frontend; the ALB checks frontend `/readyz`, which in turn checks authenticated API readiness. `/healthz` is liveness only. Read [`infra/README.md`](../infra/README.md) for first-time ECR, Terraform, Secrets Manager, and CI setup.

CloudFront may cache only immutable `/_next/static/*` assets. Invitation pages, coordinator pages, and browser APIs need private, no-store responses. ALB access logs and WAF sampled requests stay disabled because URL paths can contain bearer invitation tokens; WAF metrics remain enabled. Keep application logs free of raw paths, tokens, QR credentials, request bodies, and sensitive response fields. Production example tfvars use WAF `block`; test false positives against synthetic staging invitations first.

Before sharing a link, verify a synthetic staging invitation end to end: issue, open English/Hindi guest pages, calendar download, RSVP, QR check-in, revoke, and RSVP deletion. Confirm a data backup can restore into an isolated environment. The raw link is one-time output; share it privately and never copy it into a screenshot or ticket.

## Operations

- Watch ECS desired/running task counts, task health, CPU/memory, ALB 5xx/latency, CloudFront 5xx, certificate expiry, and WAF metrics. Confirm alert email subscriptions in both the app region and us-east-1.
- If either container fails readiness, ECS stops routing the task. Investigate API database connectivity and secrets, then roll back both images to a previously verified pair. Do not roll back data schema blindly.
- Rotate a leaked service token in both containers in one deployment. A leaked invitation pepper or database credential needs a coordinated incident response and link reissue plan; do not print old values while rotating.
- Disable a named Cognito account immediately when an operator loses access; rotate the app coordinator password separately if it may be exposed. Keep backup retention and post-wedding RSVP deletion dates documented outside this repository. Tear down public infrastructure only after retention and recovery obligations are complete.
