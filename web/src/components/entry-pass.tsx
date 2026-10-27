"use client";

import { useEffect, useRef, useState } from "react";
import * as QRCode from "qrcode";

import { parseEntryPassPayload } from "@/lib/entry-pass";
import type { EntryPass as EntryPassRecord, Locale } from "@/lib/types";

/**
 * This intentionally has no invitation URL, household token, name, or contact
 * data in it. The server issues the opaque credential after it has accepted an
 * attending RSVP, and the scanner validates that credential independently.
 */
export type GuestEntryPass = EntryPassRecord;

type EntryPassCopy = {
  heading: (householdName: string) => string;
  wedding: (coupleName: string) => string;
  ready: string;
  checkedIn: string;
  readyLead: string;
  checkedInLead: string;
  events: string;
  privacy: string;
  qrLoading: string;
  qrAlt: string;
  qrError: string;
  print: string;
  copy: string;
  copied: string;
  copyFailed: string;
  manual: string;
  hideManual: string;
  manualLabel: string;
};

const copy: Record<Locale, EntryPassCopy> = {
  en: {
    heading: (householdName) => `Entry pass for ${householdName}`,
    wedding: (coupleName) => `${coupleName}’s Wedding`,
    ready: "Your pass is ready",
    checkedIn: "Checked in",
    readyLead: "Show this QR code at the welcome desk when you arrive.",
    checkedInLead: "Your family is checked in. We’re so glad you’re here.",
    events: "Your celebrations",
    privacy: "This private pass is for the family members on your invitation. Please keep it with you.",
    qrLoading: "Preparing your entry QR code…",
    qrAlt: "Your entry QR code. Show it at the welcome desk when you arrive.",
    qrError: "We couldn’t display your QR code. Show the check-in code below at the welcome desk instead.",
    print: "Print pass",
    copy: "Copy check-in code",
    copied: "Code copied",
    copyFailed: "We couldn’t copy the code. You can show the code below at the welcome desk.",
    manual: "Show check-in code",
    hideManual: "Hide check-in code",
    manualLabel: "Check-in code"
  },
  hi: {
    heading: (householdName) => `${householdName} के लिए प्रवेश पास`,
    wedding: (coupleName) => `${coupleName} का विवाह`,
    ready: "आपका पास तैयार है",
    checkedIn: "चेक-इन हो गया",
    readyLead: "पहुँचने पर स्वागत डेस्क पर यह QR कोड दिखाएँ।",
    checkedInLead: "आपके परिवार का चेक-इन हो चुका है। हमें खुशी है कि आप हमारे साथ हैं।",
    events: "आपका कार्यक्रम",
    privacy: "यह निजी प्रवेश पास आपके निमंत्रण में शामिल सदस्यों के लिए है। कृपया इसे अपने पास रखें।",
    qrLoading: "प्रवेश के लिए आपका QR कोड तैयार किया जा रहा है…",
    qrAlt: "प्रवेश का QR कोड। पहुँचने पर इसे स्वागत डेस्क पर दिखाएँ।",
    qrError: "QR कोड तैयार नहीं हो सका। आप नीचे दिया चेक-इन कोड स्वागत डेस्क पर दिखा सकते हैं।",
    print: "पास प्रिंट करें",
    copy: "चेक-इन कोड कॉपी करें",
    copied: "कोड कॉपी हो गया",
    copyFailed: "कोड कॉपी नहीं हो सका। आप नीचे दिया कोड स्वागत डेस्क पर दिखा सकते हैं।",
    manual: "चेक-इन कोड दिखाएँ",
    hideManual: "चेक-इन कोड छिपाएँ",
    manualLabel: "चेक-इन कोड"
  }
};

function createSvgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function EntryPassQr({
  qrPayload,
  alt,
  loadingLabel,
  errorLabel,
  manualLabel
}: {
  qrPayload: string;
  alt: string;
  loadingLabel: string;
  errorLabel: string;
  manualLabel: string;
}) {
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void QRCode.toString(qrPayload, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 3,
      color: {
        dark: "#3d1f1bff",
        light: "#fffdf5ff"
      }
    })
      .then((svg) => {
        if (!cancelled) setQrSrc(createSvgDataUrl(svg));
      })
      .catch(() => {
        if (!cancelled) setHasError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [qrPayload]);

  if (qrSrc) {
    return (
      // This is an opaque, code-generated SVG data URI. It must not go
      // through an image loader or an external service before the welcome desk.
      // eslint-disable-next-line @next/next/no-img-element
      <img className="entry-pass-qr" src={qrSrc} alt={alt} />
    );
  }

  return (
    <div className={`entry-pass-qr-loading ${hasError ? "has-error" : ""}`} role="status" aria-live="polite">
      <span aria-hidden="true">{hasError ? "!" : "✦"}</span>
      <p>{hasError ? errorLabel : loadingLabel}</p>
      {hasError && <code className="entry-pass-qr-fallback-code"><span>{manualLabel}</span>{qrPayload}</code>}
    </div>
  );
}

