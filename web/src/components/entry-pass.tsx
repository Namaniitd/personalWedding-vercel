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
    heading: (householdName) => `Welcome pass for ${householdName}`,
    wedding: (coupleName) => `${coupleName}’s Wedding`,
    ready: "Ready at the welcome desk",
    checkedIn: "Checked in",
    readyLead: "Show this QR code at the welcome desk when you arrive.",
    checkedInLead: "Your household has already been welcomed. We hope you are having a beautiful evening.",
    events: "Celebrations confirmed",
    privacy: "One private pass for your invited household. Please keep it with you.",
    qrLoading: "Preparing your private entry QR code…",
    qrAlt: "Private entry QR code. Show it at the welcome desk, or use the check-in code below if the desk asks for it.",
    qrError: "We could not prepare the QR image. The manual check-in code below will still work at the welcome desk.",
    print: "Print pass",
    copy: "Copy check-in code",
    copied: "Code copied",
    copyFailed: "Copying is unavailable here. Your manual code is shown below.",
    manual: "Use a manual code",
    hideManual: "Hide manual code",
    manualLabel: "Manual check-in code"
  },
  hi: {
    heading: (householdName) => `${householdName} के लिए स्वागत पास`,
    wedding: (coupleName) => `${coupleName} का विवाह`,
    ready: "स्वागत डेस्क के लिए तैयार",
    checkedIn: "चेक-इन हो गया",
    readyLead: "पहुंचने पर स्वागत डेस्क पर यह QR कोड दिखाएँ।",
    checkedInLead: "आपके परिवार का चेक-इन हो चुका है। आशा है आपकी शाम खूबसूरत बीत रही है।",
    events: "पुष्ट समारोह",
    privacy: "यह आपके आमंत्रित परिवार के लिए एक निजी पास है। कृपया इसे अपने पास रखें।",
    qrLoading: "आपका निजी प्रवेश QR कोड तैयार किया जा रहा है…",
    qrAlt: "निजी प्रवेश QR कोड। इसे स्वागत डेस्क पर दिखाएँ या जरूरत पड़ने पर नीचे दिया चेक-इन कोड उपयोग करें।",
    qrError: "QR चित्र तैयार नहीं हो सका। नीचे दिया मैन्युअल चेक-इन कोड स्वागत डेस्क पर काम करेगा।",
    print: "पास प्रिंट करें",
    copy: "चेक-इन कोड कॉपी करें",
    copied: "कोड कॉपी हो गया",
    copyFailed: "यहाँ कॉपी करना उपलब्ध नहीं है। आपका मैन्युअल कोड नीचे दिखाया गया है।",
    manual: "मैन्युअल कोड उपयोग करें",
    hideManual: "मैन्युअल कोड छिपाएँ",
    manualLabel: "मैन्युअल चेक-इन कोड"
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
