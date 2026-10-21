"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { EntryPass } from "@/components/entry-pass";
import { parseEntryPassPayload } from "@/lib/entry-pass";
import { contactNumberSchema, defaultAttendances, validateRSVPForInvitation } from "@/lib/rsvp";
import type { AttendanceInput, EntryPass as EntryPassRecord, Invitation, Locale, RSVPInput, RSVPRecord, RSVPStatus, WeddingEvent } from "@/lib/types";

type FormCopy = {
  eyebrow: string;
  title: string;
  intro: string;
  respondent: string;
  respondentHelp: string;
  currentPlan: string;
  attending: string;
  attendingDescription: string;
  declined: string;
  declinedDescription: string;
  confirming: string;
  confirmingDescription: string;
  eventQuestion: string;
  eventRequired: string;
  yes: string;
  no: string;
  adults: string;
  children: string;
  limit: (adults: number, children: number) => string;
  comfort: string;
  comfortPlaceholder: string;
  medicalNote: string;
  declineMessage: (coupleName: string) => string;
  declineMessagePlaceholder: string;
  declineMessageHelp: string;
  updateHelp: (date: string) => string;
  submit: string;
  updating: string;
  saving: string;
  errorName: string;
  errorPlan: string;
  errorEvent: string;
  errorUnanswered: string;
  errorGeneric: string;
  successTitle: string;
  successAttending: string;
  successDeclined: string;
  successConfirming: string;
  successHelp: (date: string) => string;
  edit: string;
  call: string;
  summary: string;
  selectedEvents: string;
  selectedCount: (count: number) => string;
  guestCount: (adults: number, children: number) => string;
  decrease: (label: string) => string;
  increase: (label: string) => string;
};

