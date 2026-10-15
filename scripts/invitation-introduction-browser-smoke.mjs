import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const origin = "http://127.0.0.1:3001";
const defaultIntroduction = {
  en: "Together with our families, we invite you to celebrate the wedding of",
  hi: "परिवारों के साथ, हम आपको इनके विवाह में सादर आमंत्रित करते हैं"
};
const copy = (value) => structuredClone(value);

function withoutIntroduction(content) {
  const result = copy(content);
  if (result?.hero) delete result.hero.invitationLead;
  return result;
}

/** Run only against the disposable stack, keeping all bearer values in memory. */
export async function runInvitationIntroductionBrowserSmoke(browser, { groomPassword, bridePassword, artifactDir } = {}) {
  assert.ok(typeof groomPassword === "string" && groomPassword.length >= 16
    && typeof bridePassword === "string" && bridePassword.length >= 16 && groomPassword !== bridePassword,
  "Separate synthetic coordinator passwords are required.");
  const contexts = [], actors = [], issued = [], checks = [], browserErrors = [], cleanupErrors = [];
  const captureScreenshots = Boolean(artifactDir) && browser.browserType().name() !== "webkit";
  const suffix = Date.now().toString(36);
  let stage = "setup", failure = null;

  function sanitize(value) {
    let message = String(value)
      .replace(/https?:\/\/[^\s"'<>]+/g, "[private URL]")
      .replace(/data:[^\s"'<>]+/g, "[private data]")
      .replace(/\/i\/[^\s"'<>]+/g, "/i/[private]");
    for (const secret of [groomPassword, bridePassword, ...issued.map((record) => record.token)].filter(Boolean)) {
      message = message.replaceAll(secret, "[private credential]");
    }
    return message.replace(/[A-Za-z0-9_-]{32,}/g, "[opaque]").slice(0, 3000);
  }
  async function newPage(options) {
    const context = await browser.newContext({ reducedMotion: "reduce", ...options });
    contexts.push(context);
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(20_000);
    page.on("pageerror", (error) => browserErrors.push(`${stage}: ${sanitize(error.message)}`));
    page.on("console", (message) => {
      if (message.type() === "error" && /content security policy|violates.*directive|hydration|uncaught|react.*error/i.test(message.text())) {
        browserErrors.push(`${stage}: ${sanitize(message.text())}`);
      }
    });
    return page;
  }
  async function api(actor, code, path, { method = "GET", data, status = 200, retryRateLimit = false } = {}) {
    assert.ok(["g", "b"].includes(code) && ["content", "login", "logout", "invitations", "invitations/revoke"].includes(path),
      "Requests must use a fixed scoped test API path.");
    let response;
    for (let attempt = 0; attempt < 4; attempt++) {
      response = await actor.page.request.fetch(`${origin}/api/coordinator/${code}/${path}`, {
        method, headers: { Origin: origin }, ...(data === undefined ? {} : { data }), timeout: 15_000
      });
      if (response.status() !== 429 || !retryRateLimit || attempt === 3) break;
      const retryAfter = Number(response.headers()["retry-after"]);
      assert.ok(Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 60,
        "Cleanup rate-limit retries must have a bounded Retry-After.");
      for (let remaining = retryAfter * 1000 + 100; remaining > 0; remaining -= 30_000) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 30_000)));
      }
    }
    assert.equal(response.status(), status, `Scoped synthetic API returned status ${response.status()}, expected ${status}.`);
    return response.headers()["content-type"]?.includes("application/json") ? response.json() : null;
  }
  async function content(actor) {
    const { side, ...configuration } = (await api(actor, actor.code, "content")).configuration;
    assert.equal(side, actor.code === "g" ? "groom" : "bride", "Content must belong to its authenticated team.");
    return configuration;
  }
  async function activate(actor, locator) {
    if (actor.touch) await locator.tap();
    else await locator.click();
  }
  function introductionField(actor, locale) {
    return actor.page.getByLabel(locale === "hi" ? /^Invitation introduction\s*हिन्दी/ : /^Invitation introduction\s*English/);
  }
  async function fill(actor, locator, value) {
    if (actor.touch) await locator.tap();
    await locator.fill(value);
  }
  async function fieldsEqual(actor, expected) {
    for (const locale of ["en", "hi"]) assert.equal(await introductionField(actor, locale).inputValue(), expected[locale],
      "Friendly introduction must show the expected bilingual wording.");
  }
  async function fits(page, locator) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
      "The introduction page must fit its viewport.");
    assert.equal(await locator.evaluateAll((elements) => elements.every((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= -1 && bounds.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 2;
    })), true, "Introduction controls must fit their available width.");
  }
  async function openEditor(actor) {
    await actor.page.goto(`${origin}/coordinator/${actor.code}/content`, { waitUntil: "networkidle" });
    await actor.page.getByRole("heading", { name: "The details guests see first", exact: true }).waitFor();
    await introductionField(actor, "en").waitFor();
  }
  async function rawEditor(actor) {
    const raw = actor.page.getByLabel(/^Guest content JSON/);
    if (!await raw.isVisible()) await activate(actor, actor.page.getByRole("button", { name: "Edit JSON", exact: true }));
    return raw;
  }
  async function save(actor, status = 200) {
    const pending = actor.page.waitForResponse((response) => new URL(response.url()).pathname === `/api/coordinator/${actor.code}/content`
      && response.request().method() === "PUT");
    await activate(actor, actor.page.getByRole("button", { name: "Save invitation content", exact: true }));
    assert.equal((await pending).status(), status, "The introduction editor save returned an unexpected status.");
    if (status === 200) await actor.page.getByText("Wedding content saved.", { exact: false }).waitFor();
  }
  async function discard(actor) {
    actor.page.once("dialog", (dialog) => void dialog.accept());
    await activate(actor, actor.page.getByRole("button", { name: "Discard changes", exact: true }));
    await actor.page.getByText("Unsaved changes were discarded.", { exact: true }).waitFor();
  }
  async function assertPreserved(actor, expectedIntroduction) {
    const current = await content(actor);
    assert.deepEqual(withoutIntroduction(current.settings.guestContent), actor.fixtureContent,
      "Changing the introduction must preserve other hero keys and invitation sections.");
    if (expectedIntroduction) assert.deepEqual(current.settings.guestContent.hero.invitationLead, expectedIntroduction,
      "Saved introduction must preserve both languages.");
    else assert.equal(Object.hasOwn(current.settings.guestContent.hero, "invitationLead"), false,
      "Default wording must remove only the introduction override.");
    return current;
  }
  async function verifyGuest(actor, expected) {
    await actor.guest.goto(origin + actor.invitation.path, { waitUntil: "networkidle" });
    for (const locale of ["en", "hi"]) {
      if (locale === "hi") {
        await activate({ ...actor, page: actor.guest }, actor.guest.getByRole("button", { name: "View in Hindi", exact: true }));
        await actor.guest.waitForFunction(() => document.documentElement.lang === "hi");
      }
      const paragraph = actor.guest.locator("#invitation").getByText(expected[locale], { exact: true });
      assert.equal(await paragraph.count(), 1, "Guests must see their team's introduction in the selected language.");
      await fits(actor.guest, paragraph);
      const order = await paragraph.evaluate((node) => {
        const title = document.getElementById("invitation-title");
        return Boolean(node.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      assert.equal(order, true, "Introduction must precede the couple names.");
    }
  }

  try {
    if (captureScreenshots) await mkdir(artifactDir, { recursive: true });
    for (const [code, password, touch] of [["g", groomPassword, false], ["b", bridePassword, true]]) {
      const options = touch ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 1440, height: 1000 } };
      const actor = { code, touch, page: await newPage(options), guest: await newPage(options), loggedIn: false };
      actors.push(actor);
      stage = `${code} coordinator sign-in`;
      await actor.page.goto(`${origin}/coordinator/${code}/login`, { waitUntil: "networkidle" });
      if (touch) await actor.page.evaluate(() => {
        document.addEventListener("touchstart", () => sessionStorage.setItem("introduction-smoke-touch", "seen"), { once: true });
      });
      await fill(actor, actor.page.getByLabel("Coordinator password", { exact: true }), password);
      await activate(actor, actor.page.getByRole("button", { name: "Sign in", exact: true }));
      await actor.page.waitForURL(`${origin}/coordinator/${code}`);
      actor.loggedIn = true;
      actor.original = await content(actor);
      assert.ok(actor.original.events.some((event) => event.published), "Each disposable team needs a published synthetic event before this suite.");
      if (touch) assert.equal(await actor.page.evaluate(() => sessionStorage.getItem("introduction-smoke-touch")), "seen",
        "The bride review must receive actual touch events.");
    }
    stage = "side-bound content access";
    await api(actors[0], "b", "content", { status: 401 });
    await api(actors[1], "g", "content", { status: 401 });
    await api(actors[0], "b", "content", { method: "PUT", data: actors[1].original, status: 401 });
    checks.push(stage);

    for (const actor of actors) {
      stage = `${actor.code} synthetic introduction fixture`;
      const existing = actor.original.settings.guestContent ?? {};
      actor.fixtureContent = withoutIntroduction({
        ...copy(existing),
        hero: { ...copy(existing.hero ?? {}), invocation: "॥ शुभ मंगल ॥", region: { en: `${actor.code} synthetic region`, hi: `${actor.code} परीक्षण क्षेत्र` } },
        update: { title: { en: `${actor.code} synthetic update`, hi: "परीक्षण सूचना" }, body: { en: "Preserve this unrelated guest section.", hi: "यह अन्य अतिथि जानकारी सुरक्षित रखें।" } }
      });
      await api(actor, actor.code, "content", { method: "PUT", data: {
        ...actor.original, settings: { ...actor.original.settings, guestContent: actor.fixtureContent }
      } });
    }

    for (const actor of actors) {
      const custom = { en: `${actor.code === "g" ? "Groom" : "Bride"} families warmly invite you to join our synthetic celebration`,
        hi: `${actor.code === "g" ? "वर" : "वधू"} के परिवार आपको हमारे परीक्षण समारोह में सादर आमंत्रित करते हैं` };
      stage = `${actor.code} default fields and responsive layout`;
      await openEditor(actor);
      await fieldsEqual(actor, defaultIntroduction);
      for (const locale of ["en", "hi"]) {
        assert.equal(await introductionField(actor, locale).getAttribute("maxlength"), "600", "Introduction length must be bounded.");
        assert.equal(await introductionField(actor, locale).isDisabled(), false, "Valid JSON must keep friendly fields editable.");
      }
      await fits(actor.page, actor.page.locator('textarea').filter({ visible: true }));
      checks.push(stage);

      stage = `${actor.code} friendly edits and discard`;
      for (const locale of ["en", "hi"]) await fill(actor, introductionField(actor, locale), custom[locale]);
      const draftJson = JSON.parse(await (await rawEditor(actor)).inputValue());
      assert.deepEqual(draftJson.hero.invitationLead, custom, "Friendly fields must update the advanced JSON draft.");
      assert.deepEqual(withoutIntroduction(draftJson), actor.fixtureContent, "Friendly edits must preserve unrelated draft content.");
      await discard(actor);
      await fieldsEqual(actor, defaultIntroduction);
      checks.push(stage);

      stage = `${actor.code} save and reload friendly wording`;
      for (const locale of ["en", "hi"]) await fill(actor, introductionField(actor, locale), custom[locale]);
      await save(actor);
      await assertPreserved(actor, custom);
      await actor.page.reload({ waitUntil: "networkidle" });
      await fieldsEqual(actor, custom);
      const other = actors.find((entry) => entry !== actor);
      const otherContent = await content(other);
      assert.ok(!JSON.stringify(otherContent.settings.guestContent).includes(custom.en), "Introduction changes must stay in their own workspace.");
      if (captureScreenshots) {
        const fieldset = actor.page.getByRole("group", { name: /^Invitation introduction/ });
        await fieldset.screenshot({ path: join(artifactDir, `${actor.code}-introduction-${actor.touch ? "390" : "1440"}.png`), caret: "initial" });
      }
      const event = actor.original.events.find((entry) => entry.published);
      const issuedRecord = await api(actor, actor.code, "invitations", { method: "POST", data: {
        householdNameEn: `${actor.code} Introduction Sample ${suffix}`, householdNameHi: "परिचय परीक्षण परिवार", preferredLocale: "en",
        eventLimits: [{ eventId: event.id, adults: 1, children: 0 }]
      } });
      const record = { actor, id: issuedRecord.invitationId };
      issued.push(record);
      const url = new URL(issuedRecord.invitationUrl);
      assert.equal(url.origin, origin, "Synthetic invitation must stay on the disposable origin.");
      assert.ok(url.pathname.startsWith(`/i/${actor.code}/`), "Synthetic invitation must use its own side URL.");
      record.path = url.pathname;
      record.token = url.pathname.split("/").at(-1);
      actor.invitation = record;
      const wrongPath = record.path.replace(`/i/${actor.code}/`, `/i/${actor.code === "g" ? "b" : "g"}/`);
      assert.equal((await actor.guest.request.get(origin + wrongPath)).status(), 404, "Wrong-side invitation URL must stay unavailable.");
      await verifyGuest(actor, custom);
      checks.push(stage);

      stage = `${actor.code} advanced JSON synchronization and invalid draft protection`;
      const raw = await rawEditor(actor);
      const advanced = copy(actor.fixtureContent);
      advanced.hero.invitationLead = { en: "Advanced synthetic invitation introduction", hi: "उन्नत परीक्षण निमंत्रण परिचय" };
      await fill(actor, raw, JSON.stringify(advanced, null, 2));
      await fieldsEqual(actor, advanced.hero.invitationLead);
      for (const invalid of ['{"hero":', JSON.stringify({ ...actor.fixtureContent, hero: [] }), JSON.stringify({ ...actor.fixtureContent, hero: { invitationLead: "incompatible" } })]) {
        await fill(actor, raw, invalid);
        assert.equal(await introductionField(actor, "en").isDisabled(), true, "Invalid advanced content must protect friendly fields.");
        assert.equal(await introductionField(actor, "hi").isDisabled(), true, "Both friendly fields must be protected.");
        assert.equal(await actor.page.getByRole("button", { name: "Use default wording", exact: true }).isDisabled(), true,
          "Reset must not overwrite invalid advanced content.");
        assert.equal(await raw.inputValue(), invalid, "Invalid raw content must remain available to repair.");
      }
      await discard(actor);
      await fieldsEqual(actor, custom);
      checks.push(stage);

      if (!actor.touch) {
        stage = "groom stale save and conflict reload synchronization";
        const concurrent = await content(actor);
        const newerLead = { en: "A newer synthetic introduction saved by another operator", hi: "दूसरे समन्वयक का नया परीक्षण निमंत्रण परिचय" };
        concurrent.settings.guestContent.hero.invitationLead = newerLead;
        await api(actor, actor.code, "content", { method: "PUT", data: concurrent });
        await fill(actor, introductionField(actor, "en"), "Stale unsaved introduction must not overwrite the newer one");
        await save(actor, 409);
        await activate(actor, actor.page.getByRole("button", { name: "Load the latest version", exact: true }));
        await fieldsEqual(actor, newerLead);
        await assertPreserved(actor, newerLead);
        checks.push(stage);
      }

      stage = `${actor.code} default reset saves without removing other sections`;
      await activate(actor, actor.page.getByRole("button", { name: "Use default wording", exact: true }));
      await fieldsEqual(actor, defaultIntroduction);
      assert.deepEqual(JSON.parse(await (await rawEditor(actor)).inputValue()), actor.fixtureContent,
        "Reset must remove only the invitation introduction override.");
      await save(actor);
      await assertPreserved(actor, null);
      await actor.page.reload({ waitUntil: "networkidle" });
      await fieldsEqual(actor, defaultIntroduction);
      await verifyGuest(actor, defaultIntroduction);
      checks.push(stage);
    }
    stage = "browser rendering errors";
    assert.equal(browserErrors.length, 0, "Introduction flows must finish without CSP, hydration, or JavaScript errors.");
  } catch (error) {
    failure = `${stage}: ${sanitize(error.message)}`;
  } finally {
    for (const record of issued) {
      try { await api(record.actor, record.actor.code, "invitations/revoke", { method: "POST", data: { invitationId: record.id } }); }
      catch { cleanupErrors.push(`revoke ${record.actor.code} synthetic invitation`); }
    }
    for (const actor of actors) {
      if (actor.original && actor.loggedIn) {
        try {
          const current = await content(actor);
          await api(actor, actor.code, "content", { method: "PUT", data: { ...actor.original, revision: current.revision }, retryRateLimit: true });
          const restored = await content(actor);
          assert.deepEqual({ ...restored, revision: actor.original.revision }, actor.original,
            "Cleanup must restore the original content snapshot.");
        } catch { cleanupErrors.push(`restore ${actor.code} content with current revision`); }
      }
      if (actor.loggedIn) {
        try { await api(actor, actor.code, "logout", { method: "POST", status: 204 }); }
        catch { cleanupErrors.push(`logout ${actor.code}`); }
      }
    }
    for (const context of contexts) await context.close();
  }
  if (failure || cleanupErrors.length) {
    throw new Error(`Invitation introduction browser smoke failed: ${failure ?? "cleanup"}; cleanup=${cleanupErrors.join(", ") || "complete"}; browserErrors=${browserErrors.map(sanitize).join("; ") || "none"}`);
  }
  return { passed: true, engine: browser.browserType().name(), checks, browserErrors: 0,
    restored: "both original content snapshots using current revisions", invitations: "revoked; no RSVP data created",
    ...(captureScreenshots ? { artifactDir } : {}) };
}
