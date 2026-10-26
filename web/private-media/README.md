Invitation photography and artwork live here instead of `public/`. The allowlist
in `src/lib/server/private-media.ts` maps fixed asset names to these files. The
`/i/[token]/media/[asset]` handler verifies an active, unexpired invitation before
reading a file and sends private, no-store responses. Revoking the invitation
also prevents subsequent media requests using that link.

Public RSVP pages also display these invitation assets through
`/rsvp/g/media/[asset]` and `/rsvp/b/media/[asset]`. These routes require a
configured public invitation for the selected team, use the same fixed asset
allowlist and rate limits, and retain no-store headers. Anyone can view these
assets while the public invitation is available; private guest responses and
personal links are never included.

The runtime allowlist contains 25 files: 16 prewedding WebP exports, two
selectable artwork JPEGs, three mehendi images, one teaser poster, two teaser
videos, and one music file. The eight source JPEGs listed below are retained
only for future exports and are excluded from deployments. Unused portraits,
backgrounds, artwork, and duplicate sources have been removed.

Background music uses `music/raabta-instrumental.m4a`, an excerpt of the
[Raabta instrumental cover by Havana The Band / Sound Spirit](https://www.youtube.com/watch?v=Fa8AXcfLXs4).
The downloaded recording is exported as stereo 48 kHz AAC at 128 kbit/s with
source metadata removed and MP4 fast-start metadata. The first 8 seconds are
removed without re-encoding; the 3:31 file is about 3.3 MiB, below the 4 MiB
full-response limit. Audio supports the same invitation
checks, private headers and bounded byte ranges as the teaser. Sound is enabled
by default and begins with the opening gesture. Direct section links attempt
autoplay with a Play music fallback when the browser requires a tap. It loops
quietly and pauses for the teaser or a hidden tab. Both media-route bundles
explicitly include this file.

The invitation's optional teaser uses `teaser/prewedding-teaser-hd.mp4`,
`teaser/prewedding-teaser-4k.mp4`, and `prewedding-teaser-poster.webp`. Only the
poster loads before a guest chooses to play. The player then picks 4K only for
large, high-density desktop screens on a fast connection without data saver;
phones, tablets, and slower connections get HD, and retrying after an error
always uses HD. The film starts with sound, plays inline on phones, and offers
native playback controls for pausing, seeking, and muting. Video requests use
the same invitation gate and private headers, with byte ranges for playback and
seeking.

To replace the teaser later, export web copies to the same filenames. No
duration is hardcoded in the page. Use H.264 video, AAC audio, a 16:9 frame,
keyframes every two seconds, and MP4 fast-start metadata. Keep source masters
outside the deployed media inventory.

The current copies are about 27 MB and 87 MB. Full-file responses above 4 MiB are refused;
browsers play through bounded range responses instead. Keep both copies small
enough that the media route stays below Vercel's 250 MB function bundle limit.
The poster is a 1920×1080 lossy WebP (about 70 KB). Only the web copies are
retained and allowlisted; source masters and a poster source are not stored here.

The couple box contains only the three portraits from `prewedding/vertical/`:
`jalMahal.jpeg`, `patrikaGate.jpeg`, and `sittingInFrontOfHawaMahal.jpeg`.
Their 640px and 1066px WebP exports retain the `prewedding-lakeside`,
`prewedding-palace`, and `prewedding-hawa-mahal` names, preserve the original
framing, and remove source metadata.

The banner and scrolling backgrounds use selections from
`prewedding/horizontal/`, exported as 960px and 1600px WebP copies:

| Placement | Source | Export prefix |
| --- | --- | --- |
| First banner | `side_forehead_touch.jpeg` | `prewedding-hero` |
| Travel banner | `holding_hug.jpeg` | `prewedding-banner` |
| First story photo (desktop only) | `handhold_sunrise.jpeg` | `prewedding-handhold` |
| Second story photo | `holding_hug.jpeg` | `prewedding-banner` |
| Third story photo | `foreheadtouch_sunrise.jpeg` | `prewedding-ceremony` |
| Fourth story photo | `forehead_kiss.jpeg` | `prewedding-reception` |

Story photos appear once each, independently of event categories. Up to four
unique photos fade across the full scrolling section while every event keeps
its own caption and progress indicator. Extra events do not restart the photo
sequence; the final photo stays visible at the end. Fewer than four events use
only that many photos. One event shows one non-sticky panel, and no events
omits the story. The first banner and travel banner do not depend on event count.

The smaller copies let phones request less data. The burgundy and ivory
overlays keep text readable. Desktop backgrounds show the entire photograph
without zooming. Mobile backgrounds crop toward the couple: left in the first
banner, right in the travel banner and hug/touch/kiss story photos. The handhold
photo is omitted on mobile, where its wide framing cannot keep both faces in a
full-height crop. Mobile starts with the hug photo; a single-event invitation
uses that photo as its responsive fallback too. Hidden photos are excluded from
the scrolling fade timeline. Paused or reduced-motion
story layouts retain the full photo even when their captions make them taller.
The banner photos' mobile height is bounded and fades out, so a tall stacked
section does not magnify a narrow strip of the image. Source JPEG folders are excluded from Vercel uploads and container
builds; only the optimized exports are allowlisted and included in server
bundles. Every export uses the same invitation gate and no-store headers as
the existing images.
Never capture real personal photographs, invitation links, or entry
credentials in test artifacts.

Next.js output tracing includes the image assets and optimized teaser in
the invitation media routes' server bundles. The image optimizer permits only the generic public share image;
it cannot make cached copies of private media. Add future personal video or photo
assets through an authenticated handler, not through `public/`.
