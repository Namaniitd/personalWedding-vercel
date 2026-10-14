"use client";

/* eslint-disable @next/next/no-img-element -- next/image emits inline styles that the invitation's strict CSP blocks. */

import { useEffect, useState } from "react";

import { RSVPForm } from "@/components/rsvp-form";
import { WeddingCountdown } from "@/components/wedding-countdown";
import { invitationMediaUrl } from "@/lib/invitation-media";
import type { Locale, ResolvedInvitation, WeddingArtworkKey, WeddingEvent, WeddingGuestContent } from "@/lib/types";

import styles from "./wedding-invite.module.css";

type InviteCopy = {
  skip: string;
  brand: string;
  privateInvitation: string;
  announcement: string;
  schedule: string;
  travel: string;
  rsvp: string;
  help: string;
  switchLanguage: string;
  invitationLead: string;
  blessing: string;
  date: string;
  place: string;
  forHousehold: string;
  privateNote: string;
  eventCount: (count: number) => string;
  rsvpNow: string;
  viewSchedule: string;
  phoneFallback: string;
  deadline: string;
  scheduleEyebrow: string;
  scheduleTitle: string;
  scheduleLead: string;
  arrival: string;
  venue: string;
  address: string;
  attire: string;
  entry: string;
  helpfulToKnow: string;
  directions: string;
  calendar: string;
  calendarRetry: string;
  calendarError: string;
  preparingCalendar: string;
  travelFallback: string;
  update: string;
  helpEyebrow: string;
  helpTitle: string;
  helpLead: string;
  call: string;
  whatsapp: string;
  privacy: string;
  privacyCopy: string;
  footer: string;
  artworkCredit: string;
  photoCredit: string;
  heroPhotoAlt: string;
  detailPhotoAlt: string;
  blessingFallback: string;
  backToTop: string;
};

