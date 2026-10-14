import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const DISPOSABLE_ORIGIN = "http://127.0.0.1:3001";

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(field); field = ""; }
    else if (character === "\n" && !quoted) { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += character;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

async function downloadText(download) {
  const stream = await download.createReadStream();
  assert.ok(stream, "The browser download must be readable.");
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
}

/**
 * Reusable Playwright suite for the disposable, synthetic stack only.
 * Sensitive values remain in this function's memory. Returned diagnostics and
 * caught errors contain stage names only, never browser URLs or credentials.
 */
export async function runWeddingBrowserSmoke(page, { password, origin = DISPOSABLE_ORIGIN, artifactDir } = {}) {
  if (origin !== DISPOSABLE_ORIGIN) throw new Error("Browser smoke supports only the disposable loopback stack on port 3001.");
  if (typeof password !== "string" || password.length < 16) throw new Error("Browser smoke requires the disposable coordinator password.");
  const suffix = Date.now().toString(36);
  const names = { en: `Browser Family ${suffix}`, hi: `ब्राउज़र परिवार ${suffix}` };
  const secondNames = { en: `Browser Hindi Family ${suffix}`, hi: `हिन्दी परिवार ${suffix}` };
  const note = "=2+2\nVegetarian meal • सीढ़ी रहित प्रवेश";
  const created = [];
  const checks = [];
  const artifacts = [];
  const browserFailures = [];
  let stage = "setup", substage = "", originalContent = null, addedEventId = null, failure = null, cleanupFailed = false;
  const onPageError = () => browserFailures.push("JavaScript error");
  const onConsole = (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/content security policy|violates.*directive|hydration|uncaught|react.*error/i.test(text)) browserFailures.push("JavaScript or CSP console error");
  };
  const onResponse = (response) => {
    if (response.status() === 400 || response.status() >= 500) browserFailures.push(`Unexpected HTTP ${response.status()}`);
  };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  page.on("response", onResponse);
  page.setDefaultTimeout(6_000);
  page.setDefaultNavigationTimeout(15_000);

  async function run(label, action) { stage = label; substage = ""; await action(); checks.push(label); }
  async function api(path, { method = "GET", data, status = 200 } = {}) {
    assert.ok(path.startsWith("/api/") && !path.includes("://"), "Test API requests must stay on the disposable frontend.");
    const response = await page.request.fetch(`${origin}${path}`, { method, headers: { Origin: origin }, ...(data === undefined ? {} : { data }), timeout: 15_000 });
    assert.equal(response.status(), status, "The synthetic test API returned an unexpected status.");
    return response.headers()["content-type"]?.includes("application/json") ? response.json() : response.text();
  }
  async function content() { return (await api("/api/coordinator/content")).configuration; }
  async function saveContent(transform) {
    const current = await content();
    await api("/api/coordinator/content", { method: "PUT", data: transform(current) });
  }
  async function goto(path) { return page.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" }); }
  async function screenshot(name) {
    if (!artifactDir) return;
    assert.equal(await page.locator("#database-issued-link").count(), 0, "Do not capture a one-time invitation link.");
    assert.equal(await page.locator(".entry-pass").count(), 0, "Do not capture an entry credential.");
    assert.equal(await page.locator('input[type="password"]').count(), 0, "Do not capture a password field.");
    await page.evaluate(async () => {
      await document.fonts.ready;
      const finiteAnimations = document.getAnimations().filter((animation) => {
        const timing = animation.effect?.getComputedTiming();
        return timing && Number.isFinite(timing.endTime);
      });
      await Promise.all(finiteAnimations.map((animation) => animation.finished.catch(() => undefined)));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await page.screenshot({ path: join(artifactDir, name), fullPage: true });
    artifacts.push(name);
  }
  async function noOverflow() {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "The page must fit the viewport without horizontal overflow.");
  }
  function rowFor(household) { return page.locator("tbody tr").filter({ hasText: household }); }
  function invitationFor(household) { return page.locator(".database-invitation-list-items > li").filter({ hasText: household }); }
  async function showDetails(household) {
    const details = rowFor(household).locator("details");
    if (!(await details.evaluate((element) => element.open))) await details.locator("summary").click();
  }
  function editor() { return page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: /^(Review and update|Record a reply for) / }) }).last(); }
  async function uiReplySave(expectedStatus = 200) {
    const pending = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/coordinator/rsvp" && response.request().method() === "POST");
    await editor().getByRole("button", { name: "Save reply", exact: true }).click();
    const response = await pending;
    assert.equal(response.status(), expectedStatus, "The coordinator editor returned an unexpected status.");
    const submitted = response.request().postDataJSON();
    assert.ok(!("token" in submitted) && "invitationId" in submitted, "Manual replies must use invitation IDs without bearer links.");
    const result = await response.json();
    if (expectedStatus === 200) await page.locator(".admin-live-notice").filter({ hasText: "Reply saved for" }).waitFor();
    return { result, submitted };
  }
  async function openReply(household) {
    await rowFor(household).getByRole("button", { name: /^(Record reply|Review \/ edit reply)$/ }).click();
    await editor().getByLabel("Respondent’s name", { exact: true }).waitFor();
  }
  async function issue(household, locale, eventIds) {
    await goto("/coordinator/invitations");
    await page.locator("#database-invitation-name-en").fill(household.en);
    await page.locator("#database-invitation-name-hi").fill(household.hi);
    await page.locator('input[name="database-invitation-locale"]').nth(locale === "hi" ? 1 : 0).check();
    const selectedEvents = page.locator(".database-invitation-event-toggle input");
    for (let index = 0; index < await selectedEvents.count(); index += 1) await selectedEvents.nth(index).uncheck();
    for (const eventId of eventIds) {
      await page.locator(`#database-invitation-event-${eventId}`).check();
      await page.locator(`#database-invitation-adults-${eventId}`).fill("2");
      await page.locator(`#database-invitation-children-${eventId}`).fill("1");
    }
    const pending = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/coordinator/invitations" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Create one-time link", exact: true }).click();
    const response = await pending;
    assert.equal(response.status(), 200, "The invitation UI must issue the synthetic household.");
    const issued = await response.json();
    const record = { id: issued.invitationId, household: household[locale], locale };
    created.push(record);
    const link = await page.getByLabel("New private invitation link", { exact: true }).inputValue();
    const parsed = new URL(link);
    assert.ok(parsed.origin === origin && /^\/i\/[A-Za-z0-9_-]{16,128}$/.test(parsed.pathname), "The private link must remain on the disposable origin.");
    record.path = parsed.pathname;
    record.token = parsed.pathname.slice(3);
    await page.getByRole("button", { name: "I shared or saved it — hide link", exact: true }).click();
    assert.equal(await page.locator("#database-issued-link").count(), 0, "Dismissed links must disappear.");
    assert.ok(!(await page.locator("body").innerText()).includes(record.token), "Coordinator records must not redisplay the private link.");
    return record;
  }

  try {
    if (artifactDir) await mkdir(artifactDir, { recursive: true });
    await page.context().clearCookies();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await run("private entry and inactive link", async () => {
      const response = await goto("/");
      assert.equal(response.status(), 200, "The public entry page must load.");
      const text = await page.locator("body").innerText();
      assert.ok(text.includes("Your invitation has a personal link."), "The entry page must explain private links.");
      assert.ok(!/Test Couple|Test venue|Test address|Test Coordinator/.test(text), "The public entry must not disclose wedding information.");
      assert.equal((await goto("/i/invalid-browser-test-token")).status(), 404, "An inactive invitation must return 404.");
      await page.getByRole("heading", { name: "This link could not be opened.", exact: true }).waitFor();
    });
    await run("coordinator login and access gate", async () => {
      await goto("/coordinator/responses");
      await page.waitForURL(`${origin}/coordinator/login`);
      await page.getByLabel("Coordinator password", { exact: true }).fill("invalid-browser-password-123456");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("alert").waitFor();
      await page.getByLabel("Coordinator password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(`${origin}/coordinator`);
      await page.getByRole("heading", { name: "A calmer way to manage every RSVP.", exact: true }).waitFor();
    });
    let eventIds, eventTitles;
    await run("content editor save, discard and test celebrations", async () => {
      originalContent = await content();
      assert.ok(originalContent.events.some((event) => event.id === "test-event"), "The disposable fixture must contain its test event.");
      await goto("/coordinator/content");
      await page.getByRole("heading", { name: "Invitation content", exact: true }).waitFor();
      await page.getByRole("tab", { name: /^Events/ }).click();
      await page.getByRole("heading", { name: "Plan every celebration", exact: true }).waitFor();
      await page.getByRole("tab", { name: /^Reply-to contacts/ }).click();
      await page.getByRole("heading", { name: "Reply-to contacts", exact: true }).waitFor();
      await page.getByRole("tab", { name: /^Wedding details/ }).click();
      const savedName = `Browser Coordination ${suffix}`;
      await page.getByLabel("Fallback name", { exact: true }).fill(savedName);
      const pending = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/coordinator/content" && response.request().method() === "PUT");
      await page.getByRole("button", { name: "Save invitation content", exact: true }).click();
      assert.equal((await pending).status(), 200, "The content editor must save a reversible fixture change.");
      assert.equal((await content()).settings.coordinatorName, savedName, "The saved fixture name must reach the API.");
      await page.getByLabel("Fallback name", { exact: true }).fill("Discarded browser draft");
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByRole("button", { name: "Discard changes", exact: true }).click();
      assert.equal(await page.getByLabel("Fallback name", { exact: true }).inputValue(), savedName, "Discard must restore the saved value.");
      const current = await content();
      const first = current.events.find((event) => event.id === "test-event");
      addedEventId = `browser-event-${suffix}`;
      const second = { ...first, id: addedEventId, slug: addedEventId, titleEn: "Browser celebration", titleHi: "ब्राउज़र समारोह", displayOrder: Math.max(...current.events.map((event) => event.displayOrder)) + 1, published: true, defaultSelected: true, defaultAdultLimit: 2, defaultChildLimit: 1 };
      await api("/api/coordinator/content", { method: "PUT", data: { ...current, events: [...current.events, second] } });
      eventIds = [first.id, second.id];
      eventTitles = [first.titleEn, second.titleEn];
    });
    let main, hindi, passPayload, attendingInput, currentUpdatedAt;
    await run("English and Hindi one-time invitation UI", async () => {
      main = await issue(names, "en", eventIds);
      hindi = await issue(secondNames, "hi", eventIds);
      await goto(hindi.path);
      assert.equal(await page.locator("main").getAttribute("lang"), "hi", "The Hindi invitation must open in Hindi.");
      await page.getByRole("button", { name: "View in English", exact: true }).click();
      await page.waitForFunction(() => document.documentElement.lang === "en");
      await page.getByRole("button", { name: "View in Hindi", exact: true }).click();
      await page.waitForFunction(() => document.documentElement.lang === "hi");
    });
    await run("guest layouts, language switch and required choices", async () => {
      await goto(main.path);
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await noOverflow();
        await screenshot(`guest-before-rsvp-${width}.png`);
      }
      await page.getByRole("button", { name: "View in Hindi", exact: true }).click();
      await page.waitForFunction(() => document.documentElement.lang === "hi");
      await page.getByRole("button", { name: "View in English", exact: true }).click();
      await page.getByRole("button", { name: "Submit RSVP", exact: true }).click();
      await page.locator(".form-error").filter({ hasText: "Please tell us who" }).waitFor();
      await page.getByRole("textbox", { name: /Who is completing this RSVP/ }).fill("Browser Guest Respondent");
      await page.getByRole("button", { name: "Submit RSVP", exact: true }).click();
      await page.locator(".form-error").filter({ hasText: "Please choose your family" }).waitFor();
      await page.getByText("We plan to attend", { exact: true }).click();
      await page.getByRole("button", { name: "Submit RSVP", exact: true }).click();
      await page.locator(".form-error").filter({ hasText: "Please answer yes or no" }).waitFor();
      for (const title of eventTitles) {
        const event = page.locator(".event-response").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
        await event.getByText("Yes, we’ll be there", { exact: true }).click();
        await event.getByRole("button", { name: `Increase Adults · ${title}`, exact: true }).click();
        await event.getByRole("button", { name: `Increase Children · ${title}`, exact: true }).click();
        assert.ok(await event.getByRole("button", { name: `Increase Adults · ${title}`, exact: true }).isDisabled(), "Adult count must stop at the invitation cap.");
        assert.ok(await event.getByRole("button", { name: `Increase Children · ${title}`, exact: true }).isDisabled(), "Child count must stop at the invitation cap.");
      }
      await page.getByRole("textbox", { name: /Anything we should know/ }).fill(note);
    });
    await run("guest RSVP, welcome pass, reload and calendar", async () => {
      const pending = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/rsvp" && response.request().method() === "POST");
      await page.getByRole("button", { name: "Submit RSVP", exact: true }).click();
      const response = await pending;
      assert.equal(response.status(), 200, "The guest RSVP must save.");
      const result = await response.json();
      passPayload = result.entryPass?.qrPayload;
      assert.ok(/^shaadi-entry:v1:[A-Za-z0-9_-]{43}$/.test(passPayload ?? ""), "An attending RSVP must receive an opaque welcome pass.");
      currentUpdatedAt = result.updatedAt;
      attendingInput = { respondentName: "Browser Guest Respondent", status: "attending", attendances: eventIds.map((eventId) => ({ eventId, attending: true, adults: 2, children: 1 })), comfortNote: note };
      await page.getByRole("heading", { name: "We’ve received your response", exact: true }).waitFor();
      assert.equal(await page.locator(".response-summary li").count(), 2, "The confirmation must list both selected celebrations.");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "We’ve received your response", exact: true }).waitFor();
      await page.locator(".entry-pass-qr").waitFor();
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: `Add to calendar: ${eventTitles[0]}`, exact: true }).click();
      const calendar = await downloadText(await downloaded);
      assert.ok(calendar.includes("BEGIN:VCALENDAR") && /DTSTART:\d{8}T\d{6}Z/.test(calendar), "The calendar must contain a valid UTC event.");
      assert.ok(calendar.includes("\\n") && !calendar.includes("\\\\n"), "Calendar descriptions must contain a single escaped newline.");
      assert.ok(!calendar.includes(main.token), "Calendar files must omit bearer credentials.");
    });
    await run("coordinator notes, event CSV and recent/search filters", async () => {
      await goto("/coordinator/responses");
      await showDetails(names.en);
      assert.ok((await rowFor(names.en).innerText()).includes(note), "Coordinator details must show hospitality requests.");
      await page.getByRole("textbox", { name: "Search RSVP records", exact: true }).fill(names.en);
      assert.equal(await page.locator("tbody tr").count(), 1, "Household search must isolate the synthetic reply.");
      await page.getByRole("button", { name: "Clear search", exact: true }).click();
      await page.getByRole("combobox", { name: "Sort RSVP records", exact: true }).selectOption("recent");
      assert.ok((await page.locator("tbody tr").first().innerText()).includes(names.en), "Recent activity must put the newer reply above the later-issued pending household.");
      await page.getByRole("button", { name: /^Pending\s*\d/ }).click();
      await rowFor(secondNames.hi).waitFor();
      assert.equal(await rowFor(names.en).count(), 0, "The pending filter must exclude responded households.");
      await page.getByRole("button", { name: /^All\s*\d/ }).click();
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export CSV", exact: true }).click();
      const csv = await downloadText(await downloaded);
      const rows = parseCsv(csv), heading = rows.shift();
      const index = (name) => heading.indexOf(name);
      const ownRows = rows.filter((row) => row[index("Household")] === names.en);
      assert.equal(ownRows.length, 2, "The CSV must have a separate row for each invited celebration.");
      for (const row of ownRows) {
        assert.equal(row[index("Adults")], "2", "CSV counts must stay separate per celebration.");
        assert.equal(row[index("Children")], "1", "CSV child counts must stay separate per celebration.");
        assert.equal(row[index("Hospitality requests")], `'${note}`, "The CSV must retain Hindi needs while escaping spreadsheet formulas.");
        assert.ok(eventTitles.includes(row[index("Event")]), "The CSV must identify each celebration.");
        assert.ok(row[index("Coordinator")] && row[index("Coordinator phone")], "The CSV must include the current support contact.");
      }
      assert.ok(rows.some((row) => row[index("Household")] === secondNames.hi), "The CSV must preserve Hindi household names.");
      assert.ok(!csv.includes(main.token) && !csv.includes(passPayload), "The CSV must omit invitation and entry credentials.");
    });
    await run("phone reply editing and optimistic conflict", async () => {
      substage = "open the existing household reply";
      await openReply(names.en);
      substage = "verify the loaded respondent";
      assert.equal(await editor().getByLabel("Respondent’s name", { exact: true }).inputValue(), "Browser Guest Respondent", "Manual editing must restore the respondent.");
      substage = "fill the phone respondent and hospitality request";
      await editor().getByLabel("Respondent’s name", { exact: true }).fill("Browser Phone Respondent");
      await editor().getByRole("textbox", { name: /^Hospitality requests \(optional\)/ }).fill("Phone meal request");
      substage = "save the phone reply and await its confirmation";
      const saved = await uiReplySave();
      currentUpdatedAt = saved.result.updatedAt;
      substage = "expand the saved response details";
      await showDetails(names.en);
      substage = "wait for the refreshed phone hospitality request";
      await rowFor(names.en).getByText("Phone meal request", { exact: false }).waitFor();
      assert.ok((await rowFor(names.en).innerText()).includes("Phone meal request"), "Saving a phone reply must refresh visible notes.");
      substage = "reopen the reply for a concurrency check";
      await openReply(names.en);
      substage = "fill an unsaved coordinator change";
      await editor().getByRole("textbox", { name: /^Hospitality requests \(optional\)/ }).fill("Unsaved phone change");
      substage = "save an intervening guest response through the test API";
      const concurrent = await api("/api/rsvp", { method: "POST", data: { token: main.token, ...attendingInput, respondentName: "Browser Concurrent Respondent", comfortNote: "Concurrent response" } });
      currentUpdatedAt = concurrent.updatedAt;
      substage = "submit the stale editor and verify HTTP conflict";
      await uiReplySave(409);
      substage = "verify the conflict alert";
      await editor().getByRole("alert").waitFor();
      substage = "reload the current response from the conflict control";
      await editor().getByRole("button", { name: "Reload current response", exact: true }).click();
      substage = "expand the reloaded response details";
      await showDetails(names.en);
      substage = "wait for the intervening response notes";
      await rowFor(names.en).getByText("Concurrent response", { exact: false }).waitFor();
      assert.ok((await rowFor(names.en).innerText()).includes("Concurrent response"), "Reload must show the intervening response.");
    });
    await run("manual gate check-in and repeated pass", async () => {
      await goto("/coordinator/check-in");
      await page.getByRole("combobox", { name: /^Celebration for this check-in/ }).selectOption(eventIds[0]);
      await page.getByRole("button", { name: "Enter pass code", exact: true }).click();
      for (const expected of ["Entry recorded", "Already checked in"]) {
        await page.getByLabel("Entry pass code", { exact: true }).fill(passPayload);
        await page.getByRole("button", { name: "Check in guest", exact: true }).click();
        await page.getByText(expected, { exact: true }).waitFor();
      }
      assert.equal(await page.getByLabel("Entry pass code", { exact: true }).inputValue(), "", "The scanner must clear submitted credentials.");
    });
    await run("late phone replies, provisional/declined filters and pass invalidation", async () => {
      await saveContent((current) => ({ ...current, settings: { ...current.settings, canEditUntil: new Date(Date.now() - 60_000).toISOString() } }));
      await api("/api/rsvp", { method: "POST", status: 422, data: { token: main.token, ...attendingInput } });
      await goto("/coordinator/responses");
      await openReply(secondNames.hi);
      await editor().getByLabel("Respondent’s name", { exact: true }).fill("Browser Hindi Phone Respondent");
      for (const title of eventTitles) {
        const event = editor().getByRole("group", { name: title, exact: true });
        await event.getByRole("combobox", { name: /^Attendance/ }).selectOption("yes");
        await event.getByLabel("Adults (up to 2)", { exact: true }).fill("2");
        await event.getByLabel("Children (up to 1)", { exact: true }).fill("1");
      }
      await editor().getByRole("textbox", { name: /^Hospitality requests \(optional\)/ }).fill("देर से फ़ोन पर पुष्टि");
      await uiReplySave();
      await rowFor(secondNames.hi).getByText("Browser Hindi Phone Respondent", { exact: true }).waitFor();
      await openReply(names.en);
      await editor().getByRole("combobox", { name: /^Household’s plan/ }).selectOption("confirming");
      currentUpdatedAt = (await uiReplySave()).result.updatedAt;
      await rowFor(names.en).getByText("Confirming", { exact: true }).waitFor();
      await page.getByRole("button", { name: /^Confirming\s*\d/ }).click();
      await rowFor(names.en).waitFor();
      assert.equal(await rowFor(secondNames.hi).count(), 0, "The provisional filter must exclude final replies.");
      await page.getByRole("button", { name: /^All\s*\d/ }).click();
      await openReply(names.en);
      await editor().getByRole("combobox", { name: /^Household’s plan/ }).selectOption("declined");
      await editor().getByLabel("Message for the couple (optional)", { exact: true }).fill("Browser good wishes • शुभकामनाएँ");
      currentUpdatedAt = (await uiReplySave()).result.updatedAt;
      await rowFor(names.en).getByText("Declined", { exact: true }).waitFor();
      await page.getByRole("button", { name: /^Declined\s*\d/ }).click();
      await showDetails(names.en);
      assert.ok((await rowFor(names.en).innerText()).includes("शुभकामनाएँ"), "Declined replies must retain wishes for the couple.");
      await api("/api/coordinator/check-in", { method: "POST", status: 404, data: { passToken: passPayload.slice("shaadi-entry:v1:".length), eventId: eventIds[0] } });
      await saveContent((current) => ({ ...current, settings: { ...current.settings, canEditUntil: originalContent.settings.canEditUntil } }));
    });
    await run("workspace mobile and desktop layouts", async () => {
      const paths = ["/coordinator", "/coordinator/content", "/coordinator/invitations", "/coordinator/responses", "/coordinator/follow-ups", "/coordinator/check-in"];
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const path of paths) {
          await goto(path);
          await page.locator("main").waitFor();
          await noOverflow();
          if (path === "/coordinator" || path === "/coordinator/responses") await screenshot(`coordinator-${path === "/coordinator" ? "overview" : "responses"}-${width}.png`);
        }
      }
    });
    await run("UI revocation, response erasure and expired guest access", async () => {
      await goto("/coordinator/invitations");
      for (const record of [main, hindi]) {
        const row = invitationFor(record.household);
        page.once("dialog", (dialog) => void dialog.accept());
        await row.getByRole("button", { name: "Delete & revoke link", exact: true }).click();
        await row.getByRole("button", { name: "Delete RSVP", exact: true }).waitFor();
        page.once("dialog", (dialog) => void dialog.accept());
        await row.getByRole("button", { name: "Delete RSVP", exact: true }).click();
        await row.getByText(/^RSVP deleted /).waitFor();
      }
      assert.equal((await goto(main.path)).status(), 404, "Revoked invitation links must stop working.");
      await api("/api/coordinator/rsvp", { method: "POST", status: 404, data: { invitationId: main.id, ...attendingInput, expectedUpdatedAt: currentUpdatedAt } });
    });
    await run("coordinator sign-out and session access gate", async () => {
      substage = "sign out through the workspace";
      await goto("/coordinator");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page.waitForURL(`${origin}/coordinator/login`);
      substage = "verify the page and API access gates after sign-out";
      await goto("/coordinator/responses");
      await page.waitForURL(`${origin}/coordinator/login`);
      await api("/api/coordinator/content", { status: 401 });
      substage = "sign in again for fixture cleanup";
      await page.getByLabel("Coordinator password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(`${origin}/coordinator`);
    });
    await run("browser JavaScript and CSP checks", async () => {
      assert.equal(browserFailures.length, 0, "The browser must have no unexpected JavaScript, CSP, HTTP 400, or server errors.");
    });
  } catch (cause) {
    // Playwright error strings can include bearer URLs or filled credentials.
    const causeKind = cause?.name === "TimeoutError" ? "Playwright action timed out" : cause?.name === "AssertionError" ? "Assertion failed" : "Browser action failed";
    failure = new Error(`Wedding browser smoke failed during: ${stage}${substage ? `; ${substage}` : ""}. ${causeKind}. Detailed browser errors were withheld to protect private links.`);
  } finally {
    stage = "synthetic fixture cleanup";
    if (created.length || originalContent) {
      try {
        const login = await page.request.post(`${origin}/api/coordinator/login`, { headers: { Origin: origin }, data: { password } });
        if (login.status() !== 200) cleanupFailed = true;
      } catch { cleanupFailed = true; }
    }
    for (const record of created) {
      try {
        const revoke = await page.request.post(`${origin}/api/coordinator/invitations/revoke`, { headers: { Origin: origin }, data: { invitationId: record.id } });
        if (![200, 404].includes(revoke.status())) cleanupFailed = true;
        const erase = await page.request.post(`${origin}/api/coordinator/invitations/rsvp/delete`, { headers: { Origin: origin }, data: { invitationId: record.id } });
        if (![200, 404, 409].includes(erase.status())) cleanupFailed = true;
      } catch { cleanupFailed = true; }
    }
    if (originalContent) {
      try {
        await saveContent((current) => ({ ...current, settings: originalContent.settings, contacts: originalContent.contacts,
          events: current.events.map((event) => originalContent.events.find((original) => original.id === event.id) ?? (event.id === addedEventId ? { ...event, published: false, defaultSelected: false } : event))
        }));
      } catch { cleanupFailed = true; }
    }
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
    page.off("response", onResponse);
  }
  if (cleanupFailed) throw new Error("Wedding browser smoke fixture cleanup failed. Review only the disposable stack before rerunning.");
  if (failure) throw failure;
  return { passed: true, checks, screenshots: artifacts, browserErrors: browserFailures.length, createdHouseholds: created.length, cleanup: "Synthetic invitations revoked, replies erased, settings restored and the added test celebration archived." };
}
