# Shaadi Companion — MVP Definition

## Product decision

Build a private, mobile-first **invitation and RSVP operations tool** for one wedding in Haryana, India.

It is not a full wedding platform. Its job is to give each invited household the right information, collect a usable response, and give the couple/coordinators a reliable planning list. WhatsApp and phone calls remain the delivery and escalation channels, especially for elders and day-of changes.

## The one-sentence promise

“Open your family’s invitation, see only the events you are invited to, tell us who is coming, and get the practical details you need.”

## What success looks like

- A household can complete an RSVP in under 90 seconds without creating an account.
- The planning team can answer “how many adults and children are coming to each event?” without merging multiple spreadsheets.
- A coordinator can record a response received by phone or WhatsApp just as easily as one submitted online.
- Guests have a visible phone/WhatsApp fallback if the link, language, or form does not work for them.
- The product remains usable from WhatsApp’s in-app browser, on older Android phones, and on slow mobile data.

## Product principles

1. **Households, not anonymous headcounts.** An invitation belongs to a known household and has a defined event list and expected party size; exceptions are flagged for a coordinator rather than silently accepted.
2. **The RSVP is a planning signal, not social proof.** A response can be pending, self-reported, or coordinator-confirmed. No response is never silently treated as a decline.
3. **Useful details beat decorative features.** Timings, gate/parking notes, maps, contacts, and accurate counts come before games or galleries.
4. **One source of truth; many ways to respond.** The app, a phone call, and a WhatsApp reply all update the same guest record.
5. **Low-friction privacy.** A household link is convenient but shareable; protect PII and keep sensitive logistics out of it.

## Launch scope

### A. Personalized household invitation

Every household receives a unique, non-guessable URL, normally sent with a WhatsApp invitation message and optionally printed as a QR code.

The page includes:

- A greeting such as “Dear Sharma Family”; couple names and a short welcome.
- Only the events that household is invited to. This supports reception-only guests and different bride/groom-side schedules.
- A language switch for fully reviewed English and Hindi copy—not a machine-translated partial interface.
- A prominent RSVP button and `Can’t RSVP online? Call/WhatsApp …` fallback.
- A small “last updated” timestamp for schedule information.

Do not put a guest’s name, phone number, event permissions, or token in social-preview metadata. The URL must not contain PII. Set a strict referrer policy so opening Maps or another external link does not disclose a personalized invitation URL.

### B. Event itinerary and practical information

For each invited event, show:

- Name, date, arrival window, ceremony time, and timezone (`IST`). Use an arrival window for fluid events such as a baraat.
- Venue name, full address, validated Google Maps link, entry gate/drop-off point, and a recognisable landmark where useful.
- Dress code/theme and one concise practical note: parking, footwear, timing, or who to call.
- An optional calendar download generated from the current event record.

Include a short, shared travel page only once travel/hotel arrangements are definite. Do not publish room allocations or other sensitive details in the invite page.

### C. Household RSVP

The form must be short and event-specific.

1. Confirm or update the respondent’s name. Do not ask again for a phone number already on the invitation record.
2. Choose `Attending`, `Unable to attend`, or `Will confirm by [date]`.
3. For each invited event, select attendance and enter **adult and child counts**. The form applies the invitation’s expected count and flags exceptions for a coordinator.
4. Ask only actionable questions: dietary/allergy or accessibility needs, if catering can support them. Avoid collecting medical detail.
5. Show transport/stay questions only to eligible out-of-town households and only after those arrangements are owned by someone. Capture structured fields—arrival/departure date and time, train/flight or pickup point, travellers, nights, and pickup/drop need—not a vague “need transport?” checkbox.
6. Show a confirmation summary, RSVP deadline, and a way to correct it before the deadline.

After the deadline, replace self-editing with the relevant coordinator contact. A family representative may respond on behalf of the household.

**Recommended access trade-off:** before the deadline, let the household’s link revise ordinary attendance counts, while audit-logging every revision. Keep sensitive travel/stay arrangements coordinator-managed. This is lower friction than phone OTP for a family wedding; revoke and reissue a link if it is mis-sent. Add phone verification later only if guests must self-manage sensitive information.

### D. Coordinator console

This is the operational core, deliberately small.

