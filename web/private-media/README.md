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

To replace the teaser later, keep the masters in `teaser/` and export web copies
to the same filenames. No duration is hardcoded in the page. Use H.264 video,
AAC audio, a 16:9 frame, keyframes every two seconds, and MP4 fast-start
metadata. The current copies come from the `comingSoonHD.mp4` and
`comingSoon4K.mp4` masters (about 59 Mbit/s each):

```sh
common="-map 0:v:0 -map 0:a:0 -map_metadata -1 -c:v libx264 -preset slow -profile:v high -pix_fmt yuv420p -g 50 -keyint_min 25 -c:a aac -b:a 160k -ac 2 -movflags +faststart"
ffmpeg -i comingSoonHD.mp4 $common -crf 20 -maxrate 6M -bufsize 12M -level 4.1 prewedding-teaser-hd.mp4
ffmpeg -i comingSoon4K.mp4 $common -crf 21 -maxrate 16M -bufsize 32M -level 5.1 prewedding-teaser-4k.mp4
```

They are about 27 MB and 87 MB. Full-file responses above 4 MiB are refused;
browsers play through bounded range responses instead. Keep both copies small
enough that the media route stays below Vercel's 250 MB function bundle limit.
The poster is a 1920×1080 lossy WebP (about 70 KB), exported from
`teaser/prewedding-teaser-poster-source.png` with
`cwebp -metadata none -q 82 -m 6 -crop 9 0 2922 1644 -resize 1920 1080 -noalpha`.
The masters and poster source are excluded from git, Vercel uploads, the
container, and the server bundle; only the web copies are allowlisted.

The invitation hero opens with three pre-wedding portraits: the lakeside,
palace arch, and Hawa Mahal photographs in `prewedding/`. Their 640px and 1066px
WebP exports preserve the original framing and remove source metadata. The
three existing engagement photographs follow them in the same slideshow, with
their 640px and 1067px variants retained.

Three landscape photographs from the same pre-wedding shoot appear in the
scrolling celebration chapters; the wide lakeside image also appears behind
the hero and travel sections. Their 960px and 1600px WebP copies let phones
request smaller files. The burgundy and ivory overlays keep text readable.
Only optimized exports are copied into this folder; the source photos remain
in the owner's Pictures directory. Every export uses the same invitation
gate, allowlist, no-store headers, and output tracing as the existing images.
Never capture real personal photographs, invitation links, or entry
credentials in test artifacts.

Next.js output tracing includes the image assets and optimized teaser in
the invitation media routes' server bundles. The image optimizer permits only the generic public share image;
it cannot make cached copies of private media. Add future personal video or photo
assets through an authenticated handler, not through `public/`.
