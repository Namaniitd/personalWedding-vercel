"use client";

import { useEffect, useId, useState } from "react";

import { getCountdownParts, hasCountdownElapsed, type CountdownParts } from "@/lib/countdown";
import type { Locale } from "@/lib/types";

import styles from "./wedding-countdown.module.css";

const copy = {
  en: {
    heading: "Counting down to our wedding",
    loading: "The wedding countdown is loading.",
    arrived: "The celebration is here!",
    units: { days: "Days", hours: "Hours", minutes: "Minutes", seconds: "Seconds" }
  },
  hi: {
    heading: "हमारे शुभ विवाह की उलटी गिनती",
    loading: "विवाह की उलटी गिनती शुरू हो रही है।",
    arrived: "शुभ विवाह की बेला आ गई!",
    units: { days: "दिन", hours: "घंटे", minutes: "मिनट", seconds: "सेकंड" }
  }
} satisfies Record<Locale, {
  heading: string;
  loading: string;
  arrived: string;
  units: Record<keyof CountdownParts, string>;
}>;

const units: Array<keyof CountdownParts> = ["days", "hours", "minutes", "seconds"];
const hindiDigits = "०१२३४५६७८९";

function countdownNumber(value: number, locale: Locale) {
  const text = String(value).padStart(2, "0");
  return locale === "hi" ? text.replace(/\d/g, (digit) => hindiDigits[Number(digit)]) : text;
}

export function WeddingCountdown({ target, locale }: { target: string; locale: Locale }) {
  const headingId = useId();
  const labels = copy[locale];
  const validTarget = Number.isFinite(Date.parse(target));
  // Both server HTML and the first client render use placeholders. The clock
  // starts after hydration, and its state stays local to this component.
  const [clock, setClock] = useState<{ target: string; now: number } | null>(null);

  useEffect(() => {
    if (!validTarget) return;

    let interval: number | undefined;
    const update = () => {
      const now = Date.now();
      setClock({ target, now });
      if (hasCountdownElapsed(target, now) && interval !== undefined) {
        window.clearInterval(interval);
        interval = undefined;
      }
    };
    const initialTick = window.setTimeout(update, 0);
    interval = window.setInterval(update, 1_000);
    // Returning to a backgrounded tab immediately catches up to real time.
    const onVisible = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearTimeout(initialTick);
      if (interval !== undefined) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [target, validTarget]);

  if (!validTarget) return null;

  const now = clock?.target === target ? clock.now : null;
  const parts = now === null ? null : getCountdownParts(target, now);
  const arrived = now !== null && hasCountdownElapsed(target, now);

  return (
    <section className={styles.countdown} lang={locale} aria-labelledby={headingId}>
      <p className={styles.heading} id={headingId}>
        <span aria-hidden="true">✦</span>{labels.heading}
      </p>
      <div role="timer" aria-live="off" aria-labelledby={headingId}>
        {arrived ? (
          <p className={styles.arrived}>{labels.arrived}</p>
        ) : (
          <>
            {!parts && <span className={styles.screenReaderOnly}>{labels.loading}</span>}
            <dl className={styles.units}>
              {units.map((unit) => (
                <div className={styles.unit} key={unit}>
                  <dt className={styles.label}>{labels.units[unit]}</dt>
                  <dd className={styles.value} aria-hidden={!parts || undefined}>
                    {parts ? countdownNumber(parts[unit], locale) : "—"}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </section>
  );
}
