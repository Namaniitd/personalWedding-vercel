export type CountdownParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function countdownTimestamp(target: string | number | Date) {
  return target instanceof Date ? target.getTime() : new Date(target).getTime();
}

/** Whether the target instant has arrived. Invalid times never read as complete. */
export function hasCountdownElapsed(target: string | number | Date, now = Date.now()) {
  const targetTime = countdownTimestamp(target);
  return Number.isFinite(targetTime) && Number.isFinite(now) && targetTime <= now;
}

/**
 * Split a future moment into human-sized countdown units. The calculation is
 * duration-based, so an ISO timestamp with India's offset stays accurate for
 * guests viewing an invitation from any time zone.
 */
export function getCountdownParts(target: string | number | Date, now = Date.now()): CountdownParts | null {
  const targetTime = countdownTimestamp(target);
  if (!Number.isFinite(targetTime) || !Number.isFinite(now)) return null;

  let remaining = Math.max(0, targetTime - now);
  const days = Math.floor(remaining / DAY);
  remaining -= days * DAY;
  const hours = Math.floor(remaining / HOUR);
  remaining -= hours * HOUR;
  const minutes = Math.floor(remaining / MINUTE);
  remaining -= minutes * MINUTE;
  const seconds = Math.floor(remaining / SECOND);

  return { days, hours, minutes, seconds };
}