const formCopy: Record<Locale, FormCopy> = {
  en: {
    eyebrow: "RSVP",
    title: "Tell us your family’s plan",
    intro: "One family member may reply for everyone on this invitation.",
    respondent: "Who is completing this RSVP?",
    respondentHelp: "We will use this only if we need to clarify your response.",
    currentPlan: "What is your family’s current plan?",
    attending: "We plan to attend",
    attendingDescription: "Choose the celebrations you will join below.",
    declined: "We will be unable to attend",
    declinedDescription: "Thank you for letting us know.",
    confirming: "We will confirm soon",
    confirmingDescription: "We will follow up before the RSVP deadline.",
    eventQuestion: "Will your family attend this celebration?",
    eventRequired: "Please choose yes or no for this celebration.",
    yes: "Yes, we’ll be there",
    no: "Not this one",
    adults: "Adults",
    children: "Children",
    limit: (adults, children) => `This invitation includes up to ${adults} adult${adults === 1 ? "" : "s"} and ${children} child${children === 1 ? "" : "ren"}.`,
    comfort: "Anything we should know to make your visit comfortable?",
    comfortPlaceholder: "Dietary, accessibility, or practical assistance (optional)",
    medicalNote: "Please share only what the hospitality team needs—no detailed medical information.",
    declineMessage: (coupleName) => `Would you like to send ${coupleName} a message?`,
    declineMessagePlaceholder: "Your good wishes, or anything you’d like us to know (optional)",
    declineMessageHelp: "No explanation is needed—we’re grateful you let us know.",
    updateHelp: (date) => `You may update this response until ${date}.`,
    submit: "Submit RSVP",
    updating: "Update RSVP",
    saving: "Saving your RSVP…",
    errorName: "Please tell us who is completing this RSVP.",
    errorPlan: "Please choose your family’s current plan.",
    errorEvent: "Please select at least one celebration your family plans to attend.",
    errorUnanswered: "Please answer yes or no for every celebration so the families can plan seating and meals.",
    errorGeneric: "We could not save your response. Please try again or contact the coordination desk.",
    successTitle: "We’ve received your response",
    successAttending: "We’re looking forward to celebrating with you.",
    successDeclined: "We’ll miss you. Thank you for letting us know.",
    successConfirming: "We’ve marked your response as ‘will confirm’. Please update it before the deadline.",
    successHelp: (date) => `Need to make a change? You can update your RSVP until ${date}.`,
    edit: "Edit response",
    call: "Call",
    summary: "Your response",
    selectedEvents: "Celebrations selected",
    selectedCount: (count) => `${count} ${count === 1 ? "celebration" : "celebrations"} selected`,
    guestCount: (adults, children) => `${adults} ${adults === 1 ? "adult" : "adults"} · ${children} ${children === 1 ? "child" : "children"}`,
    decrease: (label) => `Decrease ${label}`,
    increase: (label) => `Increase ${label}`
  },
  hi: {
    eyebrow: "RSVP",
    title: "अपने परिवार की योजना बताएं",
    intro: "परिवार का एक सदस्य इस निमंत्रण में शामिल सभी लोगों की ओर से जवाब दे सकता है।",
    respondent: "यह RSVP कौन भर रहा है?",
    respondentHelp: "जरूरत पड़ने पर आपके उत्तर की पुष्टि के लिए ही इसका उपयोग किया जाएगा।",
    currentPlan: "आपके परिवार की वर्तमान योजना क्या है?",
    attending: "हम शामिल होने की योजना बना रहे हैं",
    attendingDescription: "नीचे वे समारोह चुनें जिनमें आप शामिल होंगे।",
    declined: "क्षमा करें, हम शामिल नहीं हो पाएँगे",
    declinedDescription: "हमें बताने के लिए धन्यवाद।",
    confirming: "हम जल्द पुष्टि करेंगे",
    confirmingDescription: "RSVP की अंतिम तिथि से पहले हम आपसे संपर्क करेंगे।",
    eventQuestion: "क्या आपका परिवार इस समारोह में शामिल होगा?",
    eventRequired: "कृपया इस समारोह के लिए हाँ या नहीं चुनें।",
    yes: "हाँ, हम आएंगे",
    no: "इस समारोह में नहीं",
    adults: "वयस्क",
    children: "बच्चे",
    limit: (adults, children) => `इस निमंत्रण में अधिकतम ${adults} वयस्क और ${children} बच्चे शामिल हैं।`,
    comfort: "आपकी सुविधा के लिए हमें कुछ जानना चाहिए?",
    comfortPlaceholder: "खान-पान, सुलभता या व्यावहारिक सहायता (वैकल्पिक)",
    medicalNote: "कृपया केवल वही जानकारी दें जिसकी आतिथ्य टीम को आवश्यकता है—विस्तृत चिकित्सा जानकारी न लिखें।",
    declineMessage: (coupleName) => `क्या आप ${coupleName} के लिए कोई संदेश छोड़ना चाहेंगे?`,
    declineMessagePlaceholder: "अपनी शुभकामनाएँ या कोई बात जो आप हमें बताना चाहें (वैकल्पिक)",
    declineMessageHelp: "कारण बताने की कोई आवश्यकता नहीं है—हमें सूचित करने के लिए धन्यवाद।",
    updateHelp: (date) => `आप ${date} तक यह उत्तर बदल सकते हैं।`,
    submit: "RSVP भेजें",
    updating: "RSVP संशोधित करें",
    saving: "आपका RSVP सुरक्षित किया जा रहा है…",
    errorName: "कृपया बताएं कि यह RSVP कौन भर रहा है।",
    errorPlan: "कृपया अपने परिवार की वर्तमान योजना चुनें।",
    errorEvent: "कृपया कम-से-कम एक समारोह चुनें जिसमें आपका परिवार शामिल होगा।",
    errorUnanswered: "कृपया हर समारोह के लिए हाँ या नहीं चुनें, ताकि परिवार बैठक और भोजन की व्यवस्था कर सकें।",
    errorGeneric: "आपका उत्तर सुरक्षित नहीं हो सका। कृपया फिर प्रयास करें या समन्वय डेस्क से संपर्क करें।",
    successTitle: "हमें आपका उत्तर मिल गया है",
    successAttending: "हम आपके साथ उत्सव मनाने की प्रतीक्षा कर रहे हैं।",
    successDeclined: "आपकी कमी महसूस होगी। हमें बताने के लिए धन्यवाद।",
    successConfirming: "हमने आपका उत्तर ‘पुष्टि करेंगे’ के रूप में दर्ज कर लिया है। कृपया अंतिम तिथि से पहले अपडेट करें।",
    successHelp: (date) => `कुछ बदलना है? आप ${date} तक अपना RSVP संशोधित कर सकते हैं।`,
    edit: "उत्तर संशोधित करें",
    call: "कॉल करें",
    summary: "आपका उत्तर",
    selectedEvents: "चुने हुए समारोह",
    selectedCount: (count) => `${new Intl.NumberFormat("hi-IN-u-nu-deva", { useGrouping: false }).format(count)} समारोह चुने गए`,
    guestCount: (adults, children) => `${new Intl.NumberFormat("hi-IN-u-nu-deva", { useGrouping: false }).format(adults)} वयस्क · ${new Intl.NumberFormat("hi-IN-u-nu-deva", { useGrouping: false }).format(children)} ${children === 1 ? "बच्चा" : "बच्चे"}`,
    decrease: (label) => `${label} की संख्या घटाएं`,
    increase: (label) => `${label} की संख्या बढ़ाएं`
  }
};

