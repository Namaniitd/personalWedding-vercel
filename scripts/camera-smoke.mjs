import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const requireWeb = createRequire(new URL("../web/package.json", import.meta.url));
const QRCode = requireWeb("qrcode");

/** Playwright checks against synthetic passes in the disposable stack only. */
export async function runCameraSmoke(page, { password, origin = "http://127.0.0.1:3001", artifactDir }) {
  assert.equal(origin, "http://127.0.0.1:3001", "Camera tests require the disposable stack.");
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 } });
  const camera = await context.newPage();
  const passed = [];
  let invitationId;
  let stage = "camera fixture setup";
  const errors = [];
  let checkInRequests = 0;
  camera.on("pageerror", () => errors.push("browser script error"));
  camera.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/coordinator/check-in") checkInRequests += 1;
  });
  const post = (route, data) => context.request.post(`${origin}${route}`, { headers: { Origin: origin }, data });
  try {
    assert.equal((await post("/api/coordinator/login", { password })).status(), 200, "Test coordinator login failed.");
    const issued = await post("/api/coordinator/invitations", {
      householdNameEn: "Camera test household", householdNameHi: "कैमरा परीक्षण परिवार",
      preferredLocale: "en", contactRole: "groom", eventLimits: [{ eventId: "test-event", adults: 2, children: 1 }]
    });
    assert.equal(issued.status(), 200, "Test invitation could not be created.");
    const invitation = await issued.json();
    invitationId = invitation.invitationId;
    const token = new URL(invitation.invitationUrl).pathname.slice(3);
    const reply = await post("/api/rsvp", {
      token, respondentName: "Camera test guest", status: "attending",
      attendances: [{ eventId: "test-event", attending: true, adults: 2, children: 1 }]
    });
    assert.equal(reply.status(), 200, "Camera test RSVP could not be saved.");
    const payload = (await reply.json()).entryPass.qrPayload;
    const qrImage = await QRCode.toDataURL(payload, { width: 600, margin: 4, errorCorrectionLevel: "M" });

    await context.addInitScript(({ imageUrl }) => {
      Object.defineProperty(window, "BarcodeDetector", { value: undefined, configurable: true });
      window.__cameraTestStreams = [];
      window.__cameraTestDenied = false;
      window.__cameraTestDrawQr = false;
      window.__cameraTestHoldPermission = false;
      window.__cameraTestPermissionPending = false;
      window.__cameraTestReleasePermission = null;
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          if (window.__cameraTestDenied) throw new DOMException("Permission denied", "NotAllowedError");
          if (window.__cameraTestHoldPermission) {
            await new Promise((resolve) => {
              window.__cameraTestPermissionPending = true;
              window.__cameraTestReleasePermission = () => {
                window.__cameraTestPermissionPending = false;
                window.__cameraTestHoldPermission = false;
                window.__cameraTestReleasePermission = null;
                resolve();
              };
            });
          }
          const image = new Image();
          image.src = imageUrl;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 600;
          const drawing = canvas.getContext("2d");
          drawing.fillStyle = "white";
          drawing.fillRect(0, 0, 600, 600);
          const stream = canvas.captureStream(10);
          const timer = window.setInterval(() => {
            if (stream.getTracks().every((track) => track.readyState === "ended")) {
              window.clearInterval(timer);
            } else if (window.__cameraTestDrawQr) drawing.drawImage(image, 0, 0, 600, 600);
            else drawing.fillRect(0, 0, 600, 600);
          }, 100);
          window.__cameraTestStreams.push(stream);
          return stream;
        }
      });
    }, { imageUrl: qrImage });

    stage = "manual camera stop";
    await camera.goto(`${origin}/coordinator/check-in`);
    await camera.getByRole("button", { name: "Start camera", exact: true }).click();
    await camera.getByRole("button", { name: "Stop camera", exact: true }).waitFor();
    assert.equal(await camera.evaluate(() => window.__cameraTestStreams.some((stream) => stream.getTracks().some((track) => track.readyState === "live"))), true, "Stop test never opened a live camera.");
    await camera.getByRole("button", { name: "Stop camera", exact: true }).click();
    await camera.waitForFunction(() => window.__cameraTestStreams.length > 0
      && window.__cameraTestStreams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended"))
      && document.querySelector("video")?.srcObject === null);
    await camera.getByRole("button", { name: "Start camera", exact: true }).waitFor();
    assert.equal(checkInRequests, 0, "Stopping the camera submitted a check-in.");
    passed.push("Manual camera stop ends live tracks and detaches the preview without submitting");

    async function cancelPendingCamera(label, cancel) {
      stage = label;
      const previousStreams = await camera.evaluate(() => {
        window.__cameraTestHoldPermission = true;
        // A wrongly resumed permission request would receive a real QR frame.
        window.__cameraTestDrawQr = true;
        return window.__cameraTestStreams.length;
      });
      await camera.getByRole("button", { name: "Start camera", exact: true }).click();
      await camera.waitForFunction(() => window.__cameraTestPermissionPending === true);
      await cancel();
      await camera.evaluate(() => {
        if (typeof window.__cameraTestReleasePermission !== "function") throw new Error("No permission request is pending.");
        window.__cameraTestReleasePermission();
      });
      await camera.waitForFunction((count) => window.__cameraTestPermissionPending === false
        && window.__cameraTestStreams.length === count + 1
        && window.__cameraTestStreams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended"))
        && (!document.querySelector("video") || document.querySelector("video").srcObject === null), previousStreams);
      assert.equal(checkInRequests, 0, "A canceled permission request submitted a check-in.");
    }

    await cancelPendingCamera("manual mode while camera permission is pending", async () => {
      await camera.getByRole("button", { name: "Enter pass code", exact: true }).click();
      await camera.getByLabel("Entry pass code", { exact: true }).waitFor();
    });
    assert.equal(await camera.getByRole("button", { name: "Enter pass code", exact: true }).getAttribute("aria-pressed"), "true", "Late camera permission replaced manual mode.");
    passed.push("Switching to manual entry cancels pending permission; late tracks end without submitting");
    await camera.getByRole("button", { name: "Scan with camera", exact: true }).click();

    await cancelPendingCamera("background visibility while camera permission is pending", async () => {
      await camera.evaluate(() => {
        Object.defineProperty(document, "hidden", { value: true, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await camera.getByRole("button", { name: "Start camera", exact: true }).waitFor();
    });
    await camera.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await camera.getByRole("button", { name: "Start camera", exact: true }).waitFor();
    passed.push("Background visibility cancels pending permission; late tracks end without submitting");

    stage = "software camera scanning";
    await camera.getByRole("button", { name: "Start camera", exact: true }).click();
    await camera.getByRole("heading", { name: "Camera test household", exact: true }).waitFor();
    assert.equal(checkInRequests, 1, "Canceled camera attempts added an unexpected check-in request.");
    assert.match(await camera.locator('[class*="resultAccepted"]').innerText(), /3 invited guests.*2 adults.*1 child/s, "Software camera returned incorrect attendance.");
    assert.equal(await camera.evaluate(() => window.__cameraTestStreams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended"))), true, "Camera remained active after check-in.");
    passed.push("Camera QR decoded with no native BarcodeDetector; counts verified; camera stopped");
    if (artifactDir) {
      await mkdir(artifactDir, { recursive: true });
      await camera.screenshot({ path: path.join(artifactDir, "camera-fallback-mobile.png"), fullPage: true });
    }

    stage = "duplicate camera scan";
    await camera.getByRole("button", { name: "Scan next", exact: true }).click();
    await camera.locator('[class*="resultAlready"]').waitFor();
    assert.match(await camera.locator('[class*="resultAlready"]').innerText(), /already/i, "A repeated scan created another admission.");
    passed.push("Repeated camera scan reports existing admission");

    stage = "camera permission denial";
    await camera.evaluate(() => { window.__cameraTestDenied = true; });
    await camera.getByRole("button", { name: "Scan next", exact: true }).click();
    await camera.getByText("Camera permission is off.", { exact: false }).waitFor();
    await camera.getByRole("button", { name: "Enter pass code", exact: true }).click();
    await camera.getByLabel("Entry pass code", { exact: true }).fill("invalid-pass");
    await camera.getByRole("button", { name: "Check in guest", exact: true }).click();
    await camera.getByRole("alert").filter({ hasText: "not a recognised entry pass" }).waitFor();
    passed.push("Camera denial offers manual entry; malformed pass rejected");

    stage = "browser error check";
    assert.equal(errors.length, 0, "Camera flow raised a browser error.");
    return { passed, browserErrors: errors.length };
  } catch {
    throw new Error(`Playwright camera check failed at: ${stage}. Private test credentials omitted.`);
  } finally {
    if (invitationId) {
      await post("/api/coordinator/invitations/revoke", { invitationId });
      await post("/api/coordinator/invitations/rsvp/delete", { invitationId });
    }
    await context.close();
  }
}
