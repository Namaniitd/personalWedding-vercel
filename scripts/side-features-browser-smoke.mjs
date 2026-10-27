import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const origin = "http://127.0.0.1:3001";

/** Exercise side ownership and new invitation features using synthetic data only. */
export async function runSideFeaturesBrowserSmoke(browser, { groomPassword, bridePassword, artifactDir } = {}) {
  assert.ok(groomPassword?.length >= 16 && bridePassword?.length >= 16 && groomPassword !== bridePassword,
    "Independent synthetic coordinator passwords are required.");
  const contexts = [], checks = [], issued = [];
  // Playwright WebKit inserts an unnonced stylesheet for every screenshot.
  // Keep its rendering/CSP checks intact; capture visual artifacts in Chromium.
  const captureScreenshots = artifactDir && browser.browserType().name() !== "webkit";
  const suffix = Date.now().toString(36);
  let stage = "setup", groom = null, bride = null;
  const failures = [];
  function safeDiagnostic(message) {
    let detail = String(message).split("\n")[0].replace(/https?:\/\/\S+/g, "[private URL]");
    for (const secret of [groomPassword, bridePassword, ...issued.map(record => record.token)].filter(Boolean)) {
      detail = detail.replaceAll(secret, "[private credential]");
    }
    return detail;
  }
  async function newPage(options = {}) {
    const context = await browser.newContext(options);
    contexts.push(context);
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on("pageerror", error => failures.push(`${stage}: ${safeDiagnostic(error.message)}`));
    page.on("console", message => {
      if (message.type() === "error" && /content security policy|violates.*directive|hydration|uncaught/i.test(message.text())) failures.push(`${stage}: ${safeDiagnostic(message.text())}`);
    });
    return page;
  }
  async function api(page, side, path, { method = "GET", data, status = 200 } = {}) {
    const response = await page.request.fetch(`${origin}/api/coordinator/${side}/${path}`, {
      method, headers: { Origin: origin }, ...(data ? { data } : {})
    });
    if (!(Array.isArray(status) ? status : [status]).includes(response.status())) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(`Scoped ${side}/${path} returned ${response.status()} instead of ${status}: ${payload.error ?? "Unavailable"}`);
    }
    return response.headers()["content-type"]?.includes("application/json") ? response.json() : null;
  }
  async function content(page, side) {
    const { side: owner, ...configuration } = (await api(page, side, "content")).configuration;
    assert.equal(owner, side === "b" ? "bride" : "groom");
    return configuration;
  }
  async function login(page, side, password) {
    await page.goto(`${origin}/coordinator/${side}/login`);
    await page.getByLabel("Coordinator password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${origin}/coordinator/${side}`);
  }
  async function fits(page) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "The page must fit its viewport.");
  }
  try {
    if (captureScreenshots) await mkdir(artifactDir, { recursive: true });
    groom = await newPage({ viewport: { width: 1440, height: 1000 } });
    bride = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    stage = "independent login and empty bride workspace";
    await login(groom, "g", groomPassword);
    await login(bride, "b", bridePassword);
    const loadedBaseline = await content(groom, "g");
    const baseline = { ...loadedBaseline, settings: { ...loadedBaseline.settings, canEditUntil: new Date(Date.now() + 3_600_000).toISOString() } };
    const brideEmpty = await content(bride, "b");
    assert.ok(brideEmpty.events.every(event => event.id.startsWith("b-smoke-")), "A bride workspace must contain only its own synthetic events.");
    assert.equal(brideEmpty.contacts.length, 0, "A new bride workspace starts with no copied contacts.");
    await api(groom, "b", "content", { status: 401 });
    await api(bride, "g", "content", { status: 401 });
    await api(bride, "b", "invitations", { method: "POST", data: { side: "groom" }, status: 400 });
    checks.push(stage);

    stage = "an old tab stays bound to its team after switching accounts";
    await api(groom, "b", "login", { method: "POST", data: { password: bridePassword } });
    await groom.locator(".admin-priority-card").click();
    await groom.waitForURL(`${origin}/coordinator/g/login`);
    await login(groom, "g", groomPassword);
    checks.push(stage);

    stage = "separate venue and description with the same event slug";
    const template = baseline.events.find(event => event.published);
    assert.ok(template, "A published synthetic fixture is required.");
    const brideEvent = { ...template, id: brideEmpty.events.find(event => event.published)?.id ?? `b-smoke-${suffix}`, slug: template.slug,
      titleEn: "Bride celebration", titleHi: "वधू समारोह", venueEn: "Bride test garden", venueHi: "वधू परीक्षण उद्यान",
      descriptionEn: "Bride-only description", descriptionHi: "केवल वधू की जानकारी", popupDetails: [], published: true, defaultSelected: true };
    await api(bride, "b", "content", { method: "PUT", data: { ...brideEmpty, settings: { ...baseline.settings, coordinatorName: "Bride test coordinator" }, contacts: [], events: [brideEvent, ...brideEmpty.events.filter(event => event.id !== brideEvent.id).map((event, index) => ({ ...event, displayOrder: index + 100, published: false, defaultSelected: false, slug: event.id }))] } });
    assert.ok(!(await content(groom, "g")).events.some(event => event.id === brideEvent.id));
    checks.push(stage);

    await api(groom, "g", "content", { method: "PUT", data: { ...baseline, events: baseline.events.map(event => event.id === template.id ? { ...event, descriptionEn: "", descriptionHi: "", popupDetails: [] } : event) } });
    stage = "custom popup editor on desktop and mobile";
    for (const [page, code, description] of [[groom, "g", "Groom-only description"], [bride, "b", "Bride-only description"]]) {
      await page.goto(`${origin}/coordinator/${code}/content`);
      await page.getByRole("tab", { name: /^Events/ }).click();
      await page.getByLabel(/^Description\s*English/).fill(description);
      await page.getByLabel(/^Description\s*हिन्दी/).fill("समारोह की पूरी जानकारी");
      await page.getByRole("button", { name: "+ Parking", exact: true }).click();
      let field = page.getByRole("region", { name: "Custom popup field 1", exact: true });
      await field.getByLabel(/^Field content\s*English/).fill("Use the east gate.");
      await field.getByLabel(/^Field content\s*हिन्दी/).fill("पूर्वी द्वार से आएँ।");
      await page.getByRole("button", { name: "Add custom field", exact: true }).click();
      field = page.getByRole("region", { name: "Custom popup field 2", exact: true });
      await field.getByLabel(/^Field label\s*English/).fill("Family gathering");
      await field.getByLabel(/^Field label\s*हिन्दी/).fill("परिवार मिलन");
      await field.getByLabel(/^Field content\s*English/).fill("Meet the family before the ceremony.\n" + "There is step-free access. ".repeat(35));
      await field.getByLabel(/^Field content\s*हिन्दी/).fill("समारोह से पहले परिवार से मिलें।");
      await page.getByRole("button", { name: "Move popup field 2 up", exact: true }).click();
      await fits(page);
      const response = page.waitForResponse(r => r.url().endsWith(`/api/coordinator/${code}/content`) && r.request().method() === "PUT");
      await page.getByRole("button", { name: "Save invitation content", exact: true }).click();
      assert.equal((await response).status(), 200, "The custom popup fields must save.");
      await page.reload();
      await page.getByRole("tab", { name: /^Events/ }).click();
      assert.equal(await page.getByRole("region", { name: "Custom popup field 1", exact: true }).getByLabel(/^Field label\s*English/).inputValue(), "Family gathering");
      assert.equal((await content(page, code)).events[0].descriptionEn, description);
    }
    checks.push(stage);

    stage = "scoped invitations and wrong-side URLs";
    for (const [page, code, event] of [[groom, "g", template], [bride, "b", brideEvent]]) {
      const result = await api(page, code, "invitations", { method: "POST", data: {
        householdNameEn: `${code} Synthetic Family ${suffix}`, householdNameHi: "परीक्षण परिवार", preferredLocale: "en",
        eventLimits: [{ eventId: event.id, adults: 2, children: 0 }]
      } });
      const url = new URL(result.invitationUrl);
      assert.equal(url.origin, origin);
      assert.ok(url.pathname.startsWith(`/i/${code}/`));
      issued.push({ ...result, code, path: url.pathname, token: url.pathname.split("/").at(-1), event });
      assert.equal((await page.request.get(`${origin}${url.pathname.replace(`/i/${code}/`, `/i/${code === "g" ? "b" : "g"}/`)}`)).status(), 404);
    }
    await api(bride, "b", "invitations/revoke", { method: "POST", data: { invitationId: issued[0].invitationId }, status: 404 });
    await api(groom, "g", "invitations/revoke", { method: "POST", data: { invitationId: issued[1].invitationId }, status: 404 });
    checks.push(stage);

    stage = "desktop and mobile invitation popup, localization and layouts";
    const guest = await newPage({ viewport: { width: 1440, height: 1000 } });
    for (const record of issued) {
      await guest.goto(origin + record.path);
      for (const width of [1440, 768, 390, 320]) {
        await guest.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
        await fits(guest);
        const trigger = guest.locator('button[aria-haspopup="dialog"]').first();
        await trigger.click();
        const dialog = guest.getByRole("dialog");
        await dialog.waitFor();
        assert.ok((await dialog.innerText()).includes(record.code === "b" ? "Bride-only description" : "Groom-only description"));
        assert.ok((await dialog.innerText()).includes("Family gathering"));
        assert.ok((await dialog.innerText()).includes("Use the east gate."));
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.width <= width && bounds.height <= (width < 500 ? 844 : 1000));
        if (captureScreenshots && [1440, 390].includes(width)) {
          // Let the real entrance animation finish before visual inspection.
          await guest.evaluate(async () => {
            await document.fonts.ready;
            await Promise.all(document.getAnimations()
              .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
              .map(animation => animation.finished.catch(() => undefined)));
          });
          await guest.screenshot({ path: join(artifactDir, `${record.code}-popup-${width}.png`) });
        }
        await guest.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
        await trigger.click();
        await guest.getByRole("button", { name: "Close event details", exact: true }).click();
      }
      await guest.getByRole("button", { name: "View in Hindi", exact: true }).click();
      await guest.locator('button[aria-haspopup="dialog"]').first().click();
      assert.ok((await guest.getByRole("dialog").innerText()).includes("परिवार मिलन"));
      await guest.getByRole("button", { name: "समारोह की जानकारी बंद करें", exact: true }).click();
      await guest.getByRole("button", { name: "View in English", exact: true }).click();
    }
    checks.push(stage);

    stage = "automatic photo advance, loop and manual pause";
    await guest.goto(origin + issued[0].path);
    const carousel = guest.getByRole("region", { name: "Our pre-wedding photographs", exact: true });
    await carousel.locator('[data-slide="1"][aria-hidden="false"]').waitFor();
    for (const slide of [2, 3, 1]) await carousel.locator(`[data-slide="${slide}"][aria-hidden="false"]`).waitFor({ timeout: 10_000 });
    await guest.getByRole("button", { name: "Pause slideshow", exact: true }).click();
    assert.equal(await carousel.getAttribute("data-playing"), "false");
    await guest.getByRole("button", { name: "Next photograph", exact: true }).click();
    await carousel.locator('[data-slide="2"][aria-hidden="false"]').waitFor();
    const reduced = await newPage({ reducedMotion: "reduce", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await reduced.goto(origin + issued[1].path);
    await reduced.getByRole("button", { name: "Play slideshow", exact: true }).waitFor();
    assert.equal(await reduced.getByRole("region", { name: "Our pre-wedding photographs", exact: true }).getAttribute("data-playing"), "false");
    await reduced.locator('button[aria-haspopup="dialog"]').first().click();
    await reduced.getByRole("dialog").waitFor();
    await reduced.getByRole("button", { name: "Back to invitation", exact: true }).tap();
    await fits(reduced);
    await reduced.getByRole("button", { name: "Play slideshow", exact: true }).click();
    await reduced.locator('[data-slide="2"][aria-hidden="false"]').waitFor({ timeout: 10_000 });
    checks.push(stage);

    stage = "both sides' RSVP, welcome pass, responses and check-in isolation";
    const passes = [];
    for (const [index, record] of issued.entries()) {
      const page = index === 0 ? guest : reduced;
      await page.goto(origin + record.path);
      await page.getByRole("textbox", { name: /Name of the person replying/ }).fill("Synthetic side respondent");
      await page.getByText("We’ll be there", { exact: true }).click();
      await page.locator(".event-response").getByText("Yes, we’ll be there", { exact: true }).click();
      const pending = page.waitForResponse(response => response.url().endsWith("/api/rsvp") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Send reply", exact: true }).click();
      const response = await pending;
      assert.equal(response.status(), 200, "Both sides must accept their own guest replies.");
      const result = await response.json();
      assert.match(result.entryPass?.qrPayload ?? "", /^shaadi-entry:v1:[A-Za-z0-9_-]{43}$/);
      passes.push(result.entryPass.qrPayload.slice("shaadi-entry:v1:".length));
      await page.getByRole("heading", { name: "We’ve received your reply", exact: true }).waitFor();
      await page.reload();
      await page.locator(".entry-pass-qr").waitFor();
      const actor = record.code === "b" ? bride : groom;
      await actor.goto(`${origin}/coordinator/${record.code}/responses`);
      const text = await actor.locator("body").innerText();
      assert.ok(text.includes(record.householdName.en));
      assert.ok(!text.includes(issued[1 - index].householdName.en), "A coordinator must never see the other side's household.");
    }
    await api(bride, "b", "check-in", { method: "POST", data: { passToken: passes[0], eventId: issued[0].event.id }, status: 404 });
    await api(groom, "g", "check-in", { method: "POST", data: { passToken: passes[1], eventId: issued[1].event.id }, status: 404 });
    for (const [index, record] of issued.entries()) {
      const actor = record.code === "b" ? bride : groom;
      const result = await api(actor, record.code, "check-in", { method: "POST", data: { passToken: passes[index], eventId: record.event.id } });
      assert.equal(result.outcome, "checked_in");
    }
    checks.push(stage);
    assert.equal(failures.length, 0, `Browser rendering errors: ${failures.join("; ")}`);
    return { passed: true, checks, browserErrors: failures.length };
  } catch (error) {
    const detail = safeDiagnostic(error.message);
    throw new Error(`Side feature browser smoke failed during ${stage}: ${detail}`);
  } finally {
    for (const record of issued) {
      const actor = record.code === "b" ? bride : groom;
      await api(actor, record.code, "invitations/revoke", { method: "POST", data: { invitationId: record.invitationId } });
      await api(actor, record.code, "invitations/rsvp/delete", { method: "POST", data: { invitationId: record.invitationId }, status: [200, 404] });
    }
    for (const context of contexts) await context.close();
  }
}