interface RSVPFormProps {
  invitation: Invitation;
  events: WeddingEvent[];
  coupleName: string;
  locale: Locale;
  initialResponse?: RSVPRecord | null;
  initialEntryPass?: EntryPassRecord | null;
}

function readEntryPass(value: unknown): EntryPassRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const entryPass = "entryPass" in value ? value.entryPass : null;
  if (typeof entryPass !== "object" || entryPass === null) return null;

  const { qrPayload, state, issuedAt, checkedInAt } = entryPass as Record<string, unknown>;
  if (
    typeof qrPayload !== "string" ||
    parseEntryPassPayload(qrPayload) === null ||
    (state !== "ready" && state !== "checked-in") ||
    typeof issuedAt !== "string" ||
    (typeof checkedInAt !== "string" && checkedInAt !== null)
  ) return null;

  return { qrPayload, state, issuedAt, checkedInAt };
}

/** API errors are intentionally short, guest-safe messages. Keep the UI from
 * replacing a useful response such as a closed RSVP window with a generic
 * network failure, while still bounding any unexpected response body. */
function readResponseError(value: unknown) {
  if (typeof value !== "object" || value === null || !("error" in value)) return null;
  const error = value.error;
  return typeof error === "string" && error.trim() ? error.trim().slice(0, 360) : null;
}

function createInitialState(invitation: Invitation, existingResponse?: RSVPRecord | null): Omit<RSVPInput, "token"> {
  if (existingResponse) {
    const attendanceByEvent = new Map(existingResponse.attendances.map((attendance) => [attendance.eventId, attendance]));
    return {
      respondentName: existingResponse.respondentName,
      contactNumber: existingResponse.contactNumber ?? "",
      status: existingResponse.status,
      attendances: defaultAttendances(invitation).map((attendance) => attendanceByEvent.get(attendance.eventId) ?? attendance),
      comfortNote: existingResponse.status === "attending" ? existingResponse.comfortNote ?? "" : "",
      declineMessage: existingResponse.status === "declined" ? existingResponse.declineMessage ?? "" : ""
    };
  }

  return {
    respondentName: "",
    contactNumber: invitation.contactNumber ?? "",
    status: "attending",
    attendances: defaultAttendances(invitation),
    comfortNote: "",
    declineMessage: ""
  };
}

function Stepper({
  label,
  value,
  limit,
  minimum = 0,
  decreaseLabel,
  increaseLabel,
  onChange
}: {
  label: string;
  value: number;
  limit: number;
  minimum?: number;
  decreaseLabel: string;
  increaseLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="stepper">
      <span>{label}</span>
      <div className="stepper-controls" aria-label={label}>
        <button type="button" aria-label={decreaseLabel} onClick={() => onChange(Math.max(minimum, value - 1))} disabled={value <= minimum}>
          −
        </button>
        <output aria-live="polite">{value}</output>
        <button type="button" aria-label={increaseLabel} onClick={() => onChange(Math.min(limit, value + 1))} disabled={value >= limit}>
          +
        </button>
      </div>
    </div>
  );
}

