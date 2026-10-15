"use client";

import { coordinatorApiPath } from "@/lib/wedding-side";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { parseEntryPassPayload } from "@/lib/entry-pass";
import { createQrFrameReader, type BarcodeDetectorConstructor } from "@/lib/qr-scanner";
import type { DatabaseInvitationEventOption, LocalizedText } from "@/lib/types";

import styles from "./check-in-scanner.module.css";

type ScannerMode = "camera" | "manual";
type CameraState = "idle" | "starting" | "scanning" | "unavailable" | "blocked" | "error";
type CheckInOutcome = "checked_in" | "already_checked_in";
type ScanSource = "camera" | "manual";

type CheckInRecord = {
  outcome: CheckInOutcome;
  householdName: string;
  event: { id: string; title: LocalizedText };
  expectedAdults: number;
  expectedChildren: number;
  checkedInAt: string;
  scanCount: number;
};

type CheckInResponse = CheckInRecord & { ok: true };

const MAX_RECENT_CHECK_INS = 4;
const RESCAN_COOLDOWN_MS = 1_600;
const SCAN_FRAME_INTERVAL_MS = 150;

function getBarcodeDetectorConstructor() {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
}

function isCheckInResponse(value: unknown): value is CheckInResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<CheckInResponse>;
  return response.ok === true
    && (response.outcome === "checked_in" || response.outcome === "already_checked_in")
    && typeof response.householdName === "string"
    && response.householdName.trim().length > 0
    && Boolean(response.event)
    && typeof response.event?.id === "string"
    && typeof response.event?.title?.en === "string"
    && typeof response.event?.title?.hi === "string"
    && typeof response.expectedAdults === "number"
    && Number.isSafeInteger(response.expectedAdults)
    && response.expectedAdults >= 0
    && typeof response.expectedChildren === "number"
    && Number.isSafeInteger(response.expectedChildren)
    && response.expectedChildren >= 0
    && typeof response.checkedInAt === "string"
    && Number.isFinite(new Date(response.checkedInAt).getTime())
    && typeof response.scanCount === "number"
    && Number.isSafeInteger(response.scanCount)
    && response.scanCount >= 1;
}

function errorMessage(response: unknown, status: number) {
  if (status === 429) return "Too many scans in a short time. Please wait a moment, then try again.";
  if (status === 404) return "This pass cannot be checked in for the selected celebration.";
  if (response && typeof response === "object" && "error" in response && typeof response.error === "string") {
    return response.error;
  }
  return "We could not verify this pass. Please try again or use the guest list.";
}

function formattedTime(timestamp: string) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "just now";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function allocatedGuestText(record: CheckInRecord) {
  const total = record.expectedAdults + record.expectedChildren;
  const parts = [
    `${record.expectedAdults} adult${record.expectedAdults === 1 ? "" : "s"}`,
    `${record.expectedChildren} child${record.expectedChildren === 1 ? "" : "ren"}`
  ];
  return `${total} invited guest${total === 1 ? "" : "s"} · ${parts.join(" · ")}`;
}

function readableCameraError(error: unknown): CameraState {
  if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) return "blocked";
  if (error instanceof DOMException && ["NotFoundError", "OverconstrainedError", "NotReadableError"].includes(error.name)) return "unavailable";
  return "error";
}

function cameraMessage(state: CameraState) {
  switch (state) {
    case "starting":
      return "Opening the rear camera…";
    case "scanning":
      return "Hold the guest’s QR pass inside the frame.";
    case "unavailable":
      return "We could not access a usable camera. Check the device, then try again or enter the pass code manually.";
    case "blocked":
      return "Camera permission is off. Allow it in this browser, then try again—or use the manual code field.";
    case "error":
      return "The camera could not start. Please try again or use the manual code field.";
    default:
      return "Camera stays off until you start scanning.";
  }
}

/**
 * Coordinator gate tool. It deliberately accepts only the opaque entry
 * credential in a QR pass; invitation URLs and RSVP data are never scanned,
 * shown, or retained in the browser.
 */