async function copyToClipboard(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Some embedded browsers expose Clipboard but reject writes. The focused
    // document fallback below is still useful at a venue reception desk.
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  if (!copied) throw new Error("Clipboard copy failed");
}

export function EntryPass({
  pass,
  coupleName,
  householdName,
  eventNames,
  locale
}: {
  pass: GuestEntryPass;
  coupleName: string;
  householdName: string;
  eventNames: string[];
  locale: Locale;
}) {
  const labels = copy[locale];
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [isManualCodeVisible, setIsManualCodeVisible] = useState(false);
  const resetCopyTimer = useRef<number | null>(null);

  // Match the scanner's strict, versioned contract. In particular, a raw
  // invitation URL/token can never be rendered as a QR even if a future API
  // response is accidentally shaped incorrectly.
  const isPayloadSafe = parseEntryPassPayload(pass.qrPayload) !== null;

  useEffect(() => () => {
    if (resetCopyTimer.current !== null) window.clearTimeout(resetCopyTimer.current);
  }, []);

  if (!isPayloadSafe) return null;

  async function handleCopy() {
    if (resetCopyTimer.current !== null) window.clearTimeout(resetCopyTimer.current);
    try {
      await copyToClipboard(pass.qrPayload);
      setCopyState("copied");
      setIsManualCodeVisible(false);
    } catch {
      setCopyState("failed");
      setIsManualCodeVisible(true);
    }
    resetCopyTimer.current = window.setTimeout(() => setCopyState("idle"), 2600);
  }

  const statusLabel = pass.state === "checked-in" ? labels.checkedIn : labels.ready;
  const lead = pass.state === "checked-in" ? labels.checkedInLead : labels.readyLead;
  const showManualCode = isManualCodeVisible;

  return (
    <section className={`entry-pass ${pass.state === "checked-in" ? "is-checked-in" : ""}`} aria-label={labels.heading(householdName)}>
      <div className="entry-pass-pattern" aria-hidden="true" />
      <div className="entry-pass-heading">
        <div>
          <h3>{labels.heading(householdName)}</h3>
          <p className="entry-pass-wedding">{labels.wedding(coupleName)}</p>
        </div>
        <span className="entry-pass-status"><i aria-hidden="true" />{statusLabel}</span>
      </div>

      <div className="entry-pass-main">
        <div className="entry-pass-qr-wrap">
          <EntryPassQr
            key={pass.qrPayload}
            qrPayload={pass.qrPayload}
            alt={labels.qrAlt}
            loadingLabel={labels.qrLoading}
            errorLabel={labels.qrError}
            manualLabel={labels.manualLabel}
          />
        </div>
        <div className="entry-pass-details">
          <p className="entry-pass-lede">{lead}</p>
          {eventNames.length > 0 && (
            <div className="entry-pass-events">
              <span>{labels.events}</span>
              <ul>
                {eventNames.map((eventName, index) => <li key={`${index}-${eventName}`}>{eventName}</li>)}
              </ul>
            </div>
          )}
          <p className="entry-pass-privacy"><span aria-hidden="true">✦</span>{labels.privacy}</p>
        </div>
      </div>

      <div className="entry-pass-actions">
        <button className="entry-pass-print" type="button" onClick={() => window.print()}>{labels.print}<span aria-hidden="true">↗</span></button>
        <button className="entry-pass-copy" type="button" onClick={handleCopy}>
          {copyState === "copied" ? labels.copied : labels.copy}<span aria-hidden="true">{copyState === "copied" ? "✓" : "⧉"}</span>
        </button>
        <button
          className="entry-pass-manual-toggle"
          type="button"
          onClick={() => setIsManualCodeVisible((visible) => !visible)}
          aria-expanded={showManualCode}
        >
          {showManualCode ? labels.hideManual : labels.manual}<span aria-hidden="true">{showManualCode ? "↑" : "↓"}</span>
        </button>
      </div>
      {copyState === "failed" && <p className="entry-pass-copy-status" role="status">{labels.copyFailed}</p>}
      {showManualCode && (
        <p className="entry-pass-manual-code">
          <span>{labels.manualLabel}</span>
          <code>{pass.qrPayload}</code>
        </p>
      )}
    </section>
  );
}