const copy: Record<Locale, InviteCopy> = {
  en: {
    skip: "Skip to the invitation details",
    brand: "Wedding invitation",
    privateInvitation: "A personal invitation",
    announcement: "Wedding update",
    schedule: "Your events",
    travel: "Travel",
    rsvp: "RSVP",
    help: "Contact",
    switchLanguage: "View in Hindi",
    invitationLead: "Together with our families, we invite you to celebrate the wedding of",
    blessing: "With love and blessings",
    date: "Wedding date",
    place: "Location",
    forHousehold: "Especially for",
    privateNote: "This link is for your household. Please keep it private.",
    eventCount: (count) => `${count} ${count === 1 ? "celebration" : "celebrations"} in your invitation`,
    rsvpNow: "Reply to invitation",
    viewSchedule: "See your events",
    phoneFallback: "Prefer to reply by phone?",
    deadline: "Please RSVP by",
    scheduleEyebrow: "Plan your visit",
    scheduleTitle: "Your celebrations",
    scheduleLead: "These are the events included in your household’s invitation. Check the arrival time and venue before you travel.",
    arrival: "Arrive",
    venue: "Venue",
    address: "Address",
    attire: "What to wear",
    entry: "On arrival",
    helpfulToKnow: "Good to know",
    directions: "Directions",
    calendar: "Add to calendar",
    calendarRetry: "Try calendar again",
    calendarError: "The calendar file could not be downloaded. Please try again.",
    preparingCalendar: "Preparing…",
    travelFallback: "Travel and stay",
    update: "A note for guests",
    helpEyebrow: "Here to help",
    helpTitle: "Questions about your visit?",
    helpLead: "For travel, RSVP changes, or help on the day, contact your coordination desk.",
    call: "Call",
    whatsapp: "WhatsApp",
    privacy: "Your response stays with the families",
    privacyCopy: "Your RSVP helps us plan hospitality. Only the couple and their coordination team can see it; it is never used for marketing.",
    footer: "We look forward to celebrating together.",
    artworkCredit: "Artwork credits",
    photoCredit: "Photography credits",
    heroPhotoAlt: "The couple together at their engagement celebration",
    detailPhotoAlt: "Mehendi adorned hands, shown as decorative wedding photography",
    blessingFallback: "Blessings for the journey",
    backToTop: "Back to top"
  },
  hi: {
    skip: "निमंत्रण की जानकारी पर जाएँ",
    brand: "विवाह निमंत्रण",
    privateInvitation: "आपके लिए निजी निमंत्रण",
    announcement: "विवाह संबंधी जानकारी",
    schedule: "आपके समारोह",
    travel: "यात्रा",
    rsvp: "RSVP",
    help: "संपर्क",
    switchLanguage: "View in English",
    invitationLead: "परिवारों के साथ, हम आपको इनके विवाह में सादर आमंत्रित करते हैं",
    blessing: "स्नेह और आशीर्वाद के साथ",
    date: "विवाह की तिथि",
    place: "स्थान",
    forHousehold: "विशेष रूप से",
    privateNote: "यह लिंक आपके परिवार के लिए है। कृपया इसे निजी रखें।",
    eventCount: (count) => `आपके निमंत्रण में ${new Intl.NumberFormat("hi-IN-u-nu-deva").format(count)} समारोह`,
    rsvpNow: "अपना उत्तर दें",
    viewSchedule: "समारोह देखें",
    phoneFallback: "फ़ोन पर उत्तर देना चाहेंगे?",
    deadline: "कृपया इस तिथि तक RSVP दें",
    scheduleEyebrow: "यात्रा की योजना",
    scheduleTitle: "आपके समारोह",
    scheduleLead: "आपके परिवार के निमंत्रण में ये समारोह शामिल हैं। यात्रा से पहले पहुँचने का समय और स्थान देख लें।",
    arrival: "पहुँचने का समय",
    venue: "स्थल",
    address: "पता",
    attire: "पहनावा",
    entry: "पहुँचने पर",
    helpfulToKnow: "ध्यान देने योग्य",
    directions: "रास्ता देखें",
    calendar: "कैलेंडर में जोड़ें",
    calendarRetry: "फिर प्रयास करें",
    calendarError: "कैलेंडर फ़ाइल डाउनलोड नहीं हुई। कृपया फिर प्रयास करें।",
    preparingCalendar: "तैयार हो रहा है…",
    travelFallback: "यात्रा एवं ठहराव",
    update: "अतिथियों के लिए सूचना",
    helpEyebrow: "हम आपकी सहायता के लिए हैं",
    helpTitle: "यात्रा के बारे में प्रश्न हैं?",
    helpLead: "यात्रा, RSVP में बदलाव या समारोह के दिन सहायता के लिए समन्वय डेस्क से संपर्क करें।",
    call: "कॉल करें",
    whatsapp: "WhatsApp",
    privacy: "आपका उत्तर परिवारों तक सीमित है",
    privacyCopy: "आपका RSVP हमें आतिथ्य की योजना बनाने में मदद करता है। इसे केवल जोड़ा और उनकी समन्वय टीम देख सकती है; इसका उपयोग प्रचार के लिए नहीं होता।",
    footer: "हम साथ मिलकर उत्सव मनाने की प्रतीक्षा कर रहे हैं।",
    artworkCredit: "कलाकृति का श्रेय",
    photoCredit: "फ़ोटोग्राफ़ी का श्रेय",
    heroPhotoAlt: "सगाई समारोह में साथ खड़े वर और वधू",
    detailPhotoAlt: "मेहंदी लगे हाथों की सजावटी विवाह तस्वीर",
    blessingFallback: "मंगल यात्रा के लिए आशीर्वाद",
    backToTop: "ऊपर जाएँ"
  }
};

const artwork: Record<WeddingArtworkKey, { src: string; width: number; height: number }> = {
  "ganesha-basohli": { src: "ganesha-basohli.jpg", width: 660, height: 900 },
  "gaja-lakshmi": { src: "gaja-lakshmi.jpg", width: 900, height: 750 }
};

type IconName = "arrow" | "calendar" | "pin" | "phone" | "message" | "clock" | "plane" | "train" | "car" | "bed";

