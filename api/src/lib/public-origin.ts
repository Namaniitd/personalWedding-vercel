import { isLocalStackPublicOrigin } from "./local-stack.js";

/** Require an exact public HTTPS origin, except for the bounded local stack. */
export function hasConfiguredCanonicalPublicOrigin() {
  const value = process.env.PUBLIC_APP_ORIGIN;
  if (!value || value.length > 2_048 || value.trim() !== value) return false;
  if (isLocalStackPublicOrigin()) return true;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && parsed.pathname === "/"
      && !parsed.search
      && !parsed.hash
      && value === parsed.origin;
  } catch {
    return false;
  }
}