- Import, validate, and de-duplicate the household guest list from CSV; generate/reissue invitation links.
- Search/filter by family side, city, nearby/outstation, VIP, event, invite state, and RSVP state.
- Track lifecycle: `not sent` → `sent` → `responded` / `manual response` → `confirmed`; retain `pending` and `declined` distinctly.
- Record a phone/WhatsApp response, manual correction, call note, owner, and timestamp.
- See adult/child totals by event, responses requiring follow-up, and transport/stay requests.
- Export CSVs for caterer, transport, accommodation, and an offline wedding-day backup.
- Revoke/replace a forwarded or mis-sent invitation link.
- Maintain one simple announcement banner with publish/expiry time and English/Hindi text.

Use named admin accounts, not a shared password. The couple and one or two trusted coordinators are enough for launch.

### E. Communication protocol

The website is the source of truth; it does not replace WhatsApp.

| Situation | Primary delivery | Fallback |
| --- | --- | --- |
| Invitation | Personalized WhatsApp message with unique link | Printed card/QR and a phone call for elders |
| RSVP reminder | Coordinator sends a copy-ready WhatsApp message to pending households | Phone follow-up and manual entry |
| Time-sensitive change | Relevant WhatsApp family/group/channel message, with website banner updated | Day-of coordinator phone number |
| Critical transport/baraat issue | Direct call or existing trusted group | Do not rely on a guest reopening the site |

This MVP does not assume access to the WhatsApp Business API. It supplies links and copy that a coordinator can send manually.

## Explicitly out of scope for launch

- Anonymous photo uploads or a live gallery.
- Games, sangeet voting, baraat tracker, seating finder, registry/UPI, or guest accounts.
- Automated WhatsApp messages, push notifications, or bulk marketing tools.
- Complex room assignment or transport dispatch.
- A generic public schedule that reveals events to households not invited to them.

Photo sharing is a good **post-wedding** project. It creates avoidable launch risk: moderation, spam, child-photo consent, storage cost, image safety, and EXIF/GPS privacy. If added later, use private storage, signed uploads, human approval, limits, and a deletion date.

## Invitation, RSVP, and planning model

### Source records

| Record | Key fields | Why it exists |
| --- | --- | --- |
| `Event` | bilingual title/copy, time in `Asia/Kolkata`, venue, maps URL, dress code, publish state | One canonical version of an event |
| `Invitation` | household label, primary contact, language, opaque token digest, invitation status, tags | Represents one family/household invitation |
| `Invitation event` | invitation, event, eligible, adult/child limit | Controls what the household sees and can RSVP for |
| `RSVP` | invitation, respondent, status, latest update, coordinator confirmation | Separates a guest reply from planning certainty |
| `Event attendance` | RSVP, event, attending status, adult count, child count, support needs | Produces meaningful event totals |
| `Logistics request` | invitation, arrival/departure, pickup/drop, stay nights, request status | Collected only when actionable |
| `Coordinator activity` | actor, action, note, timestamp | Makes manual changes traceable |

Keep internal tags—family side, city, nearby/outstation, VIP, follow-up owner—out of guest pages.

### RSVP states

| Guest-facing response | Planning meaning |
| --- | --- |
| Attending | Count is provisional until confirmed if needed |
| Unable to attend | Excluded from attendance forecast |
| Will confirm | Follow-up required; not counted as confirmed |
| No response | Still pending; requires follow-up or buffer decision |

Maintain a separate internal `confirmed by coordinator` state so caterer and transport exports are based on a deliberate decision, not merely on form submissions.

## Access, security, and privacy requirements

- Treat every invitation URL as a **bearer link**: use a cryptographically random token of at least 128 bits, store only its digest, and support revocation/reissue.
- A shared link can be forwarded. Therefore, do not show other guests, room assignments, other guests’ phone numbers, or sensitive travel information from it. A designated public coordinator number is the exception. If sensitive changes ever need self-service, add phone verification only when its protection justifies the added guest friction.
- Validate party/event limits, input, and permissions on the server. Never expose RSVP or invitation tables directly to the browser.
- Use row-level security in the database even when server endpoints enforce access. Keep service credentials server-only.
- Rate-limit form writes; use light anti-abuse measures that do not burden older guests. Preserve timestamps and revision history for RSVP changes.
- Admins use named authenticated accounts with MFA, least-privilege roles, and an audit trail.
- Use no third-party behavioural trackers on personalized pages. Keep analytics aggregate and avoid recording invitation URLs.
- Display a plain-language notice: what is collected, that it is used only to coordinate this wedding, who can access it, and how to request a correction.
- Set a retention rule before launch: export required planning records, then delete guest contact/RSVP data 60–90 days after the wedding unless there is a stated reason to keep it.

