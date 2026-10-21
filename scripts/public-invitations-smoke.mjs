import { randomUUID } from "node:crypto";

// This script deliberately creates synthetic demo records and leaves them in
// the disposable Podman stack. Never allow an alternate or durable target.
const origin = "http://127.0.0.1:3001";
class SmokeError extends Error {}

function check(condition, label) {
  if (!condition) throw new SmokeError(`${label}: check failed.`);
}

async function request(path, label, options = {}) {
  try {
    return await fetch(new URL(path, origin), {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new SmokeError(`${label}: request failed.`);
  }
}

function expectStatus(response, status, label) {
  if (response.status !== status) {
    throw new SmokeError(`${label}: expected HTTP ${status}, got ${response.status}.`);
  }
}

async function json(response, label) {
  try {
    return await response.json();
  } catch {
    throw new SmokeError(`${label}: invalid JSON response.`);
  }
}

function jsonPost(body, cookie) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  };
}

function privatePath(value, side, label) {
  try {
    const url = new URL(value);
    check(url.origin === origin && new RegExp(`^/i/${side}/[A-Za-z0-9_-]{16,128}$`).test(url.pathname), label);
    return url.pathname;
  } catch {
    throw new SmokeError(`${label}: invalid personal invitation address.`);
  }
}

function expectPrivate(response, label) {
  check(/no-store/i.test(response.headers.get("cache-control") ?? ""), `${label} cache protection`);
  check(response.headers.get("referrer-policy") === "no-referrer", `${label} referrer protection`);
}

async function page(path, label, cookie) {
  const response = await request(path, label, cookie ? { headers: { Cookie: cookie } } : {});
  expectStatus(response, 200, label);
  expectPrivate(response, label);
  return response.text();
}

async function login(side, password) {
  const label = `${side} coordinator login`;
  check(typeof password === "string" && password.length >= 16, `${label} configured`);
  const response = await request(`/api/coordinator/${side}/login`, label, jsonPost({ password }));
  expectStatus(response, 200, label);
  check((await json(response, label)).ok === true, label);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  check(cookie?.startsWith("shaadi_coordinator_session="), `${label} cookie`);
  return cookie;
}

async function configuration(side, cookie) {
  const label = `${side} synthetic wedding configuration`;
  const response = await request(`/api/coordinator/${side}/content`, label, { headers: { Cookie: cookie } });
  expectStatus(response, 200, label);
  const payload = await json(response, label);
  check(payload.ok === true && payload.configuration?.settings && Array.isArray(payload.configuration.events), label);
  return payload.configuration;
}

async function coordinatorRecords(side, cookie) {
  return page(`/coordinator/${side}/responses`, `${side} coordinator responses`, cookie);
}

