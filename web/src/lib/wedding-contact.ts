import type { ContactRole, WeddingContact } from "@/lib/types";

const INDIA_COUNTRY_CODE = "91";
const INDIAN_MOBILE_LENGTH = 10;

function normaliseName(value: string | undefined) {
  const name = value?.trim().replace(/\s+/g, " ") ?? "";
  return name.length >= 1 && name.length <= 80 ? name : null;
}

/**
 * Accept a normal Indian mobile number in either 10-digit or +91 form.
 * Returning null rather than building a permissive href avoids a malformed
 * call or WhatsApp destination when a configured value contains a typo.
 */
export function normaliseIndianMobile(value: string | undefined) {
  const compact = value?.trim().replace(/[\s().-]/g, "") ?? "";
  const digits = compact.startsWith("+") ? compact.slice(1) : compact;
  const withCountryCode = digits.length === INDIAN_MOBILE_LENGTH
    ? `${INDIA_COUNTRY_CODE}${digits}`
    : digits;

  if (!/^91[6-9]\d{9}$/.test(withCountryCode)) return null;
  return `+${withCountryCode}`;
}

function displayIndianMobile(e164: string) {
  const subscriberNumber = e164.slice(3);
  return `+91 ${subscriberNumber.slice(0, 5)} ${subscriberNumber.slice(5)}`;
}

/** Construct a display/call/WhatsApp contact from one validated phone value. */
export function createWeddingContact(
  role: ContactRole,
  name: string | undefined,
  phone: string | undefined
): WeddingContact | null {
  const normalizedName = normaliseName(name);
  const e164 = normaliseIndianMobile(phone);
  if (!normalizedName || !e164) return null;

  return {
    role,
    name: normalizedName,
    phoneDisplay: displayIndianMobile(e164),
    phoneHref: `tel:${e164}`,
    whatsappHref: `https://wa.me/${e164.slice(1)}`
  };
}
