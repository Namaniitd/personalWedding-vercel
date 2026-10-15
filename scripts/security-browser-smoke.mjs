import assert from "node:assert/strict";

const origin = "http://127.0.0.1:3001";
const assets = [
  "engagement-2.jpg", "engagement-2-640.webp", "engagement-2-1067.webp",
  "engagement-3.jpg", "engagement-3-640.webp", "engagement-3-1067.webp",
  "engagementCouplePic.jpg", "engagement-couple-640.webp", "engagement-couple-1067.webp",
  "ganesha-basohli.jpg", "gaja-lakshmi.jpg", "shiva-parvati-terrace.jpg", "shiva-parvati-celebration.jpg",
  "wedding-saptapadi.jpg", "wedding-varmala.jpg", "wedding-mehendi.jpg", "wedding-mehendi-960.webp",
  "wedding-mehendi-1440.webp", "wedding-hands.jpg", "wedding-hands-960.webp", "wedding-hands-1920.webp"
];

/** Playwright regression checks restricted to disposable synthetic fixtures. */
export async function runWeddingSecurityBrowserSmoke(page, { password, baseUrl = origin } = {}) {
  if (baseUrl !== origin) throw new Error("Security browser smoke requires the disposable loopback stack on port 3001.");
  if (typeof password !== "string" || password.length < 16) throw new Error("Synthetic coordinator credentials are required.");
  const checks = [];
  let stage = "setup", invitation = null, revoked = false;
  const browserErrors = [];
  const onPageError = () => browserErrors.push("JavaScript error");
  const onConsole = (message) => {
    if (message.type() === "error" && /content security policy|violates.*directive|hydration|uncaught/i.test(message.text())) {
      browserErrors.push("CSP or hydration error");
    }
  };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(20_000);

  async function check(label, action) { stage = label; await action(); checks.push(label); }
  async function post(path, data, cookie) {
    return page.request.post(origin + path, {
      headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
      ...(data === undefined ? {} : { data })
    });
  }
  async function signIn() {
    await page.goto(origin + "/coordinator/g/login", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Coordinator password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(origin + "/coordinator/g");
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  }
  function responseCookie(response) {
    // This copies only the Set-Cookie response of our own synthetic HTTP login;
    // it never reads browser cookies, profiles, or an existing user session.
    const cookie = response.headers()["set-cookie"]?.split(";", 1)[0];
    assert.ok(cookie?.startsWith("shaadi_coordinator_session="), "Synthetic login must issue a coordinator session.");
    return cookie;
  }

  try {
    await page.context().clearCookies();
    await check("old public media URLs and direct private-folder access are denied", async () => {
      for (const asset of assets) {
        const directory = asset.startsWith("wedding-") ? "wedding/" : asset.startsWith("shiva-") ? "divine/" : "";
        assert.equal((await page.request.get(origin + "/images/" + directory + asset)).status(), 404, "Invitation images must not have public copies.");
      }
      assert.equal((await page.request.get(origin + "/private-media/engagementCouplePic.jpg")).status(), 404);
      assert.equal((await page.request.get(origin + "/images/invitation-share.png")).status(), 200, "The generic messaging preview must still load.");
    });
    await check("inactive invitation cannot load private media", async () => {
      const response = await page.request.get(origin + "/i/invalid-security-test-token/media/engagementCouplePic.jpg");
      assert.equal(response.status(), 404);
      assert.match(response.headers()["cache-control"] ?? "", /no-store/);
    });
    await check("coordinator UI login and synthetic invitation issuance", async () => {
      await signIn();
      const response = await post("/api/coordinator/g/invitations", {
        householdNameEn: "Security Test Household", householdNameHi: "सुरक्षा परीक्षण परिवार", preferredLocale: "en",
        contactRole: "groom", eventLimits: [{ eventId: "test-event", adults: 2, children: 0 }]
      });
      assert.equal(response.status(), 200);
      const result = await response.json();
      const url = new URL(result.invitationUrl);
      assert.equal(url.origin, origin);
      assert.match(url.pathname, /^\/i\/g\/[A-Za-z0-9_-]{43}$/);
      invitation = { id: result.invitationId, path: url.pathname, mediaPath: `/i/${url.pathname.split("/").at(-1)}` };
    });
    await check("every private image format loads with an active invitation and private headers", async () => {
      for (const asset of assets) {
        const response = await page.request.get(origin + invitation.mediaPath + "/media/" + asset);
        assert.equal(response.status(), 200, "An active invitation must load its media.");
        assert.equal(response.headers()["content-type"], asset.endsWith(".webp") ? "image/webp" : "image/jpeg");
        assert.match(response.headers()["cache-control"] ?? "", /private.*no-store/);
        assert.equal(response.headers()["referrer-policy"], "no-referrer");
        assert.equal(response.headers()["cross-origin-resource-policy"], "same-origin");
        assert.ok((await response.body()).byteLength > 0);
      }
    });
    await check("image optimizer and arbitrary file paths cannot expose private media", async () => {
      const privatePath = invitation.path + "/media/engagement-couple-640.webp";
      const optimizer = "/_next/image?url=" + encodeURIComponent(privatePath) + "&w=640&q=75";
      assert.equal((await page.request.get(origin + optimizer)).status(), 400);
      for (const asset of ["constructor", "package.json", encodeURIComponent("../../.env.local")]) {
        assert.equal((await page.request.get(origin + invitation.mediaPath + "/media/" + asset)).status(), 404);
      }
    });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await check(viewport.width === 390 ? "mobile invitation images load without overflow" : "desktop invitation images load", async () => {
        await page.setViewportSize(viewport);
        await page.goto(origin + invitation.path, { waitUntil: "domcontentloaded" });
        await page.getByText("Security Test Household", { exact: true }).waitFor();
        const images = page.locator("img");
        for (let index = 0; index < await images.count(); index += 1) {
          if (await images.nth(index).isVisible()) await images.nth(index).scrollIntoViewIfNeeded();
        }
        await page.waitForFunction(() => Array.from(document.images)
          .filter((image) => image.getBoundingClientRect().width > 0)
          .every((image) => image.complete && image.naturalWidth > 0));
        assert.equal(await page.evaluate(() => Array.from(document.images).every((image) => new URL(image.src).pathname.includes("/media/"))), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
      });
    }
    await check("invitation revocation blocks GET and HEAD media even for a signed-in coordinator", async () => {
      assert.equal((await post("/api/coordinator/g/invitations/revoke", { invitationId: invitation.id })).status(), 200);
      revoked = true;
      const privatePath = origin + invitation.path + "/media/engagementCouplePic.jpg";
      assert.equal((await page.request.get(privatePath)).status(), 404);
      assert.equal((await page.request.head(privatePath)).status(), 404);
    });
    await check("UI logout rejects a copied session and leaves other sessions active", async () => {
      const firstLogin = await post("/api/coordinator/g/login", { password });
      assert.equal(firstLogin.status(), 200);
      const otherCookie = responseCookie(firstLogin);
      const secondLogin = await post("/api/coordinator/g/login", { password });
      assert.equal(secondLogin.status(), 200);
      const copiedCookie = responseCookie(secondLogin);
      await page.goto(origin + "/coordinator/g", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page.waitForURL(origin + "/coordinator/g/login");
      const replay = await page.request.get(origin + "/api/coordinator/g/content", { headers: { Cookie: copiedCookie } });
      assert.equal(replay.status(), 401, "A copied cookie must be denied after UI sign-out.");
      const replayPage = await page.request.get(origin + "/coordinator/g", { headers: { Cookie: copiedCookie }, maxRedirects: 0 });
      assert.equal(replayPage.status(), 307);
      assert.equal((await page.request.get(origin + "/api/coordinator/g/content", { headers: { Cookie: otherCookie } })).status(), 200);
      assert.equal((await post("/api/coordinator/g/logout", undefined, otherCookie)).status(), 204);
      await page.goto(origin + "/coordinator/g/responses", { waitUntil: "domcontentloaded" });
      await page.waitForURL(origin + "/coordinator/g/login");
      await signIn();
    });
    await check("no browser JavaScript, hydration, or CSP errors", async () => {
      assert.equal(browserErrors.length, 0);
    });
  } catch {
    // Playwright errors can include credential-bearing URLs; expose stage only.
    throw new Error("Security browser smoke failed during: " + stage + ". Detailed errors were withheld to protect credentials.");
  } finally {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
    if (invitation && !revoked) {
      try {
        await post("/api/coordinator/g/login", { password });
        await post("/api/coordinator/g/invitations/revoke", { invitationId: invitation.id });
      } catch { /* The disposable stack must be stopped after a failed run. */ }
    }
  }
  return { passed: true, checks, browserErrors: browserErrors.length };
}