export function CheckInScanner({ events }: { events: DatabaseInvitationEventOption[] }) {
  const [mode, setMode] = useState<ScannerMode>("camera");
  const [selectedEventId, setSelectedEventId] = useState(events[0]?.id ?? "");
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [manualCode, setManualCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<CheckInRecord | null>(null);
  const [scanError, setScanError] = useState("");
  const [recentChecks, setRecentChecks] = useState<CheckInRecord[]>([]);
  const [newChecksThisSession, setNewChecksThisSession] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);
  const cameraAttemptRef = useRef(0);
  const isSubmittingRef = useRef(false);
  const lastDetectedRef = useRef<{ code: string; at: number } | null>(null);
  const eventIdRef = useRef(selectedEventId);
  const scannerId = useId();

  useEffect(() => {
    eventIdRef.current = selectedEventId;
  }, [selectedEventId]);

  const stopCamera = useCallback((nextState: CameraState = "idle") => {
    cameraAttemptRef.current += 1;
    if (scanFrameRef.current !== null) {
      window.cancelAnimationFrame(scanFrameRef.current);
      scanFrameRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState(nextState);
  }, []);

  const submitPass = useCallback(async (rawCode: string, source: ScanSource) => {
    if (isSubmittingRef.current || !eventIdRef.current) return;
    const passToken = parseEntryPassPayload(rawCode);
    if (!passToken) {
      setScanError("That is not a recognised entry pass. Ask the guest to open their RSVP confirmation and try again.");
      if (source === "camera") stopCamera();
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setResult(null);
    setScanError("");
    if (source === "camera") setCameraState("starting");

    try {
      const response = await fetch(coordinatorApiPath("check-in"), {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passToken, eventId: eventIdRef.current })
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setScanError(errorMessage(body, response.status));
        if (source === "camera") stopCamera();
        return;
      }
      if (!isCheckInResponse(body)) {
        setScanError("The check-in desk received an unexpected response. Please retry this pass.");
        if (source === "camera") stopCamera();
        return;
      }

      const checkedIn = body;
      setResult(checkedIn);
      setRecentChecks((current) => [checkedIn, ...current].slice(0, MAX_RECENT_CHECK_INS));
      if (checkedIn.outcome === "checked_in") setNewChecksThisSession((count) => count + 1);
      if (source === "camera") stopCamera();
    } catch {
      setScanError("We could not reach the check-in desk. Check the connection and try again.");
      if (source === "camera") stopCamera();
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      if (source === "camera" && streamRef.current) setCameraState("scanning");
    }
  }, [stopCamera]);

  const startCamera = useCallback(async () => {
    if (cameraState === "starting" || cameraState === "scanning" || isSubmittingRef.current) return;
    setResult(null);
    setScanError("");
    lastDetectedRef.current = null;
    const attempt = cameraAttemptRef.current + 1;
    cameraAttemptRef.current = attempt;

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraState("unavailable");
      return;
    }
    setCameraState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      if (cameraAttemptRef.current !== attempt) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setCameraState("error");
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (cameraAttemptRef.current !== attempt || streamRef.current !== stream) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const readFrame = await createQrFrameReader(video, getBarcodeDetectorConstructor());
      if (cameraAttemptRef.current !== attempt || streamRef.current !== stream) return;
      setCameraState("scanning");
      let lastFrameAt = 0;

      const scanFrame = async () => {
        if (streamRef.current !== stream) return;
        const frameAt = performance.now();
        if (!document.hidden && !isSubmittingRef.current && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && frameAt - lastFrameAt >= SCAN_FRAME_INTERVAL_MS) {
          lastFrameAt = frameAt;
          try {
            const rawCode = await readFrame();
            // A decode may finish after the camera is stopped or the selected
            // event changes. That old frame must never check in a guest.
            if (cameraAttemptRef.current !== attempt || streamRef.current !== stream || document.hidden) return;
            const lastDetected = lastDetectedRef.current;
            const now = Date.now();
            if (rawCode && (!lastDetected || lastDetected.code !== rawCode || now - lastDetected.at >= RESCAN_COOLDOWN_MS)) {
              lastDetectedRef.current = { code: rawCode, at: now };
              void submitPass(rawCode, "camera");
            }
          } catch {
            // A frame can be unreadable while the camera adjusts. The next
            // frame is still safe to process, so keep this silent for staff.
          }
        }
        if (streamRef.current === stream) scanFrameRef.current = window.requestAnimationFrame(() => { void scanFrame(); });
      };
      scanFrameRef.current = window.requestAnimationFrame(() => { void scanFrame(); });
    } catch (error) {
      if (cameraAttemptRef.current === attempt) stopCamera(readableCameraError(error));
    }
  }, [cameraState, stopCamera, submitPass]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    const stopWhenHidden = () => {
      // A permission prompt can still be pending before `streamRef` exists.
      // Cancelling unconditionally invalidates that attempt too, so a camera
      // never becomes live after the coordinator has backgrounded the desk.
      if (document.hidden) stopCamera();
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => document.removeEventListener("visibilitychange", stopWhenHidden);
  }, [stopCamera]);

  function selectMode(nextMode: ScannerMode) {
    setMode(nextMode);
    setResult(null);
    setScanError("");
    // `getUserMedia()` may be awaiting a permission response while no stream
    // has been assigned yet. `stopCamera` also invalidates that pending start.
    if (nextMode !== "camera") stopCamera();
  }

  function submitManualCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const enteredCode = manualCode;
    // Keep an accidental paste out of the browser state once it has been sent.
    setManualCode("");
    void submitPass(enteredCode, "manual");
  }

  const selectedEvent = events.find((event) => event.id === selectedEventId);
  const resultIsAccepted = result?.outcome === "checked_in";

  return (
    <section className={styles.scanner} id="door-check-in" aria-labelledby={`${scannerId}-title`}>
      <div className={styles.heading}>
        <div>
          <p>Wedding-day desk</p>
          <h2 id={`${scannerId}-title`}>Welcome guests at the gate</h2>
          <span>Choose the celebration, then scan the RSVP pass. Each pass is private, opaque, and checked against the server before entry.</span>
        </div>
        <aside className={styles.securityNote} aria-label="Check-in privacy note">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3.25 19 6v5.55c0 4.32-2.77 7.81-7 9.2-4.23-1.39-7-4.88-7-9.2V6l7-2.75Z" /><path d="m9.1 11.9 1.85 1.85 4-4" /></svg>
          <p><strong>Private check-in</strong>Passes are not stored on this device. Close the camera whenever the desk is unattended.</p>
        </aside>
      </div>

      <div className={styles.grid}>
        <div className={styles.console}>
          <div className={styles.eventPicker}>
            <div>
              <span>Check guests into</span>
              <strong>{selectedEvent?.title.en ?? "Choose a celebration"}</strong>
            </div>
            <label htmlFor={`${scannerId}-event`}>
              <span className="sr-only">Celebration for this check-in</span>
              <select
                id={`${scannerId}-event`}
                value={selectedEventId}
                onChange={(event) => {
                  eventIdRef.current = event.target.value;
                  setSelectedEventId(event.target.value);
                  setResult(null);
                  setScanError("");
                  // Changing a celebration must never leave an older camera
                  // start pending in the background.
                  stopCamera();
                }}
                disabled={isSubmitting || events.length === 0}
              >
                {events.map((event) => <option key={event.id} value={event.id}>{event.title.en}</option>)}
              </select>
            </label>
          </div>

          <div className={styles.modeControls} role="group" aria-label="Choose a check-in method">
            <button type="button" className={mode === "camera" ? styles.modeActive : ""} aria-pressed={mode === "camera"} onClick={() => selectMode("camera")}>
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7.25h2.2l1.15-1.75h7.3l1.15 1.75H19A2 2 0 0 1 21 9.25v8A2 2 0 0 1 19 19.25H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" /><circle cx="12" cy="13.25" r="3.2" /></svg>
              Scan with camera
            </button>
            <button type="button" className={mode === "manual" ? styles.modeActive : ""} aria-pressed={mode === "manual"} onClick={() => selectMode("manual")}>
              <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h4" /></svg>
              Enter pass code
            </button>
          </div>

          {mode === "camera" ? (
            <div className={styles.cameraPanel}>
              <div className={`${styles.cameraViewport} ${cameraState === "scanning" ? styles.cameraLive : ""}`}>
                <video ref={videoRef} autoPlay muted playsInline aria-label="Camera preview for scanning a guest QR pass" />
                <div className={styles.cameraFrame} aria-hidden="true"><i /><i /><i /><i /></div>
                {cameraState !== "scanning" && <div className={styles.cameraPlaceholder}>
                  <span aria-hidden="true">⌁</span>
                  <strong>{cameraState === "starting" ? "Opening camera" : "Ready for a QR pass"}</strong>
                  <small>The camera activates only when you choose to start.</small>
                </div>}
                {cameraState === "scanning" && <span className={styles.scanLine} aria-hidden="true" />}
              </div>
              <div className={styles.cameraFooter}>
                <p aria-live="polite">{cameraMessage(cameraState)}</p>
                {cameraState === "scanning" ? (
                  <button type="button" className={styles.secondaryButton} onClick={() => stopCamera()}>Stop camera</button>
                ) : (
                  <button type="button" className={styles.primaryButton} onClick={() => void startCamera()} disabled={cameraState === "starting" || events.length === 0}>
                    {cameraState === "starting" ? "Opening…" : cameraState === "blocked" || cameraState === "error" || cameraState === "unavailable" ? "Try camera again" : "Start camera"}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <form className={styles.manualPanel} onSubmit={submitManualCode} noValidate>
              <div className={styles.manualIcon} aria-hidden="true">⌁</div>
              <h3>Have a code instead?</h3>
              <p>Type or paste the exact opaque entry code from the guest’s RSVP pass. Do not enter their invitation link.</p>
              <label htmlFor={`${scannerId}-pass-code`}>
                <span>Entry pass code</span>
                <input
                  id={`${scannerId}-pass-code`}
                  value={manualCode}
                  onChange={(event) => setManualCode(event.target.value)}
                  placeholder="shaadi-entry:v1:…"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  inputMode="text"
                  maxLength={128}
                  disabled={isSubmitting || events.length === 0}
                  required
                />
              </label>
              <button type="submit" className={styles.primaryButton} disabled={isSubmitting || !manualCode.trim() || events.length === 0}>{isSubmitting ? "Checking pass…" : "Check in guest"}</button>
            </form>
          )}

          {scanError && <div className={styles.resultError} role="alert"><span aria-hidden="true">!</span><p>{scanError}</p></div>}
          {result && <div className={`${styles.result} ${resultIsAccepted ? styles.resultAccepted : styles.resultAlready}`} role="status" aria-live="polite">
            <span className={styles.resultIcon} aria-hidden="true">{resultIsAccepted ? "✓" : "↻"}</span>
            <div>
              <p>{resultIsAccepted ? "Entry recorded" : "Already checked in"}</p>
              <h3>{result.householdName}</h3>
              <span>{allocatedGuestText(result)} · {result.event.title.en} · {formattedTime(result.checkedInAt)}</span>
            </div>
            <button type="button" onClick={() => { setResult(null); setScanError(""); if (mode === "camera") void startCamera(); }}>Scan next <span aria-hidden="true">→</span></button>
          </div>}
        </div>

        <aside className={styles.activity} aria-label="This session's check-in activity">
          <div className={styles.activityHeading}>
            <div><p>Desk activity</p><h3>This session</h3></div>
            <span>{newChecksThisSession} new</span>
          </div>
          <p className={styles.activityIntro}>Only successful checks made in this browser session appear here. Refreshing clears this browser-only view, not the server record.</p>
          {recentChecks.length > 0 ? (
            <ol className={styles.activityList}>
              {recentChecks.map((check, index) => <li key={`${check.householdName}-${check.event.id}-${check.checkedInAt}-${index}`}>
                <span className={check.outcome === "checked_in" ? styles.activityAccepted : styles.activityAlready}>{check.outcome === "checked_in" ? "✓" : "↻"}</span>
                <div><strong>{check.householdName}</strong><small>{allocatedGuestText(check)} · {formattedTime(check.checkedInAt)}</small></div>
                <em>{check.scanCount} pass scan{check.scanCount === 1 ? "" : "s"}</em>
              </li>)}
            </ol>
          ) : (
            <div className={styles.emptyActivity}><span aria-hidden="true">ॐ</span><strong>No guests checked in yet</strong><p>Successful entries will appear here while this desk is open.</p></div>
          )}
          <p className={styles.activityFootnote}><span aria-hidden="true">•</span> For privacy, guest messages and RSVP notes never appear at the gate.</p>
        </aside>
      </div>
    </section>
  );
}