function Icon({ name, size = 19 }: { name: IconName; size?: number }) {
  const content: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></>,
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    phone: <path d="M5 3h4l1 4-2 2a15 15 0 0 0 7 7l2-2 4 1v4a2 2 0 0 1-2 2C10 21 3 14 3 5a2 2 0 0 1 2-2Z" />,
    message: <path d="M20 11.5a8.5 8.5 0 0 1-8.5 8.5 8.2 8.2 0 0 1-4-.9L3 20l1-4.3a8.5 8.5 0 1 1 16-4.2Z" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    plane: <><path d="m21 3-8 18-2.5-7.5L3 11l18-8Z" /><path d="m10.5 13.5 5-5" /></>,
    train: <><rect x="5" y="3" width="14" height="15" rx="3" /><path d="M5 10h14M8 21l2-3m6 0 2 3M9 14h.01M15 14h.01" /></>,
    car: <><path d="M4 11 6 5h12l2 6M4 17H2v-6h20v6h-2M4 17h16M5 17v3m14-3v3" /><circle cx="7" cy="14" r="1" /><circle cx="17" cy="14" r="1" /></>,
    bed: <><path d="M3 5v15M3 16h18v4M3 11h18v5M7 8h4v3H7z" /></>
  };

  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{content[name]}</svg>;
}

function CoupleNames({ names, locale }: { names: string; locale: Locale }) {
  const separator = locale === "hi" ? /\s+(?:एवं|और)\s+|\s*&\s*/u : /\s*&\s*|\s+and\s+/iu;
  const match = separator.exec(names);
  if (!match) return <>{names}</>;
  const firstName = names.slice(0, match.index).trim();
  const secondName = names.slice(match.index + match[0].length).trim();
  if (!firstName || !secondName) return <>{names}</>;
  return <><span>{firstName}</span><em>{match[0].trim()}</em><span>{secondName}</span></>;
}