async function main() {
  check(!process.env.SMOKE_BASE_URL || process.env.SMOKE_BASE_URL === origin, "Disposable loopback destination");
  const health = await request("/readyz", "Disposable stack readiness");
  expectStatus(health, 200, "Disposable stack readiness");
  const cookies = {
    g: await login("g", process.env.COORDINATOR_GROOM_PASSWORD ?? process.env.COORDINATOR_PASSWORD),
    b: await login("b", process.env.COORDINATOR_BRIDE_PASSWORD)
  };
  const configurations = {
    g: await configuration("g", cookies.g),
    b: await configuration("b", cookies.b)
  };
  check(configurations.g.revision !== null && configurations.g.events.length > 0, "Synthetic groom template configured");

  // The checked-in disposable fixture contains groom content only. Initialize
  // the other side through the real editor API, preserving any existing setup.
  if (configurations.b.revision === null) {
    const { side: _owner, ...template } = configurations.g;
    const label = "Initialize synthetic bride wedding";
    const response = await request("/api/coordinator/b/content", label, {
      ...jsonPost({
        ...template,
        revision: null,
        settings: { ...template.settings, coordinatorName: "Synthetic Bride Coordinator" },
        events: template.events.map((event) => ({
          ...event,
          id: `bride-${event.id}`.slice(0, 100),
          slug: `bride-${event.slug}`.slice(0, 100)
        })),
        contacts: []
      }, cookies.b),
      method: "PUT"
    });
    expectStatus(response, 200, label);
    configurations.b = (await json(response, label)).configuration;
  }
  console.log("PASS: Both coordinator workspaces have usable synthetic wedding content.");

  const runId = randomUUID().slice(0, 8);
  for (const [index, side] of ["g", "b"].entries()) {
    const owner = side === "g" ? "groom" : "bride";
    const cookie = cookies[side];
    const selected = configurations[side].events.filter((event) => event.published && event.defaultSelected);
    check(selected.length > 0, `${side} public default events`);
    const eventLimits = selected.map((event) => ({
      eventId: event.id, adults: event.defaultAdultLimit, children: event.defaultChildLimit
    }));
    const eventId = selected[0].id;
    const attendances = eventLimits.map((event) => ({
      eventId: event.eventId, attending: false, adults: 0, children: 0
    }));
    const body = {
      side: owner,
      respondentName: `Synthetic Public ${side} One ${runId}`,
      contactNumber: `+1 202 555 01${index}1`,
      status: "confirming",
      attendances
    };

    const html = await page(`/rsvp/${side}`, `${side} public invitation`);
    check(/contact number/i.test(html), `${side} public contact field`);
    const media = await request(`/rsvp/${side}/media/engagement-couple-640.webp`, `${side} public media`, { method: "HEAD" });
    expectStatus(media, 200, `${side} public media`);
    expectPrivate(media, `${side} public media`);
    check(Number(media.headers.get("content-length")) > 0, `${side} public media size`);
    const calendar = await request(`/api/calendar/${encodeURIComponent(eventId)}`, `${side} public calendar`, jsonPost({ publicSide: owner }));
    expectStatus(calendar, 200, `${side} public calendar`);
    expectPrivate(calendar, `${side} public calendar`);
    check((await calendar.text()).includes("BEGIN:VCALENDAR"), `${side} public calendar format`);

    const crossOrigin = await request("/api/public/rsvp", `${side} cross-origin public RSVP`, {
      ...jsonPost(body), headers: { "Content-Type": "application/json", Origin: "https://other.example" }
    });
    expectStatus(crossOrigin, 403, `${side} cross-origin public RSVP`);
    const missingContact = await request("/api/public/rsvp", `${side} required public contact`, jsonPost({ ...body, contactNumber: "" }));
    expectStatus(missingContact, 400, `${side} required public contact`);
    const malformedContact = await request("/api/public/rsvp", `${side} malformed public contact`, jsonPost({ ...body, contactNumber: "not-a-phone" }));
    expectStatus(malformedContact, 400, `${side} malformed public contact`);

    const first = await request("/api/public/rsvp", `${side} first public RSVP`, jsonPost(body));
    expectStatus(first, 200, `${side} first public RSVP`);
    expectPrivate(first, `${side} first public RSVP`);
    const firstSaved = await json(first, `${side} first public RSVP`);
    check(firstSaved.ok === true, `${side} first public RSVP saved`);
    const firstPath = privatePath(firstSaved.invitationUrl, side, `${side} first personal link`);
    check(firstPath.endsWith(`/${firstSaved.token}`), `${side} first personal credential`);

    const secondBody = { ...body, respondentName: `Synthetic Public ${side} Two ${runId}`, contactNumber: `+1 202 555 01${index}2` };
    const second = await request("/api/public/rsvp", `${side} second public RSVP`, jsonPost(secondBody));
    expectStatus(second, 200, `${side} second public RSVP`);
    const secondSaved = await json(second, `${side} second public RSVP`);
    check(secondSaved.ok === true && firstSaved.token !== secondSaved.token, `${side} independent public credentials`);
    const secondPath = privatePath(secondSaved.invitationUrl, side, `${side} second personal link`);
    const firstHtml = await page(firstPath, `${side} first personal invitation`);
    check(firstHtml.includes(body.respondentName) && firstHtml.includes(body.contactNumber), `${side} first RSVP persisted`);
    check(!firstHtml.includes(secondBody.respondentName), `${side} first RSVP isolation`);
    const secondHtml = await page(secondPath, `${side} second personal invitation`);
    check(secondHtml.includes(secondBody.respondentName) && secondHtml.includes(secondBody.contactNumber), `${side} second RSVP persisted`);
    check(!secondHtml.includes(body.respondentName), `${side} second RSVP isolation`);

    for (const [position, saved, details, path] of [
      ["first", firstSaved, body, firstPath], ["second", secondSaved, secondBody, secondPath]
    ]) {
      const { side: _publicSide, ...privateDetails } = details;
      const label = `${side} ${position} independent private edit`;
      const response = await request("/api/rsvp", label, jsonPost({
        ...privateDetails,
        token: saved.token,
        updatedAt: saved.updatedAt,
        respondentName: `${privateDetails.respondentName} Edited`,
        status: "declined",
        declineMessage: `Synthetic ${position} public RSVP edited separately`
      }));
      expectStatus(response, 200, label);
      check((await json(response, label)).ok === true, `${label} saved`);
      check((await page(path, `${label} reload`)).includes(`${privateDetails.respondentName} Edited`), `${label} persisted`);
    }
    const records = await coordinatorRecords(side, cookie);
    check(records.includes(body.contactNumber) && records.includes(secondBody.contactNumber), `${side} public contacts visible to coordinator`);
    check(!records.includes(firstSaved.token) && !records.includes(secondSaved.token), `${side} coordinator credential privacy`);
    console.log(`PASS: ${owner} public page, media, calendar, contact validation, isolated RSVPs and personal edits.`);

    if (side === "g") {
      // A valid first row followed by an invalid contact must create no rows.
      const marker = `Synthetic Rejected Partial ${runId}`;
      const rejected = await request(`/api/coordinator/${side}/invitations/bulk`, "Invalid CSV atomicity", jsonPost({
        csv: `name,contactnumber\n${marker},+1 202 555 0191\nSynthetic Invalid Contact,123`,
        preferredLocale: "en", contactRole: owner, eventLimits
      }, cookie));
      expectStatus(rejected, 422, "Invalid CSV atomicity");
      check(!(await coordinatorRecords(side, cookie)).includes(marker), "Invalid CSV creates no partial invitation");
      console.log("PASS: Invalid CSV rejected without creating its valid first row.");
    }

    const csvName = `Synthetic परिवार, "Guest" ${side} ${runId}`;
    const csvContact = `+1 202 555 01${index}3`;
    const csvSecondName = `Synthetic CSV ${side} Two ${runId}`;
    const csvSecondContact = `+1 202 555 01${index}4`;
    const bulk = await request(`/api/coordinator/${side}/invitations/bulk`, `${side} quoted Unicode CSV import`, jsonPost({
      csv: `\uFEFFname,contactnumber\r\n"${csvName.replaceAll('"', '""')}",${csvContact}\r\n${csvSecondName},${csvSecondContact}\r\n`,
      preferredLocale: "en", contactRole: owner, eventLimits
    }, cookie));
    expectStatus(bulk, 200, `${side} quoted Unicode CSV import`);
    expectPrivate(bulk, `${side} quoted Unicode CSV import`);
    const imported = await json(bulk, `${side} quoted Unicode CSV import`);
    check(imported.ok === true && imported.invitations?.length === 2, `${side} all CSV rows imported`);
    for (const [position, name, contact] of [[0, csvName, csvContact], [1, csvSecondName, csvSecondContact]]) {
      const invitation = imported.invitations[position];
      check(invitation.householdName?.en === name && invitation.contactNumber === contact, `${side} CSV decoded name and contact`);
      const html = await page(privatePath(invitation.invitationUrl, side, `${side} CSV personal link`), `${side} CSV private invitation`);
      check(html.includes(contact), `${side} CSV contact prefills private RSVP`);
    }
    const afterBulk = await coordinatorRecords(side, cookie);
    check(afterBulk.includes(csvContact) && afterBulk.includes(csvSecondContact), `${side} CSV contacts persisted in coordinator records`);

    const manualName = `Synthetic Manual ${side} ${runId}`;
    const manualContact = `+1 202 555 01${index}5`;
    const manual = await request(`/api/coordinator/${side}/invitations`, `${side} manual private invitation contact`, jsonPost({
      householdNameEn: manualName, householdNameHi: "परीक्षण परिवार", preferredLocale: "en",
      contactRole: owner, contactNumber: manualContact, eventLimits
    }, cookie));
    expectStatus(manual, 200, `${side} manual private invitation contact`);
    const issued = await json(manual, `${side} manual private invitation contact`);
    check(issued.ok === true && issued.contactNumber === manualContact, `${side} manual contact response`);
    const privateHtml = await page(privatePath(issued.invitationUrl, side, `${side} manual personal link`), `${side} manual private invitation`);
    check(privateHtml.includes(manualName) && privateHtml.includes(manualContact), `${side} manual private RSVP contact prefill`);
    check(/contact number/i.test(await page(`/coordinator/${side}/invitations`, `${side} coordinator create-link page`, cookie)), `${side} create-link contact field`);
    console.log(`PASS: ${owner} CSV quoted Unicode names, persisted contacts, private pages and manual contact prefill.`);
  }
  console.log("Public invitation Podman smoke passed. Synthetic demo content is retained; containers stay running.");
}

main().catch((error) => {
  // Never print thrown objects, URLs, request bodies, response payloads, or
  // assertion values: successful responses contain private bearer credentials.
  console.error(error instanceof SmokeError ? error.message : "Public invitation smoke: unexpected failure (details suppressed).");
  process.exitCode = 1;
});
