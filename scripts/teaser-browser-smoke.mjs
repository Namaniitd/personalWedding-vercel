import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const origin = "http://127.0.0.1:3001";
const syntheticPoster = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#e5d5bd"/><circle cx="960" cy="475" r="150" fill="#98744a"/><path d="M920 390L1040 475L920 560Z" fill="#fff7e8"/><text x="960" y="760" fill="#503c29" font-family="serif" font-size="60" text-anchor="middle">Synthetic teaser preview</text></svg>');

/** Only disposable synthetic invitations are created; content and RSVP data are never changed. */
export async function runTeaserBrowserSmoke(browser, { groomPassword, bridePassword, artifactDir } = {}) {
  assert.ok(typeof groomPassword === "string" && groomPassword.length >= 16
    && typeof bridePassword === "string" && bridePassword.length >= 16 && groomPassword !== bridePassword,
  "Separate synthetic coordinator passwords are required.");
  const actors = [], contexts = [], checks = [], browserErrors = [], cleanupErrors = [];
  const captureScreenshots = Boolean(artifactDir) && browser.browserType().name() === "chromium";
  const suffix = Date.now().toString(36);
  let stage = "setup", failure;

  function sanitize(value) {
    let message = String(value).split("\n")[0]
      .replace(/https?:\/\/[^\s"'<>]+/g, "[private URL]")
      .replace(/\/i\/[^\s"'<>]+/g, "/i/[private]");
    for (const secret of [groomPassword, bridePassword, ...actors.map((actor) => actor.token)].filter(Boolean)) {
      message = message.replaceAll(secret, "[private credential]");
    }
    return message.replace(/[A-Za-z0-9_-]{32,}/g, "[opaque]").slice(0, 600);
  }
  async function newContext(options = {}) {
    const context = await browser.newContext({ reducedMotion: "reduce", ...options });
    contexts.push(context);
    return context;
  }
  async function newPage(context) {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    page.setDefaultNavigationTimeout(25_000);
    page.on("pageerror", (error) => browserErrors.push(`${stage}: ${sanitize(error.message)}`));
    page.on("console", (message) => {
      if (message.type() === "error" && /content security policy|violates.*directive|hydration|uncaught|react.*error/i.test(message.text())) {
        browserErrors.push(`${stage}: ${sanitize(message.text())}`);
      }
    });
    return page;
  }
  async function coordinator(actor, path, { method = "GET", data, status = 200, retry = false } = {}) {
    assert.ok(["login", "logout", "content", "invitations", "invitations/revoke"].includes(path),
      "Only fixed scoped synthetic coordinator paths are allowed.");
    let response;
    for (let attempt = 0; attempt < 4; attempt++) {
      response = await actor.admin.request.fetch(`${origin}/api/coordinator/${actor.code}/${path}`, {
        method, headers: { Origin: origin }, ...(data === undefined ? {} : { data }), timeout: 20_000
      });
      if (response.status() !== 429 || !retry || attempt === 3) break;
      const retryAfter = Number(response.headers()["retry-after"]);
      assert.ok(Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 60,
        "Synthetic cleanup retries require a bounded Retry-After.");
      for (let remaining = retryAfter * 1000 + 100; remaining > 0; remaining -= 30_000) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 30_000)));
      }
    }
    assert.equal(response.status(), status, `Synthetic scoped API returned status ${response.status()}, expected ${status}.`);
    return response.headers()["content-type"]?.includes("application/json") ? response.json() : null;
  }
  function teaser(page) {
    return page.locator("#teaser");
  }
  function playButton(section) {
    return section.getByRole("button", { name: "Watch our pre-wedding teaser", exact: true });
  }
  async function activate(actor, locator) {
    if (actor.touch) await locator.tap();
    else await locator.click();
  }
  async function fits(page, section) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
      "The invitation must fit its viewport.");
    assert.equal(await section.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= -1 && bounds.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 2;
    }), true, "The teaser section must fit its viewport.");
    assert.equal(await section.locator("button,video,img").evaluateAll((elements) => elements.every((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.width === 0 || (bounds.left >= -1 && bounds.right <= innerWidth + 1);
    })), true, "Teaser media and controls must fit their viewport.");
  }
  async function noCustomSoundUI(section) {
    assert.equal(await section.locator("#teaser-hint").count(), 0, "The removed sound hint must not remain in the teaser.");
    assert.equal(await section.getByText(/Starts muted\.|Turn on sound whenever you like\.|शुरुआत में आवाज़ बंद है|जब चाहें आवाज़ चालू करें/).count(), 0,
      "Neither language may show the removed muted-start hint.");
    assert.equal(await section.getByRole("button", { name: /^(Turn sound on|Mute sound|आवाज़ चालू करें|आवाज़ बंद करें)$/, includeHidden: true }).count(), 0,
      "Sound controls must be provided by the native video player.");
    assert.equal(await section.locator("video").getAttribute("aria-describedby"), null,
      "The player must not reference the removed sound hint.");
  }
  function privateHeaders(response) {
    const headers = response.headers();
    assert.match(headers["cache-control"] ?? "", /private.*no-store/, "Teaser media must not enter shared caches.");
    assert.equal(headers["referrer-policy"], "no-referrer", "Media must not leak invitation references.");
    assert.equal(headers["cross-origin-resource-policy"], "same-origin", "Media must remain same-origin.");
    assert.equal(headers["x-content-type-options"], "nosniff", "Media must retain private response safeguards.");
  }
  function protectedPath(value, actor) {
    const url = new URL(value, origin);
    assert.equal(url.origin, origin, "Teaser media must stay on the disposable origin.");
    const segments = url.pathname.split("/").filter(Boolean);
    assert.equal(segments[0], "i", "Teaser media must use the authenticated invitation route.");
    assert.equal(segments.at(-2), "media", "Teaser media must use the private media allowlist.");
    assert.ok(segments.includes(actor.token), "Teaser media must use its synthetic invitation credential.");
    return url.pathname;
  }
  async function assertUnavailable(actor, mediaPath) {
    for (const method of ["GET", "HEAD"]) {
      for (const range of [false, true]) {
        const response = await actor.guest.request.fetch(origin + mediaPath, {
          method, ...(range ? { headers: { Range: "bytes=0-1023" } } : {})
        });
        assert.equal(response.status(), 404, "Inactive invitations must not receive media, including HEAD and Range requests.");
        privateHeaders(response);
        if (method === "HEAD") assert.equal((await response.body()).byteLength, 0, "Denied HEAD requests must have no body.");
      }
    }
  }

  try {
    if (captureScreenshots) await mkdir(artifactDir, { recursive: true });
    for (const [code, password, touch] of [["g", groomPassword, false], ["b", bridePassword, true]]) {
      const actor = { code, touch, admin: await newContext(), guest: await newContext(touch
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 1440, height: 1000 } }), loggedIn: false, revoked: false };
      actors.push(actor);
      stage = `${code} synthetic scoped invitation`;
      await coordinator(actor, "login", { method: "POST", data: { password } });
      actor.loggedIn = true;
      const configuration = (await coordinator(actor, "content")).configuration;
      assert.equal(configuration.side, code === "g" ? "groom" : "bride", "The synthetic invitation must use its own side.");
      const event = configuration.events.find((entry) => entry.published);
      assert.ok(event, "The disposable team must have a published synthetic event.");
      const issued = await coordinator(actor, "invitations", { method: "POST", data: {
        householdNameEn: `${code} Teaser Sample ${suffix}`, householdNameHi: "टीज़र परीक्षण परिवार", preferredLocale: "en",
        eventLimits: [{ eventId: event.id, adults: 1, children: 0 }]
      }, retry: true });
      actor.id = issued.invitationId;
      const invitationUrl = new URL(issued.invitationUrl);
      assert.equal(invitationUrl.origin, origin, "Synthetic invitations must stay on disposable port 3001.");
      assert.ok(invitationUrl.pathname.startsWith(`/i/${code}/`), "The invitation URL must stay scoped to its team.");
      actor.path = invitationUrl.pathname;
      actor.token = actor.path.split("/").at(-1);
      checks.push(stage);

      stage = `${code} teaser placement and explicit-play gate`;
      actor.page = await newPage(actor.guest);
      const requests = [];
      actor.page.on("request", (request) => {
        if (/\.mp4(?:\?|$)/i.test(request.url())) requests.push(request);
      });
      await actor.page.goto(origin + actor.path, { waitUntil: "networkidle" });
      const section = teaser(actor.page);
      await section.waitFor();
      await section.getByRole("heading", { name: "A glimpse of us", exact: true }).waitFor();
      await section.scrollIntoViewIfNeeded();
      await actor.page.waitForLoadState("networkidle");
      assert.equal(requests.length, 0, "The teaser MP4 must not be requested before explicit play.");
      await playButton(section).waitFor();
      await noCustomSoundUI(section);
      const order = await section.evaluate((node) => {
        const invitee = document.querySelector("aside[aria-label]");
        const schedule = document.getElementById("schedule");
        return Boolean(invitee && schedule
          && (invitee.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
          && (node.compareDocumentPosition(schedule) & Node.DOCUMENT_POSITION_FOLLOWING));
      });
      assert.equal(order, true, "The teaser must follow the invitee band and precede the events.");
      await fits(actor.page, section);
      const posterValue = await section.locator("video").getAttribute("poster").catch(() => null)
        ?? await section.locator("img").first().getAttribute("src");
      assert.ok(posterValue, "The teaser needs a poster before playback.");
      actor.posterPath = protectedPath(posterValue, actor);
      const poster = await actor.guest.request.head(origin + actor.posterPath);
      assert.equal(poster.status(), 200, "An active synthetic invitation must load its poster.");
      assert.match(poster.headers()["content-type"] ?? "", /^image\//, "The teaser poster must be an image.");
      privateHeaders(poster);
      checks.push(stage);

      stage = `${code} sound-on inline native playback and controls`;
      if (touch) await activate(actor, playButton(section));
      else await playButton(section).press("Enter");
      const video = section.getByLabel("Pre-wedding teaser", { exact: true });
      await video.waitFor();
      await actor.page.waitForFunction(() => {
        const element = document.querySelector("video");
        return element && Number.isFinite(element.duration) && element.duration > 0 && !element.paused && element.currentTime > 0.05;
      }, undefined, { timeout: 25_000 });
      const initial = await video.evaluate((element) => ({
        controls: element.controls, inline: element.playsInline, autoplay: element.autoplay,
        muted: element.muted, defaultMuted: element.defaultMuted, src: element.currentSrc || element.src,
        duration: element.duration, time: element.currentTime, volume: element.volume
      }));
      assert.equal(initial.controls, true, "Guests must have native playback controls.");
      assert.equal(initial.inline, true, "Mobile playback must stay inline.");
      assert.equal(initial.autoplay, false, "The teaser must not autoplay.");
      assert.equal(initial.muted, false, "Explicit first playback must start with sound.");
      assert.equal(initial.defaultMuted, false, "The native media default must permit sound.");
      assert.ok(initial.volume > 0, "Explicit first playback must have audible volume.");
      if (!touch) assert.equal(await video.evaluate((element) => document.activeElement === element), true,
        "Keyboard activation must move focus to the playable video when its overlay disappears.");
      actor.videoPath = protectedPath(initial.src, actor);
      assert.ok(requests.length > 0, "Explicit play must request the teaser MP4.");
      await fits(actor.page, section);
      await noCustomSoundUI(section);
      // Native media controls live in browser-owned UI that Playwright cannot
      // address consistently, so exercise the same media state directly.
      await video.evaluate((element) => { element.muted = true; });
      assert.equal(await video.evaluate((element) => element.muted), true,
        "Native controls must be able to mute playback.");
      await video.evaluate((element) => { element.muted = false; });
      assert.equal(await video.evaluate((element) => !element.muted && element.volume > 0), true,
        "Native controls must be able to restore sound.");
      await video.evaluate((element) => { element.pause(); });
      assert.equal(await video.evaluate((element) => element.paused), true, "Native media must support pausing.");
      const pausedTime = await video.evaluate((element) => element.currentTime);
      await video.evaluate((element) => element.play());
      await actor.page.waitForFunction((time) => {
        const element = document.querySelector("video");
        return element && !element.paused && element.currentTime > time + 0.05;
      }, pausedTime);
      const seekTime = Math.min(initial.duration * 0.6, initial.duration - 0.25);
      await video.evaluate((element, time) => { element.pause(); element.currentTime = time; }, seekTime);
      await actor.page.waitForFunction((time) => {
        const element = document.querySelector("video");
        return element && !element.seeking && Math.abs(element.currentTime - time) < 0.35;
      }, seekTime);
      checks.push(stage);

      stage = `${code} private byte ranges and inactive-token denial`;
      const head = await actor.guest.request.head(origin + actor.videoPath);
      assert.equal(head.status(), 200, "Authenticated video HEAD must succeed.");
      assert.match(head.headers()["content-type"] ?? "", /^video\/mp4/, "The teaser must have its video content type.");
      assert.equal(head.headers()["accept-ranges"], "bytes", "Native seek must support byte ranges.");
      assert.equal((await head.body()).byteLength, 0, "Authenticated HEAD must omit the body.");
      privateHeaders(head);
      const range = await actor.guest.request.get(origin + actor.videoPath, { headers: { Range: "bytes=0-1023" } });
      assert.equal(range.status(), 206, "A valid video byte range must return partial content.");
      assert.match(range.headers()["content-range"] ?? "", /^bytes 0-1023\/[1-9]\d*$/, "Byte ranges must identify their exact interval.");
      assert.equal(Number(range.headers()["content-length"]), 1024, "Byte ranges need an exact content length.");
      assert.equal((await range.body()).byteLength, 1024, "Byte-range bodies must match their declared interval.");
      privateHeaders(range);
      for (const path of [actor.videoPath, actor.posterPath]) {
        await assertUnavailable(actor, path.replace(actor.token, "A".repeat(43)));
      }
      checks.push(stage);

      stage = `${code} teaser layouts and bilingual UI`;
      const visual = await newPage(actor.guest);
      await visual.route("**/media/**", async (route) => {
        if (/\.mp4(?:\?|$)/i.test(route.request().url())) return route.abort();
        await route.fulfill({ status: 200, contentType: "image/svg+xml", body: syntheticPoster,
          headers: { "Cache-Control": "private, no-store", "Cross-Origin-Resource-Policy": "same-origin" } });
      });
      await visual.goto(origin + actor.path, { waitUntil: "networkidle" });
      const visualSection = teaser(visual);
      for (const width of touch ? [390, 320] : [1440, 768]) {
        await visual.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
        await visualSection.scrollIntoViewIfNeeded();
        await fits(visual, visualSection);
        await noCustomSoundUI(visualSection);
        assert.equal(await playButton(visualSection).isVisible(), true, "The play action must stay visible on desktop and mobile.");
        if (captureScreenshots && width !== 768) {
          assert.equal(await visualSection.locator("video").evaluate((element) => !element.getAttribute("src") && element.paused), true,
            "Visual artifacts must show only the synthetic poster with no private video frames.");
          await visual.evaluate(() => document.fonts.ready);
          await visualSection.screenshot({ path: join(artifactDir, `${code}-teaser-${width}-synthetic.png`), caret: "initial" });
        }
      }
      await activate(actor, visual.getByRole("button", { name: "View in Hindi", exact: true }));
      await visual.waitForFunction(() => document.documentElement.lang === "hi");
      const translatedSection = teaser(visual);
      assert.match(await translatedSection.getByRole("heading").innerText(), /[\u0900-\u097f]/, "The Hindi teaser needs a translated heading.");
      assert.match(await translatedSection.getByRole("button").first().innerText(), /[\u0900-\u097f]/, "The Hindi play action must be translated.");
      await noCustomSoundUI(translatedSection);
      await fits(visual, translatedSection);
      await visual.close();
      checks.push(stage);

      stage = `${code} broken teaser fallback and retry recovery`;
      const broken = await newPage(actor.guest);
      let failedRequests = 0, allowRecovery = false;
      await broken.route("**/*.mp4", async (route) => {
        if (allowRecovery) return route.continue();
        failedRequests++;
        await route.fulfill({ status: 503, contentType: "text/plain", body: "Synthetic teaser outage.",
          headers: { "Cache-Control": "private, no-store" } });
      });
      await broken.goto(origin + actor.path, { waitUntil: "networkidle" });
      const brokenSection = teaser(broken);
      await activate(actor, playButton(brokenSection));
      const fallback = brokenSection.getByRole("status");
      await fallback.waitFor();
      assert.ok(failedRequests > 0, "The friendly fallback must follow a failed video request.");
      assert.match(await fallback.innerText(), /could not|couldn.t|unavailable|not.*load|try again/i,
        "Guests need a friendly explanation when teaser playback is unavailable.");
      await fits(broken, brokenSection);
      const retriedVideo = brokenSection.locator("video");
      assert.equal(await retriedVideo.evaluate((element) => element.muted), false,
        "A failed first attempt must retain the sound-on default.");
      if (touch) await retriedVideo.evaluate((element) => { element.muted = true; });
      allowRecovery = true;
      await activate(actor, brokenSection.getByRole("button", { name: "Try the teaser again", exact: true }));
      await broken.waitForFunction(() => {
        const element = document.querySelector("#teaser video");
        return element && Number.isFinite(element.duration) && element.duration > 0 && !element.paused && element.currentTime > 0.05;
      }, undefined, { timeout: 25_000 });
      await fallback.waitFor({ state: "hidden" });
      assert.equal(await retriedVideo.evaluate((element) => element.muted), touch,
        "Retry must start with sound unless the guest has explicitly muted native playback.");
      assert.equal(await retriedVideo.evaluate((element) => element.defaultMuted), false,
        "Retry must not change the sound-on native default.");
      await noCustomSoundUI(brokenSection);
      await fits(broken, brokenSection);
      await broken.close();
      checks.push(stage);

      stage = `${code} revocation blocks teaser and poster`;
      await coordinator(actor, "invitations/revoke", { method: "POST", data: { invitationId: actor.id }, retry: true });
      actor.revoked = true;
      for (const path of [actor.videoPath, actor.posterPath]) await assertUnavailable(actor, path);
      await actor.page.close();
      checks.push(stage);
    }
    stage = "browser errors";
    assert.equal(browserErrors.length, 0, "Teaser flows must finish without CSP, hydration, or JavaScript errors.");
  } catch (error) {
    failure = `${stage}: ${sanitize(error.message)}`;
  } finally {
    for (const actor of actors) {
      if (actor.id && !actor.revoked) {
        try {
          await coordinator(actor, "invitations/revoke", { method: "POST", data: { invitationId: actor.id }, retry: true });
          actor.revoked = true;
        } catch { cleanupErrors.push(`revoke ${actor.code} synthetic invitation`); }
      }
      if (actor.loggedIn) {
        try { await coordinator(actor, "logout", { method: "POST", status: 204, retry: true }); }
        catch { cleanupErrors.push(`logout ${actor.code}`); }
      }
    }
    for (const context of contexts) await context.close();
  }
  if (failure || cleanupErrors.length) {
    throw new Error(`Teaser browser smoke failed: ${failure ?? "cleanup"}; cleanup=${cleanupErrors.join(", ") || "complete"}; browserErrors=${browserErrors.join("; ") || "none"}`);
  }
  return { passed: true, engine: browser.browserType().name(), checks, browserErrors: 0,
    cleanup: "synthetic invitations revoked and coordinator sessions logged out; no content or RSVP writes",
    ...(captureScreenshots ? { artifactDir, screenshots: "synthetic poster substitutes only; no real video frames or photographs" } : {}) };
}
