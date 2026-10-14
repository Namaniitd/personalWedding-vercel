import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

const requiredColumns = [
  "external_key", "household_name_en", "household_name_hi", "preferred_locale",
  "primary_contact_phone", "family_side", "city", "is_outstation", "tags",
  "rsvp_deadline", "can_edit_until", "access_expires_at", "event_slug", "adult_limit", "child_limit"
];

const filePath = process.argv.find((argument) => !argument.startsWith("--") && argument !== process.argv[0] && argument !== process.argv[1]);
const dryRun = process.argv.includes("--dry-run");
const printLinks = process.argv.includes("--print-links");
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pepper = process.env.INVITATION_TOKEN_PEPPER;
const invitationBaseUrl = process.env.INVITATION_BASE_URL;
const publicAppOrigin = process.env.PUBLIC_APP_ORIGIN;

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
  throw new Error("The Supabase service-role import requires TLS certificate verification.");
}

function canonicalHttpsOrigin(value, variableName) {
  if (!value || value.length > 2_048 || value.trim() !== value) {
    throw new Error(`${variableName} must be a canonical HTTPS origin.`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a canonical HTTPS origin.`);
  }
  if (
    parsed.protocol !== "https:"
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || parsed.origin !== value
  ) {
    throw new Error(`${variableName} must be a canonical HTTPS origin.`);
  }
  return parsed.origin;
}

if (!filePath || !url || !serviceKey || !pepper || !invitationBaseUrl || !publicAppOrigin) {
  console.error("Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... INVITATION_TOKEN_PEPPER=... PUBLIC_APP_ORIGIN=https://invite.example INVITATION_BASE_URL=https://invite.example node scripts/import-households.mjs data/households.csv [--dry-run] [--print-links]");
  process.exit(1);
}
const supabaseUrl = canonicalHttpsOrigin(url, "SUPABASE_URL");
const supabaseOrigin = new URL(supabaseUrl);
if (supabaseOrigin.port || !supabaseOrigin.hostname.endsWith(".supabase.co")) {
  throw new Error("SUPABASE_URL must use a trusted *.supabase.co project origin.");
}
const baseUrl = canonicalHttpsOrigin(invitationBaseUrl, "INVITATION_BASE_URL");
const publicOrigin = canonicalHttpsOrigin(publicAppOrigin, "PUBLIC_APP_ORIGIN");
if (baseUrl !== publicOrigin) {
  throw new Error("INVITATION_BASE_URL must exactly match PUBLIC_APP_ORIGIN before invitation URLs can be issued.");
}
if (!dryRun && !printLinks) {
  throw new Error("Refusing to issue bearer links without --print-links. Run only on a protected operator machine and avoid saving terminal output.");
}

const file = await readFile(filePath, "utf8");
const rows = parse(file, { columns: true, skip_empty_lines: true, trim: true, bom: true });
const missingColumns = requiredColumns.filter((column) => !(column in (rows[0] ?? {})));
if (missingColumns.length > 0) throw new Error(`Missing CSV columns: ${missingColumns.join(", ")}`);
if (rows.length === 0) throw new Error("The CSV has no household rows.");

const grouped = new Map();
for (const row of rows) {
  if (!row.external_key || !row.household_name_en || !row.household_name_hi || !row.event_slug) {
    throw new Error("Each row needs external_key, English/Hindi household names, and event_slug.");
  }
  if (!grouped.has(row.external_key)) grouped.set(row.external_key, []);
  grouped.get(row.external_key).push(row);
}

function numberInRange(value, name, row) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 30) throw new Error(`${name} must be a whole number from 0–30 for ${row.external_key}.`);
  return number;
}

function asBoolean(value, name) {
  if (["true", "yes", "1"].includes(String(value).toLowerCase())) return true;
  if (["false", "no", "0", ""].includes(String(value).toLowerCase())) return false;
  throw new Error(`${name} must be true or false.`);
}

function sameValue(rowsForHousehold, column) {
  const values = new Set(rowsForHousehold.map((row) => row[column]));
  if (values.size !== 1) throw new Error(`${column} must have one value for household ${rowsForHousehold[0].external_key}.`);
  return rowsForHousehold[0][column];
}

const eventSlugs = [...new Set(rows.map((row) => row.event_slug))];
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: {
    // Supabase's service key also travels in `apikey`, which Fetch does not
    // strip when following a redirect to another origin.
    fetch: (input, init) => fetch(input, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    })
  }
});
const { data: knownEvents, error: eventError } = await supabase.from("events").select("id, slug").in("slug", eventSlugs);
if (eventError) throw eventError;
const eventsBySlug = new Map((knownEvents ?? []).map((event) => [event.slug, event.id]));
const missingEvents = eventSlugs.filter((slug) => !eventsBySlug.has(slug));
if (missingEvents.length > 0) throw new Error(`Unknown event slug(s): ${missingEvents.join(", ")}. Create events before importing households.`);

const keys = [...grouped.keys()];
const { data: existing, error: existingError } = await supabase.from("invitations").select("external_key").in("external_key", keys);
if (existingError) throw existingError;
const existingKeys = new Set((existing ?? []).map((invitation) => invitation.external_key));

const prepared = [];
for (const [externalKey, rowsForHousehold] of grouped) {
  const eventSet = new Set();
  for (const row of rowsForHousehold) {
    if (eventSet.has(row.event_slug)) throw new Error(`Duplicate ${row.event_slug} row for ${externalKey}.`);
    eventSet.add(row.event_slug);
    const adultLimit = numberInRange(row.adult_limit, "adult_limit", row);
    const childLimit = numberInRange(row.child_limit, "child_limit", row);
    if (adultLimit + childLimit === 0) {
      throw new Error(`Each event needs room for at least one guest for ${externalKey}.`);
    }
  }
  const deadline = sameValue(rowsForHousehold, "rsvp_deadline");
  const editableUntil = sameValue(rowsForHousehold, "can_edit_until");
  const accessExpiresAt = sameValue(rowsForHousehold, "access_expires_at");
  if (!Number.isFinite(Date.parse(deadline)) || !Number.isFinite(Date.parse(editableUntil)) || !Number.isFinite(Date.parse(accessExpiresAt))) throw new Error(`Use ISO dates with +05:30 for ${externalKey}.`);
  if (Date.parse(editableUntil) > Date.parse(deadline)) throw new Error(`can_edit_until must not be after rsvp_deadline for ${externalKey}.`);
  if (Date.parse(accessExpiresAt) < Date.parse(deadline)) throw new Error(`access_expires_at must not be before rsvp_deadline for ${externalKey}.`);
  prepared.push({
    externalKey,
    rows: rowsForHousehold,
    invitation: {
      external_key: externalKey,
      household_name_en: sameValue(rowsForHousehold, "household_name_en"),
      household_name_hi: sameValue(rowsForHousehold, "household_name_hi"),
      preferred_locale: sameValue(rowsForHousehold, "preferred_locale"),
      primary_contact_phone: sameValue(rowsForHousehold, "primary_contact_phone"),
      family_side: sameValue(rowsForHousehold, "family_side"),
      city: sameValue(rowsForHousehold, "city"),
      is_outstation: asBoolean(sameValue(rowsForHousehold, "is_outstation"), "is_outstation"),
      tags: sameValue(rowsForHousehold, "tags").split(",").map((tag) => tag.trim()).filter(Boolean),
      rsvp_deadline: deadline,
      can_edit_until: editableUntil,
      access_expires_at: accessExpiresAt,
      status: "active"
    }
  });
}

for (const household of prepared) {
  if (existingKeys.has(household.externalKey)) {
    console.log(`SKIPPED  ${household.externalKey} — already imported; raw links are never regenerated automatically.`);
    continue;
  }
  if (dryRun) {
    console.log(`VALID    ${household.externalKey} — ${household.rows.length} event(s), ready to import.`);
    continue;
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHmac("sha256", pepper).update(token).digest("hex");
  const { error } = await supabase.rpc("create_invitation_bundle", {
    p_invitation: { ...household.invitation, token_hash: tokenHash },
    p_event_limits: household.rows.map((row) => ({
      event_id: eventsBySlug.get(row.event_slug),
      adult_limit: numberInRange(row.adult_limit, "adult_limit", row),
      child_limit: numberInRange(row.child_limit, "child_limit", row)
    }))
  });
  if (error) throw new Error(`Could not import ${household.externalKey}: ${error.message}`);
  console.log(`CREATED  ${household.externalKey}\n         ${baseUrl}/i/${token}`);
}

console.log(dryRun ? "Dry run complete. Nothing was written." : "Import complete. Send each printed link only to its intended household.");
