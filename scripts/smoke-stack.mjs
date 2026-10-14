import assert from "node:assert/strict";

// This test creates and revokes a synthetic invitation. Keep its destination
// fixed to the disposable Podman stack, never a durable or deployed database.
const origin = "http://127.0.0.1:3001";
if (process.env.SMOKE_BASE_URL && process.env.SMOKE_BASE_URL !== origin) {
  throw new Error("The smoke test only supports the disposable loopback stack on port 3001.");
}

const password = process.env.COORDINATOR_PASSWORD;
if (!password || password.length < 16) {
  throw new Error("Load the local .env file with COORDINATOR_PASSWORD before running the smoke test.");
}

async function request(path, label, options = {}) {
  try {
    return await fetch(new URL(path, origin), {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new Error(`${label}: request failed.`);
  }
}

function expectStatus(response, status, label) {
  assert.equal(response.status, status, `${label}: expected HTTP ${status}, got ${response.status}`);
}

async function json(response, label) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${label}: invalid JSON response.`);
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

const health = await request("/healthz", "Frontend liveness");
expectStatus(health, 200, "Frontend liveness");
const ready = await request("/readyz", "Stack readiness");
expectStatus(ready, 200, "Stack readiness");

const home = await request("/", "Private entry page");
expectStatus(home, 200, "Private entry page");
assert.match(await home.text(), /personal link/i, "The entry page should explain private links.");

const forbidden = await request("/api/coordinator/login", "Cross-origin login", {
  ...jsonPost({ password }),
  headers: { "Content-Type": "application/json", Origin: "https://other.example" }
});
expectStatus(forbidden, 403, "Cross-origin login");

const login = await request("/api/coordinator/login", "Coordinator login", jsonPost({ password }));
expectStatus(login, 200, "Coordinator login");
assert.equal((await json(login, "Coordinator login")).ok, true);
const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
assert.ok(cookie?.startsWith("shaadi_coordinator_session="), "Coordinator session cookie is missing.");

const workspace = await request("/coordinator", "Coordinator workspace", { headers: { Cookie: cookie } });
expectStatus(workspace, 200, "Coordinator workspace");

const issue = await request("/api/coordinator/invitations", "Create invitation", jsonPost({
  householdNameEn: "Smoke Household",
  householdNameHi: "परीक्षण परिवार",
  preferredLocale: "en",
  contactRole: "groom",
  eventLimits: [{ eventId: "test-event", adults: 2, children: 0 }]
}, cookie));
expectStatus(issue, 200, "Create invitation");
const issued = await json(issue, "Create invitation");
assert.equal(issued.ok, true);
assert.match(issued.invitationId, /^[0-9a-f-]{36}$/i);
const inviteUrl = new URL(issued.invitationUrl);
assert.equal(inviteUrl.origin, origin, "Invitation URL must use the public loopback origin.");
assert.match(inviteUrl.pathname, /^\/i\/[A-Za-z0-9_-]{16,128}$/);
const token = inviteUrl.pathname.slice(3);

const invitationRecords = await request("/coordinator/invitations", "Invitation records", { headers: { Cookie: cookie } });
expectStatus(invitationRecords, 200, "Invitation records");
assert.ok(!(await invitationRecords.text()).includes(token), "Coordinator records must not disclose the raw invitation token.");

const invite = await request(inviteUrl.pathname, "Guest invitation");
expectStatus(invite, 200, "Guest invitation");
assert.match(invite.headers.get("cache-control") ?? "", /no-store/i);
assert.equal(invite.headers.get("referrer-policy"), "no-referrer");
const invitationHtml = await invite.text();
assert.match(invitationHtml, /Smoke Household/);
const socialMetadata = (invitationHtml.match(/<meta[^>]*>/gi) ?? [])
  .filter((tag) => /og:|twitter:/i.test(tag))
  .join("\n");
assert.match(socialMetadata, /invitation-share\.png/, "The private link needs a generic share preview.");
assert.ok(!socialMetadata.includes(token), "Share metadata must not expose the invitation token.");
assert.ok(!socialMetadata.includes("Smoke Household"), "Share metadata must not expose the household name.");

const overLimit = await request("/api/rsvp", "Guest limit enforcement", jsonPost({
  token,
  respondentName: "Smoke Guest",
  status: "attending",
  attendances: [{ eventId: "test-event", attending: true, adults: 3, children: 0 }]
}));
expectStatus(overLimit, 422, "Guest limit enforcement");

const rsvp = await request("/api/rsvp", "Guest RSVP", jsonPost({
  token,
  respondentName: "Smoke Guest",
  status: "attending",
  attendances: [{ eventId: "test-event", attending: true, adults: 2, children: 0 }],
  comfortNote: "Nut allergy"
}));
expectStatus(rsvp, 200, "Guest RSVP");
const saved = await json(rsvp, "Guest RSVP");
assert.equal(saved.ok, true);
assert.equal(saved.mode, "database");
assert.match(saved.entryPass?.qrPayload ?? "", /^shaadi-entry:v1:[A-Za-z0-9_-]{43}$/);
const passToken = saved.entryPass.qrPayload.slice("shaadi-entry:v1:".length);

const responsePage = await request("/coordinator/responses", "Hospitality notes", { headers: { Cookie: cookie } });
expectStatus(responsePage, 200, "Hospitality notes");
assert.match(await responsePage.text(), /Nut allergy/, "The coordinator must be able to read guest needs.");

const manualInput = {
  invitationId: issued.invitationId,
  respondentName: "Smoke phone respondent",
  status: "attending",
  attendances: [{ eventId: "test-event", attending: true, adults: 2, children: 0 }],
  comfortNote: "Step-free entrance",
  expectedUpdatedAt: saved.updatedAt
};
const anonymousManual = await request("/api/coordinator/rsvp", "Anonymous manual RSVP", jsonPost(manualInput));
expectStatus(anonymousManual, 401, "Anonymous manual RSVP");
const crossOriginManual = await request("/api/coordinator/rsvp", "Cross-origin manual RSVP", {
  ...jsonPost(manualInput, cookie),
  headers: { "Content-Type": "application/json", Origin: "https://other.example", Cookie: cookie }
});
expectStatus(crossOriginManual, 403, "Cross-origin manual RSVP");
const manual = await request("/api/coordinator/rsvp", "Phone RSVP", jsonPost(manualInput, cookie));
expectStatus(manual, 200, "Phone RSVP");
const manuallySaved = await json(manual, "Phone RSVP");
assert.equal(manuallySaved.ok, true);
assert.ok(!JSON.stringify(manuallySaved).includes(token), "Manual responses must not expose invitation credentials.");
const staleManual = await request("/api/coordinator/rsvp", "Stale RSVP correction", jsonPost(manualInput, cookie));
expectStatus(staleManual, 409, "Stale RSVP correction");
const correctedPage = await request("/coordinator/responses", "Corrected hospitality notes", { headers: { Cookie: cookie } });
expectStatus(correctedPage, 200, "Corrected hospitality notes");
assert.match(await correctedPage.text(), /Step-free entrance/);

const calendar = await request("/api/calendar/test-event", "Calendar download", jsonPost({ token }));
expectStatus(calendar, 200, "Calendar download");
const calendarText = await calendar.text();
assert.match(calendarText, /BEGIN:VCALENDAR/);
assert.ok(!calendarText.includes(token), "Calendar file must not contain the invitation token.");
assert.ok(!calendarText.includes("\\\\n"), "Calendar descriptions must not contain a double-escaped newline.");

const checkIn = await request("/api/coordinator/check-in", "Gate check-in", jsonPost({
  passToken,
  eventId: "test-event"
}, cookie));
expectStatus(checkIn, 200, "Gate check-in");
assert.equal((await json(checkIn, "Gate check-in")).outcome, "checked_in");

// Only this disposable fixture's deadline is changed, and it is restored before
// the rest of the flow. Guest writes must close while authenticated corrections
// remain available to coordinators who receive a late phone/WhatsApp response.
const content = await request("/api/coordinator/content", "Read test content", { headers: { Cookie: cookie } });
expectStatus(content, 200, "Read test content");
const originalContent = (await json(content, "Read test content")).configuration;
let cutoffChanged = false;
try {
  const closedContent = {
    ...originalContent,
    settings: { ...originalContent.settings, canEditUntil: new Date(Date.now() - 60_000).toISOString() }
  };
  const closeWindow = await request("/api/coordinator/content", "Close guest RSVP window", {
    ...jsonPost(closedContent, cookie), method: "PUT"
  });
  expectStatus(closeWindow, 200, "Close guest RSVP window");
  cutoffChanged = true;
  const lateGuest = await request("/api/rsvp", "Late guest RSVP", jsonPost({
    token, respondentName: "Smoke Guest", status: "declined",
    attendances: [{ eventId: "test-event", attending: false, adults: 0, children: 0 }]
  }));
  expectStatus(lateGuest, 422, "Late guest RSVP");
  const lateManual = await request("/api/coordinator/rsvp", "Late phone correction", jsonPost({
    ...manualInput,
    status: "declined", comfortNote: "", declineMessage: "Called to decline",
    attendances: [{ eventId: "test-event", attending: false, adults: 0, children: 0 }],
    expectedUpdatedAt: manuallySaved.updatedAt
  }, cookie));
  expectStatus(lateManual, 200, "Late phone correction");
  const invalidatedPass = await request("/api/coordinator/check-in", "Corrected RSVP invalidates pass", jsonPost({
    passToken, eventId: "test-event"
  }, cookie));
  expectStatus(invalidatedPass, 404, "Corrected RSVP invalidates pass");
} finally {
  if (cutoffChanged) {
    const latest = await request("/api/coordinator/content", "Read latest test content", { headers: { Cookie: cookie } });
    expectStatus(latest, 200, "Read latest test content");
    const current = (await json(latest, "Read latest test content")).configuration;
    const restore = await request("/api/coordinator/content", "Restore test RSVP window", {
      ...jsonPost({ ...current, settings: { ...current.settings, canEditUntil: originalContent.settings.canEditUntil } }, cookie),
      method: "PUT"
    });
    expectStatus(restore, 200, "Restore test RSVP window");
  }
}

const revoke = await request("/api/coordinator/invitations/revoke", "Revoke invitation", jsonPost({
  invitationId: issued.invitationId
}, cookie));
expectStatus(revoke, 200, "Revoke invitation");

const revokedPage = await request(inviteUrl.pathname, "Revoked invitation");
expectStatus(revokedPage, 404, "Revoked invitation");

const revokedPass = await request("/api/coordinator/check-in", "Revoked entry pass", jsonPost({
  passToken,
  eventId: "test-event"
}, cookie));
expectStatus(revokedPass, 404, "Revoked entry pass");
const revokedCorrection = await request("/api/coordinator/rsvp", "Revoked RSVP correction", jsonPost({
  ...manualInput, expectedUpdatedAt: null
}, cookie));
expectStatus(revokedCorrection, 404, "Revoked RSVP correction");

const erase = await request("/api/coordinator/invitations/rsvp/delete", "Erase revoked RSVP", jsonPost({
  invitationId: issued.invitationId
}, cookie));
expectStatus(erase, 200, "Erase revoked RSVP");

process.stdout.write("Smoke flow passed: readiness, private sharing, coordinator auth, guest and phone RSVPs, hospitality notes, stale-edit protection, guest cutoff, calendar, check-in, pass invalidation, revocation, and RSVP deletion.\n");
