Invitation photography and artwork live here instead of `public/`. The allowlist
in `src/lib/server/private-media.ts` maps fixed asset names to these files. The
`/i/[token]/media/[asset]` handler verifies an active, unexpired invitation before
reading a file and sends private, no-store responses. Revoking the invitation
also prevents subsequent media requests using that link.

Next.js output tracing includes this directory only in the private media route's
server bundle. The image optimizer permits only the generic public share image;
it cannot make cached copies of private media. Add future personal video or photo
assets through an authenticated handler, not through `public/`.