function CalendarDownload({ event, locale, token, labels }: { event: WeddingEvent; locale: Locale; token: string; labels: InviteCopy }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [hasError, setHasError] = useState(false);

  async function download() {
    setHasError(false);
    setIsDownloading(true);
    try {
      const response = await fetch(`/api/calendar/${encodeURIComponent(event.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      if (!response.ok) throw new Error("Calendar download failed");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${event.id}.ics`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setHasError(true);
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <span className={styles.calendarAction}>
      <button type="button" onClick={download} disabled={isDownloading} aria-busy={isDownloading} aria-label={`${labels.calendar}: ${event.title[locale]}`}>
        <Icon name="calendar" size={17} />{isDownloading ? labels.preparingCalendar : hasError ? labels.calendarRetry : labels.calendar}
      </button>
      {hasError && <small role="alert">{labels.calendarError}</small>}
    </span>
  );
}

function EventCard({ event, index, locale, token, labels }: { event: WeddingEvent; index: number; locale: Locale; token: string; labels: InviteCopy }) {
  return (
    <article className={styles.eventCard}>
      <div className={styles.eventDate}>
        <span className={styles.eventNumber}>{String(index + 1).padStart(2, "0")}</span>
        <strong>{event.date[locale]}</strong>
        <span>{event.startTime[locale]}</span>
      </div>
      <div className={styles.eventBody}>
        <h3>{event.title[locale]}</h3>
        <div className={styles.eventFacts}>
          <div><Icon name="clock" size={18} /><span><small>{labels.arrival}</small><strong>{event.arrivalWindow[locale]}</strong></span></div>
          <div><Icon name="pin" size={18} /><span><small>{labels.venue}</small><strong>{event.venue[locale]}</strong></span></div>
        </div>
        <address><span className={styles.srOnly}>{labels.address}: </span>{event.address[locale]}</address>
        {event.entryNote[locale] && <p className={styles.entryNote}>{event.entryNote[locale]}</p>}
        {(event.dressCode[locale] || event.practicalNote[locale]) && <div className={styles.eventExtras}>
          {event.dressCode[locale] && <p><span>{labels.attire}</span>{event.dressCode[locale]}</p>}
          {event.practicalNote[locale] && <p><span>{labels.helpfulToKnow}</span>{event.practicalNote[locale]}</p>}
        </div>}
        <div className={styles.eventActions}>
          <a href={event.mapsUrl} target="_blank" rel="noopener noreferrer" aria-label={`${labels.directions}: ${event.venue[locale]}`}><Icon name="pin" size={17} />{labels.directions}<span aria-hidden="true">↗</span></a>
          <CalendarDownload event={event} locale={locale} token={token} labels={labels} />
        </div>
      </div>
    </article>
  );
}

function Blessings({ blessings, locale, labels, token }: { blessings: WeddingGuestContent["blessings"]; locale: Locale; labels: InviteCopy; token: string }) {
  if (!blessings) return null;

  return (
    <section className={styles.blessings} aria-labelledby="blessings-title">
      <div className={styles.sectionIntro}>
        {blessings.invocation && <p className={styles.invocation} lang="sa">{blessings.invocation}</p>}
        <p className={styles.eyebrow}>{blessings.kicker?.[locale] ?? labels.blessingFallback}</p>
        <h2 id="blessings-title">{blessings.title[locale]}</h2>
        {blessings.lead && <p>{blessings.lead[locale]}</p>}
      </div>
      <div className={styles.blessingGrid}>
        {blessings.cards.map((card, index) => {
          const image = artwork[card.artworkKey];
          return <article className={styles.blessingCard} key={`${card.artworkKey}-${index}`}>
            <figure>
              <img src={invitationMediaUrl(token, image.src)} alt={card.artworkAlt[locale]} width={image.width} height={image.height} loading="lazy" decoding="async" />
              <figcaption>{card.label[locale]}</figcaption>
            </figure>
            <div>
              <p className={styles.sanskrit} lang="sa">{card.sanskrit}</p>
              <p lang={locale}>{card.translation[locale]}</p>
              <cite>{card.citation}</cite>
            </div>
          </article>;
        })}
      </div>
    </section>
  );
}

export function WeddingInvite({ resolved }: { resolved: ResolvedInvitation }) {
  const { invitation, events, rsvp, entryPass, wedding } = resolved;
  const [locale, setLocale] = useState<Locale>(invitation.preferredLocale);
  const labels = copy[locale];
  const travel = wedding.guestContent?.travel;
  const hero = wedding.guestContent?.hero;
  const heroArtwork = hero?.artworkKey ? artwork[hero.artworkKey] : null;
  const coupleNames = wedding.couple.en.split(" & ");
  const initials = `${coupleNames[0]?.trim().charAt(0) ?? "W"}${coupleNames[1]?.trim().charAt(0) ?? "I"}`;

  useEffect(() => {
    const previousLanguage = document.documentElement.lang;
    document.documentElement.lang = locale;
    return () => { document.documentElement.lang = previousLanguage; };
  }, [locale]);

  return (
    <main className={`invite-page ${styles.page}`} lang={locale}>
      <a className={styles.skipLink} href="#invitation">{labels.skip}</a>
      <header className={styles.header} id="top">
        <a href="#top" className={styles.brand} aria-label={`${wedding.couple[locale]} · ${labels.brand}`}><span className={styles.monogram} aria-hidden="true">{initials.split("").join("&")}</span><span>{labels.brand}<small lang="hi">शुभ विवाह</small></span></a>
        <nav className={styles.headerNav} aria-label={locale === "hi" ? "मुख्य नेविगेशन" : "Main navigation"}>
          <a href="#schedule">{labels.schedule}</a>
          <a href="#rsvp">{labels.rsvp}</a>
          <a href="#help">{labels.help}</a>
        </nav>
        <button className={styles.languageButton} type="button" onClick={() => setLocale((current) => current === "en" ? "hi" : "en")} aria-label={labels.switchLanguage}>
          <span aria-hidden="true">{locale === "en" ? "हिन्दी" : "English"}</span>
        </button>
      </header>

      {wedding.announcement && <aside className={styles.announcement} aria-label={labels.announcement}>
        <span aria-hidden="true">✦</span><strong>{labels.announcement}</strong><p>{wedding.announcement[locale]}</p>
      </aside>}

      <section className={styles.hero} id="invitation" aria-labelledby="invitation-title">
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <div className={styles.heroIntro}>
              <p className={styles.invocation} lang="sa">{hero?.invocation ?? "॥ श्री गणेशाय नमः ॥"}</p>
              <p className={styles.eyebrow}>{labels.privateInvitation}</p>
              <p className={styles.heroLead}>{labels.invitationLead}</p>
              <h1 id="invitation-title" aria-label={wedding.couple[locale]}><CoupleNames names={wedding.couple[locale]} locale={locale} /></h1>
              <p className={styles.heroBlessing}>{labels.blessing}</p>
              {hero?.region && <p className={styles.heroRegion}>{hero.region[locale]}</p>}
            </div>
            <div className={styles.heroDetails}>
              <div className={styles.heroFacts}>
                <div><span>{labels.date}</span><strong>{wedding.date[locale]}</strong></div>
                <div><span>{labels.place}</span><strong>{wedding.location[locale]}</strong></div>
              </div>
              <WeddingCountdown target={wedding.weddingMoment} locale={locale} />
              <div className={styles.heroActions}>
                <a className={styles.primaryButton} href="#rsvp">{labels.rsvpNow}<Icon name="arrow" /></a>
                <a className={styles.secondaryButton} href="#schedule">{labels.viewSchedule}</a>
              </div>
              <div className={styles.heroHelp}>
                <span>{labels.phoneFallback}</span>
                <a href={invitation.coordinator.phoneHref} aria-label={`${labels.call} ${invitation.coordinator.name}: ${invitation.coordinator.phoneDisplay}`}><Icon name="phone" size={15} />{labels.call} {invitation.coordinator.name}</a>
                <a href={invitation.coordinator.whatsappHref} target="_blank" rel="noopener noreferrer" aria-label={`${labels.whatsapp}: ${invitation.coordinator.name}`}><Icon name="message" size={15} />{labels.whatsapp}</a>
              </div>
            </div>
          </div>
          <div className={styles.heroPhoto}>
            <picture>
              <source type="image/webp" srcSet={`${invitationMediaUrl(invitation.token, "engagement-couple-640.webp")} 640w, ${invitationMediaUrl(invitation.token, "engagement-couple-1067.webp")} 1067w`} sizes="(max-width: 760px) min(320px, calc(100vw - 38px)), (max-width: 1340px) 43vw, 520px" />
              <img src={invitationMediaUrl(invitation.token, "engagementCouplePic.jpg")} alt={labels.heroPhotoAlt} width={1067} height={1601} fetchPriority="high" decoding="async" />
            </picture>
          </div>
        </div>
      </section>

      <aside className={styles.inviteeBand} aria-label={`${labels.forHousehold} ${invitation.householdName[locale]}`}>
        <div className={styles.inviteeInner}>
          {heroArtwork && <div className={styles.heroArtwork}><img src={invitationMediaUrl(invitation.token, heroArtwork.src)} alt={hero?.artworkAlt?.[locale] ?? ""} width={heroArtwork.width} height={heroArtwork.height} loading="lazy" decoding="async" /></div>}
          <div className={styles.inviteeCopy}>
            <p className={styles.eyebrow}>{labels.forHousehold}</p>
            <h2>{invitation.householdName[locale]}</h2>
            <p>{labels.privateNote}</p>
          </div>
          <div className={styles.inviteeMeta}>
            <strong>{labels.eventCount(events.length)}</strong>
            <p><Icon name="calendar" size={15} />{labels.deadline} <b>{invitation.rsvpDeadline[locale]}</b></p>
          </div>
        </div>
      </aside>

      {wedding.guestContent?.update && <section className={styles.update} aria-labelledby="update-title"><span className={styles.updateMark} aria-hidden="true">!</span><div><p className={styles.eyebrow}>{labels.update}</p><h2 id="update-title">{wedding.guestContent.update.title[locale]}</h2><p>{wedding.guestContent.update.body[locale]}</p></div></section>}

      <section className={styles.schedule} id="schedule" aria-labelledby="schedule-title">
        <div className={styles.scheduleIntro}>
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>{labels.scheduleEyebrow}</p>
            <h2 id="schedule-title">{labels.scheduleTitle}</h2>
            <p>{labels.scheduleLead}</p>
          </div>
          <div className={styles.schedulePhoto}>
            <picture>
              <source type="image/webp" srcSet={`${invitationMediaUrl(invitation.token, "wedding-mehendi-960.webp")} 960w, ${invitationMediaUrl(invitation.token, "wedding-mehendi-1440.webp")} 1440w`} sizes="(max-width: 760px) 100vw, 420px" />
              <img src={invitationMediaUrl(invitation.token, "wedding-mehendi.jpg")} alt={labels.detailPhotoAlt} width={1920} height={1277} loading="lazy" decoding="async" />
            </picture>
          </div>
        </div>
        <div className={styles.eventList}>
          {events.map((event, index) => <EventCard event={event} index={index} locale={locale} token={invitation.token} labels={labels} key={event.id} />)}
        </div>
      </section>

      <section className={styles.rsvpSection} id="rsvp" aria-label={labels.rsvp}>
        <div className="rsvp-card-shell">
          <RSVPForm invitation={invitation} events={events} coupleName={wedding.couple[locale]} locale={locale} initialResponse={rsvp} initialEntryPass={entryPass ?? null} />
        </div>
      </section>

      {travel && <section className={styles.travel} id="travel" aria-labelledby="travel-title">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>{travel.eyebrow?.[locale] ?? labels.travelFallback}</p>
          <h2 id="travel-title">{travel.title[locale]}</h2>
          {travel.lead && <p>{travel.lead[locale]}</p>}
        </div>
        <div className={styles.travelGrid}>
          {travel.cards.map((card, index) => <article key={`${card.icon}-${index}`}><span className={styles.travelIcon}><Icon name={card.icon} /></span><h3>{card.title[locale]}</h3><p>{card.body[locale]}</p></article>)}
        </div>
      </section>}

      <Blessings blessings={wedding.guestContent?.blessings} locale={locale} labels={labels} token={invitation.token} />

      <section className={styles.helpSection} id="help" aria-labelledby="help-title">
        <div>
          <p className={styles.eyebrow}>{labels.helpEyebrow}</p>
          <h2 id="help-title">{travel?.help?.title[locale] ?? labels.helpTitle}</h2>
          <p>{travel?.help?.body[locale] ?? labels.helpLead}</p>
          <strong>{invitation.coordinator.name}</strong>
        </div>
        <div className={styles.helpActions}>
          <a href={invitation.coordinator.phoneHref} aria-label={`${labels.call} ${invitation.coordinator.name}: ${invitation.coordinator.phoneDisplay}`}><Icon name="phone" />{labels.call} {invitation.coordinator.phoneDisplay}</a>
          <a href={invitation.coordinator.whatsappHref} target="_blank" rel="noopener noreferrer" aria-label={`${labels.whatsapp}: ${invitation.coordinator.name}`}><Icon name="message" />{labels.whatsapp}<span aria-hidden="true">↗</span></a>
        </div>
      </section>

      <footer className={styles.footer}>
        <div><span className={styles.footerMonogram} aria-hidden="true">{initials.split("").join("&")}</span><p>{labels.footer}</p></div>
        <div><p><strong>{labels.privacy}</strong><br />{labels.privacyCopy}</p><a href="/images/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer">{labels.artworkCredit}</a><a href="/images/wedding/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer">{labels.photoCredit}</a><a href="#top">{labels.backToTop} ↑</a></div>
      </footer>

      <nav className={styles.mobileNav} aria-label={locale === "hi" ? "निमंत्रण नेविगेशन" : "Invitation navigation"}>
        <a href="#schedule"><Icon name="calendar" size={18} /><span>{labels.schedule}</span></a>
        <a href="#rsvp" className={styles.mobileRsvp}><Icon name="message" size={18} /><span>{labels.rsvp}</span></a>
        <a href="#help"><Icon name="phone" size={18} /><span>{labels.help}</span></a>
      </nav>
    </main>
  );
}
