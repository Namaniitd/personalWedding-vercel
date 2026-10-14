import QRCode from "qrcode";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createQrFrameReader } from "@/lib/qr-scanner";

const payload = `shaadi-entry:v1:${"A".repeat(43)}`;

function cameraFrame(value: string) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const quiet = 4;
  const scale = 6;
  const size = (qr.modules.size + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / scale) - quiet;
      const column = Math.floor(x / scale) - quiet;
      const black = row >= 0 && column >= 0 && row < qr.modules.size && column < qr.modules.size && qr.modules.get(row, column);
      const offset = (y * size + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = black ? 0 : 255;
      pixels[offset + 3] = 255;
    }
  }
  const context = {
    drawImage: vi.fn(),
    getImageData: () => ({ data: pixels })
  };
  const canvas = { width: size, height: size, getContext: () => context };
  const createElement = vi.fn(() => canvas);
  vi.stubGlobal("document", { createElement });
  return { video: { videoWidth: size, videoHeight: size } as HTMLVideoElement, createElement, pixels };
}

afterEach(() => vi.unstubAllGlobals());

describe("camera QR reader", () => {
  it("decodes a real opaque pass without a native BarcodeDetector", async () => {
    const { video, createElement } = cameraFrame(payload);
    const read = await createQrFrameReader(video);
    expect(await read()).toBe(payload);
    expect(createElement).toHaveBeenCalledWith("canvas");
  });

  it("uses software when native QR support is absent", async () => {
    const { video } = cameraFrame(payload);
    class NonQrDetector {
      static getSupportedFormats = async () => ["ean_13"];
      detect = vi.fn(async () => [{ rawValue: "incorrect" }]);
    }
    const read = await createQrFrameReader(video, NonQrDetector);
    expect(await read()).toBe(payload);
  });

  it("falls back after a native detection failure", async () => {
    const { video } = cameraFrame(payload);
    class BrokenDetector {
      detect = async () => { throw new Error("Native decoding unavailable"); };
    }
    const read = await createQrFrameReader(video, BrokenDetector);
    expect(await read()).toBe(payload);
  });

  it("keeps native decoding when supported without allocating camera pixels", async () => {
    const { video, createElement } = cameraFrame(payload);
    class NativeDetector {
      static getSupportedFormats = async () => ["qr_code"];
      detect = async () => [{ rawValue: payload }];
    }
    const read = await createQrFrameReader(video, NativeDetector);
    expect(await read()).toBe(payload);
    expect(createElement).not.toHaveBeenCalled();
  });

  it("returns no code for a blank camera frame", async () => {
    const { video, pixels } = cameraFrame(payload);
    pixels.fill(255);
    const read = await createQrFrameReader(video);
    expect(await read()).toBeNull();
  });
});