## Experience requirements

- No required app install or guest account.
- Server-rendered/lightweight pages; compressed hero image; no autoplay media or heavy animation.
- Large tap targets, readable text, clear Hindi typography, and form errors written in both languages.
- Works in Android Chrome, iPhone Safari, and WhatsApp’s in-app browser.
- Maps opens externally but the page also provides a copyable address and an entry-gate note.
- Printed invitation/QR has the coordination number as a non-digital fallback.

## Recommended technical shape

Use **Next.js + TypeScript + Tailwind CSS + Supabase**, deployed on Vercel.

- Next.js provides lightweight, shareable invitation pages and validated server actions/API routes.
- Supabase provides the relational RSVP database, individual admin authentication, row-level security, and later optional private image storage.
- Vercel provides fast deploys and preview links for family review.
- Google Maps deep links remain the simplest guest navigation option.

Do not build a native app or a PWA installation flow. It adds friction without helping this guest journey.

## Delivery plan (relative to the wedding date)

| When | Required outcome |
| --- | --- |
| T−12 to T−10 weeks | Freeze event list, guest/invitation model, language choice, RSVP questions, cutoffs, data-retention rule, and coordinator ownership |
| T−9 to T−8 weeks | Build invitation, RSVP, event filtering, CSV import/export, minimal coordinator console, and link revoke/reissue |
| T−7 weeks | Pilot with 10–15 relatives: older Android users, iPhone users, Hindi readers, WhatsApp in-app browser, and slow data. Test a manual phone RSVP too |
| T−6 to T−5 weeks | Send first-wave invitations. Log sends, reconcile manual replies, and repair only observed failures |
| T−4 weeks | Send reminders to pending households; set transport/hotel detail cutoff if relevant |
| T−3 to T−2 weeks | Coordinator confirms uncertain counts; export catering/transport drafts; lock major content |
| T−7 days | Final reminder, venue-pin validation, coordinator training, offline guest and itinerary backups |
| Wedding week | Use the announcement banner as a reference; distribute urgent updates through WhatsApp/calls; maintain one day-of contact |
| T+14 to T+90 days | Offer a separate photo/memory experience if wanted; export what must be retained and delete RSVP contact data on schedule |

## Build acceptance checklist

The MVP is ready to send only when all of these are true:

- [ ] A test household sees only its allowed events and cannot exceed its allowed adult/child counts.
- [ ] Each event has a verified map pin, address, arrival guidance, and correct IST time.
- [ ] RSVP edits work until a visible deadline, then route to a human contact.
- [ ] A coordinator can import, send, resend, revoke, manually record, filter, and export an RSVP.
- [ ] Event totals distinguish adults, children, declined, pending, self-reported, and confirmed responses.
- [ ] English and Hindi labels, validation messages, and confirmation messages are family-reviewed.
- [ ] The complete flow works in WhatsApp’s in-app browser and on at least one older Android device.
- [ ] Admin accounts are individual and MFA-enabled; guest PII is not public or in URLs.
- [ ] A printed/offline contingency list and coordinator contact sheet exist before wedding week.

## Inputs needed before implementation

1. Exact wedding date(s), events, arrival windows, venue addresses, entry gates, Maps URLs, and dress themes.
2. Household guest list with primary contact, invited events, maximum adults/children, relationship/side tags, and nearby/outstation status.
3. RSVP deadline plus separate catering, accommodation, and transport cutoffs.
4. Reviewed English/Hindi invitation copy and one trusted person responsible for content accuracy.
5. Named owners for RSVP follow-up, travel/stay requests, and day-of updates, with separate contact numbers where appropriate.
6. A decision on whether household links may edit responses freely before the deadline or whether edits after initial submission must go through a coordinator.

## Later enhancements, in this order

1. Private, moderated post-wedding photo gallery.
2. Guestbook/memory messages.
3. Sangeet quiz or voting.
4. Seating/table finder, only if the venue plan is stable.
5. Baraat tracker, only if someone can reliably operate it in real time.
