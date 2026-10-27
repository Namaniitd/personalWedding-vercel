"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { Locale, WeddingEvent } from "@/lib/types";

import styles from "./event-details-dialog.module.css";

const copy = {
  en: {
    celebration: "Event details",
    date: "Date",
    time: "Start time",
    arrival: "Arrival time",
    venue: "Venue",
    address: "Address",
    entry: "On arrival",
    attire: "What to wear",
    practical: "Good to know",
    close: "Close event details",
    directions: "Get directions",
    back: "Back to invitation"
  },
  hi: {
    celebration: "समारोह की जानकारी",
    date: "तिथि",
    time: "शुरू होने का समय",
    arrival: "पहुँचने का समय",
    venue: "स्थल",
    address: "पता",
    entry: "पहुँचने पर",
    attire: "क्या पहनें",
    practical: "ज़रूरी जानकारी",
    close: "समारोह की जानकारी बंद करें",
    directions: "रास्ता देखें",
    back: "निमंत्रण पर वापस जाएँ"
  }
};

export function EventDetailsDialog({ event, locale }: { event: WeddingEvent; locale: Locale }) {
  const labels = copy[locale];
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const backdropPointerDown = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const dialogId = useId();
  const description = event.description?.[locale];
  const notes = [
    { label: labels.entry, value: event.entryNote[locale] },
    { label: labels.attire, value: event.dressCode[locale] },
    { label: labels.practical, value: event.practicalNote[locale] }
  ].filter((detail) => detail.value);

  useEffect(() => {
    if (!isOpen || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    const root = document.documentElement;
    const wasLocked = root.classList.contains(styles.modalOpen);
    dialog.showModal();
    root.classList.add(styles.modalOpen);
    return () => {
      if (dialog.open) dialog.close();
      if (!wasLocked) root.classList.remove(styles.modalOpen);
      trigger?.focus({ preventScroll: true });
    };
  }, [isOpen]);

  function pointerIsOnBackdrop(clientX: number, clientY: number) {
    if (!dialogRef.current) return false;
    const bounds = dialogRef.current.getBoundingClientRect();
    return clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom;
  }

  return (
    <>
      <h3>
        <button
          ref={triggerRef}
          className={styles.trigger}
          type="button"
          aria-haspopup="dialog"
          aria-controls={dialogId}
          aria-expanded={isOpen}
          onClick={() => setIsOpen(true)}
        >
          <span>{event.title[locale]}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
        </button>
      </h3>
      <dialog
        ref={dialogRef}
        id={dialogId}
        className={styles.dialog}
        lang={locale}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onCancel={(event) => { event.preventDefault(); setIsOpen(false); }}
        onClose={() => setIsOpen(false)}
        onPointerDown={(event) => { backdropPointerDown.current = pointerIsOnBackdrop(event.clientX, event.clientY); }}
        onClick={(event) => {
          if (backdropPointerDown.current && pointerIsOnBackdrop(event.clientX, event.clientY)) setIsOpen(false);
          backdropPointerDown.current = false;
        }}
      >
        <header className={styles.header}>
          <div><p>{labels.celebration}</p><h2 id={titleId}>{event.title[locale]}</h2></div>
          <button className={styles.close} type="button" onClick={() => setIsOpen(false)} aria-label={labels.close}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </header>

        <div className={styles.content}>
          {description && <p id={descriptionId} className={styles.description}>{description}</p>}
          <dl className={styles.facts}>
            <div><dt>{labels.date}</dt><dd>{event.date[locale]}</dd></div>
            <div><dt>{labels.time}</dt><dd>{event.startTime[locale]}</dd></div>
            <div className={styles.wide}><dt>{labels.arrival}</dt><dd>{event.arrivalWindow[locale]}</dd></div>
            <div className={styles.wide}><dt>{labels.venue}</dt><dd>{event.venue[locale]}</dd></div>
            <div className={styles.wide}><dt>{labels.address}</dt><dd>{event.address[locale]}</dd></div>
          </dl>
          {(event.popupDetails?.length || notes.length) ? (
            <dl className={styles.details}>
              {event.popupDetails?.map((detail, index) => (
                <div key={index}><dt>{detail.label[locale]}</dt><dd>{detail.value[locale]}</dd></div>
              ))}
              {notes.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}
            </dl>
          ) : null}
        </div>

        <footer className={styles.footer}>
          <a href={event.mapsUrl} target="_blank" rel="noopener noreferrer">{labels.directions}<span aria-hidden="true">↗</span></a>
          <button type="button" onClick={() => setIsOpen(false)}>{labels.back}</button>
        </footer>
      </dialog>
    </>
  );
}
