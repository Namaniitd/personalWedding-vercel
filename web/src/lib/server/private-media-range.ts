/** Keep individual video responses below serverless response-size limits. */
export const MAX_PRIVATE_VIDEO_RANGE_BYTES = 1024 * 1024;
export const MAX_PRIVATE_VIDEO_FULL_BYTES = 4 * 1024 * 1024;

/** A single, satisfiable inclusive byte range, capped to a bounded response. */
export function privateVideoByteRange(value: string, size: number): { start: number; end: number } | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;

  // Decimal ranges may exceed Number's precision. Compare them exactly before
  // converting positions that are known to fit within the actual file size.
  const fileSize = BigInt(size);
  const first = match[1] ? BigInt(match[1]) : null;
  const last = match[2] ? BigInt(match[2]) : null;
  let start: number;
  let end: number;
  if (first !== null) {
    if (first >= fileSize || (last !== null && last < first)) return null;
    start = Number(first);
    end = last === null || last >= fileSize ? size - 1 : Number(last);
  } else {
    if (last === null || last === BigInt(0)) return null;
    start = last >= fileSize ? 0 : Number(fileSize - last);
    end = size - 1;
  }
  return { start, end: Math.min(end, start + MAX_PRIVATE_VIDEO_RANGE_BYTES - 1) };
}