export function RSVPForm({ invitation, events, coupleName, locale, initialResponse = null, initialEntryPass = null }: RSVPFormProps) {
  const copy = formCopy[locale];
  const isPublic = invitation.kind === "public";
  const [personalToken, setPersonalToken] = useState<string | null>(null);
  const [personalUrl, setPersonalUrl] = useState("");
  const [linkNotice, setLinkNotice] = useState("");
  const [form, setForm] = useState<Omit<RSVPInput, "token">>(() => createInitialState(invitation, initialResponse));
  // A new household must choose a plan deliberately. Keeping the underlying
  // payload shape unchanged lets the existing API validate the same contract.
  const [selectedStatus, setSelectedStatus] = useState<RSVPStatus | null>(initialResponse?.status ?? null);
  // Reloading an eligible attending RSVP should restore the same opaque pass,
  // while all other existing responses remain directly editable in the form.
  const [submitted, setSubmitted] = useState<RSVPRecord | null>(() => initialResponse?.status === "attending" && initialEntryPass ? initialResponse : null);
  const [entryPass, setEntryPass] = useState<EntryPassRecord | null>(() => initialResponse?.status === "attending" ? initialEntryPass : null);
  const [hasExistingResponse, setHasExistingResponse] = useState(Boolean(initialResponse));
  // Guests must make an explicit yes/no choice per celebration. A returning
  // household already answered every one, so its saved answers stay visible.
  const [answeredEvents, setAnsweredEvents] = useState<ReadonlySet<string>>(
    () => new Set(initialResponse ? initialResponse.attendances.map((attendance) => attendance.eventId) : [])
  );
  const [error, setError] = useState<{ kind: "name" | "plan" | "unanswered" | "event" | "custom"; message?: string } | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const contactInputRef = useRef<HTMLInputElement>(null);
  const planFieldsetRef = useRef<HTMLFieldSetElement>(null);
  const eventListRef = useRef<HTMLDivElement>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusSuccessAfterSubmitRef = useRef(false);
  const errorMessage = error?.kind === "name"
    ? copy.errorName
    : error?.kind === "plan"
      ? copy.errorPlan
      : error?.kind === "unanswered"
        ? copy.errorUnanswered
        : error?.kind === "event"
          ? copy.errorEvent
          : error?.message ?? null;

  // Confirming an RSVP swaps the whole card, so move the reading position to
  // the confirmation instead of leaving it on a control that no longer exists.
  useEffect(() => {
    if (!submitted || !focusSuccessAfterSubmitRef.current) return;

    const heading = successHeadingRef.current;
    if (!heading) return;

    focusSuccessAfterSubmitRef.current = false;

    const frame = window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      heading.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
      heading.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [submitted]);

  const selectedEvents = useMemo(
    () => form.attendances.filter((attendance) => attendance.attending).map((attendance) => events.find((event) => event.id === attendance.eventId)).filter(Boolean) as WeddingEvent[],
    [events, form.attendances]
  );

  const updateAttendance = (eventId: string, updates: Partial<AttendanceInput>) => {
    setError(null);
    if (updates.attending !== undefined) {
      setAnsweredEvents((current) => current.has(eventId) ? current : new Set(current).add(eventId));
    }
    setForm((current) => ({
      ...current,
      attendances: current.attendances.map((attendance) => {
        if (attendance.eventId !== eventId) return attendance;
        const next = { ...attendance, ...updates };
        if (updates.attending === true && next.adults + next.children === 0) {
          const limit = invitation.eventLimits[eventId];
          next.adults = limit?.adults ? 1 : 0;
          next.children = next.adults === 0 && limit?.children ? 1 : 0;
        }
        if (updates.attending === false) {
          next.adults = 0;
          next.children = 0;
        }
        return next;
      })
    }));
  };

  const setStatus = (status: RSVPStatus) => {
    setError(null);
    setSelectedStatus(status);
    if (status !== "attending") setAnsweredEvents(new Set());
    setForm((current) => ({
      ...current,
      status,
      comfortNote: status === "attending" ? current.comfortNote : "",
      declineMessage: status === "declined" ? current.declineMessage : "",
      attendances:
        status === "attending"
          ? current.attendances
          : current.attendances.map((attendance) => ({ ...attendance, attending: false, adults: 0, children: 0 }))
    }));
  };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setShowValidation(true);

    if (form.respondentName.trim().length < 2) {
      setError({ kind: "name" });
      nameInputRef.current?.focus();
      nameInputRef.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      return;
    }

    if (!selectedStatus) {
      setError({ kind: "plan" });
      planFieldsetRef.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      planFieldsetRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
      return;
    }

    if (!contactNumberSchema.safeParse(form.contactNumber ?? "").success || (isPublic && !form.contactNumber?.trim())) {
      setError({ kind: "custom", message: locale === "hi" ? "कृपया 7 से 15 अंकों का संपर्क नंबर लिखें।" : "Please enter a contact number with 7 to 15 digits." });
      contactInputRef.current?.focus();
      return;
    }

    if (form.status === "attending" && form.attendances.some((attendance) => !answeredEvents.has(attendance.eventId))) {
      setError({ kind: "unanswered" });
      const unansweredEvent = eventListRef.current?.querySelector<HTMLElement>(".event-response.is-unanswered");
      unansweredEvent?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      unansweredEvent?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
      return;
    }

    if (form.status === "attending" && !form.attendances.some((attendance) => attendance.attending)) {
      setError({ kind: "event" });
      eventListRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      return;
    }

    const payload: RSVPInput = {
      ...form,
      token: personalToken ?? invitation.token,
      respondentName: form.respondentName.trim(),
      contactNumber: form.contactNumber?.trim() ?? "",
      comfortNote: form.status === "attending" ? form.comfortNote?.trim() || undefined : undefined,
      declineMessage: form.status === "declined" ? form.declineMessage?.trim() || undefined : undefined
    };
    const validation = validateRSVPForInvitation(payload, { invitation, events });
    if (!validation.ok) {
      setError({ kind: "custom", message: validation.message });
      return;
    }

    setIsSaving(true);
    try {
      const registering = isPublic && !personalToken;
      const response = await fetch(registering ? "/api/public/rsvp" : "/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registering ? {
          side: invitation.side ?? "groom", respondentName: payload.respondentName,
          contactNumber: payload.contactNumber, status: payload.status, attendances: payload.attendances,
          comfortNote: payload.comfortNote, declineMessage: payload.declineMessage
        } : payload)
      });
      if (!response.ok) {
        const responseBody: unknown = await response.json().catch(() => null);
        throw new Error(readResponseError(responseBody) ?? copy.errorGeneric);
      }

      const responseBody: unknown = await response.json().catch(() => null);
      if (registering) {
        if (!responseBody || typeof responseBody !== "object" || !("token" in responseBody) || typeof responseBody.token !== "string" || !("invitationUrl" in responseBody) || typeof responseBody.invitationUrl !== "string") {
          throw new Error(copy.errorGeneric);
        }
        setPersonalToken(responseBody.token);
        setPersonalUrl(responseBody.invitationUrl);
        payload.token = responseBody.token;
      }
      const updatedAt = typeof responseBody === "object" && responseBody !== null && "updatedAt" in responseBody && typeof responseBody.updatedAt === "string"
        ? responseBody.updatedAt
        : new Date().toISOString();
      const record: RSVPRecord = { ...payload, updatedAt };
      // Never manufacture a pass from the invitation token. The API returns an
      // opaque, validated entry credential only after an attending RSVP.
      setEntryPass(payload.status === "attending" ? readEntryPass(responseBody) : null);
      focusSuccessAfterSubmitRef.current = true;
      setSubmitted(record);
      setHasExistingResponse(true);
    } catch (reason) {
      setError({ kind: "custom", message: reason instanceof Error && reason.message ? reason.message : copy.errorGeneric });
    } finally {
      setIsSaving(false);
    }
  }

  if (submitted) {
    const confirmation =
      submitted.status === "attending"
        ? copy.successAttending
        : submitted.status === "declined"
          ? copy.successDeclined
          : copy.successConfirming;
    const attendedEvents = submitted.attendances.filter((attendance) => attendance.attending);
    const attendedEventNames = attendedEvents.flatMap((attendance) => {
      const event = events.find((item) => item.id === attendance.eventId);
      return event ? [event.title[locale]] : [];
    });

    return (
      <section className="rsvp-success" aria-live="polite">
        <div className="success-check" aria-hidden="true">✓</div>
        <p className="section-kicker">{copy.eyebrow}</p>
        <h2 ref={successHeadingRef} tabIndex={-1}>{copy.successTitle}</h2>
        <p className="success-lede">{confirmation}</p>
        {submitted.status === "attending" && entryPass && attendedEventNames.length > 0 && (
          <EntryPass
            pass={entryPass}
            coupleName={coupleName}
            householdName={isPublic ? submitted.respondentName : invitation.householdName[locale]}
            eventNames={attendedEventNames}
            locale={locale}
          />
        )}
        {personalUrl && <div className="response-summary personal-invitation-link">
          <strong>{locale === "hi" ? "अपना निजी RSVP लिंक सुरक्षित रखें" : "Save your personal RSVP link"}</strong>
          <p>{locale === "hi" ? "अपना उत्तर देखने या बदलने के लिए इस लिंक का उपयोग करें। इसे केवल अपने परिवार में साझा करें।" : "Use this link to return to your response and make changes. Share it only with your household."}</p>
          <label className="field-label"><span className="sr-only">{locale === "hi" ? "निजी RSVP लिंक" : "Personal RSVP link"}</span><input readOnly value={personalUrl} onFocus={(event) => event.target.select()} /></label>
          <div className="success-actions"><button type="button" className="button button-secondary" onClick={async () => {
            try { await navigator.clipboard.writeText(personalUrl); setLinkNotice(locale === "hi" ? "लिंक कॉपी हो गया।" : "Link copied."); }
            catch { setLinkNotice(locale === "hi" ? "ऊपर दिए लिंक को चुनकर कॉपी करें।" : "Select and copy the link above."); }
          }}>{locale === "hi" ? "लिंक कॉपी करें" : "Copy link"}</button><a className="text-link" href={personalUrl}>{locale === "hi" ? "निजी निमंत्रण खोलें" : "Open personal invitation"}</a></div>
          {linkNotice && <p role="status">{linkNotice}</p>}
        </div>}
        {attendedEvents.length > 0 && (
          <div className="response-summary">
            <span>{copy.selectedEvents}</span>
            <ul>
              {attendedEvents.map((attendance) => {
                const event = events.find((item) => item.id === attendance.eventId);
                if (!event) return null;
                return (
                  <li key={attendance.eventId}>
                    <strong>{event.title[locale]}</strong>
                    <span>{copy.guestCount(attendance.adults, attendance.children)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <p className="muted-copy">{copy.successHelp(invitation.rsvpDeadline[locale])}</p>
        <div className="success-actions">
          <button type="button" className="button button-secondary" onClick={() => {
            setSubmitted(null);
            setEntryPass(null);
          }}>{copy.edit}</button>
          <a
            className="text-link"
            href={invitation.coordinator.phoneHref}
            aria-label={locale === "hi"
              ? `${invitation.coordinator.name} को ${invitation.coordinator.phoneDisplay} पर कॉल करें`
              : `Call ${invitation.coordinator.name} at ${invitation.coordinator.phoneDisplay}`}
          >{copy.call} {invitation.coordinator.name} <span aria-hidden="true">↗</span></a>
        </div>
      </section>
    );
  }

  return (
    <form className="rsvp-form" onSubmit={submit} noValidate>
      <div className="rsvp-heading">
        <p className="section-kicker">{copy.eyebrow}</p>
        <h2>{copy.title}</h2>
        <p>{isPublic ? locale === "hi" ? "अपने परिवार की ओर से जवाब दें। जवाब देने के बाद आपको अपना निजी RSVP लिंक मिलेगा।" : "Reply for your household. After submitting, you’ll receive a personal link to view or update your RSVP." : copy.intro}</p>
      </div>

      <label className="field-label">
        <span>{copy.respondent}</span>
        <input
          ref={nameInputRef}
          value={form.respondentName}
          onChange={(event) => {
            setError(null);
            setForm((current) => ({ ...current, respondentName: event.target.value }));
          }}
          placeholder={locale === "hi" ? "अपना नाम लिखें" : "Enter your name"}
          autoComplete="name"
          maxLength={100}
          aria-invalid={showValidation && form.respondentName.trim().length < 2 || undefined}
          aria-describedby={showValidation && form.respondentName.trim().length < 2 ? "rsvp-name-help rsvp-name-error" : "rsvp-name-help"}
        />
        <small id="rsvp-name-help">{copy.respondentHelp}</small>
        {showValidation && form.respondentName.trim().length < 2 && <small className="field-error" id="rsvp-name-error">{copy.errorName}</small>}
      </label>

      <label className="field-label">
        <span>{locale === "hi" ? "संपर्क नंबर" : "Contact number"}{!isPublic && (locale === "hi" ? " (वैकल्पिक)" : " (optional)")}</span>
        <input ref={contactInputRef} type="tel" autoComplete="tel" inputMode="tel" maxLength={40} value={form.contactNumber ?? ""} required={isPublic} onChange={(event) => { setError(null); setForm((current) => ({ ...current, contactNumber: event.target.value })); }} placeholder={locale === "hi" ? "देश कोड सहित नंबर" : "Number with country code"} aria-describedby="rsvp-contact-help" />
        <small id="rsvp-contact-help">{locale === "hi" ? "जरूरत पड़ने पर RSVP के बारे में संपर्क करने के लिए।" : "So the coordination team can contact you about your RSVP."}</small>
      </label>

      <fieldset className={`plan-fieldset ${showValidation && !selectedStatus ? "has-validation-error" : ""}`} ref={planFieldsetRef} aria-describedby={showValidation && !selectedStatus ? "rsvp-plan-error" : undefined}>
        <legend>{copy.currentPlan}</legend>
        <div className="plan-options">
          {([
            ["attending", copy.attending, copy.attendingDescription],
            ["declined", copy.declined, copy.declinedDescription],
            ["confirming", copy.confirming, copy.confirmingDescription]
          ] as const).map(([status, title, description]) => (
            <label className={`plan-option ${selectedStatus === status ? "is-selected" : ""}`} key={status}>
              <input
                className="choice-input"
                type="radio"
                name="rsvp-status"
                value={status}
                checked={selectedStatus === status}
                onChange={() => setStatus(status)}
              />
              <span className="radio-dot" aria-hidden="true" />
              <span><strong>{title}</strong><small>{description}</small></span>
            </label>
          ))}
        </div>
        {showValidation && !selectedStatus && <p className="field-error" id="rsvp-plan-error">{copy.errorPlan}</p>}
      </fieldset>

      {selectedStatus === "attending" && (
        <div className="event-response-list" ref={eventListRef}>
          {events.map((event) => {
            const attendance = form.attendances.find((item) => item.eventId === event.id);
            const limit = invitation.eventLimits[event.id];
            if (!attendance || !limit) return null;
            const isAnswered = answeredEvents.has(event.id);
            const isAttending = isAnswered && attendance.attending;
            const isDeclined = isAnswered && !attendance.attending;
            return (
              <article className={`event-response ${isAttending ? "is-attending" : ""} ${isAnswered ? "" : "is-unanswered"} ${showValidation && !isAnswered ? "has-validation-error" : ""}`} key={event.id}>
                <div className="event-response-topline">
                  <div>
                    <p>{event.date[locale]}</p>
                    <h3>{event.title[locale]}</h3>
                  </div>
                  <span className="event-time">{event.startTime[locale]}</span>
                </div>
                <fieldset className="event-answer-fieldset">
                  <legend className="event-question">{copy.eventQuestion}</legend>
                  <div className="event-answer-buttons">
                    <label className={`event-answer ${isAttending ? "is-selected" : ""}`}>
                      <input
                        className="choice-input"
                        type="radio"
                        name={`event-${event.id}`}
                        checked={isAttending}
                        aria-invalid={showValidation && !isAnswered || undefined}
                        aria-describedby={showValidation && !isAnswered ? `event-${event.id}-error` : undefined}
                        onChange={() => updateAttendance(event.id, { attending: true })}
                      />
                      <span>{copy.yes}</span>
                    </label>
                    <label className={`event-answer ${isDeclined ? "is-selected" : ""}`}>
                      <input
                        className="choice-input"
                        type="radio"
                        name={`event-${event.id}`}
                        checked={isDeclined}
                        aria-invalid={showValidation && !isAnswered || undefined}
                        aria-describedby={showValidation && !isAnswered ? `event-${event.id}-error` : undefined}
                        onChange={() => updateAttendance(event.id, { attending: false })}
                      />
                      <span>{copy.no}</span>
                    </label>
                  </div>
                </fieldset>
                {showValidation && !isAnswered && <p className="event-inline-error" id={`event-${event.id}-error`}>{copy.eventRequired}</p>}
                {isAttending && (
                  <div className="count-panel">
                    <p>{copy.limit(limit.adults, limit.children)}</p>
                    <div className="steppers">
                      <Stepper label={copy.adults} value={attendance.adults} limit={limit.adults} minimum={attendance.children === 0 ? 1 : 0} decreaseLabel={copy.decrease(`${copy.adults} · ${event.title[locale]}`)} increaseLabel={copy.increase(`${copy.adults} · ${event.title[locale]}`)} onChange={(adults) => updateAttendance(event.id, { adults })} />
                      <Stepper label={copy.children} value={attendance.children} limit={limit.children} minimum={attendance.adults === 0 ? 1 : 0} decreaseLabel={copy.decrease(`${copy.children} · ${event.title[locale]}`)} increaseLabel={copy.increase(`${copy.children} · ${event.title[locale]}`)} onChange={(children) => updateAttendance(event.id, { children })} />
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {selectedStatus === "attending" && error?.kind === "event" && <p className="field-error">{copy.errorEvent}</p>}

      {selectedStatus === "attending" && selectedEvents.length > 0 && (
        <div className="form-selection-note">
          <span aria-hidden="true">✦</span>
          <span>{copy.selectedCount(selectedEvents.length)}</span>
        </div>
      )}

      {selectedStatus && selectedStatus !== "confirming" && (
        <label className="field-label support-field">
          <span>{selectedStatus === "declined" ? copy.declineMessage(coupleName) : copy.comfort} <em>{locale === "hi" ? "वैकल्पिक" : "Optional"}</em></span>
          <textarea
            key={`rsvp-note-${selectedStatus}`}
            value={selectedStatus === "declined" ? form.declineMessage ?? "" : form.comfortNote ?? ""}
            onChange={(event) => {
              setError(null);
              setForm((current) => current.status === "declined"
                ? { ...current, declineMessage: event.target.value }
                : { ...current, comfortNote: event.target.value }
              );
            }}
            placeholder={selectedStatus === "declined" ? copy.declineMessagePlaceholder : copy.comfortPlaceholder}
            maxLength={500}
            rows={3}
          />
          <small>{selectedStatus === "declined" ? copy.declineMessageHelp : copy.medicalNote}</small>
        </label>
      )}

      <div className="rsvp-submit-row">
        <div>
          <p>{copy.updateHelp(invitation.rsvpDeadline[locale])}</p>
          {hasExistingResponse && <small>{locale === "hi" ? "आपकी पिछली प्रतिक्रिया लोड हो गई है।" : "Your previous response has been loaded."}</small>}
        </div>
        <button className="button button-primary" type="submit" disabled={isSaving}>
          {isSaving ? copy.saving : hasExistingResponse ? copy.updating : copy.submit}
          {!isSaving && <span aria-hidden="true">→</span>}
        </button>
      </div>
      {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
    </form>
  );
}
